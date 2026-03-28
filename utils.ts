import * as BABYLON from "@babylonjs/core";
import { createVertexDataFromModel, emptyModel, solidBlock } from "./backing.ts";
import { Chunk } from "./world.ts";

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
    const layerSize = 16;
    const layers = chunk.layers;

    const solidLayers = layers.map(layer => layer.every(block => solidBlock(chunk.blockPalette[ block ])));

    const isOpaque = (x: number, y: number, z: number): boolean => {
        if (x < 0 || x >= layerSize || z < 0 || z >= layerSize) return false;
        if (y < 0 || y >= layers.length) return false;
        if (solidLayers[ y ]) return true;
        return solidBlock(chunk.blockPalette[ layers[ y ][ x + z * layerSize ] ]);
    };

    const allPositions: number[] = [];
    const allIndices: number[] = [];
    const allUVs: number[] = [];
    const allColors: number[] = [];
    let indexOffset = 0;

    for (let y = 0; y < layers.length; y++) {
        const layer = layers[ y ];
        for (let index = 0; index < layer.length; index++) {
            const modelName = chunk.blockPalette[ layer[ index ] ];
            if (emptyModel(modelName)) continue;

            const x = index % layerSize;
            const z = Math.floor(index / layerSize);

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

            for (const idx of (vd.indices as number[]))
                allIndices.push(idx + indexOffset);

            allUVs.push(...(vd.uvs as number[]));
            allColors.push(...(vd.colors as number[]));
            indexOffset += positions.length / 3;
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