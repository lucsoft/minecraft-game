import * as BABYLON from "@babylonjs/core";
import { memoize } from "@std/cache/memoize";
import { createVertexDataFromModel, emptyModel, solidBlock } from "./bakeing.ts";
import { Chunk, CHUNK_SIZE, getIndexFromLocalBlock } from "./world.ts";

const FACE_BITS = { up: 1, down: 2, north: 4, south: 8, west: 16, east: 32 } as const;
const FACE_NAMES = Object.keys(FACE_BITS) as (keyof typeof FACE_BITS)[];
const vertexDataFromModel = memoize((modelName: string, mask: number) => {
    const hidden = mask === 0 ? undefined : new Set(FACE_NAMES.filter(f => mask & FACE_BITS[ f ]));
    return createVertexDataFromModel(modelName, hidden);
}, { getKey: (modelName, mask) => `${modelName}:${mask}` });

export function renderChunk(chunk: Chunk, offset: BABYLON.Vector3) {
    const worldHeight = chunk.blocks.length / (CHUNK_SIZE * CHUNK_SIZE);

    const solidLayers = Array.from({ length: worldHeight }, (_, y) => {
        for (let z = 0; z < CHUNK_SIZE; z++)
            for (let x = 0; x < CHUNK_SIZE; x++)
                if (!solidBlock(chunk.blockPalette[ chunk.blocks[ getIndexFromLocalBlock(x, y, z) ] ])) return false;
        return true;
    });

    const isOpaque = (x: number, y: number, z: number): boolean => {
        if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) return false;
        if (y < 0 || y >= worldHeight) return false;
        if (solidLayers[ y ]) return true;
        return solidBlock(chunk.blockPalette[ chunk.blocks[ getIndexFromLocalBlock(x, y, z) ] ]);
    };

    const allPositions: number[] = [];
    const allIndices: number[] = [];
    const allUVs: number[] = [];
    const allColors: number[] = [];
    let indexOffset = 0;
    for (let y = 0; y < worldHeight; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            for (let x = 0; x < CHUNK_SIZE; x++) {
                const modelName = chunk.blockPalette[ chunk.blocks[ getIndexFromLocalBlock(x, y, z) ] ];
                if (emptyModel(modelName)) continue;

                let mask = 0;
                if (isOpaque(x, y + 1, z)) mask |= FACE_BITS.up;
                if (isOpaque(x, y - 1, z)) mask |= FACE_BITS.down;
                if (isOpaque(x, y, z - 1)) mask |= FACE_BITS.north;
                if (isOpaque(x, y, z + 1)) mask |= FACE_BITS.south;
                if (isOpaque(x - 1, y, z)) mask |= FACE_BITS.west;
                if (isOpaque(x + 1, y, z)) mask |= FACE_BITS.east;

                const vd = vertexDataFromModel(modelName, mask);
                if (!vd) continue;

                const positions = vd.positions as number[];
                const bx = (x + offset.x) * 16;
                const by = (y + offset.y) * 16;
                const bz = (z + offset.z) * 16;
                for (let i = 0; i < positions.length; i += 3) {
                    allPositions.push(positions[ i ] + bx, positions[ i + 1 ] + by, positions[ i + 2 ] + bz);
                }

                for (const i of (vd.indices as number[]))
                    allIndices.push(i + indexOffset);

                (vd.uvs as number[]).forEach(uv => allUVs.push(uv));
                (vd.colors as number[]).forEach(color => allColors.push(color));
                indexOffset += positions.length / 3;
            }
        }
    }

    const vertexData = new BABYLON.VertexData();
    vertexData.positions = allPositions;
    vertexData.indices = allIndices;
    vertexData.uvs = allUVs;
    vertexData.colors = allColors;
    return vertexData;
}
