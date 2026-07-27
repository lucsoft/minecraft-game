import { soundFileUrl } from "../asset-pipeline-url.ts";

/** decoded buffers are cheap to keep but 4000 of them are not, so the oldest are dropped */
const KEEP = 200;

export interface Player {
    play(name: string): Promise<void>;
    /** plays a sound and then walks its neighbours, which is the fastest way to hear a cluster */
    playSequence(names: string[]): Promise<void>;
    stop(): void;
    readonly playing: string | undefined;
}

export function createPlayer(onChange: () => void): Player {
    let context: AudioContext | undefined;
    let source: AudioBufferSourceNode | undefined;
    let element: HTMLAudioElement | undefined;
    let playing: string | undefined;
    let run = 0;
    const buffers = new Map<string, AudioBuffer>();
    const loading = new Map<string, Promise<AudioBuffer | undefined>>();

    function load(name: string) {
        const cached = buffers.get(name);
        if (cached) return Promise.resolve(cached);
        const running = loading.get(name);
        if (running) return running;
        const request = (async () => {
            try {
                const response = await fetch(soundFileUrl(name));
                if (!response.ok) throw new Error(response.statusText);
                const buffer = await context!.decodeAudioData(await response.arrayBuffer());
                if (buffers.size >= KEEP) buffers.delete(buffers.keys().next().value!);
                buffers.set(name, buffer);
                return buffer;
            } catch (error) {
                console.warn(`[sound] ${name} could not be decoded:`, error);
                return undefined;
            } finally {
                loading.delete(name);
            }
        })();
        loading.set(name, request);
        return request;
    }

    function halt() {
        source?.stop();
        source = undefined;
        element?.pause();
        element = undefined;
        if (playing) {
            playing = undefined;
            onChange();
        }
    }

    async function playOne(name: string, token: number) {
        context ??= new AudioContext();
        if (context.state === "suspended") await context.resume();
        const buffer = await load(name);
        if (token !== run) return;
        if (!buffer) {
            // not every browser decodes ogg through the Web Audio API, the tag usually still can
            halt();
            element = new Audio(soundFileUrl(name));
            playing = name;
            onChange();
            element.addEventListener("ended", () => {
                if (token === run) halt();
            });
            await element.play().catch(() => halt());
            return;
        }
        halt();
        if (token !== run) return;
        source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.addEventListener("ended", () => {
            if (token === run) halt();
        });
        playing = name;
        onChange();
        source.start();
        await new Promise<void>(resolve => setTimeout(resolve, buffer.duration * 1000));
    }

    return {
        get playing() {
            return playing;
        },
        async play(name) {
            const token = ++run;
            await playOne(name, token);
        },
        async playSequence(names) {
            const token = ++run;
            for (const name of names) {
                if (token !== run) return;
                await playOne(name, token);
                if (token !== run) return;
                await new Promise<void>(resolve => setTimeout(resolve, 120));
            }
            if (token === run) halt();
        },
        stop() {
            run++;
            halt();
        },
    };
}
