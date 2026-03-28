import * as BABYLON from "@babylonjs/core";
import { bakeModel, isEmptyModel, isSolidBlock } from "./backing.ts";

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

export const asyncMaterials = new Set<{ model: string, position: BABYLON.Vector3, mesh?: BABYLON.Mesh; }>();

export function renderChunk(layers: string[][], offset: BABYLON.Vector3, scene: BABYLON.Scene) {
    const layerSize = 16;

    const solidLayers = layers.map(layer => layer.every(block => isSolidBlock(block)));

    const isOpaque = (x: number, y: number, z: number): boolean => {
        if (x < 0 || x >= layerSize || z < 0 || z >= layerSize) return false;
        if (y < 0 || y >= layers.length) return false;
        if (solidLayers[ y ]) return true;
        return isSolidBlock(layers[ y ][ x + z * layerSize ]);
    };

    const meshes = layers.flatMap((layer, y) =>
        layer.map((modelName, index) => {
            if (isEmptyModel(modelName)) return null;

            const x = index % layerSize;
            const z = Math.floor(index / layerSize);

            const hidden = new Set<string>();
            if (isOpaque(x, y + 1, z)) hidden.add("up");
            if (isOpaque(x, y - 1, z)) hidden.add("down");
            if (isOpaque(x, y, z - 1)) hidden.add("north");
            if (isOpaque(x, y, z + 1)) hidden.add("south");
            if (isOpaque(x - 1, y, z)) hidden.add("west");
            if (isOpaque(x + 1, y, z)) hidden.add("east");

            const mesh = bakeModel(modelName, hidden.size > 0 ? hidden : undefined);
            mesh.position = new BABYLON.Vector3(x, y, z).add(offset);
            mesh.position.scaleInPlace(16);
            scene.removeMesh(mesh);
            if (mesh.name === "emptyModel") return null;
            return mesh;
        }).filter((m) => !!m)
    );

    const merged = BABYLON.Mesh.MergeMeshes(meshes, true, true, undefined, false, true)!;
    scene.removeMesh(merged);
    asyncMaterials.add({ model: "block/air", mesh: merged, position: offset });
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