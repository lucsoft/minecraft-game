import * as BABYLON from "https://esm.sh/@babylonjs/core";

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

export const asyncMaterials = new Set<{ model: string, position: BABYLON.Vector3 }>();

export function renderChunk(layers: string[][], offset: BABYLON.Vector3) {
    layers.forEach((layer, y) => {
        layer.forEach((modelName, index) => {
            const x = index % 16;
            const z = Math.floor(index / 16);
            asyncMaterials.add({ model: modelName, position: new BABYLON.Vector3(x + offset.x, y + offset.y, z + offset.z) });
        });
    });
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