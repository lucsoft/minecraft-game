import * as BABYLON from "@babylonjs/core";
import { jump, syncCameraToControlledEntity, syncControlledEntityFromCamera, tickPhysics } from "./entities.ts";

const MOVE_SPEED = 140;  // world units/s forward/back (~8.75 blocks/s)
const STRAFE_SPEED = 84; // world units/s left/right (~60% of forward)
const keysHeld = new Set<string>();

export function setupCamera(scene: BABYLON.Scene): BABYLON.FreeCamera {
    const camera = new BABYLON.FreeCamera("camera", new BABYLON.Vector3(20, 20, -20), scene);
    camera.attachControl();
    camera.keysUp = [];
    camera.keysDown = [];
    camera.keysLeft = [];
    camera.keysRight = [];
    camera.keysUpward = [];
    camera.keysDownward = [];
    camera.inertia = 0;
    camera.angularSensibility = 500;
    camera.mode = BABYLON.Camera.PERSPECTIVE_CAMERA;
    return camera;
}

export function tickCamera(camera: BABYLON.FreeCamera, dt: number, isSolid: (bx: number, by: number, bz: number) => boolean) {
    const fwd = camera.getDirection(BABYLON.Axis.Z);
    fwd.y = 0;
    fwd.normalize();
    const right = new BABYLON.Vector3(fwd.z, 0, -fwd.x);

    let mx = 0, mz = 0;
    if (keysHeld.has("KeyW")) { mx += fwd.x; mz += fwd.z; }
    if (keysHeld.has("KeyS")) { mx -= fwd.x; mz -= fwd.z; }
    if (keysHeld.has("KeyA")) { mx -= right.x * (STRAFE_SPEED / MOVE_SPEED); mz -= right.z * (STRAFE_SPEED / MOVE_SPEED); }
    if (keysHeld.has("KeyD")) { mx += right.x * (STRAFE_SPEED / MOVE_SPEED); mz += right.z * (STRAFE_SPEED / MOVE_SPEED); }

    const mag = Math.sqrt(mx * mx + mz * mz);
    if (mag > 1) { mx /= mag; mz /= mag; }

    camera.position.x += mx * MOVE_SPEED * dt;
    camera.position.z += mz * MOVE_SPEED * dt;

    syncControlledEntityFromCamera(camera, isSolid);
    tickPhysics(dt, isSolid);
    syncCameraToControlledEntity(camera);
}

export function setupCameraInput(camera: BABYLON.FreeCamera, scene: BABYLON.Scene, engine: BABYLON.WebGPUEngine) {
    addEventListener("keydown", (e) => {
        if (e.key === "t") scene.forceWireframe = !scene.forceWireframe;
        if (e.code === "Space") jump();
        keysHeld.add(e.code);
    });

    addEventListener("keyup", (e) => {
        keysHeld.delete(e.code);
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
}
