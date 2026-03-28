import * as BABYLON from "@babylonjs/core";
import './assets.ts';
import { assetState, getMinecraftMaterialFromName, loadAssets, normalizeName } from "./assets.ts";
import './css.ts';
import { computedChunks, range, rawChunks, renderChunk } from "./utils.ts";
import { generateWorld } from "./world.ts";

document.head.innerHTML += `<meta name="color-scheme" content="light dark">`;
const canvas = document.createElement("canvas");
document.body.append(canvas);
const engine = new BABYLON.WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
await engine.initAsync();
const scene = new BABYLON.Scene(engine);
loadAssets().then(() => {
    const seed = 5;
    for (const element of range(0, 20)) {
        const world = generateWorld(seed, element, element - 1);
        for (const { z, x, chunk } of world) {
            rawChunks.add({ index: rawChunks.size, x, z, chunk });
        }
    }
});

const camera = new BABYLON.FreeCamera("camera", new BABYLON.Vector3(20, 20, -20), scene);
camera.attachControl();
camera.keysUp = [ 87 ];
camera.keysDown = [ 83 ];
camera.keysLeft = [ 65 ];
camera.keysRight = [ 68 ];
camera.keysUpward = [ 32 ];
camera.keysDownward = [ 16 ];
camera.speed = 5;
camera.mode = BABYLON.Camera.PERSPECTIVE_CAMERA;
new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, -1), scene);
const activeChunks: number[] = [];
const activeRawChunks: number[] = [];

function updateChunkVertexData() {
    const start = performance.now();
    for (const element of rawChunks) {
        if (activeRawChunks.includes(element.index)) continue;
        if (performance.now() - start > 5) break;
        computedChunks.add({
            index: element.index, x: element.x, z: element.z,
            chunkData: renderChunk(element.chunk, new BABYLON.Vector3(element.x * 16, -5 * 16, element.z * 16))
        });
        activeRawChunks.push(element.index);
    }
}

function updateChunkMeshPipeline() {
    const start = performance.now();
    for (const element of computedChunks) {
        if (activeChunks.includes(element.index)) continue;
        if (performance.now() - start > 5) break;
        const mesh = new BABYLON.Mesh("chunk", null);
        element.chunkData.applyToMesh(mesh);
        mesh.material = getMinecraftMaterialFromName(normalizeName("block/stone"));
        activeChunks.push(element.index);
    }
}

engine.runRenderLoop(() => {
    scene.render();
    if (!assetState.loaded) return;
    updateChunkVertexData();
    updateChunkMeshPipeline();
});

addEventListener("keydown", (e) => {
    if (e.key === "t") scene.forceWireframe = !scene.forceWireframe;
});

addEventListener("click", () => {
    if (!engine.isPointerLock) {
        engine.enterPointerlock();
    }
});

addEventListener("resize", () => {
    engine.resize();
});

addEventListener("DOMContentLoaded", () => {
    engine.resize();
});