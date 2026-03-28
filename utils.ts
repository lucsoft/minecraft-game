import * as BABYLON from "@babylonjs/core";
import { createVertexDataFromModel, emptyModel, solidBlock } from "./backing.ts";
import { Chunk, CHUNK_SIZE } from "./world.ts";

export function iteratorToStream<T>(iterator: AsyncIterator<T>) {
    return new ReadableStream<T>({
        async pull(controller) {
            const { value, done } = await iterator.next();

            if (value && !done) {
                controller.enqueue(value);
            }
            if (done) {
                controller.close();
            }
        },
    });
}

export const rawChunks = new Set<{ index: number, x: number, z: number, chunk: Chunk; }>();
export const computedChunks = new Set<{ index: number, x: number, z: number, chunkData: BABYLON.VertexData; }>();

export function renderChunk(chunk: Chunk, offset: BABYLON.Vector3) {
    const worldHeight = chunk.blocks.length / (CHUNK_SIZE * CHUNK_SIZE);
    const idx = (x: number, y: number, z: number) => x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;

    const solidLayers = Array.from({ length: worldHeight }, (_, y) => {
        for (let z = 0; z < CHUNK_SIZE; z++)
            for (let x = 0; x < CHUNK_SIZE; x++)
                if (!solidBlock(chunk.blockPalette[ chunk.blocks[ idx(x, y, z) ] ])) return false;
        return true;
    });

    const isOpaque = (x: number, y: number, z: number): boolean => {
        if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) return false;
        if (y < 0 || y >= worldHeight) return false;
        if (solidLayers[ y ]) return true;
        return solidBlock(chunk.blockPalette[ chunk.blocks[ idx(x, y, z) ] ]);
    };

    const allPositions: number[] = [];
    const allIndices: number[] = [];
    const allUVs: number[] = [];
    const allColors: number[] = [];
    let indexOffset = 0;

    for (let y = 0; y < worldHeight; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            for (let x = 0; x < CHUNK_SIZE; x++) {
                const modelName = chunk.blockPalette[ chunk.blocks[ idx(x, y, z) ] ];
                if (emptyModel(modelName)) continue;

                const hidden = new Set<string>();
                if (isOpaque(x, y + 1, z)) hidden.add("up");
                if (isOpaque(x, y - 1, z)) hidden.add("down");
                if (isOpaque(x, y, z - 1)) hidden.add("north");
                if (isOpaque(x, y, z + 1)) hidden.add("south");
                if (isOpaque(x - 1, y, z)) hidden.add("west");
                if (isOpaque(x + 1, y, z)) hidden.add("east");

                const vd = createVertexDataFromModel(modelName, hidden.size > 0 ? hidden : undefined);
                if (!vd) continue;

                const positions = vd.positions as number[];
                const blockOffset = new BABYLON.Vector3(x, y, z).add(offset).scale(16);
                for (let i = 0; i < positions.length; i += 3) {
                    allPositions.push(positions[ i ] + blockOffset.x, positions[ i + 1 ] + blockOffset.y, positions[ i + 2 ] + blockOffset.z);
                }

                for (const i of (vd.indices as number[]))
                    allIndices.push(i + indexOffset);

                allUVs.push(...(vd.uvs as number[]));
                allColors.push(...(vd.colors as number[]));
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

export function blockBorder(index: number, radius: number, insideBlock: string, outsideBlock: string, chunkSize = 16) {
    const x = index % chunkSize;
    const z = Math.floor(index / chunkSize);
    if (x < radius || x >= chunkSize - radius || z < radius || z >= chunkSize - radius) {
        return outsideBlock;
    }
    return insideBlock;
}

export function range(start: number, end: number) {
    return Array.from({ length: end - start }, (_, i) => i + start);
};
