import { soundFeaturesUrl, soundListUrl } from "../asset-pipeline-url.ts";

/** the analysis the pipeline ran on the file, see asset-pipeline/sound-features.ts */
export interface SoundFeatures {
    duration: number;
    active: number;
    loudness: number;
    centroid: number;
    spread: number;
    rolloff: number;
    flatness: number;
    zcr: number;
    attack: number;
    temporal: number;
    pitch: number;
    tonality: number;
    mfcc: number[];
    mfccVar: number[];
}

export interface SoundEvent {
    name: string;
    subtitle?: string;
    sounds: number[];
}

export interface Neighbour {
    /** index into the node list */
    to: number;
    /** squared distance in timbre space, only meaningful next to other gaps */
    gap: number;
    /** 0..1, how alike the two sounds are, this is what the graph draws */
    strength: number;
}

export interface SoundNode {
    name: string;
    /** the top level folder, "block", "mob", "ambient" and so on */
    category: string;
    /** the containing folder, sounds in one folder are almost always variations of each other */
    folder: string;
    size: number;
    events: SoundEvent[];
    features?: SoundFeatures;
    neighbours: Neighbour[];
    x: number;
    y: number;
    vx: number;
    vy: number;
    /** false until the sound has been analysed and given a place in the graph */
    placed: boolean;
}

export interface SoundLibrary {
    nodes: SoundNode[];
    events: SoundEvent[];
    byName: Map<string, number>;
}

export async function loadSoundLibrary(): Promise<SoundLibrary> {
    const response = await fetch(soundListUrl());
    if (!response.ok) throw new Error(`the asset pipeline said ${response.status}`);
    const index = await response.json() as { sounds: { name: string; size: number; }[]; events: SoundEvent[]; };

    const nodes: SoundNode[] = index.sounds.map(sound => {
        const parts = sound.name.split("/");
        return {
            name: sound.name,
            category: parts[ 0 ],
            folder: parts.slice(0, -1).join("/") || parts[ 0 ],
            size: sound.size,
            events: [],
            neighbours: [],
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            placed: false,
        };
    });
    for (const event of index.events) {
        for (const at of event.sounds) nodes[ at ]?.events.push(event);
    }
    return { nodes, events: index.events, byName: new Map(nodes.map((node, at) => [ node.name, at ])) };
}

/**
 * The first run has to download and decode 4000 files, so the pipeline hands them over as it
 * finishes them rather than at the end. Rows arrive in batches and the graph grows with them.
 */
export async function streamFeatures(onRows: (rows: { name: string; features: SoundFeatures; }[]) => void) {
    const response = await fetch(soundFeaturesUrl());
    if (!response.ok || !response.body) throw new Error(`the asset pipeline said ${response.status}`);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let rest = "";
    let total = 0;
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const lines = (rest + value).split("\n");
        // the last piece is whatever came before the chunk boundary, it is finished by the next read
        rest = lines.pop() ?? "";
        const rows: { name: string; features: SoundFeatures; }[] = [];
        for (const line of lines) {
            if (!line) continue;
            const parsed = JSON.parse(line);
            if (parsed.total !== undefined) {
                total = parsed.total;
                continue;
            }
            const { n, ...features } = parsed;
            rows.push({ name: n, features });
        }
        if (rows.length) onRows(rows);
    }
    return total;
}
