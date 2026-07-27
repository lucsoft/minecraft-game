import { assert, assertAlmostEquals, assertEquals, assertFalse, assertGreater, assertLess, assertNotEquals } from "@std/assert";
import {
    beginDrag,
    BOARD,
    createGame,
    GameState,
    isReady,
    launcherPosition,
    LAUNCHER,
    moveDrag,
    pickSpawnTier,
    releaseDrag,
    resetGame,
    updateGame,
} from "./game.ts";
import { itemTiers, MAX_TIER } from "./items.ts";
import { Item, radiusOf } from "./physics.ts";

function place(state: GameState, tier: number, x: number, y: number): Item {
    const item: Item = { id: state.nextId++, tier, x, y, vx: 0, vy: 0, angle: 0, spin: 0, pop: 0, settled: false, merging: false };
    state.items.push(item);
    return item;
}

function run(state: GameState, seconds: number, dt = 1 / 60) {
    for (let elapsed = 0; elapsed < seconds; elapsed += dt) updateGame(state, dt);
}

/** grab the item at `fromX`, slide it sideways to `toX`, then let go */
function slide(state: GameState, fromX: number, toX = fromX, frames = 4) {
    beginDrag(state, { x: fromX, y: BOARD.height - 20 });
    for (let frame = 1; frame <= frames; frame++) {
        moveDrag(state, { x: fromX + ((toX - fromX) * frame) / frames, y: BOARD.height - 20 });
    }
    releaseDrag(state);
}

Deno.test("a new game has three objectives and a loaded launcher", () => {
    const state = createGame();
    assertEquals(state.orders.length, 3);
    assertEquals(state.orders.filter(order => order.done).length, 0);
    assertEquals(state.queue.length, 3);
    assertEquals(state.round, 1);
    assertEquals(state.coins, 0);
    assert(isReady(state));
});

Deno.test("objectives always ask for a tier that cannot simply spawn", () => {
    for (let attempt = 0; attempt < 200; attempt++) {
        const state = createGame();
        const spawnable = Math.max(...state.queue);
        for (const order of state.orders) assertGreater(order.tier, spawnable);
    }
});

Deno.test("the launcher gets mostly coal, some redstone and rarely copper", () => {
    const rolls = 20_000;
    const counts = [ 0, 0, 0 ];
    for (let roll = 0; roll < rolls; roll++) counts[ pickSpawnTier() ]++;
    assertAlmostEquals(counts[ 0 ] / rolls, 0.65, 0.03);
    assertAlmostEquals(counts[ 1 ] / rolls, 0.3, 0.03);
    assertAlmostEquals(counts[ 2 ] / rolls, 0.05, 0.02);
});

Deno.test("objective rewards match the item value table", () => {
    const state = createGame();
    for (const order of state.orders) assertEquals(order.reward, itemTiers[ order.tier ].coins * 3);
});

Deno.test("sliding moves the held item sideways only, inside the rails", () => {
    const state = createGame();
    beginDrag(state, { x: -40, y: 20 });
    assertEquals(launcherPosition(state).x, radiusOf(state.queue[ 0 ]));
    assertEquals(launcherPosition(state).y, LAUNCHER.y);
    moveDrag(state, { x: 70, y: 20 });
    assertEquals(launcherPosition(state).x, 70);
    assertEquals(launcherPosition(state).y, LAUNCHER.y);
    moveDrag(state, { x: 500, y: 20 });
    assertEquals(launcherPosition(state).x, BOARD.width - radiusOf(state.queue[ 0 ]));
});

Deno.test("letting go shoots the item up the tray, even without any slide", () => {
    const state = createGame();
    const tier = state.queue[ 0 ];
    slide(state, 50);
    assertEquals(state.items.length, 1);
    assertEquals(state.items[ 0 ].tier, tier);
    assertLess(state.items[ 0 ].vy, 0);
    assertEquals(state.items[ 0 ].vx, 0);
    assertEquals(state.shots, 1);
    assertEquals(state.queue.length, 3);
    assertEquals(launcherPosition(state), LAUNCHER);
});

Deno.test("a sideways slide only picks the lane, it never angles the shot", () => {
    for (const [ from, to ] of [ [ 30, 60 ], [ 60, 30 ], [ 10, 90 ] ]) {
        const state = createGame();
        slide(state, from, to);
        assertEquals(state.items[ 0 ].vx, 0);
        assertLess(state.items[ 0 ].vy, 0);
        assertEquals(state.items[ 0 ].x, to);
    }
});

Deno.test("a launched item carries all the way to the far end", () => {
    const state = createGame();
    slide(state, 50);
    run(state, 5);
    assertLess(state.items[ 0 ].y, BOARD.lineY);
    // it should end up against the far rail, not somewhere in the middle
    assertLess(state.items[ 0 ].y, 25);
});

Deno.test("only a short reload blocks the next shot, sliding items do not", () => {
    const state = createGame();
    slide(state, 50);
    assertFalse(isReady(state));
    slide(state, 50);
    assertEquals(state.items.length, 1);

    run(state, 0.3);
    assert(isReady(state), "should reload while the first item is still sliding");
    assertGreater(Math.abs(state.items[ 0 ].vy), 0);
    slide(state, 40);
    assertEquals(state.items.length, 2);
});

Deno.test("two touching items merge into the next tier and pay out", () => {
    const state = createGame();
    place(state, 1, 50, 100);
    place(state, 1, 56, 100);
    run(state, 0.2);
    assertEquals(state.items.length, 1);
    assertEquals(state.items[ 0 ].tier, 2);
    assertEquals(state.coins, itemTiers[ 2 ].coins);
    assertEquals(state.highestTier, 2);
    assertGreater(state.texts.length, 0);
});

Deno.test("a merge passes on the momentum that went into it, plus a small reward", () => {
    const state = createGame();
    const resting = place(state, 1, 50, 100);
    resting.settled = true;
    const incoming = place(state, 1, 50, 100 + radiusOf(1) * 1.9);
    incoming.vy = -100;
    run(state, 1 / 60);
    assertEquals(state.items.length, 1);
    const merged = state.items[ 0 ];
    // half of 100 shared between the two halves, then the 20% merge boost
    assertAlmostEquals(merged.vy, -60, 4);
    assertLess(merged.vy, incoming.vy / 2);
});

Deno.test("merging the ordered item completes that objective and pays the reward", () => {
    const state = createGame();
    const order = state.orders[ 0 ];
    const source = order.tier - 1;
    place(state, source, 50, 100);
    place(state, source, 50 + radiusOf(source) * 1.5, 100);
    run(state, 0.2);
    assert(order.done);
    assertEquals(state.deliveries, 1);
    assertEquals(state.coins, itemTiers[ order.tier ].coins + order.reward);
    // the delivered item leaves the tray
    assertEquals(state.items.length, 0);
});

Deno.test("an objective is only completed by a merge, not by a lucky spawn", () => {
    const state = createGame();
    const order = state.orders[ 0 ];
    place(state, order.tier, 50, 60).settled = true;
    run(state, 0.5);
    assertFalse(order.done);
    assertEquals(state.deliveries, 0);
});

Deno.test("finishing all three objectives starts the next round with a bonus", () => {
    const state = createGame();
    const before = state.coins;
    let expected = before;
    for (const order of [ ...state.orders ]) {
        const source = order.tier - 1;
        place(state, source, 50, 60);
        place(state, source, 50 + radiusOf(source) * 1.5, 60);
        expected += itemTiers[ order.tier ].coins + order.reward;
        run(state, 0.2);
    }
    assertEquals(state.deliveries, 3);
    assertEquals(state.round, 2);
    assertEquals(state.coins, expected + 500);
    assertEquals(state.orders.filter(order => order.done).length, 0);
    assertNotEquals(state.banner, null);
});

Deno.test("a top tier item cashes itself in once it stops", () => {
    const state = createGame();
    place(state, MAX_TIER, 50, 60).settled = true;
    run(state, 0.2);
    assertEquals(state.items.length, 0);
    assertEquals(state.coins, itemTiers[ MAX_TIER ].coins * 2);
});

Deno.test("items left in the serving zone end the run", () => {
    const state = createGame();
    for (const x of [ 20, 50, 80 ]) place(state, 0, x, BOARD.height - 20).settled = true;
    run(state, 0.2);
    assert(state.over);
});

Deno.test("a single spill is survivable", () => {
    const state = createGame();
    place(state, 0, 20, BOARD.height - 20).settled = true;
    run(state, 0.5);
    assertFalse(state.over);
});

Deno.test("the game ignores input once it is over", () => {
    const state = createGame();
    state.over = true;
    slide(state, 50);
    assertEquals(state.items.length, 0);
});

Deno.test("restarting clears the tray and the score", () => {
    const state = createGame();
    place(state, 4, 50, 60);
    state.coins = 4321;
    state.over = true;
    resetGame(state);
    assertEquals(state.items.length, 0);
    assertEquals(state.coins, 0);
    assertEquals(state.round, 1);
    assertFalse(state.over);
    assertEquals(state.orders.length, 3);
});

Deno.test("the three objectives of a round ask for different items", () => {
    for (let attempt = 0; attempt < 200; attempt++) {
        const tiers = createGame().orders.map(order => order.tier);
        assertEquals(new Set(tiers).size, tiers.length);
    }
});
