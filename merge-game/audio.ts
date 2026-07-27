import { soundFileUrl } from "../asset-pipeline-url.ts";

/**
 * Minecraft's own sounds, pulled through the asset pipeline. Everything is kept quiet and
 * short so a long session stays pleasant: a fishing-rod style whoosh for a shot, an
 * experience orb that climbs with the tier for a merge, and the level up jingle for an order.
 */
const MASTER = 0.5;

const THROW = "entity/bobber/castfast";
const MERGE = "random/orb";
const DELIVER = "random/levelup";
const ROUND = "ui/toast/challenge_complete";

let context: AudioContext | undefined;
const buffers = new Map<string, AudioBuffer>();

async function load(name: string) {
    if (!context || buffers.has(name)) return;
    try {
        const response = await fetch(soundFileUrl(name));
        if (!response.ok) throw new Error(response.statusText);
        buffers.set(name, await context.decodeAudioData(await response.arrayBuffer()));
    } catch (error) {
        console.warn(`[audio] ${name} unavailable:`, error);
    }
}

/** browsers only allow audio after a gesture, so this runs on the first pointer down */
export function unlockAudio() {
    if (context) {
        if (context.state === "suspended") context.resume();
        return;
    }
    context = new AudioContext();
    for (const name of [ THROW, MERGE, DELIVER, ROUND ]) load(name);
}

function play(name: string, gain: number, rate = 1) {
    const buffer = buffers.get(name);
    if (!context || !buffer) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const volume = context.createGain();
    volume.gain.value = MASTER * gain;
    source.connect(volume).connect(context.destination);
    source.start();
}

export function playShoot() {
    // slight pitch drift so repeated shots do not grate
    play(THROW, 0.7, 0.92 + Math.random() * 0.16);
}

export function playMerge(tier: number) {
    play(MERGE, 0.55, 0.8 + Math.min(tier, 10) * 0.06);
}

export function playDeliver() {
    play(DELIVER, 0.5);
}

export function playRound() {
    play(ROUND, 0.55);
}
