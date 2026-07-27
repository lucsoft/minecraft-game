import { loadSoundLibrary, SoundLibrary, streamFeatures } from "./data.ts";
import { createLayout } from "./layout.ts";
import { createPlayer } from "./player.ts";
import { createRenderer, Scene, worldRadius } from "./render.ts";
import { createGraph } from "./similarity.ts";
import { createUi } from "./ui.ts";

document.head.insertAdjacentHTML("beforeend", `<meta name="color-scheme" content="dark">`);

const canvas = document.createElement("canvas");
document.body.append(canvas);

const ui = createUi();
const renderer = createRenderer(canvas);
const layout = createLayout();
const graph = createGraph();
renderer.resize();

let library: SoundLibrary;
try {
    library = await loadSoundLibrary();
} catch (error) {
    document.body.insertAdjacentHTML("beforeend", `<div class="panel" style="inset:50% auto auto 50%;transform:translate(-50%,-50%);max-width:340px">
        <b>The asset pipeline is not answering.</b><br><br>
        Start it with <code>deno task cdn</code> and reload.<br><br>
        <span style="color:#9aa6b8">${error}</span>
    </div>`);
    throw error;
}
ui.setLegend(library.nodes);

const scene: Scene = {
    nodes: library.nodes,
    members: graph.members,
    edges: layout.edges,
    camera: { x: 0, y: 0, scale: 1 },
    colour: "category",
    hovered: -1,
    selected: -1,
    matches: new Set(),
    searching: false,
    playing: -1,
};

const player = createPlayer(() => {
    scene.playing = player.playing === undefined ? -1 : library.byName.get(player.playing) ?? -1;
});

/** the camera frames the graph on its own until the user takes over by panning or zooming */
let following = true;

function play(at: number, neighbours: boolean) {
    if (neighbours) {
        const cluster = [ at, ...library.nodes[ at ].neighbours.slice(0, ui.controls.links).map(entry => entry.to) ];
        player.playSequence(cluster.map(index => library.nodes[ index ].name));
    } else {
        player.play(library.nodes[ at ].name);
    }
}

function select(at: number) {
    scene.selected = at;
    ui.showDetails(library, at);
    if (at >= 0) play(at, false);
}

function applySearch() {
    scene.colour = ui.controls.colour;
    scene.searching = ui.controls.search.length > 0;
    scene.matches.clear();
    if (scene.searching) {
        for (const at of graph.members) {
            const node = library.nodes[ at ];
            if (node.name.includes(ui.controls.search) || node.events.some(event =>
                event.name.includes(ui.controls.search) || event.subtitle?.toLowerCase().includes(ui.controls.search))) {
                scene.matches.add(at);
            }
        }
    }
}

ui.onControls(() => {
    const before = scene.searching || scene.matches.size;
    applySearch();
    // typing should take you to the hits, but fiddling with the colours should not move the view
    if (before !== (scene.searching || scene.matches.size) || scene.searching) following = true;
    layout.rebuild(library.nodes, graph.members, ui.controls.links);
    layout.reheat(0.35);
});
ui.onPick(at => select(at));
ui.onPlay((at, neighbours) => play(at, neighbours));

// input ---------------------------------------------------------------------

const worldOf = (clientX: number, clientY: number) => ({
    x: (clientX - renderer.size.width / 2) / scene.camera.scale + scene.camera.x,
    y: (clientY - renderer.size.height / 2) / scene.camera.scale + scene.camera.y,
});

function nodeAt(clientX: number, clientY: number) {
    const point = worldOf(clientX, clientY);
    let best = -1;
    let bestDistance = Infinity;
    for (const at of graph.members) {
        const node = library.nodes[ at ];
        const reach = (worldRadius(node, scene.camera.scale) + 4 / scene.camera.scale) ** 2;
        const distance = (node.x - point.x) ** 2 + (node.y - point.y) ** 2;
        if (distance < reach && distance < bestDistance) {
            best = at;
            bestDistance = distance;
        }
    }
    return best;
}

let drag: { x: number; y: number; moved: number; } | undefined;

function follow() {
    if (!following || !graph.members.length) return;
    let { minX, minY, maxX, maxY } = layout.extent;
    // a search frames what it found, which is the only way to spot six dots among four thousand
    if (scene.searching && scene.matches.size) {
        minX = minY = Infinity;
        maxX = maxY = -Infinity;
        for (const at of scene.matches) {
            const node = library.nodes[ at ];
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x);
            maxY = Math.max(maxY, node.y);
        }
    }
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const wanted = Math.min(scene.searching ? 2.5 : 12, Math.max(0.12,
        Math.min(renderer.size.width / (width * 1.12), renderer.size.height / (height * 1.12))));
    // eased, so the view drifts with the layout instead of snapping around every frame
    scene.camera.x += ((minX + maxX) / 2 - scene.camera.x) * 0.08;
    scene.camera.y += ((minY + maxY) / 2 - scene.camera.y) * 0.08;
    scene.camera.scale += (wanted - scene.camera.scale) * 0.08;
}

canvas.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("dragging");
    drag = { x: event.clientX, y: event.clientY, moved: 0 };
});

canvas.addEventListener("pointermove", (event) => {
    if (drag) {
        const deltaX = event.clientX - drag.x;
        const deltaY = event.clientY - drag.y;
        drag.moved += Math.abs(deltaX) + Math.abs(deltaY);
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (drag.moved > 5) following = false;
        scene.camera.x -= deltaX / scene.camera.scale;
        scene.camera.y -= deltaY / scene.camera.scale;
        return;
    }
    scene.hovered = nodeAt(event.clientX, event.clientY);
});

canvas.addEventListener("pointerup", (event) => {
    canvas.classList.remove("dragging");
    // a click that wandered was a pan, only a still one counts as picking a sound
    if (drag && drag.moved < 5) select(nodeAt(event.clientX, event.clientY));
    drag = undefined;
});

canvas.addEventListener("pointercancel", () => {
    canvas.classList.remove("dragging");
    drag = undefined;
});

canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    following = false;
    const before = worldOf(event.clientX, event.clientY);
    scene.camera.scale = Math.max(0.12, Math.min(12, scene.camera.scale * Math.exp(-event.deltaY * 0.0015)));
    const after = worldOf(event.clientX, event.clientY);
    // keep whatever sits under the cursor pinned to the cursor
    scene.camera.x += before.x - after.x;
    scene.camera.y += before.y - after.y;
}, { passive: false });

globalThis.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.code === "Space" && scene.selected >= 0) {
        event.preventDefault();
        play(scene.selected, false);
    }
    if (event.code === "Escape") {
        player.stop();
        select(-1);
    }
});

new ResizeObserver(() => renderer.resize()).observe(canvas);

// loading -------------------------------------------------------------------

let analysed = 0;
let total = library.nodes.length;
let dirty = false;
ui.setProgress(0, total);

streamFeatures((rows) => {
    for (const { name, features } of rows) {
        const at = library.byName.get(name);
        if (at === undefined) continue;
        library.nodes[ at ].features = features;
        graph.add(library.nodes, at);
        analysed++;
    }
    dirty = true;
}).then((reported) => {
    graph.flush(library.nodes);
    total = reported || total;
    dirty = true;
}).catch((error) => {
    console.error("[sound] the feature stream stopped:", error);
    graph.flush(library.nodes);
    dirty = true;
});

/** the graph only has to catch up with the stream a few times a second, not every frame */
function absorb() {
    dirty = false;
    for (const at of graph.members) {
        if (!library.nodes[ at ].placed) layout.seed(library.nodes, at);
    }
    graph.settle(library.nodes);
    applySearch();
    layout.rebuild(library.nodes, graph.members, ui.controls.links);
    layout.reheat(0.6);
    ui.setProgress(analysed, total);
    if (scene.selected >= 0) ui.showDetails(library, scene.selected);
}

let lastAbsorb = 0;

function frame(now: number) {
    if (dirty && now - lastAbsorb > 600) {
        lastAbsorb = now;
        absorb();
    }
    layout.step(library.nodes, graph.members);
    follow();
    renderer.draw(scene);
    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// @ts-expect-error debug handle, same as the other pages
globalThis.soundGraph = { library, graph, layout, scene, player };
