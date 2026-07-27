import * as BABYLON from "@babylonjs/core";
import { BOARD, GameState, launcherPosition } from "./game.ts";
import { speedOf } from "./physics.ts";
import { buildItemMesh, buildShadowMesh, loadAlphaMask } from "./item-mesh.ts";
import { backgroundPalette, boardTextures, itemTiers, randomlyRotated } from "./items.ts";
import { blockMaterial, itemMaterial, silhouetteMaterial } from "./materials.ts";

const RAIL_HEIGHT = 7;
const RAIL_WIDTH = 8;
const RAIL_DROP = 9;
const CAMERA_PITCH = 1.02;
const ITEM_LEAN = -0.55;
const AIM_LENGTH = 34;
/** screen space kept clear of the tray so the hud never covers it, in css pixels */
const HUD_TOP = 96;
const HUD_BOTTOM = 92;
const SHADE_HEIGHT = 0.09;
/** the sun sits behind the camera, so shadows fall away from the player */
const SUN_DIRECTION = new BABYLON.Vector3(0.55, -1, -0.5);
/** where the sun pushes the top of a standing item, per unit of its height */
const SHADE_DRIFT = new BABYLON.Vector2(SUN_DIRECTION.x / -SUN_DIRECTION.y, SUN_DIRECTION.z / -SUN_DIRECTION.y);
/** floor tiles per noise cell: bigger means broader patches of the same block */
const PATCH_CELL = 5.5;
/** board space is x: 0..width, y: 0..height with the player side (high y) closest to the camera */
const toWorldX = (x: number) => x - BOARD.width / 2;
const toWorldZ = (y: number) => y - BOARD.height / 2;

export interface Stage {
    engine: BABYLON.AbstractEngine;
    scene: BABYLON.Scene;
    camera: BABYLON.TargetCamera;
    resize(): void;
    sync(state: GameState, time: number): void;
    boardFromPointer(clientX: number, clientY: number): { x: number; y: number; };
    project(x: number, y: number): { x: number; y: number; };
}

export async function createStage(canvas: HTMLCanvasElement): Promise<Stage> {
    const engine = await createEngine(canvas);
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.05, 0.06, 0.09, 1);
    scene.ambientColor = new BABYLON.Color3(0.4, 0.4, 0.4);

    const camera = new BABYLON.TargetCamera("camera", BABYLON.Vector3.Zero(), scene);
    camera.fov = 0.68;
    camera.minZ = 1;
    camera.maxZ = 2000;

    const ambient = new BABYLON.HemisphericLight("ambient", new BABYLON.Vector3(0.2, 1, -0.4), scene);
    ambient.intensity = 0.7;
    ambient.groundColor = new BABYLON.Color3(0.42, 0.42, 0.48);

    const sun = new BABYLON.DirectionalLight("sun", SUN_DIRECTION.clone(), scene);
    sun.position = new BABYLON.Vector3(-70, 170, 150);
    sun.intensity = 0.85;

    buildTray(scene);

    const masks = await Promise.all(itemTiers.map(tier => loadAlphaMask(tier.texture)));
    const templates = itemTiers.map((tier, index) => {
        const mesh = buildItemMesh(tier.texture, tier.radius * 2, masks[ index ], scene);
        mesh.material = itemMaterial(tier.texture, scene);
        mesh.isVisible = false;
        return mesh;
    });

    // no shadow map: each item lays its own sprite down as a flat shadow, cheap and exact
    const shades = itemTiers.map(tier => {
        const mesh = buildShadowMesh(tier.texture, tier.radius * 2, SHADE_DRIFT, scene);
        mesh.material = silhouetteMaterial(tier.texture, scene);
        mesh.isVisible = false;
        return mesh;
    });

    interface Tracked {
        mesh: BABYLON.InstancedMesh;
        shade: BABYLON.InstancedMesh;
        /** eased so the shadow stretches and settles instead of snapping */
        stretch: number;
    }
    const instances = new Map<number, Tracked>();
    const launcher: Tracked = { mesh: null!, shade: null!, stretch: 1 };
    let launcherTier = -1;

    function placeShade(entry: Tracked, x: number, z: number, lift: number, pop: number, speed: number, dt: number) {
        // fast items smear their shadow, a merge pops it, and lifting slides it off the base
        const target = 1 + Math.min(0.3, speed / 1200) + pop * 0.25;
        entry.stretch += (target - entry.stretch) * Math.min(1, dt * 9);
        entry.shade.position.set(x + SHADE_DRIFT.x * lift, SHADE_HEIGHT, z + SHADE_DRIFT.y * lift);
        entry.shade.scaling.set(1 + pop * 0.2, 1, entry.stretch);
    }

    const aim = BABYLON.MeshBuilder.CreateGround("aim", { width: 1.6, height: AIM_LENGTH }, scene);
    const aimMaterial = new BABYLON.StandardMaterial("aim", scene);
    aimMaterial.diffuseColor = new BABYLON.Color3(1, 1, 1);
    aimMaterial.emissiveColor = new BABYLON.Color3(0.9, 0.9, 0.9);
    aimMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
    aimMaterial.alpha = 0.5;
    aim.material = aimMaterial;
    aim.isVisible = false;

    function resize() {
        engine.resize();
        // fit the tray rectangle, not its bounding sphere, so it fills as much screen as possible
        const aspect = engine.getRenderWidth() / engine.getRenderHeight();
        const halfVertical = camera.fov / 2;
        const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
        const width = (BOARD.width + RAIL_WIDTH * 2) / 2;
        // the tray depth is foreshortened by the camera tilt
        const depth = ((BOARD.height + RAIL_WIDTH * 2) / 2) * Math.sin(CAMERA_PITCH);

        // leave room for the hud bars, then centre the tray in what is left
        const screenHeight = canvas.clientHeight || 1;
        const top = Math.min(0.24, HUD_TOP / screenHeight);
        const bottom = Math.min(0.28, HUD_BOTTOM / screenHeight);
        const usable = Math.max(0.35, 1 - top - bottom);
        const distance = Math.max(
            width / Math.tan(halfHorizontal),
            depth / (Math.tan(halfVertical) * usable),
        ) * 1.02;
        const visibleDepth = (2 * distance * Math.tan(halfVertical)) / Math.sin(CAMERA_PITCH);
        const target = new BABYLON.Vector3(0, 0, (visibleDepth * (bottom - top)) / 2);
        camera.position = target.add(new BABYLON.Vector3(0, Math.sin(CAMERA_PITCH), Math.cos(CAMERA_PITCH)).scale(distance));
        camera.setTarget(target);
    }
    resize();

    let lastTime = 0;

    function sync(state: GameState, time: number) {
        const dt = Math.min(0.05, Math.max(0, time - lastTime));
        lastTime = time;

        for (const item of state.items) {
            let entry = instances.get(item.id);
            if (!entry) {
                entry = {
                    mesh: templates[ item.tier ].createInstance("item"),
                    shade: shades[ item.tier ].createInstance("shade"),
                    stretch: 1,
                };
                instances.set(item.id, entry);
            }
            const radius = itemTiers[ item.tier ].radius;
            const scale = 1 + Math.sin(item.pop * Math.PI) * 0.34;
            const x = toWorldX(item.x);
            const z = toWorldZ(item.y);
            entry.mesh.position.set(x, radius * scale + 0.6, z);
            entry.mesh.rotation.set(ITEM_LEAN, 0, 0);
            entry.mesh.scaling.setAll(scale);
            placeShade(entry, x, z, 0, item.pop, speedOf(item), dt);
        }
        for (const [ id, entry ] of instances) {
            if (state.items.some(item => item.id === id)) continue;
            entry.mesh.dispose();
            entry.shade.dispose();
            instances.delete(id);
        }

        const tier = state.queue[ 0 ];
        if (tier !== launcherTier) {
            launcher.mesh?.dispose();
            launcher.shade?.dispose();
            launcher.mesh = templates[ tier ].createInstance("launcher");
            launcher.shade = shades[ tier ].createInstance("shade");
            launcherTier = tier;
        }
        const spot = launcherPosition(state);
        const radius = itemTiers[ tier ].radius;
        const hover = state.drag ? 3 : 1 + Math.sin(time * 2.4) * 0.8;
        launcher.mesh.position.set(toWorldX(spot.x), radius + hover, toWorldZ(spot.y));
        launcher.mesh.rotation.set(ITEM_LEAN, 0, 0);
        launcher.mesh.isVisible = !state.over;
        launcher.shade.isVisible = !state.over;
        placeShade(launcher, toWorldX(spot.x), toWorldZ(spot.y), hover, 0, 0, dt);

        // a short guide line straight up the tray, shots never angle away from it
        aim.isVisible = state.drag !== null;
        if (state.drag) aim.position.set(toWorldX(spot.x), 0.14, toWorldZ(spot.y - AIM_LENGTH / 2 - radius));
    }

    function boardFromPointer(clientX: number, clientY: number) {
        const rect = canvas.getBoundingClientRect();
        const x = (clientX - rect.left) * (engine.getRenderWidth() / rect.width);
        const y = (clientY - rect.top) * (engine.getRenderHeight() / rect.height);
        const near = BABYLON.Vector3.Unproject(
            new BABYLON.Vector3(x, y, 0),
            engine.getRenderWidth(),
            engine.getRenderHeight(),
            BABYLON.Matrix.Identity(),
            scene.getViewMatrix(),
            scene.getProjectionMatrix(),
        );
        const origin = camera.globalPosition;
        const direction = near.subtract(origin).normalize();
        const distance = direction.y === 0 ? 0 : -origin.y / direction.y;
        const point = origin.add(direction.scale(distance));
        return { x: point.x + BOARD.width / 2, y: point.z + BOARD.height / 2 };
    }

    function project(x: number, y: number) {
        const rect = canvas.getBoundingClientRect();
        const point = BABYLON.Vector3.Project(
            new BABYLON.Vector3(toWorldX(x), 10, toWorldZ(y)),
            BABYLON.Matrix.Identity(),
            scene.getTransformMatrix(),
            camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
        );
        return {
            x: point.x * (rect.width / engine.getRenderWidth()),
            y: point.y * (rect.height / engine.getRenderHeight()),
        };
    }

    return { engine, scene, camera, resize, sync, boardFromPointer, project };
}

async function createEngine(canvas: HTMLCanvasElement) {
    if (await BABYLON.WebGPUEngine.IsSupportedAsync) {
        const engine = new BABYLON.WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
        await engine.initAsync();
        return engine;
    }
    return new BABYLON.Engine(canvas, true, { adaptToDeviceRatio: true });
}

/**
 * Baked ambient occlusion for the tray: the rails darken the sand they enclose.
 * Painted once into a texture and laid over the floor.
 */
function trayShadeOverlay(scene: BABYLON.Scene) {
    const scale = 2;
    const band = 11 * scale;
    const width = Math.round(BOARD.width * scale);
    const height = Math.round(BOARD.height * scale);
    const texture = new BABYLON.DynamicTexture("tray-ao", { width, height }, scene, true);
    const context = texture.getContext() as unknown as CanvasRenderingContext2D;
    context.clearRect(0, 0, width, height);

    const edges: [ number, number, number, number ][] = [
        [ 0, 0, band, 0 ],
        [ width, 0, width - band, 0 ],
        [ 0, 0, 0, band ],
        [ 0, height, 0, height - band ],
    ];
    for (const [ x0, y0, x1, y1 ] of edges) {
        const gradient = context.createLinearGradient(x0, y0, x1, y1);
        gradient.addColorStop(0, "rgba(0,0,0,0.5)");
        gradient.addColorStop(0.45, "rgba(0,0,0,0.16)");
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);
    }
    texture.update();
    texture.hasAlpha = true;

    const material = new BABYLON.StandardMaterial("tray-ao", scene);
    material.diffuseTexture = texture;
    material.opacityTexture = texture;
    material.diffuseColor = new BABYLON.Color3(0, 0, 0);
    material.specularColor = new BABYLON.Color3(0, 0, 0);
    material.disableLighting = true;

    const mesh = BABYLON.MeshBuilder.CreateGround("tray-ao", { width: BOARD.width, height: BOARD.height }, scene);
    mesh.position.y = 0.07;
    mesh.material = material;
    return mesh;
}

/** the tray itself drops a shadow onto the stone floor around it */
function traySurroundShadow(scene: BABYLON.Scene) {
    const margin = 74;
    const width = BOARD.width + RAIL_WIDTH * 2 + margin * 2;
    const depth = BOARD.height + RAIL_WIDTH * 2 + margin * 2;
    const scale = 2;
    const canvasWidth = Math.round(width * scale);
    const canvasHeight = Math.round(depth * scale);
    const texture = new BABYLON.DynamicTexture("tray-drop", { width: canvasWidth, height: canvasHeight }, scene, true);
    const context = texture.getContext() as unknown as CanvasRenderingContext2D;
    context.clearRect(0, 0, canvasWidth, canvasHeight);

    const inset = margin * scale;
    const boxWidth = canvasWidth - inset * 2;
    const boxHeight = canvasHeight - inset * 2;
    // two passes: a broad soft falloff plus a tight dark band right against the frame,
    // biased a little towards the camera the way the sun throws it
    const passes: [ blur: number, alpha: number ][] = [ [ 36, 0.55 ], [ 14, 0.8 ], [ 5, 0.85 ] ];
    for (const [ blur, alpha ] of passes) {
        context.save();
        context.shadowColor = `rgba(0,0,0,${alpha})`;
        context.shadowBlur = blur * scale;
        context.shadowOffsetX = 2 * scale;
        context.shadowOffsetY = -4 * scale;
        context.fillStyle = "#000000";
        context.fillRect(inset, inset, boxWidth, boxHeight);
        context.restore();
    }
    // the tray covers its own footprint, only the surrounding shadow should show
    context.clearRect(inset, inset, boxWidth, boxHeight);
    texture.update();
    texture.hasAlpha = true;

    const material = new BABYLON.StandardMaterial("tray-drop", scene);
    material.diffuseTexture = texture;
    material.opacityTexture = texture;
    material.diffuseColor = new BABYLON.Color3(0, 0, 0);
    material.specularColor = new BABYLON.Color3(0, 0, 0);
    material.disableLighting = true;

    const mesh = BABYLON.MeshBuilder.CreateGround("tray-drop", { width, height: depth }, scene);
    mesh.position.set(0, -RAIL_DROP + 0.08, 0);
    mesh.material = material;
    return mesh;
}

/** stable per-tile noise, so the floor pattern is the same on every load */
function tileNoise(col: number, row: number, seed: number) {
    let hash = Math.imul(col, 374761393) + Math.imul(row, 668265263) + Math.imul(seed, 362437);
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

/** value noise: hashed lattice blended with a smoothstep, the cheap cousin of perlin noise */
function smoothNoise(x: number, y: number, seed: number) {
    const col = Math.floor(x);
    const row = Math.floor(y);
    const fade = (t: number) => t * t * (3 - 2 * t);
    const fx = fade(x - col);
    const fy = fade(y - row);
    const top = tileNoise(col, row, seed) * (1 - fx) + tileNoise(col + 1, row, seed) * fx;
    const bottom = tileNoise(col, row + 1, seed) * (1 - fx) + tileNoise(col + 1, row + 1, seed) * fx;
    return top * (1 - fy) + bottom * fy;
}

/** two octaves of value noise, stretched so the whole palette gets used */
function patchNoise(x: number, y: number, seed: number) {
    const value = smoothNoise(x, y, seed) * 0.68 + smoothNoise(x * 2.4, y * 2.4, seed + 8191) * 0.32;
    return Math.min(1, Math.max(0, (value - 0.5) * 2.1 + 0.5));
}

/**
 * Flat floor built one block at a time, each tile getting a rotated and sometimes mirrored
 * copy of the texture. Minecraft varies flat ground the same way so it does not read as tiling.
 */
function scatteredFloor(name: string, textures: string[], scene: BABYLON.Scene, width: number, depth: number, seed: number) {
    const cols = Math.max(1, Math.round(width / 16));
    const rows = Math.max(1, Math.round(depth / 16));
    // tiles are sized to divide the surface evenly, a partial tile would smear its texture
    const tileWidth = width / cols;
    const tileDepth = depth / rows;
    const corners: [ number, number ][] = [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ] ];
    const buckets = textures.map(() => ({ positions: [] as number[], normals: [] as number[], uvs: [] as number[], indices: [] as number[] }));

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const x0 = -width / 2 + col * tileWidth;
            const z0 = -depth / 2 + row * tileDepth;
            const x1 = x0 + tileWidth;
            const z1 = z0 + tileDepth;
            // one smooth noise field walks along the palette, so tones drift instead of jumping
            const patch = patchNoise(col / PATCH_CELL, row / PATCH_CELL, seed + 5501);
            const pick = Math.min(textures.length - 1, Math.floor(patch * textures.length));
            const varies = randomlyRotated.has(textures[ pick ]);
            const turns = varies ? Math.floor(tileNoise(col, row, seed) * 4) : 0;
            const mirror = varies && tileNoise(col, row, seed + 977) > 0.5;
            const { positions, normals, uvs, indices } = buckets[ pick ];

            const start = positions.length / 3;
            const quad: [ number, number, number ][] = [ [ x0, 0, z0 ], [ x1, 0, z0 ], [ x1, 0, z1 ], [ x0, 0, z1 ] ];
            for (const [ index, corner ] of quad.entries()) {
                positions.push(...corner);
                normals.push(0, 1, 0);
                const [ u, v ] = corners[ (index + turns) % 4 ];
                uvs.push(mirror ? 1 - u : u, v);
            }
            indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
        }
    }

    const root = new BABYLON.TransformNode(name, scene);
    for (const [ index, bucket ] of buckets.entries()) {
        if (bucket.indices.length === 0) continue;
        const mesh = new BABYLON.Mesh(`${name}:${textures[ index ]}`, scene);
        const vertexData = new BABYLON.VertexData();
        vertexData.positions = bucket.positions;
        vertexData.normals = bucket.normals;
        vertexData.uvs = bucket.uvs;
        vertexData.indices = bucket.indices;
        vertexData.applyToMesh(mesh);
        const material = blockMaterial(textures[ index ], scene, 1, 1);
        material.backFaceCulling = false;
        mesh.material = material;
        mesh.parent = root;
    }
    return root;
}

/** every surface gets its own material so the block texture keeps square texels */
function surface(name: string, texture: string, scene: BABYLON.Scene, width: number, depth: number) {
    const mesh = BABYLON.MeshBuilder.CreateGround(name, { width, height: depth }, scene);
    mesh.material = blockMaterial(texture, scene, width / 16, depth / 16);
    mesh.receiveShadows = true;
    return mesh;
}

function wall(name: string, texture: string, scene: BABYLON.Scene, width: number, height: number, rotationY: number) {
    const mesh = BABYLON.MeshBuilder.CreatePlane(name, { width, height, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
    mesh.material = blockMaterial(texture, scene, width / 16, height / 16);
    mesh.rotation.y = rotationY;
    mesh.receiveShadows = true;
    return mesh;
}

function buildTray(scene: BABYLON.Scene) {
    const table = scatteredFloor("table", backgroundPalette, scene, 620, 780, 1337);
    table.position.y = -RAIL_DROP;

    traySurroundShadow(scene);
    scatteredFloor("tray", [ boardTextures.tray ], scene, BOARD.width, BOARD.height, 4242);
    trayShadeOverlay(scene);

    const outerWidth = BOARD.width + RAIL_WIDTH * 2;
    const wallHeight = RAIL_HEIGHT + RAIL_DROP;
    const railTops: [ string, number, number, number, number ][] = [
        [ "rail-far", 0, toWorldZ(0) - RAIL_WIDTH / 2, outerWidth, RAIL_WIDTH ],
        [ "rail-near", 0, toWorldZ(BOARD.height) + RAIL_WIDTH / 2, outerWidth, RAIL_WIDTH ],
        [ "rail-left", toWorldX(0) - RAIL_WIDTH / 2, 0, RAIL_WIDTH, BOARD.height ],
        [ "rail-right", toWorldX(BOARD.width) + RAIL_WIDTH / 2, 0, RAIL_WIDTH, BOARD.height ],
    ];
    for (const [ name, x, z, width, depth ] of railTops) {
        const top = surface(name, boardTextures.frame, scene, width, depth);
        top.position.set(x, RAIL_HEIGHT, z);
    }

    const walls: [ string, number, number, number, number ][] = [
        [ "wall-far-in", 0, toWorldZ(0), outerWidth, 0 ],
        [ "wall-far-out", 0, toWorldZ(0) - RAIL_WIDTH, outerWidth, 0 ],
        [ "wall-near-in", 0, toWorldZ(BOARD.height), outerWidth, 0 ],
        [ "wall-near-out", 0, toWorldZ(BOARD.height) + RAIL_WIDTH, outerWidth, 0 ],
        [ "wall-left-in", toWorldX(0), 0, BOARD.height, Math.PI / 2 ],
        [ "wall-left-out", toWorldX(0) - RAIL_WIDTH, 0, BOARD.height, Math.PI / 2 ],
        [ "wall-right-in", toWorldX(BOARD.width), 0, BOARD.height, Math.PI / 2 ],
        [ "wall-right-out", toWorldX(BOARD.width) + RAIL_WIDTH, 0, BOARD.height, Math.PI / 2 ],
    ];
    for (const [ name, x, z, width, rotationY ] of walls) {
        const mesh = wall(name, boardTextures.frame, scene, width, wallHeight, rotationY);
        mesh.position.set(x, RAIL_HEIGHT - wallHeight / 2, z);
    }

    const zoneDepth = BOARD.height - BOARD.lineY;
    const zone = BABYLON.MeshBuilder.CreateGround("zone", { width: BOARD.width, height: zoneDepth }, scene);
    zone.position.set(0, 0.06, toWorldZ(BOARD.lineY + zoneDepth / 2));
    const zoneMaterial = new BABYLON.StandardMaterial("zone", scene);
    zoneMaterial.diffuseColor = new BABYLON.Color3(0, 0, 0);
    zoneMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
    zoneMaterial.alpha = 0.16;
    zone.material = zoneMaterial;

    const dashMaterial = new BABYLON.StandardMaterial("dash", scene);
    dashMaterial.diffuseColor = new BABYLON.Color3(1, 1, 1);
    dashMaterial.emissiveColor = new BABYLON.Color3(0.7, 0.7, 0.7);
    dashMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
    const dashes = 13;
    for (let index = 0; index < dashes; index++) {
        const dash = BABYLON.MeshBuilder.CreateGround("dash", { width: (BOARD.width / dashes) * 0.6, height: 1.2 }, scene);
        dash.position.set(toWorldX((index + 0.5) * (BOARD.width / dashes)), 0.12, toWorldZ(BOARD.lineY));
        dash.material = dashMaterial;
    }
}
