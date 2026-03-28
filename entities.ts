import * as BABYLON from "@babylonjs/core";

const BLOCK_SIZE = 16;
const GRAVITY_UP = -700;        // world units / s² while rising
const GRAVITY_DOWN = -400;      // world units / s² while falling
const PLAYER_WIDTH = 0.6 * BLOCK_SIZE;
const PLAYER_HEIGHT = 1.8 * BLOCK_SIZE;
const PLAYER_EYE_HEIGHT = 1.62 * BLOCK_SIZE;
const TERMINAL_VELOCITY = -1600;

export interface Entity {
    id: number;
    position: BABYLON.Vector3;
    rotation: BABYLON.Vector3;
    velocity: BABYLON.Vector3;
    onGround: boolean;
}

let nextId = 0;
const entities = new Map<number, Entity>();

export let controlledEntityId: number | null = null;

export function createEntity(position: BABYLON.Vector3): Entity {
    const entity: Entity = {
        id: nextId++,
        position: position.clone(),
        rotation: BABYLON.Vector3.Zero(),
        velocity: BABYLON.Vector3.Zero(),
        onGround: false,
    };
    entities.set(entity.id, entity);
    return entity;
}

export function setControlledEntity(id: number) {
    controlledEntityId = id;
}

export function getEntity(id: number): Entity | undefined {
    return entities.get(id);
}

const JUMP_VELOCITY = Math.sqrt(2 * Math.abs(GRAVITY_UP) * BLOCK_SIZE * 1.25);

export function jump() {
    if (controlledEntityId === null) return;
    const entity = entities.get(controlledEntityId);
    if (!entity?.onGround) return;
    entity.velocity.y = JUMP_VELOCITY;
}

export function syncControlledEntityFromCamera(camera: BABYLON.FreeCamera, isSolid: (bx: number, by: number, bz: number) => boolean) {
    if (controlledEntityId === null) return;
    const entity = entities.get(controlledEntityId);
    if (!entity) return;

    const prevX = entity.position.x;
    const prevZ = entity.position.z;

    entity.position.x = camera.position.x;
    if (collidesAt(entity.position.x, entity.position.y, entity.position.z, isSolid)) {
        entity.position.x = prevX;
        camera.position.x = prevX;
    }

    entity.position.z = camera.position.z;
    if (collidesAt(entity.position.x, entity.position.y, entity.position.z, isSolid)) {
        entity.position.z = prevZ;
        camera.position.z = prevZ;
    }

    entity.rotation.copyFrom(camera.rotation);
}

export function syncCameraToControlledEntity(camera: BABYLON.FreeCamera) {
    if (controlledEntityId === null) return;
    const entity = entities.get(controlledEntityId);
    if (!entity) return;
    camera.position.set(entity.position.x, entity.position.y + PLAYER_EYE_HEIGHT, entity.position.z);
    camera.rotation.copyFrom(entity.rotation);
}

// Returns all block coords overlapping a world-space bounding box
function overlappingBlocks(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): [number, number, number][] {
    const blocks: [number, number, number][] = [];
    const x0 = Math.floor(minX / BLOCK_SIZE);
    const y0 = Math.floor(minY / BLOCK_SIZE);
    const z0 = Math.floor(minZ / BLOCK_SIZE);
    const x1 = Math.floor((maxX - 0.001) / BLOCK_SIZE);
    const y1 = Math.floor((maxY - 0.001) / BLOCK_SIZE);
    const z1 = Math.floor((maxZ - 0.001) / BLOCK_SIZE);
    for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++)
            for (let x = x0; x <= x1; x++)
                blocks.push([ x, y, z ]);
    return blocks;
}

function collidesAt(px: number, py: number, pz: number, isSolid: (bx: number, by: number, bz: number) => boolean): boolean {
    const half = PLAYER_WIDTH / 2;
    return overlappingBlocks(px - half, py, pz - half, px + half, py + PLAYER_HEIGHT, pz + half)
        .some(([ bx, by, bz ]) => isSolid(bx, by, bz));
}

export function tickPhysics(dt: number, isSolid: (bx: number, by: number, bz: number) => boolean) {
    for (const entity of entities.values()) {
        // Gravity
        const gravity = entity.velocity.y > 0 ? GRAVITY_UP : GRAVITY_DOWN;
        entity.velocity.y = Math.max(entity.velocity.y + gravity * dt, TERMINAL_VELOCITY);

        const { position: pos, velocity: vel } = entity;

        // Resolve each axis independently
        // X
        pos.x += vel.x * dt;
        if (collidesAt(pos.x, pos.y, pos.z, isSolid)) {
            pos.x -= vel.x * dt;
            vel.x = 0;
        }

        // Y
        pos.y += vel.y * dt;
        if (collidesAt(pos.x, pos.y, pos.z, isSolid)) {
            entity.onGround = vel.y < 0;
            pos.y -= vel.y * dt;
            vel.y = 0;
        } else {
            entity.onGround = false;
        }

        // Z
        pos.z += vel.z * dt;
        if (collidesAt(pos.x, pos.y, pos.z, isSolid)) {
            pos.z -= vel.z * dt;
            vel.z = 0;
        }
    }
}
