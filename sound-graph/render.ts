import { SoundNode } from "./data.ts";
import { Edge } from "./layout.ts";

/** the top level folders, everything else falls back to the last colour */
export const CATEGORIES: Record<string, string> = {
    block: "#7bd06a",
    mob: "#e0736b",
    entity: "#e8a44c",
    item: "#f2d857",
    ambient: "#6fb6e8",
    music: "#b98ce8",
    records: "#e07bc4",
    step: "#9c8a6a",
    ui: "#8fe8d0",
    note: "#f0f0f0",
    random: "#8f9ce8",
    dig: "#c0a878",
    liquid: "#5ec8e0",
    enchant: "#d0a0f0",
    fire: "#f08a4c",
    portal: "#a878e0",
    event: "#e8d0a0",
    fireworks: "#f0e05c",
    damage: "#e05c5c",
    minecart: "#a0a0b0",
    tile: "#9ad06a",
};
const OTHER = "#808a99";

export type ColourMode = "category" | "brightness" | "length" | "pitch";

export interface Camera {
    x: number;
    y: number;
    scale: number;
}

export interface Scene {
    nodes: SoundNode[];
    members: number[];
    edges: Edge[];
    camera: Camera;
    colour: ColourMode;
    hovered: number;
    selected: number;
    /** node indices the search matched, empty means no search is running */
    matches: Set<number>;
    searching: boolean;
    playing: number;
}

const hueScale = (value: number, low: number, high: number) => {
    const ratio = Math.max(0, Math.min(1, (value - low) / (high - low)));
    // cyan through yellow to red, dull sounds cold and sharp ones hot
    return `hsl(${(1 - ratio) * 195}deg 72% ${45 + ratio * 18}%)`;
};

export function colourOf(node: SoundNode, mode: ColourMode) {
    const features = node.features;
    if (!features || mode === "category") return CATEGORIES[ node.category ] ?? OTHER;
    if (mode === "brightness") return hueScale(Math.log(features.centroid + 1), 5, 9.4);
    if (mode === "length") return hueScale(Math.log(features.active + 0.02), -3.5, 1.6);
    return features.pitch ? hueScale(Math.log(features.pitch), 4, 7.6) : "#4a5160";
}

/** longer sounds get a bigger dot, so the music sits in the graph as a few obvious blobs */
const radiusOf = (node: SoundNode) =>
    2 + Math.max(0.6, Math.min(4.5, Math.log((node.features?.active ?? 0.2) + 0.05) * 0.9 + 3.2));

/**
 * Dots are sized in screen pixels and then converted back, otherwise four thousand of them turn
 * into invisible specks the moment the whole graph is in view. They still grow a little on the
 * way in so zooming feels like getting closer rather than just cropping.
 */
export const worldRadius = (node: SoundNode, scale: number) =>
    radiusOf(node) * Math.min(2.2, Math.max(0.55, Math.sqrt(scale))) / scale;

const BANDS = [
    { from: 0, to: 0.45, width: 0.5, dim: "#1e2634", lit: "#4a5f8c" },
    { from: 0.45, to: 0.7, width: 1, dim: "#2b384e", lit: "#6d8fd6" },
    { from: 0.7, to: 1.01, width: 1.6, dim: "#3b4e6e", lit: "#a8c6ff" },
];

export function createRenderer(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d")!;
    let width = 0;
    let height = 0;

    function resize() {
        const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
        const box = canvas.getBoundingClientRect();
        width = box.width;
        height = box.height;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    return {
        resize,
        get size() {
            return { width, height };
        },
        draw(scene: Scene) {
            const { camera, nodes } = scene;
            context.setTransform(1, 0, 0, 1, 0, 0);
            const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
            context.scale(ratio, ratio);
            context.fillStyle = "#0d1016";
            context.fillRect(0, 0, width, height);

            context.save();
            context.translate(width / 2 - camera.x * camera.scale, height / 2 - camera.y * camera.scale);
            context.scale(camera.scale, camera.scale);

            const focus = scene.selected >= 0 ? scene.selected : scene.hovered;
            const near = new Set<number>();
            if (focus >= 0) {
                for (const neighbour of nodes[ focus ].neighbours) near.add(neighbour.to);
            }

            // the web goes down in three strength bands, so a strong link really does look
            // stronger, and the links of whatever is under the cursor go over the top of it
            context.lineCap = "round";
            for (const pass of focus >= 0 ? [ false, true ] : [ false ]) {
                for (const band of BANDS) {
                    context.beginPath();
                    let drawn = 0;
                    for (const edge of scene.edges) {
                        if (edge.strength < band.from || edge.strength >= band.to) continue;
                        if (pass !== (edge.a === focus || edge.b === focus)) continue;
                        // during a search the web is just noise around the few dots that matter
                        if (scene.searching && !scene.matches.has(edge.a) && !scene.matches.has(edge.b)) continue;
                        context.moveTo(nodes[ edge.a ].x, nodes[ edge.a ].y);
                        context.lineTo(nodes[ edge.b ].x, nodes[ edge.b ].y);
                        drawn++;
                    }
                    if (!drawn) continue;
                    context.lineWidth = (pass ? band.width * 1.6 : band.width) / camera.scale;
                    context.strokeStyle = pass ? band.lit : band.dim;
                    context.stroke();
                }
            }

            for (const at of scene.members) {
                const node = nodes[ at ];
                const radius = worldRadius(node, camera.scale);
                const dimmed = scene.searching && !scene.matches.has(at);
                context.globalAlpha = dimmed ? 0.12 : focus >= 0 && at !== focus && !near.has(at) ? 0.4 : 1;
                context.beginPath();
                context.arc(node.x, node.y, radius, 0, Math.PI * 2);
                context.fillStyle = colourOf(node, scene.colour);
                context.fill();
                if (!dimmed && scene.searching) {
                    context.beginPath();
                    context.arc(node.x, node.y, radius + 5 / camera.scale, 0, Math.PI * 2);
                    context.lineWidth = 1.5 / camera.scale;
                    context.strokeStyle = "#ffe97f";
                    context.stroke();
                }
                if (near.has(at)) {
                    context.lineWidth = 1.4 / camera.scale;
                    context.strokeStyle = "#ffffff";
                    context.stroke();
                }
            }
            context.globalAlpha = 1;

            for (const [ at, colour ] of [ [ scene.playing, "#ffe97f" ], [ scene.selected, "#ffffff" ] ] as const) {
                if (at < 0) continue;
                const node = nodes[ at ];
                context.beginPath();
                context.arc(node.x, node.y, worldRadius(node, camera.scale) + 5 / camera.scale, 0, Math.PI * 2);
                context.lineWidth = 2 / camera.scale;
                context.strokeStyle = colour;
                context.stroke();
            }

            context.restore();

            // folder names as landmarks, biggest first and anything that would land on top of one
            // already written is dropped, otherwise the middle of the graph turns into grey mush
            const folders = new Map<string, { x: number; y: number; count: number; }>();
            for (const at of scene.members) {
                const node = nodes[ at ];
                const entry = folders.get(node.folder) ?? { x: 0, y: 0, count: 0 };
                entry.x += node.x;
                entry.y += node.y;
                entry.count++;
                folders.set(node.folder, entry);
            }
            context.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
            context.textAlign = "center";
            context.textBaseline = "alphabetic";
            const taken: { x: number; y: number; half: number; }[] = [];
            // a handful for orientation when the whole graph is in view, more as you come closer
            const room = Math.max(14, Math.min(70, Math.round(12 + camera.scale * 70)));
            for (const [ folder, entry ] of Array.from(folders).sort((a, b) => b[ 1 ].count - a[ 1 ].count)) {
                if (entry.count < 4 || taken.length >= room) continue;
                const x = width / 2 + (entry.x / entry.count - camera.x) * camera.scale;
                const y = height / 2 + (entry.y / entry.count - camera.y) * camera.scale - 10;
                if (x < 40 || y < 12 || x > width - 40 || y > height - 8) continue;
                const half = context.measureText(folder).width / 2 + 6;
                if (taken.some(other => Math.abs(other.x - x) < other.half + half && Math.abs(other.y - y) < 13)) continue;
                taken.push({ x, y, half });
                context.fillStyle = "#0d1016c0";
                context.fillRect(x - half, y - 9, half * 2, 12);
                context.fillStyle = "#97a3b8";
                context.fillText(folder, x, y);
            }
        },
    };
}
