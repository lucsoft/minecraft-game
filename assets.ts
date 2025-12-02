import * as BABYLON from "@babylonjs/core";
import { Entry, ZipReader, FileEntry } from "@zip-js/zip-js";
import { iteratorToStream } from "./utils.ts";
import { chunk, deepMerge } from "https://esm.sh/jsr/@std/collections";
import { memoize } from "https://esm.sh/jsr/@std/cache";
import { MaxRectsPacker } from "https://esm.sh/maxrects-packer";
import { encodeCbor, decodeCbor } from "https://esm.sh/jsr/@std/cbor";

interface MinecraftTexture {
    texture: BABYLON.Texture;
    animation?: {
        interpolate?: boolean;
        width?: number;
        height?: number;
        frametime: number;
        frames: Array<number | { index: number; time: number }>;
    };
}

type PositionName = "thirdperson_righthand" | "thirdperson_lefthand" | "firstperson_righthand" | "firstperson_lefthand" | "head" | "gui" | "ground" | "fixed" | "on_shelf";
export type FaceName = "down" | "up" | "north" | "south" | "west" | "east";

export interface MinecraftModel {
    parent?: string;
    gui_light?: "font" | "side";
    display?: Record<PositionName, {
        rotation: [ number, number, number ];
        translation: [ number, number, number ];
        scale: [ number, number, number ];
    }>;
    textures?: Record<string, string>;
    elements?: {
        from: [ number, number, number ];
        to: [ number, number, number ];
        rotation?: {
            origin: [ number, number, number ];
            axis: "x" | "y" | "z";
            angle: number;
            rescale?: boolean;
        };
        faces: Record<FaceName, {
            uv: [ x1: number, y1: number, x2: number, y2: number ];
            texture: string;
            cullface?: FaceName;
            // texture rotation in degrees
            rotation?: 0 | 90 | 180 | 270;
            tintindex?: number;
        }>
    }[]
}
interface MinecraftModelVariantModel {
    model: string;
    x?: number;
    y?: number;
    uvlock?: boolean;
    weight?: number;
}
export interface MinecraftBlockstate {
    variants?: Record<string, MinecraftModelVariantModel[] | MinecraftModelVariantModel>;
}
export const minecraftModels = new Map<string, MinecraftModel>();
export const minecraftBlockstates = new Map<string, MinecraftBlockstate>();
const currentVersion = 3;
for (const element of Array.from({ length: currentVersion - 1 }, (_, i) => i + 1)) {
    await caches.delete("minecraft-cache-v" + element);
}
const mccache = await caches.open("minecraft-cache-v" + currentVersion);
const minecraft = await (async () => {
    const cachedResponse = await mccache.match("minecraft.jar");
    if (cachedResponse)
        return cachedResponse;

    const response = await fetch("minecraft.jar");
    mccache.put("minecraft.jar", response.clone());
    return response;
})();

const minecraftReader = new ZipReader(minecraft.body!);
const textureLoader = new Set<FileEntry>();
const animationStatistics = new Map<string,FileEntry>();
const modulesLoader = new Set<FileEntry>();
const blockstateLoader = new Set<FileEntry>();
export const assetState = {
    loaded: false,
    blockItmesAtlasMeta: null as {
        width: number,
        height: number,
        x: number,
        y: number,
        data: {
            name: string,
            animation: MinecraftTexture[ "animation" ];
        }
    }[] | null,
    blockItemsAtlas: null as BABYLON.Texture | null,
};
type AtlasCacheData = { rects: typeof assetState[ "blockItmesAtlasMeta" ], data: Uint8Array; width: number, height: number; };
const cachedModels: RequestInfo = new Request("/minecraft-models-cache-v1");
const cachedAtlas: RequestInfo = new Request("/minecraft-texture-atlas-v1");
const cachedBlockstates: RequestInfo = new Request("/minecraft-blockstates-cache-v1");
export async function loadAssets() {
    console.time("loadAllAssets");
    console.time("loadingCache");
    const cachedModelResponse = await mccache.match(cachedModels);
    const cachedAtlasResponse = await mccache.match(cachedAtlas);
    const cachedBlockstateResponse = await mccache.match(cachedBlockstates);
    console.timeEnd("loadingCache");
    if (!cachedAtlasResponse || !cachedModelResponse || !cachedBlockstateResponse) {
        console.time("loadAssets");
        const files = iteratorToStream(minecraftReader.getEntriesGenerator())
            .pipeThrough(new TransformStream<Entry, FileEntry>({
                transform(entry, controller) {
                    if (entry.filename.endsWith(".class")) return;
                    if (!('getData' in entry)) return;
                    // state.loadedFiles++;
                    if (entry.filename.startsWith("assets/minecraft/models/")) {
                        if (entry.filename.endsWith(".json"))
                            modulesLoader.add(entry as FileEntry);
                    }
                    if (entry.filename.startsWith("assets/minecraft/blockstates/")) {
                        if (entry.filename.endsWith(".json"))
                            blockstateLoader.add(entry as FileEntry);
                    }
                    if (entry.filename.startsWith("assets/minecraft/textures/")) {
                        if (entry.filename.endsWith(".png"))
                            textureLoader.add(entry as FileEntry);
                        if (entry.filename.endsWith(".mcmeta"))
                            animationStatistics.set(entry.filename, entry as FileEntry);
                    }
                    controller.enqueue(entry);
                }
            }));

        await Array.fromAsync(files);
        console.timeEnd("loadAssets");
    }
    console.time("loadBlockstates");
    if (cachedBlockstateResponse) {
        const entries = await cachedBlockstateResponse.json() as Record<string, MinecraftBlockstate>;
        for (const [ key, value ] of Object.entries(entries)) {
            minecraftBlockstates.set(key, value);
        }
    } else {
        for await (const files of chunk(blockstateLoader, 100)) {
            const blobs = await Promise.all(files.map(file => file.arrayBuffer().then(buffer => new Response(buffer).json())));
            for (const [ index, buffer ] of blobs.entries()) {
                const text = buffer as MinecraftBlockstate;
                minecraftBlockstates.set(files[index].filename.replace(/assets\/(minecraft)\/blockstates\//, "$1:").replace(".json", ""), text);
            }
        }
        const data = new Response(JSON.stringify(Object.fromEntries(minecraftBlockstates)));
        await mccache.put(cachedBlockstates, data);
    }
    console.timeEnd("loadBlockstates");
    console.time("loadModels");
    if (cachedModelResponse) {
        const entries = await cachedModelResponse.json() as Record<string, MinecraftModel>;
        for (const [ key, value ] of Object.entries(entries)) {
            minecraftModels.set(key, value);
        }
    } else {
        for await (const files of chunk(modulesLoader, 100)) {
            const blobs = await Promise.all(files.map(file => file.arrayBuffer().then(buffer => new Response(buffer).json())));
            for (const [ index, buffer ] of blobs.entries()) {
                const text = buffer as MinecraftModel;

                minecraftModels.set(files[index].filename.replace(/assets\/(minecraft)\/models\//, "$1:").replace(".json", ""), text);
            }
        }
        const data = new Response(JSON.stringify(Object.fromEntries(minecraftModels)));
        await mccache.put(cachedModels, data);
    }
    console.timeEnd("loadModels");
    console.time("loadTextures");

    if (cachedAtlasResponse) {
        const cbor = decodeCbor(await cachedAtlasResponse.bytes()) as AtlasCacheData;
        const atlas = new BABYLON.RawTexture(cbor.data, cbor.width, cbor.height, BABYLON.Engine.TEXTUREFORMAT_RGBA, null, false, false, BABYLON.Texture.NEAREST_NEAREST_MIPLINEAR);
        atlas.hasAlpha = true;
        assetState.blockItemsAtlas = atlas;
        assetState.blockItmesAtlasMeta = cbor.rects;
    } else {
        const minecraftTextures = new Map<string, MinecraftTexture>();
        for await (const files of chunk(textureLoader, 100)) {
            const blobs = await Promise.all(files.map(file => file.arrayBuffer()));
            for (const [ index, buffer ] of blobs.entries()) {
                const blob = new Blob([ buffer ], { type: "image/png" });
                const url = URL.createObjectURL(blob);
                const texture = new BABYLON.Texture(
                    url,
                    null,
                    false,
                    true,
                    BABYLON.Texture.NEAREST_NEAREST_MIPLINEAR,
                    () => URL.revokeObjectURL(url),
                (message, exception) => {
                    console.error("Failed to load texture:", message, exception);
                    });
                minecraftTextures.set(files[ index ].filename.replace(/assets\/(minecraft)\/textures\//, "$1:").replace(".png", ""), {
                    texture,
                    ...animationStatistics.has(files[ index ].filename + ".mcmeta") ? await new Response(await animationStatistics.get(files[ index ].filename + ".mcmeta")!.arrayBuffer()).json() : undefined,
                });
            }
        }

        const packer = new MaxRectsPacker<{ width: number, height: number, x: number, y: number, data: { name: string, texture: BABYLON.Texture, animation: MinecraftTexture["animation"] }; }>(1024,1024);
        const targetTextures = /^(.*:)(block|item).*$/;
        const coll = Intl.Collator("en");

        packer.addArray((Array.from(minecraftTextures.entries())).toSorted(([name],[nameB]) => coll.compare(name, nameB)).filter(([name]) => name.match(targetTextures)).map(([ name, object ]) => {
            const { height, width } = object.texture.getSize();
            return {
                width,
                height,
                data: { name, ...object }
            // deno-lint-ignore no-explicit-any
            } as any;
        }));

        if (packer.bins.length > 1) {
            throw new Error("Textures do not fit in a single atlas");
        }

        const bin = packer.bins[ 0 ];

        const dyn = new BABYLON.DynamicTexture("minecraftTextureAtlas", { width: bin.width, height: bin.height }, null, false, BABYLON.Texture.NEAREST_NEAREST_MIPLINEAR);
        const ctx = dyn.getContext();
        for (const rect of bin.rects) {
            const texture = rect.data.texture as BABYLON.Texture;
            const pixels = await texture.readPixels();
            if ((rect.width * rect.height * 4) === 0) {
                throw new Error("Texture has zero size" + rect.data.name);
            }
            const imgData = new ImageData(new Uint8ClampedArray(pixels as unknown as Iterable<number>), rect.width, rect.height);
            ctx.putImageData(imgData, rect.x, rect.y);
        }
        dyn.hasAlpha = true;
        dyn.update(false);
        assetState.blockItemsAtlas = dyn;
        assetState.blockItmesAtlasMeta = bin.rects;
        await mccache.put(cachedAtlas, new Response(new Uint8Array(encodeCbor({
            rects: bin.rects.map(rect => ({ ...rect, data: { ...rect.data, texture: undefined } })) as typeof assetState["blockItmesAtlasMeta"],
            data: new Uint8Array(await dyn.readPixels() as Uint8Array),
            height: bin.height,
            width: bin.width,
        } as AtlasCacheData))));
    }
    console.timeEnd("loadTextures");
    console.timeEnd("loadAllAssets");
    assetState.loaded = true;
}

export function normalizeName(name: string) {
    return name.startsWith("minecraft:") ? name : `minecraft:${name}`;
}

export const getMinecraftModelInfo = memoize((name: string): MinecraftModel => {
    const raw = minecraftModels.get(normalizeName(name));
    if (!raw) return {};

    if (raw.parent) {
        const parent = getMinecraftModelInfo(raw.parent);
        if (!parent) return raw;
        delete raw.parent;
        return deepMerge({ ...parent, elements: raw.elements ? undefined : parent.elements }, { ...raw });
    }
    return raw;
});

export const getMinecraftMaterialFromName = memoize((path: string) => {
    const material = new BABYLON.StandardMaterial(normalizeName(path));
    material.diffuseTexture = assetState.blockItemsAtlas!;
    material.useAlphaFromDiffuseTexture = true;
    material.transparencyMode = BABYLON.Material.MATERIAL_ALPHATESTANDBLEND;
    material.forceDepthWrite = true;
    return material;
});

export interface AtlasMetaData
{
    name: string;
    atlasUV: BABYLON.Vector4;
    animationKeys?: number;
    animation?: MinecraftTexture["animation"];
}

export const getAtlasMetaData = memoize((name: string) => {
    if (!assetState.blockItmesAtlasMeta) throw new Error("Atlas not loaded yet");
    const meta = assetState.blockItmesAtlasMeta.find(meta => meta.data.name === normalizeName(name));
    if (!meta) throw new Error(`Texture ${name} not found in atlas`);

    const { x, y, width: uvWidth, height: uvHeigth } = meta;
    const { height: atlasHeight, width: atlasWidth } = assetState.blockItemsAtlas!.getSize();
    const uvX = x / atlasWidth;
    const uvY = y / atlasHeight;
    const uvX2 = (x + uvWidth) / atlasWidth;
    const uvY2 = (y + uvHeigth) / atlasHeight;
    const atlasUV = new BABYLON.Vector4(uvX, uvY, uvX2, uvY2);
    return {
        name,
        atlasUV,
        animationKeys: meta.data.animation ? uvHeigth / uvWidth : undefined,
        animation: meta.data.animation,
    };
});
