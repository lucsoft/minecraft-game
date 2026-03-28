import { ZipReader } from "@zip-js/zip-js";
import { ensureDir, exists } from "@std/fs";
import { dirname } from "@std/path";
import { encodeCbor  } from "@std/cbor";
import { memoize, LruCache, MemoizationCacheResult } from "@std/cache";
import { NullEngine, Scene } from "@babylonjs/core";
import { MaxRectsPacker } from "maxrects-packer";
import { createCanvas, Image, loadImage } from "@gfx/canvas-wasm";
import { serveFile } from "@std/http";
const kv = await Deno.openKv("./cache/asset-cache.kv");
const engine = new NullEngine();
new Scene(engine);
const validUrlPattern = /https:\/\/piston-data\.mojang\.com\/v1\/objects\/(?<objectId>.*)\/client\.jar/

async function makeMinecraftAssetCache(objectId: string, stream: ReadableStream<Uint8Array<ArrayBuffer>>)
{
    const minecraftReader = new ZipReader(stream!);

    const files = new Set<string>();
    for await (const entry of await minecraftReader.getEntries()) {
        if (!('getData' in entry)) continue;
        if (entry.filename.endsWith(".class")) continue;
        files.add(entry.filename);
        await ensureDir(dirname(`./cache/${objectId}/${entry.filename}`));
        await using writeFile = await Deno.open(`./cache/${objectId}/${entry.filename}`, { write: true, create: true, truncate: true });
        await entry.getData(writeFile.writable);
    }
    await Deno.writeTextFile(`./cache/${objectId}/index.json`, Array.from(files).join("\n"));
    return Array.from(files);
}

async function ensureCache(objectId: string, url: URL) {
    const item = await kv.get<true>([ "assets", "v0", objectId ]);
    if (!item.value) {
        const response = await fetch(url.searchParams.get("url") ?? "");
        if (!response.ok) throw new Error("Failed to fetch the object");
        await makeMinecraftAssetCache(objectId, response.body!);
        await kv.set([ "assets", "v0", objectId ], true);
    }
}

async function ensureBlockstates(files: string[], objectId: string) {
    const item = await kv.get<true>([ "blockstates", "v0", objectId ]);
    if (item.value) return;
    console.log(`[INFO] Caching blockstates for objectId: ${objectId}`);
    for (const file of files) {
        if (!file.startsWith("assets/minecraft/blockstates/") || !file.endsWith(".json")) continue;
        await using readFile = await Deno.open(`./cache/${objectId}/${file}`, { read: true });
        const content = await new Response(readFile.readable).json();
        await kv.set([ "blockstates", "v0", objectId, file.replace(/assets\/(minecraft)\/models\//, "$1:").replace(".json", "") ], content);
    }
    await kv.set([ "blockstates", "v0", objectId ], true);
}

const fileIndex = memoize(async (objectId: string) => {
    return await Deno.readTextFile(`./cache/${objectId}/index.json`).then(content => content.split("\n"));;
}, { cache: new LruCache<string, MemoizationCacheResult<Promise<string[]>>>(10) });

const jsonCache = memoize(async (keys: string[]) => {
    return Object.fromEntries((await Array.fromAsync(kv.list({ prefix: keys }))).map(({ key, value }) => [ key.at(-1)!, value ]))
}, { cache: new LruCache<string, MemoizationCacheResult<Promise<unknown>>>(10), getKey: (keys) => `${keys.join(":")}` });

async function ensureModels(files: string[], objectId: string) {
    const item = await kv.get<true>([ "models", "v0", objectId ]);
    if (item.value) return;
    console.log(`[INFO] Caching models for objectId: ${objectId}`);
    for (const file of files) {
        if (!file.startsWith("assets/minecraft/models/") || !file.endsWith(".json")) continue;
        await using readFile = await Deno.open(`./cache/${objectId}/${file}`, { read: true });
        const content = await new Response(readFile.readable).json();
        await kv.set([ "models", "v0", objectId, file.replace(/assets\/(minecraft)\/models\//, "$1:").replace(".json", "") ], content);
    }
    await kv.set([ "models", "v0", objectId ], true);
}

async function ensureAtlas(files: string[], objectId: string)
{
    const item = await kv.get<true>([ "atlas", "v0", objectId ]);
    if (item.value) return;
    console.log(`[INFO] Caching atlas for objectId: ${objectId}`);
    const textures = new Map<string, {
        image: Image,
        animation?: {
            interpolate?: boolean;
            width?: number;
            height?: number;
            frametime: number;
            frames: Array<number | { index: number; time: number }>;
        };
    }>();
    for (const file of files) {
        if (!file.startsWith("assets/minecraft/textures/") || !file.endsWith(".png")) continue;
        await using readFile = await Deno.open(`./cache/${objectId}/${file}`, { read: true });
        const blob = await new Response(readFile.readable, { headers: { "Content-Type": "image/png" } }).bytes();
        const image = await loadImage(blob);
        const mcmeta = `./cache/${objectId}/${file.replace(".png", ".json")}`;
        textures.set(file.replace(/assets\/(minecraft)\/textures\//, "$1:").replace(".png", ""), {
            image,
            ...await exists(mcmeta, { isFile: true }) ? JSON.parse(await Deno.readTextFile(`./cache/${objectId}/${file.replace(".png", ".json")}`)) : {}
        });
    }
    const size = 2 ** 10;
    // deno-lint-ignore no-explicit-any
    const packer = new MaxRectsPacker<{ width: number, height: number, x: number, y: number, data: { name: string, image: Image, animation: any }; }>(size,size);
    const targetTextures = /^(.*:)(block|item).*$/;
    const coll = Intl.Collator("en");
    packer.addArray((Array.from(textures.entries())).toSorted(([name],[nameB]) => coll.compare(name, nameB)).filter(([name]) => name.match(targetTextures)).map(([ name, object ]) => {
        return {
            width: object.image.width(),
            height: object.image.height(),
            data: { name, ...object }
        // deno-lint-ignore no-explicit-any
        } as any;
    }));
     if (packer.bins.length > 1) {
        throw new Error("Textures do not fit in a single atlas: " + packer.bins.length + " bins needed");
     }
    const bin = packer.bins[ 0 ];
    const canvas = createCanvas(bin.width, bin.height);

    const ctx = canvas.getContext("2d");
    for (const rect of bin.rects) {
        ctx.drawImage(rect.data.image, rect.x, rect.y);
    }

    await Deno.writeFile(`./cache/${objectId}/atlas.cbor`, encodeCbor({
        rects: bin.rects.map(rect => ({ ...rect, data: { ...rect.data, image: undefined } })),
        data: canvas.getRawBuffer(0, 0, bin.width, bin.height),
        width: bin.width,
        height: bin.height,
    }));
    await Deno.writeFile(`./cache/${objectId}/atlas.png`, canvas.toBuffer("image/png"));
    canvas.dispose();
    await kv.set([ "atlas", "v0", objectId ], true);
}

function respond(rsp: Response) {
    rsp.headers.set("Access-Control-Allow-Origin", "*");
    rsp.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    rsp.headers.set("Access-Control-Allow-Headers", "Content-Type");
    rsp.headers.set("Access-Control-Max-Age", "86400");
    return rsp;
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS")
        return respond(new Response("", { status: 200}));
    console.log(`[INFO] ${req.method} - ${req.url}`);
    const url = new URL(req.url);
    if (!url.searchParams.has("url")) return respond(new Response("Missing url parameter", { status: 400 }));

    const objectId = url.searchParams.get("url")?.match(validUrlPattern)?.groups?.objectId;
    if (!objectId) return respond(new Response("Invalid URL", { status: 400 }));

    await ensureCache(objectId, url);

    const files = await fileIndex(objectId);
    await ensureBlockstates(files, objectId);
    await ensureModels(files, objectId);
    await ensureAtlas(files, objectId);

    if (url.searchParams.has("atlas")) return respond(await serveFile(req, `./cache/${objectId}/atlas.cbor`));
    if (url.searchParams.has("atlaspng")) return respond(await serveFile(req, `./cache/${objectId}/atlas.png`));
    if (url.searchParams.has("files")) return respond(Response.json(files));
    return respond(Response.json({
        objectId,
        files,
        blockstates: await jsonCache([ "blockstates", "v0", objectId ]),
        models: await jsonCache([ "models", "v0", objectId ]),
    }));
})
