import { LruCache, MemoizationCacheResult, memoize } from "@std/cache";
import { ensureDir, exists } from "@std/fs";
import { dirname } from "@std/path";

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
