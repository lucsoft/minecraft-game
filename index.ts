import * as BABYLON from "https://esm.sh/@babylonjs/core";
import './assets.ts'
import { assetState, getMinecraftModel, loadAssets, minecraftModels } from "./assets.ts";
import './index.css';
document.head.innerHTML += `<meta name="color-scheme" content="light dark">`;
const canvas = document.createElement("canvas");
document.body.append(canvas);
const engine = new BABYLON.WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
await engine.initAsync();
const asyncMaterials = new Set<{ model: string, position: BABYLON.Vector3 }>();
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

    const blocks = minecraftModels.keys().filter(model =>
        model.startsWith("minecraft:block/")
        && !model.includes("template_")
        && !model.startsWith("minecraft:block/crop")
        && !model.startsWith("minecraft:block/flowerbed")
        && !model.startsWith("minecraft:block/orientable")
        && !model.startsWith("minecraft:block/fence")
        && !model.startsWith("minecraft:block/cube")
        && !model.startsWith("minecraft:block/button")
        && !model.startsWith("minecraft:block/door")
        && !model.startsWith("minecraft:block/custom")
        && !model.startsWith("minecraft:block/stem_growth")
        && !model.startsWith("minecraft:block/carpet")
        && !model.startsWith("minecraft:block/pressure_plate")
        && !model.startsWith("minecraft:block/cross")
        && !model.startsWith("minecraft:block/redstone_dust_side_alt")
        && !model.startsWith("minecraft:block/wall_inventory")
        && !model.startsWith("minecraft:block/tinted_flower_pot_cross")
        && !model.startsWith("minecraft:block/flower_pot_cross")
        && !model.startsWith("minecraft:block/rail_curved")
        && !model.startsWith("minecraft:block/sniffer_egg")
        && !model.startsWith("minecraft:block/outer_stairs")
        && !model.startsWith("minecraft:block/coral_wall_fan")
        && !model.startsWith("minecraft:block/coral_fan")
        && !model.startsWith("minecraft:block/leaves")
        && !model.startsWith("minecraft:block/pointed_dripstone")
        && !model.startsWith("minecraft:block/piston_extended")
        && !model.startsWith("minecraft:block/slab")
        && !model.startsWith("minecraft:block/rail_flat")
        && !model.startsWith("minecraft:block/stairs")
        && !model.startsWith("minecraft:block/inner_stairs")
        && !model.startsWith("minecraft:block/tinted_cross")
        && !model.startsWith("minecraft:block/redstone_dust_side")
        && !model.startsWith("minecraft:block/stem_fruit")
    ).take(10 * 20).toArray();

    const rowLimit = 15;
    blocks.entries().forEach(([ index, modelName ]) => {
        const x = index % rowLimit;
        const z = Math.floor(index / rowLimit);
        asyncMaterials.add({ model: modelName, position: new BABYLON.Vector3(x + x + 1, 0,  z + z - 3) });
        // asyncMaterials.add({ model: "block/stone", position: new BABYLON.Vector3(x + x + 1, -1, z + z - 3) });
    });
});

const camera = new BABYLON.ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.5, 20, new BABYLON.Vector3(0, 0, 0), scene);
camera.attachControl(canvas, true);

new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, -1), scene);

engine.runRenderLoop(() => {
    scene.render();
    if (assetState.loaded) {
        if (asyncMaterials.size > 0) {
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
