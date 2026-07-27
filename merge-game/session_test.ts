import { assert, assertEquals, assertFalse, assertGreater } from "@std/assert";
import { beginDrag, BOARD, createGame, GameState, isReady, moveDrag, releaseDrag, updateGame } from "./game.ts";
import { MAX_TIER } from "./items.ts";
import { radiusOf } from "./physics.ts";

/** deterministic Math.random so a session replays identically */
function withSeed<T>(seed: number, body: () => T) {
    const original = Math.random;
    let value = seed;
    Math.random = () => {
        value = (value * 1664525 + 1013904223) % 4294967296;
        return value / 4294967296;
    };
    try {
        return body();
    } finally {
        Math.random = original;
    }
}

const DT = 1 / 60;

function tick(state: GameState, seconds: number) {
    for (let elapsed = 0; elapsed < seconds; elapsed += DT) updateGame(state, DT);
}

function shoot(state: GameState, x: number, slide = 0) {
    beginDrag(state, { x, y: BOARD.height - 12 });
    for (let frame = 1; frame <= 4; frame++) {
        moveDrag(state, { x: x + (slide * frame) / 4, y: BOARD.height - 12 });
    }
    releaseDrag(state);
}

function checkInvariants(state: GameState) {
    const ids = new Set<number>();
    for (const item of state.items) {
        const radius = radiusOf(item.tier);
        assert(Number.isFinite(item.x) && Number.isFinite(item.y), "position went non-finite");
        assert(Number.isFinite(item.vx) && Number.isFinite(item.vy), "velocity went non-finite");
        assert(item.x >= radius - 0.01 && item.x <= BOARD.width - radius + 0.01, `x escaped the tray: ${item.x}`);
        assert(item.y >= radius - 0.01 && item.y <= BOARD.height - radius + 0.01, `y escaped the tray: ${item.y}`);
        assert(item.tier >= 0 && item.tier <= MAX_TIER, `impossible tier: ${item.tier}`);
        assertFalse(ids.has(item.id), "duplicate item id");
        ids.add(item.id);
    }
    assertEquals(state.queue.length, 3);
    assertEquals(state.orders.length, 3);
}

/** plays a scripted session and checks the whole loop keeps producing merges and orders */
function playSession(seed: number, shots: number) {
    return withSeed(seed, () => {
        const state = createGame();
        let taken = 0;
        let coins = 0;
        for (let attempt = 0; attempt < shots * 4 && !state.over; attempt++) {
            if (isReady(state)) {
                const before = state.shots;
                shoot(state, 12 + ((attempt * 17) % 76), ((attempt % 5) - 2) * 8);
                if (state.shots > before) taken++;
            }
            tick(state, 0.5);
            checkInvariants(state);
            assert(state.coins >= coins, "coins must never go down");
            coins = state.coins;
            if (taken >= shots) break;
        }
        tick(state, 3);
        return { state, taken };
    });
}

Deno.test("a scripted session keeps the rules intact and scores points", () => {
    const { state, taken } = playSession(1, 40);
    assertGreater(taken, 20);
    assertGreater(state.coins, 0);
    assertGreater(state.highestTier, 0);
    checkInvariants(state);
});

Deno.test("a longer session reaches later rounds and higher tiers", () => {
    const { state } = playSession(7, 140);
    assertGreater(state.deliveries, 0);
    assertGreater(state.highestTier, 2);
});

Deno.test("two runs with the same seed play out identically", () => {
    const first = playSession(99, 30).state;
    const second = playSession(99, 30).state;
    assertEquals(first.coins, second.coins);
    assertEquals(first.round, second.round);
    assertEquals(first.items.map(item => [ item.tier, Math.round(item.x), Math.round(item.y) ]), second.items.map(item => [ item.tier, Math.round(item.x), Math.round(item.y) ]));
});

Deno.test("hammering the same lane stays consistent until the tray gives up", () => {
    withSeed(3, () => {
        const state = createGame();
        let shots = 0;
        for (let attempt = 0; attempt < 400 && !state.over; attempt++) {
            if (isReady(state)) {
                shoot(state, 50);
                shots++;
            }
            tick(state, 0.6);
            checkInvariants(state);
        }
        // one lane clogs the serving zone sooner or later, that is the fail state
        assert(state.over, "expected the run to end");
        assertGreater(shots, 20);
        assertGreater(state.coins, 0);
    });
});
