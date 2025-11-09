import './css.ts'
import * as BABYLON from "https://esm.sh/@babylonjs/core";
import './assets.ts'
import { assetState, getMinecraftModel, loadAssets, minecraftBlockstates, minecraftModels } from "./assets.ts";
import { asyncMaterials, blockBorder, range, renderChunk } from "./utils.ts";
document.head.innerHTML += `<meta name="color-scheme" content="light dark">`;
const canvas = document.createElement("canvas");
document.body.append(canvas);
const engine = new BABYLON.WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
await engine.initAsync();
const scene = new BABYLON.Scene(engine);
loadAssets().then(() => {
    const ground = BABYLON.CreateGround("ground", { width: 30, height: 30 }, scene);

    const material = new BABYLON.StandardMaterial("material", scene);
    material.backFaceCulling = false;
    material.diffuseTexture = assetState.blockItemsAtlas!;
    material.transparencyMode = BABYLON.Material.MATERIAL_ALPHATEST;
    material.useAlphaFromDiffuseTexture = true;
    ground.material = material;
    ground.position.y = -1;

    const blockStates = minecraftBlockstates.entries()
        .filter(([ _, value ]) => value.variants !== undefined && value.variants[ "" ])
        .map(([ _, value ]) => Array.isArray(value.variants![ ""]) ? value.variants![ ""][0].model : value.variants![ ""].model);

    const rowLimit = 25;
    blockStates.filter(item =>
        !item.startsWith("minecraft:block/heavy_core")
    ).toArray().toSorted().entries().forEach(([ index, modelName ]) => {
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
    ], new BABYLON.Vector3(-20, 0, 10));
});


const camera = new BABYLON.ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.5, 20, new BABYLON.Vector3(0, 0, 0), scene);
camera.attachControl(canvas, true);

new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, -1), scene);
const ssao = new BABYLON.SSAORenderingPipeline("ssaopipeline", scene, 0.75, [ camera ]);
ssao.radius = 2;

engine.runRenderLoop(() => {
    scene.render();
    if (assetState.loaded) {
        while (asyncMaterials.size > 0) {
            const asyncMaterial = asyncMaterials.values().next().value!;
            asyncMaterials.delete(asyncMaterial);
            const box = getMinecraftModel(asyncMaterial.model).clone();
            box.visibility = 1;
            box.position = asyncMaterial.position;
        }
    }
});

addEventListener("resize", () => {
    engine.resize();
});

addEventListener("DOMContentLoaded", () => {
    engine.resize();
});