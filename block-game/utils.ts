import * as BABYLON from "@babylonjs/core";
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

export const rawChunks = new Set<{ x: number, z: number, chunk: Chunk; }>();
export const computedChunks = new Set<{ x: number, z: number, chunkData: BABYLON.VertexData; }>();

export function range(start: number, end: number) {
    return Array.from({ length: end - start }, (_, i) => i + start);
};

export function positionToGlobalLocation(position: BABYLON.Vector3) {
    const x = Math.floor(position.x / CHUNK_SIZE);
    const y = Math.floor(position.y / CHUNK_SIZE);
    const z = Math.floor(position.z / CHUNK_SIZE);
    return { x, y, z };
}

export function positionToChunkId(position: BABYLON.Vector3 | { x: number, z: number; }) {
    const chunkX = Math.floor(position.x / CHUNK_SIZE);
    const chunkZ = Math.floor(position.z / CHUNK_SIZE);
    return { x: chunkX, z: chunkZ };
}