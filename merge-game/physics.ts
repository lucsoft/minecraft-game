import { HITBOX_SCALE, itemTiers, MAX_TIER } from "./items.ts";

export interface Item {
    id: number;
    tier: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    angle: number;
    spin: number;
    /** merge pop animation, 1 -> 0 */
    pop: number;
    /** true once the item stopped sliding at least once */
    settled: boolean;
    /** items scheduled for a merge are ignored until the game removes them */
    merging: boolean;
}

export interface Board {
    width: number;
    height: number;
    /** items resting below this line fill up the serving area */
    lineY: number;
}

const SUBSTEP = 1 / 240;
/** a fresh shot glides across the whole tray */
const DAMPING = 1.9;
/** below this speed the sand grabs hold, so nudged items only creep a little */
const CREEP_SPEED = 34;
const CREEP_DAMPING = 6.5;
const SPIN_DAMPING = 3.4;
const STOP_SPEED = 3.5;
const WALL_RESTITUTION = 0.55;
const ITEM_RESTITUTION = 0.42;

/** collision radius, a bit tighter than the sprite so items can nestle together */
export const radiusOf = (tier: number) => itemTiers[ tier ].radius * HITBOX_SCALE;

/**
 * Only the standstill grip scales with size: every item glides the same, but once one is
 * barely moving a netherite ingot digs into the sand where a lump of coal still skates.
 */
export const gripOf = (tier: number) => (itemTiers[ tier ].radius / itemTiers[ 0 ].radius) ** 0.6;
export const massOf = (tier: number) => radiusOf(tier) ** 2;
export const speedOf = (item: Item) => Math.hypot(item.vx, item.vy);

export function stepPhysics(items: Item[], board: Board, dt: number): [ Item, Item ][] {
    const merges: [ Item, Item ][] = [];
    let remaining = Math.min(dt, 0.05);
    while (remaining > 0) {
        const step = Math.min(SUBSTEP, remaining);
        remaining -= step;
        integrate(items, board, step);
        collide(items, merges);
        // collision push-apart can shove an item into a rail, so keep everyone inside
        for (const item of items) {
            const radius = radiusOf(item.tier);
            item.x = Math.min(board.width - radius, Math.max(radius, item.x));
            item.y = Math.min(board.height - radius, Math.max(radius, item.y));
        }
    }
    return merges;
}

function integrate(items: Item[], board: Board, dt: number) {
    const spinDecay = Math.exp(-SPIN_DAMPING * dt);
    for (const item of items) {
        item.x += item.vx * dt;
        item.y += item.vy * dt;
        const friction = speedOf(item) < CREEP_SPEED ? CREEP_DAMPING * gripOf(item.tier) : DAMPING;
        const decay = Math.exp(-friction * dt);
        item.vx *= decay;
        item.vy *= decay;
        item.angle += item.spin * dt;
        item.spin *= spinDecay;
        item.pop = Math.max(0, item.pop - dt * 5);

        const radius = radiusOf(item.tier);
        if (item.x < radius) {
            item.x = radius;
            item.vx = Math.abs(item.vx) * WALL_RESTITUTION;
            item.spin -= item.vy * 0.06;
        }
        if (item.x > board.width - radius) {
            item.x = board.width - radius;
            item.vx = -Math.abs(item.vx) * WALL_RESTITUTION;
            item.spin += item.vy * 0.06;
        }
        if (item.y < radius) {
            item.y = radius;
            item.vy = Math.abs(item.vy) * WALL_RESTITUTION;
            item.spin += item.vx * 0.06;
        }
        if (item.y > board.height - radius) {
            item.y = board.height - radius;
            item.vy = -Math.abs(item.vy) * WALL_RESTITUTION;
            item.spin -= item.vx * 0.06;
        }

        if (speedOf(item) < STOP_SPEED) {
            item.vx = 0;
            item.vy = 0;
            item.settled = true;
        }
    }
}

function collide(items: Item[], merges: [ Item, Item ][]) {
    for (let i = 0; i < items.length; i++) {
        const a = items[ i ];
        if (a.merging) continue;
        for (let j = i + 1; j < items.length; j++) {
            const b = items[ j ];
            if (b.merging) continue;

            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const distance = Math.hypot(dx, dy);
            const minDistance = radiusOf(a.tier) + radiusOf(b.tier);
            if (distance >= minDistance) continue;

            if (a.tier === b.tier && a.tier < MAX_TIER) {
                a.merging = true;
                b.merging = true;
                merges.push([ a, b ]);
                break;
            }

            // both items on top of each other: push them apart in an arbitrary direction
            const nx = distance === 0 ? 1 : dx / distance;
            const ny = distance === 0 ? 0 : dy / distance;
            const overlap = minDistance - Math.max(distance, 0.0001);

            const massA = massOf(a.tier);
            const massB = massOf(b.tier);
            const total = massA + massB;
            a.x -= nx * overlap * (massB / total);
            a.y -= ny * overlap * (massB / total);
            b.x += nx * overlap * (massA / total);
            b.y += ny * overlap * (massA / total);

            const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (relative >= 0) continue;
            const impulse = -(1 + ITEM_RESTITUTION) * relative / total;
            a.vx -= impulse * nx * massB;
            a.vy -= impulse * ny * massB;
            b.vx += impulse * nx * massA;
            b.vy += impulse * ny * massA;
            a.spin -= impulse * 0.3;
            b.spin += impulse * 0.3;
            a.settled = false;
            b.settled = false;
        }
    }
}
