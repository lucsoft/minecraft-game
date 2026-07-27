import { assert, assertEquals, assertGreater, assertLess } from "@std/assert";
import { BOARD } from "./game.ts";
import { MAX_TIER } from "./items.ts";
import { Item, radiusOf, speedOf, stepPhysics } from "./physics.ts";

function item(tier: number, x: number, y: number, vx = 0, vy = 0): Item {
    return { id: 0, tier, x, y, vx, vy, angle: 0, spin: 0, pop: 0, settled: false, merging: false };
}

function step(items: Item[], seconds: number, dt = 1 / 60) {
    const merges: [ Item, Item ][] = [];
    for (let elapsed = 0; elapsed < seconds; elapsed += dt) {
        merges.push(...stepPhysics(items, BOARD, dt));
    }
    return merges;
}

Deno.test("a sliding item loses speed and comes to a stop", () => {
    const sliding = item(0, 50, 150, 0, -120);
    step([ sliding ], 4);
    assertEquals(speedOf(sliding), 0);
    assert(sliding.settled);
    assertLess(sliding.y, 150);
});

Deno.test("a full power shot glides to the far end of the tray", () => {
    const sliding = item(0, 50, 158, 0, -315);
    step([ sliding ], 6);
    assertEquals(speedOf(sliding), 0);
    assertLess(sliding.y, 22);
});

Deno.test("a resting item only creeps when it is nudged", () => {
    const resting = item(2, 50, 100);
    resting.settled = true;
    const nudge = item(0, 50, 116, 0, -60);
    step([ nudge, resting ], 3);
    assertEquals(speedOf(resting), 0);
    // the sand grabs hold, so a soft hit shifts it a few units at most
    assertLess(100 - resting.y, 10);
    assertGreater(100 - resting.y, 0);
});

Deno.test("items bounce off the rails and never leave the tray", () => {
    const items = [ item(0, 6, 20, -260, -40), item(3, 94, 40, 300, 120) ];
    step(items, 3);
    for (const entry of items) {
        const radius = radiusOf(entry.tier);
        assert(entry.x >= radius - 0.001 && entry.x <= BOARD.width - radius + 0.001, `x out of bounds: ${entry.x}`);
        assert(entry.y >= radius - 0.001 && entry.y <= BOARD.height - radius + 0.001, `y out of bounds: ${entry.y}`);
    }
});

Deno.test("two touching items of the same tier report a merge exactly once", () => {
    const a = item(0, 50, 100);
    const b = item(0, 56, 100);
    const merges = step([ a, b ], 1);
    assertEquals(merges.length, 1);
    assertEquals(merges[ 0 ].map(entry => entry.tier), [ 0, 0 ]);
    assert(a.merging && b.merging);
});

Deno.test("items of different tiers push each other apart instead of merging", () => {
    const a = item(0, 50, 100);
    const b = item(1, 55, 100);
    const merges = step([ a, b ], 0.5);
    assertEquals(merges.length, 0);
    assertGreater(Math.hypot(b.x - a.x, b.y - a.y), radiusOf(0) + radiusOf(1) - 0.5);
});

Deno.test("the top tier does not merge any further", () => {
    const a = item(MAX_TIER, 50, 100);
    const b = item(MAX_TIER, 55, 100);
    assertEquals(step([ a, b ], 0.5).length, 0);
});

Deno.test("a head-on hit transfers momentum to the resting item", () => {
    const moving = item(0, 50, 140, 0, -160);
    const resting = item(1, 50, 100);
    step([ moving, resting ], 2);
    assertLess(resting.y, 100);
});

Deno.test("stacked items with identical positions are separated", () => {
    const a = item(2, 50, 100);
    const b = item(3, 50, 100);
    step([ a, b ], 0.5);
    assertGreater(Math.hypot(b.x - a.x, b.y - a.y), 1);
});
