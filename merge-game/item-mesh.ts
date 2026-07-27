import * as BABYLON from "@babylonjs/core";
import { textureFileUrl } from "../asset-pipeline-url.ts";

const ALPHA_THRESHOLD = 8;
/** how many texels deep an item is, vanilla dropped items are one */
const THICKNESS_TEXELS = 2;
const SHADOW_RESOLUTION = 64;
/** penumbra in shadow-texture pixels: crisp where the item touches, soft at the far end */
const SHADOW_BLUR_NEAR = 1;
const SHADOW_BLUR_FAR = 7;
const SHADOW_ALPHA_NEAR = 0.8;
const SHADOW_ALPHA_FAR = 0.3;
/** the blur thins the silhouette out, this puts the weight back without losing the gradient */
const SHADOW_GAIN = 1.8;
/** the penumbra fans out sideways as well, so the far end of the shadow is wider */
const SHADOW_SPREAD = 1.35;
/** margin around the sprite inside the shadow texture, so the blur has room to bleed */
const SHADOW_PADDING = 0.2;

export interface AlphaMask {
    width: number;
    height: number;
    alpha: Uint8Array;
}

/** reads the opaque silhouette of an item sprite, animated sprites use their first frame */
export async function loadAlphaMask(name: string): Promise<AlphaMask> {
    const response = await fetch(textureFileUrl(name));
    if (!response.ok) throw new Error(`Failed to load ${name}: ${response.statusText}`);
    const bitmap = await createImageBitmap(await response.blob());
    const frame = Math.min(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, frame, frame);
    const alpha = new Uint8Array(frame * frame);
    for (let index = 0; index < alpha.length; index++) alpha[ index ] = data[ index * 4 + 3 ];
    bitmap.close();
    return { width: frame, height: frame, alpha };
}

/**
 * Builds a dropped-item style mesh: the sprite on both wide faces plus one-texel deep
 * side walls wherever an opaque texel borders a transparent one, so the outline of the
 * item is extruded instead of a plain box.
 */
export function buildItemMesh(name: string, size: number, mask: AlphaMask, scene: BABYLON.Scene) {
    const { width, height, alpha } = mask;
    const depth = (size / Math.max(width, height)) * THICKNESS_TEXELS;
    const half = size / 2;
    const texelX = size / width;
    const texelY = size / height;
    const opaque = (col: number, row: number) =>
        col >= 0 && row >= 0 && col < width && row < height && alpha[ row * width + col ] > ALPHA_THRESHOLD;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    function quad(corners: [ number, number, number ][], normal: [ number, number, number ], uv: [ number, number ][]) {
        const start = positions.length / 3;
        for (const [ index, corner ] of corners.entries()) {
            positions.push(...corner);
            normals.push(...normal);
            uvs.push(...uv[ index ]);
        }
        indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }

    // wide faces, the alpha channel cuts out the silhouette. world +x points to screen left,
    // so u runs the other way round to keep sprites reading like their gui icon
    const faceUV = (corners: [ number, number, number ][]) =>
        corners.map(([ x, y ]) => [ 1 - (x + half) / size, (y + half) / size ] as [ number, number ]);
    const front: [ number, number, number ][] = [ [ -half, -half, depth / 2 ], [ half, -half, depth / 2 ], [ half, half, depth / 2 ], [ -half, half, depth / 2 ] ];
    const back: [ number, number, number ][] = [ [ half, -half, -depth / 2 ], [ -half, -half, -depth / 2 ], [ -half, half, -depth / 2 ], [ half, half, -depth / 2 ] ];
    quad(front, [ 0, 0, 1 ], faceUV(front));
    quad(back, [ 0, 0, -1 ], faceUV(back));

    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            if (!opaque(col, row)) continue;
            const left = -half + col * texelX;
            const right = left + texelX;
            const top = half - row * texelY;
            const bottom = top - texelY;
            const texel: [ number, number ] = [ 1 - (col + 0.5) / width, 1 - (row + 0.5) / height ];
            const flat = [ texel, texel, texel, texel ];

            if (!opaque(col - 1, row)) {
                quad([ [ left, bottom, -depth / 2 ], [ left, bottom, depth / 2 ], [ left, top, depth / 2 ], [ left, top, -depth / 2 ] ], [ -1, 0, 0 ], flat);
            }
            if (!opaque(col + 1, row)) {
                quad([ [ right, bottom, depth / 2 ], [ right, bottom, -depth / 2 ], [ right, top, -depth / 2 ], [ right, top, depth / 2 ] ], [ 1, 0, 0 ], flat);
            }
            if (!opaque(col, row - 1)) {
                quad([ [ left, top, -depth / 2 ], [ left, top, depth / 2 ], [ right, top, depth / 2 ], [ right, top, -depth / 2 ] ], [ 0, 1, 0 ], flat);
            }
            if (!opaque(col, row + 1)) {
                quad([ [ left, bottom, depth / 2 ], [ left, bottom, -depth / 2 ], [ right, bottom, -depth / 2 ], [ right, bottom, depth / 2 ] ], [ 0, -1, 0 ], flat);
            }
        }
    }

    const mesh = new BABYLON.Mesh(`item:${name}`, scene);
    const vertexData = new BABYLON.VertexData();
    vertexData.positions = positions;
    vertexData.normals = normals;
    vertexData.uvs = uvs;
    vertexData.indices = indices;
    vertexData.applyToMesh(mesh);
    return mesh;
}

/**
 * Flat shadow of a sprite standing at `lean` radians: every corner is projected onto the sand
 * along `drift`, which shears the quad instead of turning it, so the silhouette keeps the
 * orientation of the item. Coordinates are relative to the item's footprint, including the
 * way the lean tips its bottom edge towards the camera.
 */
export function buildShadowMesh(name: string, size: number, lean: number, drift: BABYLON.Vector2, scene: BABYLON.Scene) {
    const half = size / 2;
    const height = size * Math.cos(lean);
    const nearZ = -half * Math.sin(lean);
    const reachX = drift.x * height;
    const reachZ = half * Math.sin(lean) + drift.y * height - nearZ;
    // the quad covers the padded texture, so the blurred edges are not clipped
    const nearHalf = half + SHADOW_PADDING * size;
    const farHalf = half * SHADOW_SPREAD + SHADOW_PADDING * size * SHADOW_SPREAD;
    const nearOffsetX = -SHADOW_PADDING * reachX;
    const nearOffsetZ = nearZ - SHADOW_PADDING * reachZ;
    const farOffsetX = reachX * (1 + SHADOW_PADDING);
    const farOffsetZ = nearZ + reachZ * (1 + SHADOW_PADDING);
    const mesh = new BABYLON.Mesh(`shade:${name}`, scene);
    const vertexData = new BABYLON.VertexData();
    vertexData.positions = [
        nearOffsetX - nearHalf, 0, nearOffsetZ,
        nearOffsetX + nearHalf, 0, nearOffsetZ,
        farOffsetX + farHalf, 0, farOffsetZ,
        farOffsetX - farHalf, 0, farOffsetZ,
    ];
    vertexData.normals = [ 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0 ];
    // u mirrored like the item faces, v running from the base of the sprite to its top
    vertexData.uvs = [ 1, 0, 0, 0, 0, 1, 1, 1 ];
    vertexData.indices = [ 0, 1, 2, 0, 2, 3 ];
    vertexData.applyToMesh(mesh);
    return mesh;
}

/**
 * Bakes the item silhouette into a shadow texture whose blur and darkness follow the distance
 * from the item's feet, the way a real penumbra spreads the further the shadow is thrown.
 */
export function buildShadowTexture(name: string, mask: AlphaMask, scene: BABYLON.Scene) {
    const size = SHADOW_RESOLUTION;
    const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
    // texture space includes a margin, this maps it back onto the sprite
    const spriteAt = (pixel: number) => ((pixel + 0.5) / size - SHADOW_PADDING) / (1 - 2 * SHADOW_PADDING);
    // the top of the sprite lands furthest from the item, its feet touch the ground
    const distanceOf = (row: number) => Math.min(1, Math.max(0, 1 - spriteAt(row)));

    const coverage = new Float32Array(size * size);
    for (let row = 0; row < size; row++) {
        const spriteRow = spriteAt(row);
        if (spriteRow < 0 || spriteRow >= 1) continue;
        const maskRow = Math.floor(spriteRow * mask.height);
        for (let col = 0; col < size; col++) {
            const spriteCol = spriteAt(col);
            if (spriteCol < 0 || spriteCol >= 1) continue;
            const maskCol = Math.floor(spriteCol * mask.width);
            coverage[ row * size + col ] = mask.alpha[ maskRow * mask.width + maskCol ] > ALPHA_THRESHOLD ? 1 : 0;
        }
    }

    const radiusOf = (row: number) => Math.round(lerp(SHADOW_BLUR_NEAR, SHADOW_BLUR_FAR, distanceOf(row)));
    const blurred = new Float32Array(size * size);
    const spread = new Float32Array(size * size);
    for (let row = 0; row < size; row++) {
        const radius = radiusOf(row);
        for (let col = 0; col < size; col++) {
            let total = 0;
            for (let step = -radius; step <= radius; step++) {
                const sample = Math.min(size - 1, Math.max(0, col + step));
                total += coverage[ row * size + sample ];
            }
            spread[ row * size + col ] = total / (radius * 2 + 1);
        }
    }
    for (let row = 0; row < size; row++) {
        const radius = radiusOf(row);
        for (let col = 0; col < size; col++) {
            let total = 0;
            for (let step = -radius; step <= radius; step++) {
                const sample = Math.min(size - 1, Math.max(0, row + step));
                total += spread[ sample * size + col ];
            }
            blurred[ row * size + col ] = total / (radius * 2 + 1);
        }
    }

    const texture = new BABYLON.DynamicTexture(`shade:${name}`, { width: size, height: size }, scene, true);
    const context = texture.getContext() as unknown as CanvasRenderingContext2D;
    const image = context.createImageData(size, size);
    for (let row = 0; row < size; row++) {
        const strength = lerp(SHADOW_ALPHA_NEAR, SHADOW_ALPHA_FAR, distanceOf(row));
        for (let col = 0; col < size; col++) {
            const index = (row * size + col) * 4;
            const value = Math.min(1, blurred[ row * size + col ] * SHADOW_GAIN);
            image.data[ index + 3 ] = Math.round(value * strength * 255);
        }
    }
    context.putImageData(image, 0, 0);
    // same orientation as the item textures: uv v 0 is the bottom of the sprite, its feet
    texture.update(true);
    texture.hasAlpha = true;
    return texture;
}
