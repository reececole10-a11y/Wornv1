// ---------------------------------------------------------------------------
// blocks.js - the block table. One entry per block id; the mesher, the physics
// and the UI all read from here so a new block only has to be added once.
// ---------------------------------------------------------------------------

export const AIR = 0;

const defs = [];

function def(id, name, opts = {}) {
  const tex = opts.tex || {};
  const all = tex.all || name;
  defs[id] = {
    id,
    name: opts.label || name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    // Per-face tiles, in the order the mesher emits faces:
    // +X, -X, +Y (top), -Y (bottom), +Z, -Z
    tiles: [
      tex.side || all, tex.side || all,
      tex.top || all, tex.bottom || tex.top || all,
      tex.side || all, tex.side || all,
    ],
    solid: opts.solid !== false,       // stops the player walking through it
    opaque: opts.opaque !== false,     // hides the neighbouring face behind it
    liquid: !!opts.liquid,
    render: opts.render || 'cube',     // 'cube' | 'cross'
    hardness: opts.hardness ?? 1,      // seconds of mining at bare-hand speed
    light: opts.light || 0,            // emissive strength, 0..1
    drop: opts.drop,                   // block id handed to the player, if any
    craftable: !!opts.craftable,
  };
  if (defs[id].drop === undefined) defs[id].drop = id;
  return id;
}

export const GRASS      = def(1,  'grass',        { tex: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, hardness: 0.6, drop: 2 });
export const DIRT       = def(2,  'dirt',         { hardness: 0.5 });
export const STONE      = def(3,  'stone',        { hardness: 1.5, drop: 4 });
export const COBBLE     = def(4,  'cobblestone',  { hardness: 1.7 });
export const SAND       = def(5,  'sand',         { hardness: 0.5 });
export const SANDSTONE  = def(6,  'sandstone',    { tex: { top: 'sandstone_top', side: 'sandstone', bottom: 'sandstone_top' }, hardness: 1.2 });
export const GRAVEL     = def(7,  'gravel',       { hardness: 0.6 });
export const LOG        = def(8,  'log',          { tex: { top: 'log_top', side: 'log_side', bottom: 'log_top' }, hardness: 1.0 });
export const LEAVES     = def(9,  'leaves',       { opaque: false, hardness: 0.3 });
export const PLANKS     = def(10, 'planks',       { hardness: 1.0, craftable: true });
export const WATER      = def(11, 'water',        { solid: false, opaque: false, liquid: true, hardness: 0, drop: 0 });
export const GLASS      = def(12, 'glass',        { opaque: false, hardness: 0.4, craftable: true });
export const COAL_ORE   = def(13, 'coal_ore',     { hardness: 2.0 });
export const IRON_ORE   = def(14, 'iron_ore',     { hardness: 2.5 });
export const GOLD_ORE   = def(15, 'gold_ore',     { hardness: 2.5 });
export const BRICK      = def(16, 'brick',        { hardness: 1.8, craftable: true });
export const STONE_BRICK= def(17, 'stone_brick',  { hardness: 1.7, craftable: true });
export const SNOW       = def(18, 'snow',         { tex: { top: 'snow', side: 'snow_side', bottom: 'dirt' }, hardness: 0.4, drop: 18 });
export const BEDROCK    = def(19, 'bedrock',      { hardness: Infinity, drop: 0 });
export const GLOWSTONE  = def(20, 'glowstone',    { hardness: 0.6, light: 1.0 });
export const LANTERN    = def(21, 'lantern',      { tex: { top: 'lantern_top', side: 'lantern', bottom: 'lantern_top' }, hardness: 0.4, light: 0.85, craftable: true });
export const CACTUS     = def(22, 'cactus',       { tex: { top: 'cactus_top', side: 'cactus_side', bottom: 'cactus_top' }, opaque: false, hardness: 0.5 });
export const TALL_GRASS = def(23, 'tall_grass',   { render: 'cross', solid: false, opaque: false, hardness: 0.05 });
export const FLOWER_RED = def(24, 'flower_red',   { render: 'cross', solid: false, opaque: false, hardness: 0.05 });
export const FLOWER_YEL = def(25, 'flower_yellow',{ render: 'cross', solid: false, opaque: false, hardness: 0.05 });
export const WOOL_WHITE = def(26, 'wool_white',   { hardness: 0.8 });
export const WOOL_RED   = def(27, 'wool_red',     { hardness: 0.8 });
export const WOOL_BLUE  = def(28, 'wool_blue',    { hardness: 0.8 });
export const WOOL_GREEN = def(29, 'wool_green',   { hardness: 0.8 });
export const WOOL_BLACK = def(30, 'wool_black',   { hardness: 0.8 });

export const BLOCKS = defs;
export const blockDef = (id) => defs[id];
export const isSolid = (id) => id !== AIR && defs[id] !== undefined && defs[id].solid;
export const isOpaque = (id) => id !== AIR && defs[id] !== undefined && defs[id].opaque;
export const isLiquid = (id) => id !== AIR && defs[id] !== undefined && defs[id].liquid;
export const isCross = (id) => id !== AIR && defs[id] !== undefined && defs[id].render === 'cross';

// Blocks the player can hold, in the order they appear in the inventory grid.
export const PLACEABLE = [
  GRASS, DIRT, STONE, COBBLE, SAND, SANDSTONE, GRAVEL, LOG, LEAVES, PLANKS,
  GLASS, BRICK, STONE_BRICK, SNOW, COAL_ORE, IRON_ORE, GOLD_ORE, GLOWSTONE,
  LANTERN, CACTUS, TALL_GRASS, FLOWER_RED, FLOWER_YEL,
  WOOL_WHITE, WOOL_RED, WOOL_BLUE, WOOL_GREEN, WOOL_BLACK, WATER,
];

// Bench recipes. `needs` is a list of [blockId, count]; you get `count` of `out`.
export const RECIPES = [
  { out: PLANKS,       count: 4, needs: [[LOG, 1]] },
  { out: STONE_BRICK,  count: 4, needs: [[COBBLE, 4]] },
  { out: GLASS,        count: 2, needs: [[SAND, 2]] },
  { out: BRICK,        count: 2, needs: [[DIRT, 4]] },
  { out: LANTERN,      count: 2, needs: [[GLASS, 1], [COAL_ORE, 1]] },
  { out: GLOWSTONE,    count: 1, needs: [[GOLD_ORE, 1], [COAL_ORE, 2]] },
  { out: WOOL_WHITE,   count: 2, needs: [[TALL_GRASS, 4]] },
];
