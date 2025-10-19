// deno-lint-ignore-file no-import-prefix
import { ZipReader, Entry, FileEntry } from "@zip-js/zip-js";
import { WindowBuilder, EventType, PixelFormat, Surface, Rect, Texture, Canvas, Color, Point } from "../deno_sdl2/mod.ts";
import { memoize, LruCache, MemoizationCacheResult } from "jsr:@std/cache";
import { chunk } from "jsr:@std/collections";
import * as BABYLON from "npm:@babylonjs/core";
import { iteratorToStream } from "./utils.ts";
const minecraftJar = await Deno.open("1.21.1-21.1.197.jar");
const minecraftReader = new ZipReader(minecraftJar.readable);
interface MinecraftTexture {
    path: string;
    texture: Texture;
}

const minecraftTextures = new Map<string, MinecraftTexture>();
const minecraftModels = new Map<string, FileEntry>();

const window = new WindowBuilder("Test", 1280, 800).metal().resizable().build();
const adapter = await navigator.gpu.requestAdapter();
const device = await adapter?.requestDevice();
device
console.log(adapter?.features);
const wgpu = window.windowSurface(1280, 800);

const engine = new BABYLON.WebGPUEngine(new class OffScreenCanvas extends EventTarget {
    getContext = wgpu.getContext.bind(wgpu);
});

const scene = new BABYLON.Scene(engine);

const camera = new BABYLON.ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.5, 3, new BABYLON.Vector3(0, 0, 0), scene);

const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);

const box = BABYLON.MeshBuilder.CreateBox("box", {}, scene);

// const canvas = window.canvas();
// const textures = canvas.textureCreator();

const items = Array.fromAsync(iteratorToStream(minecraftReader.getEntriesGenerator())
    .pipeThrough(new TransformStream<Entry, FileEntry>({
        transform(entry, controller) {
            if (entry.filename.endsWith(".class")) return;
            if (!('getData' in entry)) return;
            state.loadedFiles++;
            controller.enqueue(entry);
        }
    })))

const state = {
    loaded: false,
    loadedFiles: 0,
    loadedTextures: 0,
    availableTextures: 0,
    files: [] as FileEntry[],
}

// items.then((files) => {
//     const assetFiles = files.filter(file => file.filename.startsWith("assets/minecraft/textures/")).filter(file => file.filename.endsWith(".png"));
//     state.files = files;
//     state.availableTextures = assetFiles.length;
//     state.loaded = true;
//     console.log("Loaded files:", files.length);

//     (async () => {
//         for (const files of chunk(assetFiles, 30)) {
//             const blobs = await Promise.all(files.map(file => file.arrayBuffer()));
//             for (const [index, data] of blobs.entries()) {
//                 const file = files[index];
//                 using surface = Surface.fromRaw(new Uint8Array(data));
//                 const texture = textures.createTextureFromSurface(surface!);
//                 minecraftTextures.set(file.filename.replace("assets/minecraft/textures/", "").replace(".png", ""), {
//                     path: file.filename,
//                     texture: texture!,
//                 });
//                 state.loadedTextures++;
//             }
//         }
//     })()
// });

// const font = canvas.loadFont("MinecraftRegular.otf", 26);
// const dynamicTextureCache = new LruCache<string, MemoizationCacheResult<Texture>>(10);
// const createText = memoize((text: string, color: Color) => {
//     using surface = font.renderSolid(text, color);
//     return textures.createTextureFromSurface(surface)!;
// },{ cache: dynamicTextureCache })

// function renderBlock(canavas: Canvas, x: number, y: number, texture: MinecraftTexture, scale: number, rotation: number) {
//     const blockRect = new Rect(x, y, 16 * scale, 16 * scale);
//     canavas.copyEx(texture.texture, undefined, blockRect, rotation, new Point(0, 5));
// }

// function renderText(canavas: Canvas, x: number, y: number, text: string, color: Color) {
//     const texture = createText(text, color);
//     const { height, width } = font.textSize(text)

//     const textRect = new Rect(x, y, width, height);
//     canavas.copyEx(texture, undefined, textRect, 0, new Point(0, 5), { flipVertical: false });
// }

// const whiteColor = new Color(255, 255, 255);

let scrollingPoint = 0;

for await (const element of window.events()) {
    if (element.type === EventType.Quit) break;
    else if (element.type === EventType.Draw) {
        // canvas.clear();

        // const scale = 2;
        // const padding = 4;

        // // const gridSize = 80;
        // const keys = minecraftTextures.keys().toArray().toSorted();
        // const angle = (Date.now() % 6000) / 6000 * Math.PI * 2;
        // for (let row = 0; row < 1000; row++) {
        //     for (let col = 0; col < 21; col++) {
        //         const blockIndex = row * 40 + col;
        //         const texture = minecraftTextures.get(keys[ blockIndex ]);
        //         if (!texture) break;
        //         renderBlock(canvas, (col * 16 + (col * padding)) * scale, (row * 16 + (row * padding)) * scale + 60 + scrollingPoint, texture, scale, angle * 360);
        //     }
        // }
        // renderText(canvas, 0, 0, "Loaded files: " + state.loadedFiles, whiteColor);
        // renderText(canvas, 0, 30, "Loaded textures: " + state.loadedTextures + " / " + state.availableTextures, whiteColor);
        // canvas.present()
        await new Promise<void>(done => setTimeout(done, 10));

    }
    else if (element.type === EventType.MouseWheel) {
        scrollingPoint += element.y * 15;
        if (scrollingPoint > 0) {
            scrollingPoint = 0;
        }
    }
}
