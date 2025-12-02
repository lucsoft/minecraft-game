import './css.ts'
import * as BABYLON from "https://esm.sh/@babylonjs/core";
import './assets.ts'
import { assetState, loadAssets, minecraftBlockstates } from "./assets.ts";
import { asyncMaterials, blockBorder, range, renderChunk } from "./utils.ts";
import { bakeModel, isEmptyModel } from "./backing.ts";
import { memoize } from "https://esm.sh/jsr/@std/cache";

document.head.innerHTML += `<meta name="color-scheme" content="light dark">`;
const canvas = document.createElement("canvas");
document.body.append(canvas);
const engine = new BABYLON.WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
await engine.initAsync();
const scene = new BABYLON.Scene(engine);
loadAssets().then(() => {
    const blockStates = minecraftBlockstates.entries()
        .filter(([ _, value ]) => value.variants !== undefined)
        .map(([ _, value ]) => {
            const lookupKey = (key: string) => Array.isArray(value.variants![ key ]) ? value.variants![ key ][ 0 ].model : value.variants![ key ].model
            return Object.keys(value.variants!).map(k => lookupKey(k))[0];
        })
        .filter((modelName) => !isEmptyModel(modelName));

    const rowLimit = 25;
    blockStates.toArray().toSorted().entries().forEach(([ index, modelName ]) => {
        const x = index % rowLimit;
        const z = Math.floor(index / rowLimit);
        asyncMaterials.add({ model: modelName, position: new BABYLON.Vector3(x + x + 1, 0,  z + z - 3) });
        asyncMaterials.add({ model: "block/stone", position: new BABYLON.Vector3(x + x + 1, -1, z + z - 3) });
    });

    renderChunk([
        ...range(0, 8).map((_, borderRadius) => range(0, 16 * 16)
            .map((_, i) => blockBorder(i, borderRadius, `block/sandstone`, `block/air`))),
        ...range(0, 8).map((_, borderRadius) => range(0, 16 * 16)
            .map((_, i) => blockBorder(i, 7 - borderRadius, `block/deepslate`, `block/air`))),
        ...range(0, 8).map((_, borderRadius) => range(0, 16 * 16)
            .map((_, i) => blockBorder(i, borderRadius, `block/cobblestone`, `block/air`))),
    ], new BABYLON.Vector3(-20, 0, 10), scene);
});



const camera = new BABYLON.FreeCamera("camera", new BABYLON.Vector3(20, 20, -20), scene);
camera.attachControl();
camera.keysUp = [87];
camera.keysDown = [83];
camera.keysLeft = [65];
camera.keysRight = [68];
camera.keysUpward = [ 32 ];
camera.keysDownward = [ 16 ];
camera.speed = 5;
camera.mode = BABYLON.Camera.PERSPECTIVE_CAMERA;
new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, -1), scene);

const modelBoxes = memoize((model: string) => {
    const box = bakeModel(model);
    scene.removeMesh(box);
    return box;
})

engine.runRenderLoop(() => {
    scene.render();
    if (assetState.loaded) {
        while (asyncMaterials.size > 0) {
            const asyncMaterial = asyncMaterials.values().next().value!;
            asyncMaterials.delete(asyncMaterial);
            if (asyncMaterial.mesh) {
                scene.addMesh(asyncMaterial.mesh);
            } else {
                const box = modelBoxes(asyncMaterial.model).clone();
                box.position = asyncMaterial.position.scale(16);
            }
        }
    }
});

addEventListener("click", () => {
    if (!engine.isPointerLock) {
        engine.enterPointerlock();
    }
})

addEventListener("resize", () => {
    engine.resize();
});

addEventListener("DOMContentLoaded", () => {
    engine.resize();
});