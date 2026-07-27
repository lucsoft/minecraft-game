import { SoundLibrary, SoundNode } from "./data.ts";
import { CATEGORIES, ColourMode } from "./render.ts";

const style = `
:root {
    color-scheme: dark;
}

body {
    margin: 0;
    background: #0d1016;
    overflow: hidden;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    color: #e6ebf2;
    -webkit-user-select: none;
    user-select: none;
}

canvas {
    display: block;
    width: 100vw;
    height: 100dvh;
    touch-action: none;
    cursor: grab;
}

canvas.dragging {
    cursor: grabbing;
}

.panel {
    position: fixed;
    background: #12161ee6;
    border: 2px solid #000000;
    box-shadow: inset 2px 2px 0 #ffffff1a, inset -2px -2px 0 #00000080;
    backdrop-filter: blur(6px);
    padding: 10px 12px;
}

.title {
    inset: 12px auto auto 12px;
    max-width: 320px;
}

.title h1 {
    margin: 0;
    font-size: 14px;
    letter-spacing: 2px;
}

.title p {
    margin: 6px 0 0;
    font-size: 11px;
    line-height: 1.5;
    color: #9aa6b8;
}

.progress {
    margin-top: 8px;
    height: 4px;
    background: #000000;
    overflow: hidden;
}

.progress div {
    height: 100%;
    width: 0;
    background: #7bd06a;
    transition: width .2s linear;
}

.tools {
    inset: 12px 12px auto auto;
    display: grid;
    gap: 8px;
    width: 210px;
}

.tools label {
    display: grid;
    gap: 4px;
    font-size: 10px;
    letter-spacing: 1px;
    color: #8b97ab;
}

.tools input,
.tools select {
    font: inherit;
    font-size: 12px;
    color: #e6ebf2;
    background: #070a0f;
    border: 1px solid #2b3342;
    padding: 5px 6px;
}

.tools input[type="range"] {
    padding: 0;
    border: 0;
    background: none;
    accent-color: #7bd06a;
}

.tools input:focus,
.tools select:focus {
    outline: 1px solid #4a6f9c;
}

.legend {
    inset: auto auto 12px 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    max-width: 300px;
    font-size: 10px;
    letter-spacing: 1px;
    color: #9aa6b8;
}

.legend span {
    display: flex;
    align-items: center;
    gap: 4px;
}

.legend i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
}

.details {
    inset: auto 12px 12px auto;
    width: 300px;
    max-height: 62dvh;
    overflow-y: auto;
    display: none;
}

.details.open {
    display: block;
}

.details h2 {
    margin: 0;
    font-size: 12px;
    letter-spacing: 1px;
    word-break: break-all;
}

.details .subtitle {
    margin: 4px 0 0;
    font-size: 11px;
    color: #9aa6b8;
}

.details .actions {
    display: flex;
    gap: 6px;
    margin: 10px 0;
}

.details button {
    flex: 1;
    font: inherit;
    font-size: 11px;
    letter-spacing: 1px;
    color: #ffffff;
    background: #3c8527;
    border: 2px solid #000000;
    box-shadow: inset 2px 2px 0 #ffffff33, inset -2px -2px 0 #00000080;
    padding: 6px 4px;
    cursor: pointer;
}

.details button.secondary {
    background: #2b3342;
}

.details button:active {
    box-shadow: inset -2px -2px 0 #ffffff1a, inset 2px 2px 0 #00000080;
}

.details dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    margin: 0 0 10px;
    font-size: 11px;
}

.details dt {
    color: #8b97ab;
}

.details dd {
    margin: 0;
    text-align: right;
}

.details h3 {
    margin: 0 0 6px;
    font-size: 10px;
    letter-spacing: 1px;
    color: #8b97ab;
}

.details ol {
    list-style: none;
    margin: 0 0 10px;
    padding: 0;
    display: grid;
    gap: 3px;
}

.details ol li {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    align-items: center;
    font-size: 11px;
    padding: 3px 4px;
    background: #ffffff08;
    cursor: pointer;
}

.details ol li:hover {
    background: #ffffff16;
}

.details ol li span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.details ol li b {
    font-weight: 400;
    color: #7bd06a;
}

.details .events {
    font-size: 10px;
    color: #8b97ab;
    line-height: 1.6;
    word-break: break-all;
}

.hint {
    position: fixed;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    font-size: 10px;
    letter-spacing: 1px;
    color: #5c6779;
    pointer-events: none;
}
`;

export interface Controls {
    search: string;
    colour: ColourMode;
    links: number;
}

export interface Ui {
    readonly controls: Controls;
    onControls(handler: () => void): void;
    onPick(handler: (at: number) => void): void;
    onPlay(handler: (at: number, neighbours: boolean) => void): void;
    setLegend(nodes: SoundNode[]): void;
    setProgress(analysed: number, total: number): void;
    showDetails(library: SoundLibrary, at: number): void;
}

const format = {
    seconds: (value: number) => value < 1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(2)} s`,
    hertz: (value: number) => value >= 1000 ? `${(value / 1000).toFixed(2)} kHz` : `${Math.round(value)} Hz`,
};

export function createUi(): Ui {
    document.head.insertAdjacentHTML("beforeend", `<style>${style}</style>`);
    const root = document.createElement("div");
    root.innerHTML = `
        <div class="panel title">
            <h1>MINECRAFT SOUNDS</h1>
            <p data-status>asking the asset pipeline…</p>
            <div class="progress"><div data-bar></div></div>
        </div>
        <div class="panel tools">
            <label>SEARCH<input type="search" data-search placeholder="creeper, step, bell…"></label>
            <label>COLOUR BY<select data-colour>
                <option value="category">folder</option>
                <option value="brightness">brightness</option>
                <option value="length">length</option>
                <option value="pitch">pitch</option>
            </select></label>
            <label data-links-label>LINKS PER SOUND · 4<input type="range" min="1" max="8" value="4" data-links></label>
        </div>
        <div class="panel legend" data-legend></div>
        <div class="panel details" data-details></div>
        <div class="hint">DRAG TO PAN · SCROLL TO ZOOM · CLICK A DOT TO HEAR IT</div>
    `;
    document.body.append(root);

    const query = <T extends Element>(selector: string) => root.querySelector<T>(selector)!;
    const statusEl = query<HTMLParagraphElement>("[data-status]");
    const barEl = query<HTMLDivElement>("[data-bar]");
    const searchEl = query<HTMLInputElement>("[data-search]");
    const colourEl = query<HTMLSelectElement>("[data-colour]");
    const linksEl = query<HTMLInputElement>("[data-links]");
    const linksLabel = query<HTMLLabelElement>("[data-links-label]");
    const legendEl = query<HTMLDivElement>("[data-legend]");
    const detailsEl = query<HTMLDivElement>("[data-details]");

    const controls: Controls = { search: "", colour: "category", links: 4 };
    let onControls = () => {};
    let onPick = (_at: number) => {};
    let onPlay = (_at: number, _neighbours: boolean) => {};

    searchEl.addEventListener("input", () => {
        controls.search = searchEl.value.trim().toLowerCase();
        onControls();
    });
    colourEl.addEventListener("change", () => {
        controls.colour = colourEl.value as ColourMode;
        onControls();
    });
    linksEl.addEventListener("input", () => {
        controls.links = Number(linksEl.value);
        linksLabel.firstChild!.textContent = `LINKS PER SOUND · ${controls.links}`;
        onControls();
    });

    detailsEl.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        const action = target.closest<HTMLElement>("[data-play]");
        if (action) return onPlay(Number(action.dataset.play), action.dataset.neighbours === "yes");
        const jump = target.closest<HTMLElement>("[data-jump]");
        if (jump) onPick(Number(jump.dataset.jump));
    });

    return {
        controls,
        onControls(handler) {
            onControls = handler;
        },
        onPick(handler) {
            onPick = handler;
        },
        onPlay(handler) {
            onPlay = handler;
        },
        setLegend(nodes) {
            const counts = new Map<string, number>();
            for (const node of nodes) counts.set(node.category, (counts.get(node.category) ?? 0) + 1);
            legendEl.innerHTML = Array.from(counts.entries())
                .sort((a, b) => b[ 1 ] - a[ 1 ])
                .map(([ category, count ]) =>
                    `<span><i style="background:${CATEGORIES[ category ] ?? "#808a99"}"></i>${category} ${count}</span>`)
                .join("");
        },
        setProgress(analysed, total) {
            barEl.style.width = `${total ? analysed / total * 100 : 0}%`;
            statusEl.textContent = analysed >= total
                ? `${total} sounds, linked by how they sound`
                : `analysing ${analysed} of ${total} sounds…`;
            if (analysed >= total) barEl.parentElement!.style.display = "none";
        },
        showDetails(library, at) {
            if (at < 0) {
                detailsEl.classList.remove("open");
                return;
            }
            const node = library.nodes[ at ];
            const features = node.features;
            const subtitle = node.events.find(event => event.subtitle)?.subtitle;
            const rows: [ string, string ][] = features
                ? [
                    [ "length", format.seconds(node.features!.duration) ],
                    [ "loudness", `${features.loudness.toFixed(1)} dB` ],
                    [ "brightness", format.hertz(features.centroid) ],
                    [ "attack", format.seconds(features.attack) ],
                    [ "noisiness", `${Math.round(Math.min(1, Math.max(0, 1 + features.flatness / 70)) * 100)}%` ],
                    [ "pitch", features.pitch ? format.hertz(features.pitch) : "unpitched" ],
                ]
                : [];
            detailsEl.classList.add("open");
            detailsEl.innerHTML = `
                <h2>${node.name}</h2>
                ${subtitle ? `<p class="subtitle">${subtitle}</p>` : ""}
                <div class="actions">
                    <button type="button" data-play="${at}">PLAY</button>
                    <button type="button" class="secondary" data-play="${at}" data-neighbours="yes">PLAY CLUSTER</button>
                </div>
                <dl>${rows.map(([ key, value ]) => `<dt>${key}</dt><dd>${value}</dd>`).join("")}</dl>
                ${node.neighbours.length ? `<h3>SOUNDS ALIKE</h3><ol>${node.neighbours.map(neighbour => `
                    <li data-jump="${neighbour.to}"><span>${library.nodes[ neighbour.to ].name}</span><b>${Math.round(neighbour.strength * 100)}%</b></li>
                `).join("")}</ol>` : ""}
                ${node.events.length ? `<h3>PLAYED BY</h3><div class="events">${node.events.slice(0, 12).map(event => event.name).join(" · ")}</div>` : ""}
            `;
        },
    };
}

