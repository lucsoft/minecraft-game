
const CHUNK_SIZE = 16;
const WORLD_HEIGHT = 80;
const SEA_LEVEL = 60;

function hash(seed: number, x: number, z: number): number {
    let h = seed ^ (x * 1664525 + z * 1013904223);
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
    return t * t * (3 - 2 * t);
}

function valueNoise(seed: number, x: number, z: number): number {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    const xf = x - xi;
    const zf = z - zi;

    const a = hash(seed, xi, zi);
    const b = hash(seed, xi + 1, zi);
    const c = hash(seed, xi, zi + 1);
    const d = hash(seed, xi + 1, zi + 1);

    const sx = smoothstep(xf);
    const sz = smoothstep(zf);

    return a + sx * (b - a) + sz * (c - a) + sx * sz * (a - b - c + d);
}

function terrainHeight(seed: number, x: number, z: number): number {
    const n1 = valueNoise(seed, x * 0.04, z * 0.04);
    const n2 = valueNoise(seed + 1, x * 0.08, z * 0.08) * 0.5;
    const raw = (n1 + n2) / 1.5;
    return Math.floor(raw * 24 + (SEA_LEVEL - 4));
}

const blockIndex = {
    "block/air": 0,
    "block/bedrock": 1,
    "block/stone": 2,
    "block/dirt": 3,
    "block/grass_block": 4,
};

export interface Chunk {
    blockPalette: string[];
    layers: number[][];
}

export function generateChunk(chunkX: number, chunkZ: number, seed: number): Chunk {
    const layers: number[][] = Array.from(
        { length: WORLD_HEIGHT },
        () => Array(CHUNK_SIZE * CHUNK_SIZE).fill(blockIndex[ "block/air" ])
    );

    for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
            const worldX = chunkX * CHUNK_SIZE + x;
            const worldZ = chunkZ * CHUNK_SIZE + z;
            const height = terrainHeight(seed, worldX, worldZ);
            const index = x + z * CHUNK_SIZE;

            layers[ 0 ][ index ] = blockIndex[ "block/bedrock" ];

            for (let y = 1; y < height - 3; y++)
                layers[ y ][ index ] = blockIndex[ "block/stone" ];

            for (let y = Math.max(1, height - 3); y < height; y++)
                layers[ y ][ index ] = blockIndex[ "block/dirt" ];

            if (height < WORLD_HEIGHT)
                layers[ height ][ index ] = blockIndex[ "block/grass_block" ];
        }
    }

    return {
        blockPalette: Object.keys(blockIndex),
        layers
    };
}

export function generateWorld(seed: number, radius: number, skipRadius: number) {
    const chunks: { x: number, z: number, chunk: Chunk; }[] = [];
    for (let z = -radius; z <= radius; z++) {
        for (let x = -radius; x <= radius; x++) {
            // continue if within skip radius
            if (Math.abs(x) <= skipRadius && Math.abs(z) <= skipRadius) continue;
            chunks.push({ x, z, chunk: generateChunk(x, z, seed) });
        }
    }
    return chunks;
}