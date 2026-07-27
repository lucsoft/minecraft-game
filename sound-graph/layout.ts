import { SoundNode } from "./data.ts";

export interface Edge {
    a: number;
    b: number;
    strength: number;
}

/** how close two sounds are pulled, a strong link ends up short and a weak one long */
const REST_SHORT = 16;
const REST_LONG = 90;
const SPRING = 0.32;
/** neighbours shoving each other apart, only within RANGE and handled by the fine grid */
const REPEL = 300;
const RANGE = 34;
/**
 * Every other sound in the graph pushes too, otherwise four thousand nodes just collapse into
 * one ball. Doing that pair by pair is 9 million sums a frame, so the far half of the work is
 * done against a coarse grid of clumps instead, which is the cheap half of a Barnes-Hut tree.
 */
const FAR_REPEL = 45;
const COARSE_CELLS = 10;
const GRAVITY = 0.01;
const DAMPING = 0.7;
const MAX_SPEED = 22;
const COOLING = 0.997;
const IDLE = 0.004;

export interface Layout {
    readonly edges: Edge[];
    readonly alpha: number;
    /** the box the graph currently occupies, so the camera can frame it */
    readonly extent: { minX: number; minY: number; maxX: number; maxY: number; };
    /** collects the drawn edges from the neighbour lists, `perNode` is the slider on the page */
    rebuild(nodes: SoundNode[], members: number[], perNode: number): void;
    /** drops a newcomer next to the neighbours it already has, so clusters grow instead of jump */
    seed(nodes: SoundNode[], at: number): void;
    step(nodes: SoundNode[], members: number[]): void;
    reheat(amount?: number): void;
}

export function createLayout(): Layout {
    const edges: Edge[] = [];
    let alpha = 1;
    let heads = new Int32Array(0);
    let next = new Int32Array(0);
    let seeded = 0;
    const mass = new Float32Array(COARSE_CELLS * COARSE_CELLS);
    const centreX = new Float32Array(mass.length);
    const centreY = new Float32Array(mass.length);
    const packX = new Float64Array(mass.length);
    const packY = new Float64Array(mass.length);
    const packMass = new Float64Array(mass.length);
    const seat = new Int32Array(mass.length);
    const extent = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

    return {
        edges,
        extent,
        get alpha() {
            return alpha;
        },
        rebuild(nodes, members, perNode) {
            edges.length = 0;
            // two sounds usually name each other, the key keeps that pair as one line
            const seen = new Set<number>();
            for (const at of members) {
                for (const neighbour of nodes[ at ].neighbours.slice(0, perNode)) {
                    const key = at < neighbour.to
                        ? at * nodes.length + neighbour.to
                        : neighbour.to * nodes.length + at;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    edges.push({ a: at, b: neighbour.to, strength: neighbour.strength });
                }
            }
        },
        seed(nodes, at) {
            const node = nodes[ at ];
            const known = node.neighbours.filter(neighbour => nodes[ neighbour.to ].placed);
            if (known.length) {
                for (const neighbour of known) {
                    node.x += nodes[ neighbour.to ].x / known.length;
                    node.y += nodes[ neighbour.to ].y / known.length;
                }
                node.x += (Math.random() - 0.5) * 20;
                node.y += (Math.random() - 0.5) * 20;
            } else {
                // the very first sounds have nothing to hold on to, spread them over a spiral
                const angle = seeded * 2.399;
                const radius = 12 * Math.sqrt(seeded);
                node.x = Math.cos(angle) * radius;
                node.y = Math.sin(angle) * radius;
            }
            seeded++;
            node.placed = true;
        },
        step(nodes, members) {
            if (alpha <= IDLE || members.length < 2) return;
            alpha *= COOLING;

            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (const at of members) {
                const node = nodes[ at ];
                if (node.x < minX) minX = node.x;
                if (node.y < minY) minY = node.y;
                if (node.x > maxX) maxX = node.x;
                if (node.y > maxY) maxY = node.y;
            }
            Object.assign(extent, { minX, minY, maxX, maxY });
            // the cell never goes under RANGE, so a 3x3 scan still covers everything in reach, and
            // it grows with the graph so the grid cannot balloon into hundreds of thousands of cells
            const cell = Math.max(RANGE, Math.max(maxX - minX, maxY - minY) / 320);
            const columns = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
            const rows = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
            // the extent moves every frame while the graph settles, reallocating that often would
            // cost more than the forces do, so the grid only ever grows
            if (heads.length < columns * rows) heads = new Int32Array(Math.ceil(columns * rows * 1.4));
            if (next.length < members.length) next = new Int32Array(members.length * 2);
            heads.fill(-1, 0, columns * rows);

            const columnOf = (x: number) => Math.max(0, Math.min(columns - 1, Math.floor((x - minX) / cell)));
            const rowOf = (y: number) => Math.max(0, Math.min(rows - 1, Math.floor((y - minY) / cell)));
            for (let slot = 0; slot < members.length; slot++) {
                const node = nodes[ members[ slot ] ];
                const bucket = rowOf(node.y) * columns + columnOf(node.x);
                next[ slot ] = heads[ bucket ];
                heads[ bucket ] = slot;
            }

            // repulsion only against what shares a cell or touches one, everything further away
            // is handled by the springs pulling their own clusters together
            for (let slot = 0; slot < members.length; slot++) {
                const node = nodes[ members[ slot ] ];
                const column = columnOf(node.x);
                const row = rowOf(node.y);
                for (let dy = -1; dy <= 1; dy++) {
                    const line = row + dy;
                    if (line < 0 || line >= rows) continue;
                    for (let dx = -1; dx <= 1; dx++) {
                        const side = column + dx;
                        if (side < 0 || side >= columns) continue;
                        for (let other = heads[ line * columns + side ]; other !== -1; other = next[ other ]) {
                            if (other <= slot) continue;
                            const partner = nodes[ members[ other ] ];
                            const deltaX = node.x - partner.x;
                            const deltaY = node.y - partner.y;
                            const square = deltaX * deltaX + deltaY * deltaY;
                            if (square > RANGE * RANGE) continue;
                            // two sounds landing on the exact same spot would divide by zero
                            const push = REPEL / (square + 12) * alpha;
                            const offsetX = square < 0.01 ? Math.random() - 0.5 : deltaX;
                            const offsetY = square < 0.01 ? Math.random() - 0.5 : deltaY;
                            node.vx += offsetX * push;
                            node.vy += offsetY * push;
                            partner.vx -= offsetX * push;
                            partner.vy -= offsetY * push;
                        }
                    }
                }
            }

            // and now the long range half, every clump against every node that is not inside it
            const coarse = Math.max(maxX - minX, maxY - minY, 1) / COARSE_CELLS;
            mass.fill(0);
            centreX.fill(0);
            centreY.fill(0);
            for (const at of members) {
                const node = nodes[ at ];
                const clump = Math.min(COARSE_CELLS - 1, (node.y - minY) / coarse | 0) * COARSE_CELLS
                    + Math.min(COARSE_CELLS - 1, (node.x - minX) / coarse | 0);
                mass[ clump ]++;
                centreX[ clump ] += node.x;
                centreY[ clump ] += node.y;
            }
            // the clumps are packed down to only the ones that hold something, and into flat arrays,
            // because this inner loop runs close to a million times a frame
            let clumps = 0;
            for (let clump = 0; clump < mass.length; clump++) {
                if (!mass[ clump ]) {
                    seat[ clump ] = -1;
                    continue;
                }
                packX[ clumps ] = centreX[ clump ] / mass[ clump ];
                packY[ clumps ] = centreY[ clump ] / mass[ clump ];
                packMass[ clumps ] = mass[ clump ];
                seat[ clump ] = clumps++;
            }
            const softening = coarse * coarse;
            for (const at of members) {
                const node = nodes[ at ];
                const x = node.x;
                const y = node.y;
                const own = seat[ Math.min(COARSE_CELLS - 1, (y - minY) / coarse | 0) * COARSE_CELLS
                    + Math.min(COARSE_CELLS - 1, (x - minX) / coarse | 0) ];
                let pushX = 0;
                let pushY = 0;
                for (let clump = 0; clump < clumps; clump++) {
                    if (clump === own) continue;
                    const deltaX = x - packX[ clump ];
                    const deltaY = y - packY[ clump ];
                    const push = packMass[ clump ] / (deltaX * deltaX + deltaY * deltaY + softening);
                    pushX += deltaX * push;
                    pushY += deltaY * push;
                }
                node.vx += pushX * FAR_REPEL * alpha;
                node.vy += pushY * FAR_REPEL * alpha;
            }

            for (const edge of edges) {
                const from = nodes[ edge.a ];
                const to = nodes[ edge.b ];
                const deltaX = to.x - from.x;
                const deltaY = to.y - from.y;
                const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY) || 0.01;
                const rest = REST_SHORT + (1 - edge.strength) * (REST_LONG - REST_SHORT);
                const pull = (distance - rest) / distance * edge.strength * SPRING * alpha;
                from.vx += deltaX * pull;
                from.vy += deltaY * pull;
                to.vx -= deltaX * pull;
                to.vy -= deltaY * pull;
            }

            for (const at of members) {
                const node = nodes[ at ];
                node.vx = (node.vx - node.x * GRAVITY * alpha) * DAMPING;
                node.vy = (node.vy - node.y * GRAVITY * alpha) * DAMPING;
                const speed = Math.hypot(node.vx, node.vy);
                if (speed > MAX_SPEED) {
                    node.vx *= MAX_SPEED / speed;
                    node.vy *= MAX_SPEED / speed;
                }
                node.x += node.vx;
                node.y += node.vy;
            }
        },
        reheat(amount = 1) {
            alpha = Math.max(alpha, amount);
        },
    };
}
