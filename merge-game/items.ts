export interface ItemTier {
    name: string;
    texture: string;
    /** half the sprite size in board units */
    radius: number;
    coins: number;
}

/** collisions use a tighter radius than the sprite, so items look like they touch before they bump */
export const HITBOX_SCALE = 0.78;

/** The merge chain. Two items of the same tier fuse into the next one. */
export const itemTiers: ItemTier[] = [
    { name: "Coal", texture: "item/coal", radius: 4.6, coins: 5 },
    { name: "Redstone", texture: "item/redstone", radius: 7.8, coins: 10 },
    { name: "Copper Ingot", texture: "item/copper_ingot", radius: 11.6, coins: 20 },
    { name: "Iron Ingot", texture: "item/iron_ingot", radius: 12.8, coins: 40 },
    { name: "Lapis Lazuli", texture: "item/lapis_lazuli", radius: 13.9, coins: 80 },
    { name: "Gold Ingot", texture: "item/gold_ingot", radius: 14.9, coins: 160 },
    { name: "Quartz", texture: "item/quartz", radius: 15.8, coins: 320 },
    { name: "Emerald", texture: "item/emerald", radius: 16.6, coins: 640 },
    { name: "Diamond", texture: "item/diamond", radius: 17.4, coins: 1280 },
    { name: "Netherite Ingot", texture: "item/netherite_ingot", radius: 18.2, coins: 2560 },
    { name: "Nether Star", texture: "item/nether_star", radius: 19, coins: 5120 },
];

export const MAX_TIER = itemTiers.length - 1;

export const boardTextures = {
    frame: "block/dark_oak_planks",
    tray: "block/sand",
    coin: "item/gold_nugget",
};

/**
 * The floor around the tray: mostly one polished stone with a few accent blocks mixed in,
 * the way a builder would lay a calm modern patio.
 */
export const backgroundPalette = [
    "block/polished_andesite",
    "block/polished_andesite",
    "block/polished_andesite",
    "block/polished_andesite",
    "block/polished_andesite",
    "block/polished_andesite",
    "block/smooth_stone",
    "block/andesite",
];

/**
 * Vanilla only rotates and mirrors the model of a few natural blocks (sand, stone, dirt…).
 * Polished or patterned blocks always face the same way, so they must not be turned around.
 */
export const randomlyRotated = new Set([ "block/sand", "block/stone", "block/gravel", "block/dirt" ]);

export function allTextureNames() {
    return [ ...itemTiers.map(tier => tier.texture), ...Object.values(boardTextures), ...backgroundPalette ];
}
