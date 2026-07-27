/**
 * Describes a sound by what it actually sounds like, not by what it is called. The numbers
 * here are the usual music information retrieval descriptors: MFCCs carry the timbre, the
 * spectral moments say bright or dull, and the envelope says click or drone. Two sounds with
 * close vectors really do sound alike, which is what the graph on /sound is built from.
 */
export interface SoundFeatures {
    /** full length of the file in seconds */
    duration: number;
    /** length with leading and trailing silence removed */
    active: number;
    /** overall level in dBFS */
    loudness: number;
    /** spectral centroid in Hz, the "brightness" of the sound */
    centroid: number;
    /** spectral spread in Hz, narrow for tones and wide for noise */
    spread: number;
    /** frequency below which 85% of the energy sits */
    rolloff: number;
    /** spectral flatness in dB, very negative for a pure tone and near 0 for white noise */
    flatness: number;
    /** zero crossings per second */
    zcr: number;
    /** seconds from the onset to the loudest moment */
    attack: number;
    /** where the energy sits in time, 0 front loaded, 1 back loaded */
    temporal: number;
    /** dominant frequency in Hz, 0 when nothing periodic was found */
    pitch: number;
    /** how convincing that pitch is, 0..1 */
    tonality: number;
    /** mean of the first 12 MFCCs above c0 */
    mfcc: number[];
    /** how much each MFCC moves over the sound, so a steady tone differs from a sweep */
    mfccVar: number[];
}

const FFT_SIZE = 1024;
const HOP = 512;
const FINE_WINDOW = 256;
const FINE_HOP = 64;
const MEL_BANDS = 40;
const MFCC_COUNT = 12;
/** analysing more than this buys nothing and the music tracks are minutes long */
const MAX_SECONDS = 10;
const SILENCE = 10 ** (-55 / 20);

const hann = Float32Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFT_SIZE));
const cosTable = new Float32Array(FFT_SIZE / 2);
const sinTable = new Float32Array(FFT_SIZE / 2);
for (let i = 0; i < FFT_SIZE / 2; i++) {
    cosTable[ i ] = Math.cos(-2 * Math.PI * i / FFT_SIZE);
    sinTable[ i ] = Math.sin(-2 * Math.PI * i / FFT_SIZE);
}

/** in place radix-2 FFT over a fixed FFT_SIZE, table driven so the twiddles do not drift */
function fft(re: Float32Array, im: Float32Array) {
    const n = FFT_SIZE;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [ re[ i ], re[ j ] ] = [ re[ j ], re[ i ] ];
            [ im[ i ], im[ j ] ] = [ im[ j ], im[ i ] ];
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const half = len >> 1;
        const step = n / len;
        for (let start = 0; start < n; start += len) {
            for (let k = 0; k < half; k++) {
                const wRe = cosTable[ k * step ];
                const wIm = sinTable[ k * step ];
                const a = start + k;
                const b = a + half;
                const vRe = re[ b ] * wRe - im[ b ] * wIm;
                const vIm = re[ b ] * wIm + im[ b ] * wRe;
                re[ b ] = re[ a ] - vRe;
                im[ b ] = im[ a ] - vIm;
                re[ a ] += vRe;
                im[ a ] += vIm;
            }
        }
    }
}

const toMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const fromMel = (mel: number) => 700 * (10 ** (mel / 2595) - 1);

/** triangular mel filters as [ startBin, weights ] so a frame only touches the bins it needs */
function melFilters(sampleRate: number) {
    const bins = FFT_SIZE / 2;
    const low = toMel(30);
    const high = toMel(Math.min(sampleRate / 2, 16000));
    const points = Array.from({ length: MEL_BANDS + 2 }, (_, i) => {
        const hz = fromMel(low + (high - low) * i / (MEL_BANDS + 1));
        return Math.round(hz / (sampleRate / FFT_SIZE));
    });
    return Array.from({ length: MEL_BANDS }, (_, band) => {
        const [ start, peak, end ] = [ points[ band ], points[ band + 1 ], points[ band + 2 ] ];
        const weights = new Float32Array(Math.max(1, Math.min(end, bins - 1) - start + 1));
        for (let i = 0; i < weights.length; i++) {
            const bin = start + i;
            weights[ i ] = bin <= peak
                ? (peak === start ? 1 : (bin - start) / (peak - start))
                : (end === peak ? 0 : (end - bin) / (end - peak));
        }
        return { start, weights };
    });
}

const filterCache = new Map<number, ReturnType<typeof melFilters>>();
const dct = Array.from({ length: MFCC_COUNT + 1 }, (_, k) =>
    Float32Array.from({ length: MEL_BANDS }, (_, n) => Math.cos(Math.PI * k * (n + 0.5) / MEL_BANDS)));

/** mixes to mono, most Minecraft sounds are mono already but the music is not */
export function toMono(channels: Float32Array[]) {
    if (channels.length === 1) return channels[ 0 ];
    const mono = new Float32Array(channels[ 0 ].length);
    for (const channel of channels) {
        for (let i = 0; i < mono.length; i++) mono[ i ] += channel[ i ] / channels.length;
    }
    return mono;
}

/** cuts the padding a lot of the sound files carry, it would drag every descriptor toward silence */
function trim(samples: Float32Array) {
    let start = 0;
    let end = samples.length;
    while (start < end && Math.abs(samples[ start ]) < SILENCE) start++;
    while (end > start && Math.abs(samples[ end - 1 ]) < SILENCE) end--;
    return samples.subarray(start, end);
}

function estimatePitch(samples: Float32Array, sampleRate: number, at: number) {
    const size = Math.min(2048, samples.length);
    const from = Math.max(0, Math.min(at, samples.length - size));
    const window = Float32Array.prototype.slice.call(samples, from, from + size);
    let mean = 0;
    for (let i = 0; i < size; i++) mean += window[ i ];
    mean /= size;
    for (let i = 0; i < size; i++) window[ i ] -= mean;

    const minLag = Math.max(2, Math.floor(sampleRate / 2000));
    const maxLag = Math.min(size - 1, Math.floor(sampleRate / 50));
    if (maxLag <= minLag) return { pitch: 0, tonality: 0 };

    // energy of the tail that each lag correlates against, so the score is a real correlation
    const tail = new Float64Array(size + 1);
    for (let i = size - 1; i >= 0; i--) tail[ i ] = tail[ i + 1 ] + window[ i ] * window[ i ];
    if (tail[ 0 ] <= 0) return { pitch: 0, tonality: 0 };

    let bestLag = 0;
    let best = 0;
    let descending = true;
    for (let lag = 1; lag <= maxLag; lag++) {
        let sum = 0;
        for (let i = 0; i + lag < size; i++) sum += window[ i ] * window[ i + lag ];
        const score = sum / Math.sqrt((tail[ 0 ] - tail[ size - lag ]) * (tail[ lag ] - tail[ size ]) + 1e-12);
        // the autocorrelation always peaks at lag 0, so wait for it to fall away before believing a peak
        if (descending) {
            if (score < 0) descending = false;
            continue;
        }
        if (lag >= minLag && score > best) {
            best = score;
            bestLag = lag;
        }
    }
    const tonality = Math.max(0, Math.min(1, best));
    // below this the "period" is just noise lining up by accident
    return tonality < 0.35 || !bestLag ? { pitch: 0, tonality } : { pitch: sampleRate / bestLag, tonality };
}

export function analyseSound(input: Float32Array, sampleRate: number): SoundFeatures {
    const duration = input.length / sampleRate;
    const trimmed = trim(input);
    const samples = trimmed.subarray(0, Math.min(trimmed.length, Math.floor(MAX_SECONDS * sampleRate)));
    const active = trimmed.length / sampleRate;

    const empty = {
        duration, active, loudness: -120, centroid: 0, spread: 0, rolloff: 0, flatness: 0,
        zcr: 0, attack: 0, temporal: 0, pitch: 0, tonality: 0,
        mfcc: new Array(MFCC_COUNT).fill(0), mfccVar: new Array(MFCC_COUNT).fill(0),
    };
    if (samples.length < FFT_SIZE) return empty;

    if (!filterCache.has(sampleRate)) filterCache.set(sampleRate, melFilters(sampleRate));
    const filters = filterCache.get(sampleRate)!;

    const re = new Float32Array(FFT_SIZE);
    const im = new Float32Array(FFT_SIZE);
    const power = new Float32Array(FFT_SIZE / 2);
    const binHz = sampleRate / FFT_SIZE;

    const frames = Math.floor((samples.length - FFT_SIZE) / HOP) + 1;
    const sums = { weight: 0, centroid: 0, spread: 0, rolloff: 0, flatness: 0 };
    const mfccSum = new Float64Array(MFCC_COUNT);
    const mfccSquare = new Float64Array(MFCC_COUNT);
    const mel = new Float32Array(MEL_BANDS);
    let mfccWeight = 0;

    for (let frame = 0; frame < frames; frame++) {
        const offset = frame * HOP;
        let rms = 0;
        for (let i = 0; i < FFT_SIZE; i++) {
            const sample = samples[ offset + i ];
            rms += sample * sample;
            re[ i ] = sample * hann[ i ];
            im[ i ] = 0;
        }
        // loud frames should dominate the averages, a tail of room tone must not blur the timbre
        const weight = Math.sqrt(rms / FFT_SIZE);
        fft(re, im);

        let total = 0;
        for (let bin = 0; bin < power.length; bin++) {
            power[ bin ] = re[ bin ] * re[ bin ] + im[ bin ] * im[ bin ];
            total += power[ bin ];
        }
        // frames this quiet are room tone, letting them vote would blur every cluster together
        if (total < 1e-9) continue;

        let centroid = 0;
        for (let bin = 0; bin < power.length; bin++) centroid += bin * binHz * power[ bin ];
        centroid /= total;

        let spread = 0;
        let running = 0;
        let rolloff = 0;
        for (let bin = 0; bin < power.length; bin++) {
            const hz = bin * binHz;
            spread += (hz - centroid) ** 2 * power[ bin ];
            running += power[ bin ];
            if (!rolloff && running >= total * 0.85) rolloff = hz;
        }
        spread = Math.sqrt(spread / total);

        // in dB and with a floor relative to the frame, otherwise the geometric mean of 512 bins
        // underflows and every sound reports the same "perfectly tonal" zero
        const average = total / power.length;
        const floor = average * 1e-8;
        let logSum = 0;
        for (let bin = 1; bin < power.length; bin++) logSum += Math.log10(power[ bin ] + floor);
        const flatness = 10 * (logSum / (power.length - 1) - Math.log10(average));

        sums.weight += weight;
        sums.centroid += centroid * weight;
        sums.spread += spread * weight;
        sums.rolloff += rolloff * weight;
        sums.flatness += Math.max(-90, flatness) * weight;

        let loudest = 0;
        for (let band = 0; band < MEL_BANDS; band++) {
            const { start, weights } = filters[ band ];
            let energy = 0;
            for (let i = 0; i < weights.length; i++) energy += (power[ start + i ] ?? 0) * weights[ i ];
            mel[ band ] = energy;
            if (energy > loudest) loudest = energy;
        }
        // hold the bands to 80dB under the loudest one, an absolute floor would let a pure tone
        // bottom out 39 of its 40 bands and throw MFCCs an order of magnitude past every other sound
        const quietest = loudest * 1e-8 + 1e-20;
        for (let band = 0; band < MEL_BANDS; band++) mel[ band ] = Math.log(Math.max(mel[ band ], quietest));
        for (let k = 0; k < MFCC_COUNT; k++) {
            let value = 0;
            const basis = dct[ k + 1 ];
            for (let band = 0; band < MEL_BANDS; band++) value += mel[ band ] * basis[ band ];
            mfccSum[ k ] += value * weight;
            mfccSquare[ k ] += value * value * weight;
        }
        mfccWeight += weight;
    }

    if (sums.weight <= 0 || mfccWeight <= 0) return empty;

    // the STFT hop is 12ms, far too coarse to tell a click from a swell, so the envelope that
    // decides attack and where the energy sits in time is measured much finer
    const fine = new Float32Array(Math.max(1, Math.floor((samples.length - FINE_WINDOW) / FINE_HOP) + 1));
    for (let step = 0; step < fine.length; step++) {
        let sum = 0;
        for (let i = 0; i < FINE_WINDOW; i++) {
            const sample = samples[ step * FINE_HOP + i ];
            sum += sample * sample;
        }
        fine[ step ] = Math.sqrt(sum / FINE_WINDOW);
    }

    let peak = 0;
    let peakStep = 0;
    let energySum = 0;
    let timeSum = 0;
    for (let step = 0; step < fine.length; step++) {
        if (fine[ step ] > peak) {
            peak = fine[ step ];
            peakStep = step;
        }
        energySum += fine[ step ];
        timeSum += fine[ step ] * step;
    }
    let onset = peakStep;
    while (onset > 0 && fine[ onset - 1 ] > peak * 0.1) onset--;

    let crossings = 0;
    for (let i = 1; i < samples.length; i++) {
        if ((samples[ i - 1 ] < 0) !== (samples[ i ] < 0)) crossings++;
    }

    let square = 0;
    for (let i = 0; i < samples.length; i++) square += samples[ i ] * samples[ i ];
    const { pitch, tonality } = estimatePitch(samples, sampleRate, peakStep * FINE_HOP);

    const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;
    return {
        duration: round(duration),
        active: round(active),
        loudness: round(20 * Math.log10(Math.sqrt(square / samples.length) + 1e-9), 2),
        centroid: round(sums.centroid / sums.weight, 1),
        spread: round(sums.spread / sums.weight, 1),
        rolloff: round(sums.rolloff / sums.weight, 1),
        flatness: round(sums.flatness / sums.weight, 4),
        zcr: round(crossings / (samples.length / sampleRate), 1),
        attack: round((peakStep - onset) * FINE_HOP / sampleRate, 4),
        temporal: round(fine.length > 1 && energySum > 0 ? timeSum / energySum / (fine.length - 1) : 0, 4),
        pitch: round(pitch, 1),
        tonality: round(tonality, 4),
        mfcc: Array.from(mfccSum, (value) => round(value / mfccWeight, 3)),
        mfccVar: Array.from(mfccSquare, (value, k) =>
            round(Math.sqrt(Math.max(0, value / mfccWeight - (mfccSum[ k ] / mfccWeight) ** 2)), 3)),
    };
}
