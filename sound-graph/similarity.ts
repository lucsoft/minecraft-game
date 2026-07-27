import { Neighbour, SoundFeatures, SoundNode } from "./data.ts";

/**
 * Turns the analysis into a point in timbre space. The MFCCs describe the colour of the sound
 * and carry most of the weight, the rest says how long, how bright, how noisy and how sudden it
 * is. Everything is z-scored before it is compared, otherwise Hz would drown out the coefficients.
 */
const WEIGHTS = [
    ...new Array(12).fill(1),      // mfcc, the shape of the spectrum
    ...new Array(12).fill(0.45),   // mfccVar, how much that shape moves over the sound
    0.9,   // length
    0.35,  // loudness
    0.8,   // centroid
    0.5,   // rolloff
    0.7,   // flatness
    0.5,   // zero crossings
    0.5,   // attack
    0.4,   // where the energy sits in time
    0.6,   // tonality
    0.4,   // pitch
];
const DIMENSIONS = WEIGHTS.length;

/** a handful of sounds are wild outliers, without a clamp they would sit alone at the edge */
const CLAMP = 4;
/** kept per sound, the slider on the page picks how many of them are actually drawn */
export const MAX_NEIGHBOURS = 8;
/**
 * How many sounds the mean and deviation are taken from. They are frozen afterwards so a
 * distance measured early in the stream stays comparable with one measured at the end.
 */
const SAMPLE = 600;

function rawVector(features: SoundFeatures) {
    const raw = new Float32Array(DIMENSIONS);
    for (let i = 0; i < 12; i++) {
        raw[ i ] = features.mfcc[ i ] ?? 0;
        raw[ 12 + i ] = features.mfccVar[ i ] ?? 0;
    }
    raw[ 24 ] = Math.log(features.active + 0.02);
    raw[ 25 ] = features.loudness;
    raw[ 26 ] = Math.log(features.centroid + 1);
    raw[ 27 ] = Math.log(features.rolloff + 1);
    raw[ 28 ] = features.flatness;
    raw[ 29 ] = Math.log(features.zcr + 1);
    raw[ 30 ] = Math.log(features.attack + 0.001);
    raw[ 31 ] = features.temporal;
    raw[ 32 ] = features.tonality;
    // an unpitched sound reports 0Hz, folding in the confidence keeps it away from "very low note"
    raw[ 33 ] = features.tonality * Math.log(features.pitch + 1);
    return raw;
}

/** keeps a neighbour list sorted and capped, returns the gap that now bounds it */
function insert(list: Neighbour[], entry: Neighbour) {
    let position = list.length;
    while (position > 0 && list[ position - 1 ].gap > entry.gap) position--;
    list.splice(position, 0, entry);
    if (list.length > MAX_NEIGHBOURS) list.pop();
    return list.length >= MAX_NEIGHBOURS ? list[ list.length - 1 ].gap : Infinity;
}

export interface Graph {
    /** node indices that have a place in the graph, in the order they got one */
    readonly members: number[];
    /** feeds one analysed sound in, linking it to everything already there */
    add(nodes: SoundNode[], at: number): void;
    /** places whatever is still held back waiting for the sample to fill */
    flush(nodes: SoundNode[]): void;
    /** recomputes every strength from the spread of the whole graph, call after a batch */
    settle(nodes: SoundNode[]): void;
}

export function createGraph(): Graph {
    let vectors = new Float32Array(1024 * DIMENSIONS);
    let bounds = new Float64Array(1024);
    const members: number[] = [];
    const placed = new Set<number>();
    /** held back until there are enough of them to measure the deviations from */
    const waiting: number[] = [];
    let mean: Float32Array | undefined;
    let scale: Float32Array | undefined;

    function fit(nodes: SoundNode[]) {
        const rows = waiting.map(at => rawVector(nodes[ at ].features!));
        mean = new Float32Array(DIMENSIONS);
        scale = new Float32Array(DIMENSIONS);
        for (const row of rows) {
            for (let d = 0; d < DIMENSIONS; d++) mean[ d ] += row[ d ] / rows.length;
        }
        for (const row of rows) {
            for (let d = 0; d < DIMENSIONS; d++) scale[ d ] += (row[ d ] - mean[ d ]) ** 2 / rows.length;
        }
        for (let d = 0; d < DIMENSIONS; d++) scale[ d ] = WEIGHTS[ d ] / Math.max(1e-4, Math.sqrt(scale[ d ]));
    }

    function place(node: SoundNode, at: number) {
        const index = members.length;
        if ((index + 1) * DIMENSIONS > vectors.length) {
            const grown = new Float32Array(vectors.length * 2);
            grown.set(vectors);
            vectors = grown;
            const wider = new Float64Array(bounds.length * 2);
            wider.set(bounds);
            bounds = wider;
        }
        const raw = rawVector(node.features!);
        const offset = index * DIMENSIONS;
        for (let d = 0; d < DIMENSIONS; d++) {
            const value = (raw[ d ] - mean![ d ]) * scale![ d ];
            vectors[ offset + d ] = Math.max(-CLAMP, Math.min(CLAMP, value));
        }
        bounds[ index ] = Infinity;
        members.push(at);
        placed.add(at);
        return index;
    }

    /**
     * Compares the newcomer against everything already in the graph and lets both sides keep it
     * if it is close enough. That is O(n) per sound, but the row it walks is a flat array and the
     * distance bails the moment it cannot beat either list, so the whole 4000 stay interactive.
     */
    function link(nodes: SoundNode[], index: number) {
        const at = members[ index ];
        const list = nodes[ at ].neighbours;
        const offset = index * DIMENSIONS;
        let far = Infinity;

        for (let other = 0; other < index; other++) {
            const otherOffset = other * DIMENSIONS;
            const limit = Math.max(far, bounds[ other ]);
            let sum = 0;
            for (let d = 0; d < DIMENSIONS; d++) {
                const delta = vectors[ offset + d ] - vectors[ otherOffset + d ];
                sum += delta * delta;
                if (sum > limit) break;
            }
            if (sum > limit) continue;
            if (sum <= far) far = insert(list, { to: members[ other ], gap: sum, strength: 0 });
            if (sum <= bounds[ other ]) {
                bounds[ other ] = insert(nodes[ members[ other ] ].neighbours, { to: at, gap: sum, strength: 0 });
            }
        }
        bounds[ index ] = far;
    }

    function drain(nodes: SoundNode[]) {
        fit(nodes);
        for (const at of waiting) link(nodes, place(nodes[ at ], at));
        waiting.length = 0;
    }

    return {
        members,
        add(nodes, at) {
            if (!nodes[ at ].features || placed.has(at) || waiting.includes(at)) return;
            if (!mean) {
                waiting.push(at);
                if (waiting.length >= SAMPLE) drain(nodes);
                return;
            }
            link(nodes, place(nodes[ at ], at));
        },
        flush(nodes) {
            if (!mean && waiting.length) drain(nodes);
        },
        settle(nodes) {
            const gaps: number[] = [];
            for (const at of members) {
                for (const neighbour of nodes[ at ].neighbours) gaps.push(neighbour.gap);
            }
            if (!gaps.length) return;
            gaps.sort((a, b) => a - b);
            // the 80th percentile of every link in the graph is what "far apart" means here
            const reach = Math.sqrt(gaps[ Math.floor(gaps.length * 0.8) ]) || 1;
            for (const at of members) {
                for (const neighbour of nodes[ at ].neighbours) {
                    neighbour.strength = Math.max(0.02, 1 - Math.sqrt(neighbour.gap) / (reach * 1.6));
                }
            }
        },
    };
}
