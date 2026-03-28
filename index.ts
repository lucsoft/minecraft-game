import * as BABYLON from "@babylonjs/core";
import { assert } from "@std/assert";
import './assets.ts';
import { assetState, getMinecraftMaterialFromName, loadAssets, minecraftBlockstates, normalizeName } from "./assets.ts";
import { isEmptyModel, isSolidBlock } from "./backing.ts";
import { setupCamera, setupCameraInput, tickCamera } from "./camera.ts";
import { createEntity, setControlledEntity } from "./entities.ts";
import { createSkyDome, tickSky } from "./sky.ts";
import { computedChunks, range, rawChunks, renderChunk } from "./utils.ts";
import { Chunk, CHUNK_SIZE, debugMutateChunk, generateWorld, getIndexFromLocalBlock } from "./world.ts";

const CHUNK_Y_BLOCK_OFFSET = 0 * CHUNK_SIZE;
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
    const blockId = chunk.blocks[ getIndexFromLocalBlock(localX, localY, localZ) ];
    return isSolidBlock(chunk.blockPalette[ blockId ]);
}

document.head.innerHTML += `<meta name="color-scheme" content="light dark">`;
const canvas = document.createElement("canvas");
document.body.append(canvas);

const debugEl = document.createElement("pre");
debugEl.style.cssText = "position:fixed;top:8px;left:8px;margin:0;padding:4px 8px;background:rgba(0,0,0,.5);color:#fff;font-size:12px;pointer-events:none;z-index:9999";
document.body.append(debugEl);
const engine = new BABYLON.WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
await engine.initAsync();
const scene = new BABYLON.Scene(engine);

const activeChunks: string[] = [];
const activeRawChunks: string[] = [];

const staleChunks = new Map<string, { vertexUpdated: boolean; }>();

async function startGame() {
    await loadAssets();
    // load test world
    const seed = 5;
    for (const element of range(0, 5)) {
        const world = generateWorld(seed, element, element - 1);
        for (const { z, x, chunk } of world) {
            rawChunks.add({ x, z, chunk });
            chunkMap.set(`${x},${z}`, chunk);
        }
    }


    const chunk = chunkMap.get("0,0");
    const blockStates = minecraftBlockstates.entries()
        .filter(([ _, value ]) => value.variants !== undefined)
        .map(([ _, value ]) => {
            const lookupKey = (key: string) => Array.isArray(value.variants![ key ]) ? value.variants![ key ][ 0 ].model : value.variants![ key ].model;
            return Object.keys(value.variants!).map(k => lookupKey(k))[ 0 ];
        })
        .filter((modelName) => !isEmptyModel(modelName));
    const items = Array.from(blockStates);
    let counter = 0;
    setInterval(() => {
        debugMutateChunk(chunk!, { x: 0, y: 72, z: 0 }, items[ ++counter % items.length ]);
        debugMutateChunk(chunk!, { x: 0, y: 72, z: 1 }, items[ (counter + 1) % items.length ]);
        debugMutateChunk(chunk!, { x: 0, y: 72, z: 2 }, items[ (counter + 2) % items.length ]);
        debugMutateChunk(chunk!, { x: 0, y: 72, z: 3 }, items[ (counter + 3) % items.length ]);
        debugMutateChunk(chunk!, { x: 0, y: 72, z: 4 }, items[ (counter + 4) % items.length ]);
        staleChunks.set(`0,0`, { vertexUpdated: false });
    }, 200);
}


function updateChunkVertexData() {
    const start = performance.now();
    for (const element of rawChunks) {
        if (activeRawChunks.includes(`${element.x},${element.z}`) && !staleChunks.has(`${element.x},${element.z}`)) continue;
        if (performance.now() - start > 5) break;

        const chunkData = renderChunk(element.chunk, new BABYLON.Vector3(element.x * 16, 0, element.z * 16));

        if (staleChunks.has(`${element.x},${element.z}`)) {
            const computedChunk = Array.from(computedChunks).find(c => c.x === element.x && c.z === element.z);
            if (computedChunk) {
                assert(computedChunk, "Stale chunk must have a corresponding computed chunk");
                computedChunks.delete(computedChunk);
            }
            computedChunks.add({ x: element.x, z: element.z, chunkData });
            staleChunks.set(`${element.x},${element.z}`, { vertexUpdated: true });
        }
        else {
            computedChunks.add({ x: element.x, z: element.z, chunkData });
            activeRawChunks.push(`${element.x},${element.z}`);
        }
    }
}
const chunkMeshMap = new Map<string, BABYLON.Mesh>();
function updateChunkMeshPipeline() {
    const start = performance.now();
    for (const element of computedChunks) {
        const chunkId = `${element.x},${element.z}`;
        if (activeChunks.includes(chunkId) && !(staleChunks.has(chunkId) && staleChunks.get(chunkId)!.vertexUpdated)) continue;
        if (performance.now() - start > 5) break;
        const mesh = chunkMeshMap.getOrInsertComputed(chunkId, () => new BABYLON.Mesh("chunk", null));
        element.chunkData.applyToMesh(mesh);
        mesh.material = getMinecraftMaterialFromName(normalizeName("block/stone"));
        if (staleChunks.has(chunkId)) {
            staleChunks.delete(chunkId);
        }
        else {
            activeChunks.push(chunkId);
        }
    }
}

// @ts-expect-error lol
globalThis.state = {
    chunkMap,
    activeChunks,
    rawChunks,
    computedChunks,
    chunkMeshMap
};

startGame();
const camera = setupCamera(scene);
camera.position.y = 100 * 16;
const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, -1), scene);
light.groundColor = new BABYLON.Color3(0.3, 0.3, 0.3);
createSkyDome(scene);

const player = createEntity(camera.position);
setControlledEntity(player.id);
setupCameraInput(camera, scene, engine);

engine.runRenderLoop(() => {
    scene.render();
    if (!assetState.loaded) return;
    updateChunkVertexData();
    updateChunkMeshPipeline();

    const dt = engine.getDeltaTime() / 1000;
    tickCamera(camera, dt, isBlockSolid);
    tickSky(dt, scene, light);

    const pos = camera.position;
    const bx = Math.floor(pos.x / CHUNK_SIZE);
    const by = Math.floor(pos.y / CHUNK_SIZE);
    const bz = Math.floor(pos.z / CHUNK_SIZE);
    const chunkX = Math.floor(bx / CHUNK_SIZE);
    const chunkZ = Math.floor(bz / CHUNK_SIZE);
    debugEl.textContent = `pos   ${bx}, ${by}, ${bz}\nchunk ${chunkX},${chunkZ}`;
});
