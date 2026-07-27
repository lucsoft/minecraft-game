import * as BABYLON from "@babylonjs/core";
import { textureFileUrl } from "../asset-pipeline-url.ts";

const ALPHA_THRESHOLD = 8;
/** how many texels deep an item is, vanilla dropped items are one */
const THICKNESS_TEXELS = 3;

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
