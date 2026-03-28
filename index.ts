import * as BABYLON from "@babylonjs/core";
import './assets.ts';
import { assetState, getMinecraftMaterialFromName, loadAssets, normalizeName } from "./assets.ts";
import { isSolidBlock } from "./backing.ts";
import { setupCamera, setupCameraInput, tickCamera } from "./camera.ts";
import { createEntity, setControlledEntity } from "./entities.ts";
import { computedChunks, range, rawChunks, renderChunk } from "./utils.ts";
import { Chunk, CHUNK_SIZE, generateWorld } from "./world.ts";

const CHUNK_Y_BLOCK_OFFSET = -5 * CHUNK_SIZE;
const chunkMap = new Map<string, Chunk>();

function isBlockSolid(bx: number, by: number, bz: number): boolean {
    const chunkX = Math.floor(bx / CHUNK_SIZE);
    const chunkZ = Math.floor(bz / CHUNK_SIZE);
    const chunk = chunkMap.get(`${chunkX},${chunkZ}`);
    if (!chunk) return false;
    const localX = bx - chunkX * CHUNK_SIZE;
    const localZ = bz - chunkZ * CHUNK_SIZE;
    const localY = by - CHUNK_Y_BLOCK_OFFSET;
    const worldHeight = chunk.blocks.length / (CHUNK_SIZE * CHUNK_SIZE);
    if (localY < 0 || localY >= worldHeight) return false;
    const blockId = chunk.blocks[ localX + localZ * CHUNK_SIZE + localY * CHUNK_SIZE * CHUNK_SIZE ];
    return isSolidBlock(chunk.blockPalette[ blockId ]);
}

document.head.innerHTML += `<meta name="color-scheme" content="light dark">`;
const canvas = document.createElement("canvas");
document.body.append(canvas);
const engine = new BABYLON.WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
await engine.initAsync();
const scene = new BABYLON.Scene(engine);

const camera = setupCamera(scene);
new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, -1), scene);

const player = createEntity(camera.position);
setControlledEntity(player.id);
const activeChunks: number[] = [];
const activeRawChunks: number[] = [];

async function startGame() {
    await loadAssets();
    // load test world
    const seed = 5;
    for (const element of range(0, 16)) {
        const world = generateWorld(seed, element, element - 1);
        for (const { z, x, chunk } of world) {
            rawChunks.add({ index: rawChunks.size, x, z, chunk });
            chunkMap.set(`${x},${z}`, chunk);
        }
    }
}


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
        if (performance.now() - start > 2) break;
        const mesh = new BABYLON.Mesh("chunk", null);
        element.chunkData.applyToMesh(mesh);
        mesh.material = getMinecraftMaterialFromName(normalizeName("block/stone"));
        activeChunks.push(element.index);
    }
}

startGame();
setupCameraInput(camera, scene, engine);

engine.runRenderLoop(() => {
    scene.render();
    if (!assetState.loaded) return;
    updateChunkVertexData();
    updateChunkMeshPipeline();

    const dt = engine.getDeltaTime() / 1000;
    tickCamera(camera, dt, isBlockSolid);
});
