import * as BABYLON from "@babylonjs/core";
import { assetPipeline } from "./assets.ts";

// Day cycle: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset, 1 = midnight
// Speed: one full day every 20 minutes (real Minecraft default)
const DAY_DURATION_SECONDS = 25 * 60;

// [time 0-1, r, g, b]
const ZENITH_KEYFRAMES: [ number, number, number, number ][] = [
    [ 0.00, 0.01, 0.01, 0.05 ],  // midnight
    [ 0.20, 0.01, 0.01, 0.05 ],  // pre-dawn
    [ 0.25, 0.40, 0.30, 0.20 ],  // sunrise
    [ 0.32, 0.35, 0.55, 0.95 ],  // morning
    [ 0.50, 0.30, 0.50, 0.95 ],  // noon
    [ 0.68, 0.35, 0.55, 0.95 ],  // afternoon
    [ 0.75, 0.40, 0.30, 0.20 ],  // sunset
    [ 0.80, 0.01, 0.01, 0.05 ],  // dusk
    [ 1.00, 0.01, 0.01, 0.05 ],  // midnight
];

const HORIZON_KEYFRAMES: [ number, number, number, number ][] = [
    [ 0.00, 0.03, 0.03, 0.10 ],  // midnight
    [ 0.20, 0.03, 0.03, 0.10 ],  // pre-dawn
    [ 0.25, 0.75, 0.55, 0.35 ],  // sunrise
    [ 0.32, 0.65, 0.80, 1.00 ],  // morning
    [ 0.50, 0.55, 0.72, 1.00 ],  // noon
    [ 0.68, 0.65, 0.80, 1.00 ],  // afternoon
    [ 0.75, 0.75, 0.55, 0.35 ],  // sunset
    [ 0.80, 0.03, 0.03, 0.10 ],  // dusk
    [ 1.00, 0.03, 0.03, 0.10 ],  // midnight
];

const SUN_KEYFRAMES: [ number, number, number, number, number ][] = [
    [ 0.00, 0.10, 0.10, 0.30, 0.02 ],  // midnight
    [ 0.20, 0.10, 0.10, 0.30, 0.02 ],  // pre-dawn
    [ 0.25, 1.00, 0.78, 0.55, 0.60 ],  // sunrise
    [ 0.35, 1.00, 0.95, 0.85, 1.00 ],  // morning
    [ 0.50, 1.00, 1.00, 1.00, 1.00 ],  // noon
    [ 0.65, 1.00, 0.95, 0.85, 1.00 ],  // afternoon
    [ 0.75, 1.00, 0.78, 0.55, 0.60 ],  // sunset
    [ 0.80, 0.10, 0.10, 0.30, 0.02 ],  // dusk
    [ 1.00, 0.10, 0.10, 0.30, 0.02 ],  // midnight
];

function lerpKeyframes<T extends number[]>(
    keyframes: [ number, ...T ][],
    t: number
): T {
    t = ((t % 1) + 1) % 1;
    let lo = keyframes[ keyframes.length - 1 ];
    let hi = keyframes[ 0 ];
    for (let i = 0; i < keyframes.length - 1; i++) {
        if (t >= keyframes[ i ][ 0 ] && t < keyframes[ i + 1 ][ 0 ]) {
            lo = keyframes[ i ];
            hi = keyframes[ i + 1 ];
            break;
        }
    }
    const span = hi[ 0 ] - lo[ 0 ];
    const alpha = span === 0 ? 0 : (t - lo[ 0 ]) / span;
    return lo.slice(1).map((v, i) => v + (hi[ i + 1 ] - v) * alpha) as unknown as T;
}

const VERT = `
    precision highp float;
    attribute vec3 position;
    uniform mat4 worldViewProjection;
    varying float vY;
    void main() {
        vY = normalize(position).y;
        gl_Position = worldViewProjection * vec4(position, 1.0);
    }
`;

const FRAG = `
    precision highp float;
    uniform vec3 zenithColor;
    uniform vec3 horizonColor;
    varying float vY;
    void main() {
        float t = clamp(vY, 0.0, 1.0);
        // Minecraft uses a slightly steep gradient
        t = pow(t, 0.6);
        vec3 color = mix(horizonColor, zenithColor, t);
        gl_FragColor = vec4(color, 1.0);
    }
`;

const SUN_VERT = `
    precision highp float;
    attribute vec3 position;
    attribute vec2 uv;
    uniform mat4 worldViewProjection;
    varying vec2 vUV;
    void main() {
        vUV = uv;
        gl_Position = worldViewProjection * vec4(position, 1.0);
    }
`;

const SUN_FRAG = `
    precision highp float;
    uniform sampler2D sunTexture;
    uniform vec3 tint;
    varying vec2 vUV;
    void main() {
        vec4 tex = texture2D(sunTexture, vUV);
        gl_FragColor = vec4(tex.rgb * tint, tex.a);
    }
`;

// moon_phases.png is a 4-column × 2-row spritesheet (8 phases total)
const MOON_FRAG = `
    precision highp float;
    uniform sampler2D moonTexture;
    uniform vec2 phaseOffset;
    varying vec2 vUV;
    void main() {
        vec2 uv = phaseOffset + vUV * vec2(0.25, 0.5);
        vec4 tex = texture2D(moonTexture, uv);
        gl_FragColor = vec4(tex.rgb, tex.a);
    }
`;

export let dayTime = 0.4;
let totalDays = 0.4; // fractional + integer days, used for moon phase

let skyMaterial: BABYLON.ShaderMaterial | null = null;
let sunMesh: BABYLON.Mesh | null = null;
let sunMaterial: BABYLON.ShaderMaterial | null = null;
let moonMesh: BABYLON.Mesh | null = null;
let moonMaterial: BABYLON.ShaderMaterial | null = null;

const SUN_RADIUS = 1200;
const SUN_SIZE = 300;

export function createSkyDome(scene: BABYLON.Scene): void {
    BABYLON.Effect.ShadersStore[ "skyVertexShader" ] = VERT;
    BABYLON.Effect.ShadersStore[ "skyFragmentShader" ] = FRAG;

    const dome = BABYLON.MeshBuilder.CreateSphere("skydome", { diameter: 3000, segments: 8, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
    dome.isPickable = false;
    dome.infiniteDistance = true;

    skyMaterial = new BABYLON.ShaderMaterial("skyMat", scene, { vertex: "sky", fragment: "sky" }, {
        attributes: [ "position" ],
        uniforms: [ "worldViewProjection", "zenithColor", "horizonColor" ],
    });
    skyMaterial.backFaceCulling = false;
    skyMaterial.disableDepthWrite = true;
    dome.material = skyMaterial;

    // Sun disc
    BABYLON.Effect.ShadersStore[ "sunVertexShader" ] = SUN_VERT;
    BABYLON.Effect.ShadersStore[ "sunFragmentShader" ] = SUN_FRAG;

    sunMesh = BABYLON.MeshBuilder.CreatePlane("sun", { size: SUN_SIZE }, scene);
    sunMesh.isPickable = false;
    sunMesh.infiniteDistance = true;


    const sunUrl = new URL(assetPipeline);
    sunUrl.searchParams.set("file", "assets/minecraft/textures/environment/sun.png");
    const sunTexture = new BABYLON.Texture(sunUrl.toString(), scene, false, false, BABYLON.Texture.NEAREST_SAMPLINGMODE);

    sunMaterial = new BABYLON.ShaderMaterial("sunMat", scene, { vertex: "sun", fragment: "sun" }, {
        attributes: [ "position", "uv" ],
        uniforms: [ "worldViewProjection", "tint" ],
        samplers: [ "sunTexture" ],
        needAlphaBlending: true,
    });
    sunMaterial.alphaMode = BABYLON.Engine.ALPHA_ADD;
    sunMaterial.setTexture("sunTexture", sunTexture);
    sunMaterial.setVector3("tint", new BABYLON.Vector3(1, 1, 1));
    sunMaterial.backFaceCulling = false;
    sunMaterial.disableDepthWrite = true;
    sunMesh.material = sunMaterial;

    // Moon disc
    BABYLON.Effect.ShadersStore[ "moonFragmentShader" ] = MOON_FRAG;

    moonMesh = BABYLON.MeshBuilder.CreatePlane("moon", { size: SUN_SIZE }, scene);
    moonMesh.isPickable = false;
    moonMesh.infiniteDistance = true;

    const moonUrl = new URL(assetPipeline);
    moonUrl.searchParams.set("file", "assets/minecraft/textures/environment/moon_phases.png");
    const moonTexture = new BABYLON.Texture(moonUrl.toString(), scene, false, false, BABYLON.Texture.NEAREST_SAMPLINGMODE);

    moonMaterial = new BABYLON.ShaderMaterial("moonMat", scene, { vertex: "sun", fragment: "moon" }, {
        attributes: [ "position", "uv" ],
        uniforms: [ "worldViewProjection", "phaseOffset" ],
        samplers: [ "moonTexture" ],
        needAlphaBlending: true,
    });
    moonMaterial.alphaMode = BABYLON.Engine.ALPHA_ADD;
    moonMaterial.setTexture("moonTexture", moonTexture);
    moonMaterial.setVector2("phaseOffset", new BABYLON.Vector2(0, 0));
    moonMaterial.backFaceCulling = false;
    moonMaterial.disableDepthWrite = true;
    moonMesh.material = moonMaterial;
}

export function tickSky(
    dt: number,
    scene: BABYLON.Scene,
    light: BABYLON.HemisphericLight
) {
    totalDays += dt / DAY_DURATION_SECONDS;
    dayTime = totalDays % 1;

    const [ zr, zg, zb ] = lerpKeyframes(ZENITH_KEYFRAMES, dayTime);
    const [ hr, hg, hb ] = lerpKeyframes(HORIZON_KEYFRAMES, dayTime);

    scene.clearColor = new BABYLON.Color4(hr, hg, hb, 1);

    if (skyMaterial) {
        skyMaterial.setVector3("zenithColor", new BABYLON.Vector3(zr, zg, zb));
        skyMaterial.setVector3("horizonColor", new BABYLON.Vector3(hr, hg, hb));
    }

    const [ lr, lg, lb, li ] = lerpKeyframes(SUN_KEYFRAMES, dayTime);
    light.diffuse = new BABYLON.Color3(lr, lg, lb);
    light.intensity = li;
    light.groundColor = new BABYLON.Color3(lr * 0.3, lg * 0.3, lb * 0.3).add(new BABYLON.Color3(0.05, 0.05, 0.08));

    // Sun position: orbits in the XY plane; dayTime=0.25 → east horizon, 0.5 → zenith, 0.75 → west horizon
    const sunAngle = (dayTime - 0.25) * 2 * Math.PI;
    const sunX = SUN_RADIUS * Math.cos(sunAngle);
    const sunY = SUN_RADIUS * Math.sin(sunAngle);

    if (sunMesh) {
        sunMesh.position.set(sunX, sunY, 0);
        // Tilt the plane flat (normal → -Y), then orbit around Z to the sun's position.
        // This keeps world Z as the plane's up direction at all orbit angles — no spinning.
        const qTilt = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, Math.PI / 2);
        const qOrbit = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Z, sunAngle - Math.PI / 2);
        sunMesh.rotationQuaternion = qOrbit.multiply(qTilt);
        sunMesh.setEnabled(sunY > -SUN_SIZE / 2);
    }

    if (sunMaterial) {
        sunMaterial.setVector3("tint", new BABYLON.Vector3(lr, lg, lb));
    }

    // Moon: opposite side of the sky from the sun
    const moonAngle = sunAngle + Math.PI;
    const moonX = SUN_RADIUS * Math.cos(moonAngle);
    const moonY = SUN_RADIUS * Math.sin(moonAngle);

    if (moonMesh) {
        moonMesh.position.set(moonX, moonY, 0);
        const qRoll = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Z, -Math.PI / 2);
        const qTilt = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, Math.PI / 2);
        const qOrbit = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Z, moonAngle - Math.PI / 2);
        moonMesh.rotationQuaternion = qOrbit.multiply(qTilt).multiply(qRoll);
        moonMesh.setEnabled(moonY > -SUN_SIZE / 2);
    }

    if (moonMaterial) {
        // moon_phases.png: 4 columns × 2 rows, phase 0–7 over 8 days
        const phase = Math.floor(totalDays) % 8;
        const col = phase % 4;
        const row = Math.floor(phase / 4);
        moonMaterial.setVector2("phaseOffset", new BABYLON.Vector2(col * 0.25, row * 0.5));
    }
}
