import * as BABYLON from "@babylonjs/core";
import { bakeModel } from "./backing.ts";

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

export const asyncMaterials = new Set<{ model: string, position: BABYLON.Vector3, mesh?: BABYLON.Mesh }>();

export async function renderChunk(layers: string[][], offset: BABYLON.Vector3, scene: BABYLON.Scene) {
    const mesh = BABYLON.Mesh.MergeMeshes(layers.flatMap((layer, y) => {
        return layer.map((modelName, index) => {
            const x = index % 16;
            const z = Math.floor(index / 16);
            const mesh = bakeModel(modelName);
            mesh.position = new BABYLON.Vector3(x, y, z).add(offset);
            mesh.position.scaleInPlace(16);
            scene.removeMesh(mesh);
            if (mesh.name === "emptyModel")
                return null;
            return mesh;
        }).filter((key) => !!key);
    }), true, true, undefined, false, true)!;
    scene.removeMesh(mesh);
    await mesh.optimizeIndicesAsync();

    asyncMaterials.add({ model: "block/air", mesh: mesh, position: offset });
}

export function blockBorder(index: number, radius: number, insideBlock: string, outsideBlock: string, chunkSize = 16)
{
    const x = index % chunkSize;
    const z = Math.floor(index / chunkSize);
    if (x < radius || x >= chunkSize - radius || z < radius || z >= chunkSize - radius) {
        return outsideBlock;
    }
    return insideBlock;
}

export function range(start: number, end: number) {
    return Array.from({ length: end - start }, (_, i) => i + start)
};