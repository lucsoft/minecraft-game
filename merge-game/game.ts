import { itemTiers, MAX_TIER } from "./items.ts";
import { Board, Item, massOf, radiusOf, stepPhysics } from "./physics.ts";

export const BOARD: Board = { width: 100, height: 176, lineY: 154 };
/** resting spot of the item waiting to be flicked */
export const LAUNCHER = { x: 50, y: 165 };

/** the one way to lose: this many items coming to rest in the serving zone */
export const MAX_SPILLED = 3;
/** every shot thumps the sand around the launch line, shoving spilled items back up the tray */
const BLAST_RADIUS = 34;
const BLAST_SPEED = 170;
export const BLAST_TIME = 0.3;
const LAUNCH_COOLDOWN = 0.28;
/** fast enough that a shot carries all the way to the far rail */
const LAUNCH_SPEED = 350;
const ORDER_COUNT = 3;
/** what drops into the launcher: mostly coal, some redstone, copper is a treat */
const SPAWN_WEIGHTS: [ tier: number, chance: number ][] = [ [ 0, 0.65 ], [ 1, 0.3 ], [ 2, 0.05 ] ];
const MAX_SPAWN_TIER = 2;
/** a merge hands its momentum to the new item and adds a little on top as a reward */
const MERGE_BOOST = 1.2;

export interface Order {
    tier: number;
    reward: number;
    done: boolean;
}

export interface FloatingText {
    x: number;
    y: number;
    text: string;
    color: string;
    life: number;
}

/** a delivered item flying from the tray up to its order card */
export interface Flight {
    tier: number;
    x: number;
    y: number;
    order: number;
    life: number;
}

export const FLIGHT_TIME = 0.6;

/** the item held under the finger, sliding along the launch line */
export interface Drag {
    x: number;
    y: number;
}

export interface GameState {
    items: Item[];
    /** upcoming tiers, index 0 sits in the launcher */
    queue: number[];
    orders: Order[];
    coins: number;
    round: number;
    deliveries: number;
    highestTier: number;
    texts: FloatingText[];
    flights: Flight[];
    drag: Drag | null;
    /** number of shots taken, used to hide the swipe hint */
    shots: number;
    /** merge tally and the tier the last one produced, for sound and effects */
    merges: number;
    lastMergeTier: number;
    banner: { text: string; life: number; } | null;
    /** items at rest in the serving zone, drives the warning colours */
    spilled: number;
    /** the thump of the last shot, for the ring effect */
    blast: { x: number; y: number; life: number; } | null;
    over: boolean;
    cooldown: number;
    nextId: number;
}

export function createGame(): GameState {
    const state: GameState = {
        items: [],
        queue: [],
        orders: [],
        coins: 0,
        round: 1,
        deliveries: 0,
        highestTier: 0,
        texts: [],
        flights: [],
        drag: null,
        shots: 0,
        merges: 0,
        lastMergeTier: 0,
        banner: null,
        spilled: 0,
        blast: null,
        over: false,
        cooldown: 0,
        nextId: 0,
    };
    while (state.queue.length < 3) state.queue.push(pickSpawnTier());
    fillOrders(state);
    return state;
}

export function resetGame(state: GameState) {
    Object.assign(state, createGame());
}

export function pickSpawnTier() {
    let roll = Math.random();
    for (const [ tier, chance ] of SPAWN_WEIGHTS) {
        roll -= chance;
        if (roll < 0) return tier;
    }
    return 0;
}

/**
 * The tiers a round can ask for: always three distinct ones above the spawn tiers, climbing
 * with the rounds until they hit the top of the chain.
 */
function orderTiers(state: GameState) {
    const top = Math.min(MAX_TIER, MAX_SPAWN_TIER + 3 + Math.floor((state.round - 1) / 3));
    return [ top - 2, top - 1, top ];
}

/** orders always ask for something above the spawn tiers, so they have to be merged */
function createOrder(state: GameState): Order {
    const taken = state.orders.filter(order => !order.done).map(order => order.tier);
    const free = orderTiers(state).filter(tier => !taken.includes(tier));
    const pool = free.length > 0 ? free : orderTiers(state);
    const tier = pool[ Math.floor(Math.random() * pool.length) ];
    return { tier, reward: itemTiers[ tier ].coins * 3, done: false };
}

function fillOrders(state: GameState) {
    state.orders = [];
    while (state.orders.length < ORDER_COUNT) state.orders.push(createOrder(state));
}

/** shots only wait for a short reload, items already sliding do not block the next one */
export function isReady(state: GameState) {
    return !state.over && state.cooldown <= 0;
}

/** where the next item currently sits: under the finger while sliding, on its spot otherwise */
export function launcherPosition(state: GameState) {
    return state.drag ?? LAUNCHER;
}

/** the held item only slides sideways, it never leaves the launch line */
function clampToLane(state: GameState, x: number) {
    const radius = radiusOf(state.queue[ 0 ]);
    return Math.min(BOARD.width - radius, Math.max(radius, x));
}

export function beginDrag(state: GameState, point: { x: number; y: number; }) {
    if (!isReady(state)) return;
    state.drag = { x: clampToLane(state, point.x), y: LAUNCHER.y };
}

export function moveDrag(state: GameState, point: { x: number; y: number; }) {
    if (!state.drag) return;
    state.drag.x = clampToLane(state, point.x);
}

/** letting go shoots straight up the tray, from wherever the item was slid to */
export function releaseDrag(state: GameState) {
    const drag = state.drag;
    state.drag = null;
    if (drag) launch(state, drag);
}

/** the shot lands with a thump that pushes nearby items away, always up the tray */
function blast(state: GameState, from: Drag) {
    state.blast = { x: from.x, y: from.y, life: BLAST_TIME };
    for (const item of state.items) {
        const dx = item.x - from.x;
        const dy = item.y - from.y;
        const distance = Math.hypot(dx, dy);
        if (distance > BLAST_RADIUS) continue;
        const falloff = 1 - distance / BLAST_RADIUS;
        const nx = distance < 0.001 ? 0 : dx / distance;
        // never shove an item towards the near rail, the point is to clear the zone
        const ny = Math.min(distance < 0.001 ? -1 : dy / distance, -0.4);
        const weight = (itemTiers[ 0 ].radius / itemTiers[ item.tier ].radius) ** 0.8;
        item.vx += nx * BLAST_SPEED * falloff * weight * 0.7;
        item.vy += ny * BLAST_SPEED * falloff * weight;
        item.settled = false;
    }
}

export function launch(state: GameState, from: Drag) {
    if (!isReady(state)) return;
    blast(state, from);
    const tier = state.queue.shift()!;
    state.queue.push(pickSpawnTier());
    state.items.push({
        id: state.nextId++,
        tier,
        x: from.x,
        y: from.y,
        vx: 0,
        vy: -LAUNCH_SPEED,
        angle: 0,
        spin: 0,
        pop: 0,
        settled: false,
        merging: false,
    });
    state.shots++;
    state.cooldown = LAUNCH_COOLDOWN;
}

export function updateGame(state: GameState, dt: number) {
    for (const text of state.texts) text.life -= dt;
    state.texts = state.texts.filter(text => text.life > 0);
    for (const flight of state.flights) flight.life -= dt;
    state.flights = state.flights.filter(flight => flight.life > 0);
    if (state.blast) {
        state.blast.life -= dt;
        if (state.blast.life <= 0) state.blast = null;
    }
    if (state.banner) {
        state.banner.life -= dt;
        if (state.banner.life <= 0) state.banner = null;
    }

    if (state.over) return;
    state.cooldown = Math.max(0, state.cooldown - dt);

    for (const [ a, b ] of stepPhysics(state.items, BOARD, dt)) {
        merge(state, a, b);
    }

    for (const item of state.items) {
        if (item.tier === MAX_TIER && item.settled && !item.merging) {
            item.merging = true;
            award(state, item, itemTiers[ MAX_TIER ].coins * 2, "#ffe97f");
        }
    }
    state.items = state.items.filter(item => !item.merging);

    // however busy the tray gets, only a blocked serving zone ends the run
    state.spilled = state.items.filter(item => item.settled && item.y > BOARD.lineY).length;
    if (state.spilled >= MAX_SPILLED) state.over = true;
}

function merge(state: GameState, a: Item, b: Item) {
    const tier = a.tier + 1;
    const radius = radiusOf(tier);
    // momentum of both halves carries into the new item, the bigger item now drags more sand
    const massA = massOf(a.tier);
    const massB = massOf(b.tier);
    const total = massA + massB;
    const merged: Item = {
        id: state.nextId++,
        tier,
        x: Math.min(BOARD.width - radius, Math.max(radius, (a.x + b.x) / 2)),
        y: Math.min(BOARD.height - radius, Math.max(radius, (a.y + b.y) / 2)),
        vx: ((a.vx * massA + b.vx * massB) / total) * MERGE_BOOST,
        vy: ((a.vy * massA + b.vy * massB) / total) * MERGE_BOOST,
        angle: 0,
        spin: ((a.spin * massA + b.spin * massB) / total) * MERGE_BOOST,
        pop: 1,
        settled: false,
        merging: false,
    };

    state.merges++;
    state.lastMergeTier = tier;
    state.highestTier = Math.max(state.highestTier, tier);
    state.coins += itemTiers[ tier ].coins;
    state.texts.push({ x: merged.x, y: merged.y, text: `+${itemTiers[ tier ].coins}`, color: "#ffffff", life: 0.9 });

    const index = state.orders.findIndex(order => !order.done && order.tier === tier);
    if (index !== -1) {
        const order = state.orders[ index ];
        order.done = true;
        state.deliveries++;
        state.flights.push({ tier, x: merged.x, y: merged.y, order: index, life: FLIGHT_TIME });
        award(state, merged, order.reward, "#8bf58b");
        if (state.orders.every(entry => entry.done)) completeRound(state);
        return;
    }
    state.items.push(merged);
}

function completeRound(state: GameState) {
    const bonus = 500 * state.round;
    state.coins += bonus;
    state.banner = { text: `ROUND ${state.round} COMPLETE   +${bonus}`, life: 3 };
    state.round++;
    fillOrders(state);
}

function award(state: GameState, item: Item, coins: number, color: string) {
    state.coins += coins;
    state.texts.push({ x: item.x, y: item.y, text: `+${coins}`, color, life: 1.4 });
}
