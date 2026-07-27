import { LruCache, MemoizationCacheResult, memoize } from "@std/cache";
import { ensureDir, exists } from "@std/fs";
import { dirname } from "@std/path";
import { OggVorbisDecoder } from "@wasm-audio-decoders/ogg-vorbis";
import { analyseSound, SoundFeatures, toMono } from "./sound-features.ts";

const versionManifestUrl = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const assetObjectsUrl = "https://resources.download.minecraft.net";

/** sounds are not shipped in the jar, they live in the asset objects of the matching version */
interface AssetIndex {
    objects: Record<string, { hash: string; size: number; }>;
}

async function findAssetIndex(objectId: string) {
    const manifest = await fetch(versionManifestUrl).then(response => response.json()) as { versions: { id: string, url: string; }[]; };
    const batchSize = 16;
    // the newest versions come first, so a current jar is found within a batch or two
    for (let offset = 0; offset < Math.min(manifest.versions.length, 320); offset += batchSize) {
        const batch = await Promise.all(manifest.versions.slice(offset, offset + batchSize).map(async (version) => {
            const response = await fetch(version.url);
            // deno-lint-ignore no-explicit-any
            return response.ok ? await response.json() as any : null;
        }));
        const match = batch.find(version => version?.downloads?.client?.url?.includes(objectId));
        if (!match) continue;
        console.log(`[INFO] objectId ${objectId} is Minecraft ${match.id}, assets ${match.assetIndex.id}`);
        return await fetch(match.assetIndex.url).then(response => response.json()) as AssetIndex;
    }
    throw new Error(`No Minecraft version ships the client jar ${objectId}`);
}

export const assetIndex = memoize(async (objectId: string) => {
    const path = `./cache/${objectId}/asset-index.json`;
    if (!await exists(path, { isFile: true })) {
        await ensureDir(dirname(path));
        await Deno.writeTextFile(path, JSON.stringify(await findAssetIndex(objectId)));
    }
    return JSON.parse(await Deno.readTextFile(path)) as AssetIndex;
}, { cache: new LruCache<string, MemoizationCacheResult<Promise<AssetIndex>>>(4) });

/** downloads an asset object on first use and keeps it next to the rest of the cache */
export async function ensureAssetObject(objectId: string, name: string) {
    const index = await assetIndex(objectId);
    const object = index.objects[ name ];
    if (!object) return null;
    const path = `./cache/${objectId}/objects/${name}`;
    if (!await exists(path, { isFile: true })) {
        const response = await fetch(`${assetObjectsUrl}/${object.hash.slice(0, 2)}/${object.hash}`);
        if (!response.ok) throw new Error(`Failed to fetch asset ${name}: ${response.statusText}`);
        await ensureDir(dirname(path));
        await Deno.writeFile(path, await response.bytes());
    }
    return path;
}

const SOUND_PREFIX = "minecraft/sounds/";

type SoundEntry = string | { name: string; type?: "sound" | "event"; };
type SoundsJson = Record<string, { sounds?: SoundEntry[]; subtitle?: string; }>;

export interface SoundIndex {
    objectId: string;
    sounds: { name: string; size: number; }[];
    /** the sound events of the game, pointing at their files by index */
    events: { name: string; subtitle?: string; sounds: number[]; }[];
}

/**
 * sounds.json names its subtitles by translation key. The English strings for those are in the
 * jar rather than the asset objects, so they are only there once the jar has been unpacked.
 */
async function subtitles(objectId: string) {
    const path = `./cache/${objectId}/assets/minecraft/lang/en_us.json`;
    if (!await exists(path, { isFile: true })) return {} as Record<string, string>;
    return JSON.parse(await Deno.readTextFile(path)) as Record<string, string>;
}

/**
 * The asset index knows every ogg file, sounds.json knows which event plays it and what the
 * subtitle says. Neither alone is enough to label a node, so both are folded into one listing.
 */
export const soundIndex = memoize(async (objectId: string): Promise<SoundIndex> => {
    const index = await assetIndex(objectId);
    const translations = await subtitles(objectId);
    const files = Object.entries(index.objects)
        .filter(([ name ]) => name.startsWith(SOUND_PREFIX) && name.endsWith(".ogg"))
        .map(([ name, object ]) => ({ name: name.slice(SOUND_PREFIX.length, -".ogg".length), size: object.size }))
        .sort((a, b) => a.name < b.name ? -1 : 1);
    const position = new Map(files.map((file, at) => [ file.name, at ]));

    const events: SoundIndex[ "events" ] = [];
    const path = await ensureAssetObject(objectId, "minecraft/sounds.json");
    if (path) {
        const definitions = JSON.parse(await Deno.readTextFile(path)) as SoundsJson;
        for (const [ name, definition ] of Object.entries(definitions)) {
            const sounds = (definition.sounds ?? [])
                // an entry can point at another event instead of a file, those carry no audio of their own
                .filter(entry => typeof entry === "string" || entry.type !== "event")
                .map(entry => position.get(typeof entry === "string" ? entry : entry.name))
                .filter(at => at !== undefined);
            if (!sounds.length) continue;
            // an unresolved key is worse than nothing, "subtitles.entity.creeper.hurt" tells nobody anything
            events.push({ name, subtitle: definition.subtitle ? translations[ definition.subtitle ] : undefined, sounds });
        }
    }
    return { objectId, sounds: files, events };
}, { cache: new LruCache<string, MemoizationCacheResult<Promise<SoundIndex>>>(4) });

interface FeatureRow extends SoundFeatures {
    n: string;
}

interface Store {
    /** append only, so a stream that joined late can catch up by index */
    done: FeatureRow[];
    running: boolean;
    change: Promise<void>;
    notify: () => void;
}

const stores = new Map<string, Store>();

function bump(store: Store) {
    store.notify();
    store.change = new Promise(resolve => store.notify = resolve);
}

/** loads whatever was analysed in an earlier run, this is what makes a second visit instant */
async function loadStore(objectId: string) {
    const existing = stores.get(objectId);
    if (existing) return existing;
    const store: Store = { done: [], running: false, change: Promise.resolve(), notify: () => {} };
    bump(store);
    stores.set(objectId, store);

    const path = `./cache/${objectId}/sound-features.jsonl`;
    if (await exists(path, { isFile: true })) {
        for (const line of (await Deno.readTextFile(path)).split("\n")) {
            if (line) store.done.push(JSON.parse(line));
        }
        console.log(`[INFO] ${store.done.length} sounds already analysed for ${objectId}`);
    }
    return store;
}

const FETCH_BATCH = 8;

async function analyse(objectId: string, store: Store) {
    if (store.running) return;
    store.running = true;
    const decoder = new OggVorbisDecoder();
    const path = `./cache/${objectId}/sound-features.jsonl`;
    try {
        await decoder.ready;
        const index = await soundIndex(objectId);
        const seen = new Set(store.done.map(row => row.n));
        // the music and the records are minutes long each, they must not hold up the other 4000
        const todo = index.sounds
            .filter(sound => !seen.has(sound.name))
            .sort((a, b) => a.size - b.size)
            .map(sound => sound.name);
        if (!todo.length) return;

        await ensureDir(dirname(path));
        using file = await Deno.open(path, { write: true, create: true, append: true });
        const encoder = new TextEncoder();

        for (let offset = 0; offset < todo.length; offset += FETCH_BATCH) {
            const batch = todo.slice(offset, offset + FETCH_BATCH);
            // downloading is the slow part and decoding is single threaded wasm, so only fetch in parallel
            const paths = await Promise.all(batch.map(async (name) => {
                try {
                    return await ensureAssetObject(objectId, `${SOUND_PREFIX}${name}.ogg`);
                } catch (error) {
                    console.warn(`[WARN] ${name} could not be fetched:`, error);
                    return null;
                }
            }));
            const rows: FeatureRow[] = [];
            for (const [ at, soundPath ] of paths.entries()) {
                if (!soundPath) continue;
                try {
                    const decoded = await decoder.decodeFile(await Deno.readFile(soundPath));
                    if (!decoded.samplesDecoded) throw new Error("no samples");
                    rows.push({ n: batch[ at ], ...analyseSound(toMono(decoded.channelData), decoded.sampleRate) });
                } catch (error) {
                    console.warn(`[WARN] ${batch[ at ]} could not be analysed:`, error);
                }
            }
            if (rows.length) {
                await file.write(encoder.encode(rows.map(row => JSON.stringify(row)).join("\n") + "\n"));
                store.done.push(...rows);
            }
            bump(store);
            if ((offset / FETCH_BATCH) % 25 === 0) {
                console.log(`[INFO] analysed ${store.done.length} sounds, ${todo.length - offset - batch.length} to go`);
            }
        }
        console.log(`[INFO] sound analysis complete for ${objectId}`);
    } catch (error) {
        console.error("[ERROR] sound analysis stopped:", error);
    } finally {
        await decoder.free();
        store.running = false;
        bump(store);
    }
}

/**
 * Streams a feature row per sound as newline delimited JSON. Rows that are already cached go out
 * immediately and the rest follow as they are analysed, so the page can draw a graph that grows
 * instead of staring at a spinner for the first run.
 */
export async function streamSoundFeatures(objectId: string) {
    const index = await soundIndex(objectId);
    const store = await loadStore(objectId);
    analyse(objectId, store);

    const encoder = new TextEncoder();
    let cursor = 0;
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(encoder.encode(JSON.stringify({ total: index.sounds.length }) + "\n"));
        },
        async pull(controller) {
            while (cursor >= store.done.length) {
                if (!store.running) return controller.close();
                await store.change;
            }
            const rows = store.done.slice(cursor, cursor + 64);
            cursor += rows.length;
            controller.enqueue(encoder.encode(rows.map(row => JSON.stringify(row)).join("\n") + "\n"));
        },
    });
}
