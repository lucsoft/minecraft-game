import * as BABYLON from "@babylonjs/core";
import { assert } from "@std/assert";
import { memoize } from "@std/cache";
import { decodeCbor } from "@std/cbor";
import { deepMerge } from "@std/collections";

interface MinecraftTexture {
    texture: BABYLON.Texture;
    animation?: {
        interpolate?: boolean;
        width?: number;
        height?: number;
        frametime: number;
        frames: Array<number | { index: number; time: number; }>;
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
        }>;
    }[];
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
        };
    }[] | null,
    blockItemsAtlas: null as BABYLON.Texture | null,
};
type AtlasCacheData = { rects: typeof assetState[ "blockItmesAtlasMeta" ], data: Uint8Array; width: number, height: number; };

const minecraftTargetJar = "https://piston-data.mojang.com/v1/objects/d3bdf582a7fa723ce199f3665588dcfe6bf9aca8/client.jar";
const assertCdn = new URL(`http://localhost:8000?${new URLSearchParams({ url: minecraftTargetJar })}`);

export async function loadAssets() {
    const requestMetadata = await fetch(assertCdn);
    assert(requestMetadata.ok, "Failed to load assets: " + requestMetadata.statusText);
    const metadata = await requestMetadata.json() as {
        objectId: string;
        blockstates: Record<string, MinecraftBlockstate>;
        models: Record<string, MinecraftModel>;
        files: string[];
    };

    Object.keys(metadata.blockstates).forEach(key => minecraftBlockstates.set(key, metadata.blockstates[ key ]));
    Object.keys(metadata.models).forEach(key => minecraftModels.set(key, metadata.models[ key ]));

    const atlasUrl = new URL(assertCdn);
    atlasUrl.searchParams.set("atlas", "true");
    const atlasResponse = await fetch(atlasUrl);
    assert(atlasResponse.ok, "Failed to load atlas: " + atlasResponse.statusText);
    const cbor = decodeCbor(await atlasResponse.bytes()) as AtlasCacheData;

    const atlas = new BABYLON.RawTexture(cbor.data, cbor.width, cbor.height, BABYLON.Engine.TEXTUREFORMAT_RGBA, null, false, false, BABYLON.Texture.NEAREST_NEAREST_MIPLINEAR);
    atlas.hasAlpha = true;
    assetState.blockItemsAtlas = atlas;
    assetState.blockItmesAtlasMeta = cbor.rects;

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

export interface AtlasMetaData {
    name: string;
    atlasUV: BABYLON.Vector4;
    animationKeys?: number;
    animation?: MinecraftTexture[ "animation" ];
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
