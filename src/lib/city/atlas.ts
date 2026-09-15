/**
 * The block textures, painted at runtime on one 128 × 128 canvas: an 8 × 8
 * atlas of 16 × 16 tiles, sampled with nearest filtering so every texel
 * stays a crisp square. No image files anywhere in the project.
 */
export const TILE_PX = 16;
export const ATLAS_TILES = 8;
export const ATLAS_PX = TILE_PX * ATLAS_TILES;

export const T = {
  GRASS_TOP: 0,
  GRASS_SIDE: 1,
  DIRT: 2,
  STONE: 3,
  COBBLE: 4,
  PLANKS: 5,
  PLANKS_DARK: 6,
  BRICKS_RED: 7,
  BRICKS_CREAM: 8,
  CONCRETE_LIGHT: 9,
  CONCRETE_DARK: 10,
  WINDOW: 11,
  WINDOW_LIT: 12,
  ROOF_RED: 13,
  ROOF_SLATE: 14,
  DOOR: 15,
  AWNING_RED: 16,
  AWNING_BLUE: 17,
  GOLD: 18,
  SIGN: 19,
  LOG: 20,
  LEAVES: 21,
  WATER: 22,
  ASPHALT: 23,
  STRIPE_NS: 24,
  STRIPE_EW: 25,
  SIDEWALK: 26,
  GLASS_DARK: 27,
  GLASS_DARK_LIT: 28,
  LAMP: 29,
  GRAVEL: 30,
  STALL_RED: 31,
  STALL_GREEN: 32,
  CONCRETE_BEIGE: 33,
  SAND: 34,
  FOUNTAIN: 35,
  BEACON: 36,
  MARBLE: 37,
  ANTENNA: 38,
  LOT: 39,
  PLAZA: 40,
  BANNER: 41,
  WINDOW_WIDE: 42,
  GLASS_GREEN: 43,
  GLASS_GREEN_LIT: 44,
  ROOF_GOLD: 45,
  DOOR_GLASS: 46,
  CHECKER: 47,
  CLOUD: 48,
} as const;

export type Tile = (typeof T)[keyof typeof T];

/** Deterministic noise — the atlas must look the same on every load. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;

function hex(h: string): [number, number, number] {
  const n = Number.parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function css(rgb: [number, number, number], k = 1): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c(rgb[0])},${c(rgb[1])},${c(rgb[2])})`;
}

/** A tile of `base` with per-pixel luminance noise of ±amp. */
function noise(ctx: Ctx, ox: number, oy: number, base: string, amp: number, seed: number, every = 1) {
  const r = rng(seed);
  const rgb = hex(base);
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const k = (x + y) % every === 0 ? 1 + (r() * 2 - 1) * amp : 1;
      ctx.fillStyle = css(rgb, k);
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  }
}

function px(ctx: Ctx, ox: number, oy: number, x: number, y: number, color: string, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(ox + x, oy + y, w, h);
}

function bricks(ctx: Ctx, ox: number, oy: number, brick: string, mortar: string, seed: number) {
  noise(ctx, ox, oy, brick, 0.08, seed);
  ctx.fillStyle = mortar;
  for (let row = 0; row < 4; row++) {
    const y = row * 4 + 3;
    ctx.fillRect(ox, oy + y, TILE_PX, 1);
    const off = row % 2 === 0 ? 0 : 4;
    for (let c = 0; c < 3; c++) ctx.fillRect(ox + ((off + c * 8 + 7) % 16), oy + row * 4, 1, 3);
  }
}

function planks(ctx: Ctx, ox: number, oy: number, wood: string, line: string, seed: number) {
  noise(ctx, ox, oy, wood, 0.06, seed, 1);
  ctx.fillStyle = line;
  for (let b = 0; b < 4; b++) {
    ctx.fillRect(ox, oy + b * 4 + 3, TILE_PX, 1);
    ctx.fillRect(ox + ((b * 5 + 2) % 16), oy + b * 4, 1, 3);
  }
}

function windowTile(ctx: Ctx, ox: number, oy: number, frame: string, glass: string, light: string, dark: string) {
  px(ctx, ox, oy, 0, 0, frame, 16, 16);
  px(ctx, ox, oy, 2, 2, glass, 12, 12);
  // a diagonal reflection and a cross bar
  for (let i = 0; i < 12; i++) if (i < 7) px(ctx, ox, oy, 2 + i + 3, 2 + 6 - i, light);
  for (let i = 0; i < 12; i++) if (i < 5) px(ctx, ox, oy, 2 + i, 2 + 4 - i, light);
  px(ctx, ox, oy, 7, 2, frame, 2, 12);
  px(ctx, ox, oy, 2, 7, frame, 12, 2);
  px(ctx, ox, oy, 2, 12, dark, 12, 2);
}

function roof(ctx: Ctx, ox: number, oy: number, base: string, dark: string, seed: number) {
  noise(ctx, ox, oy, base, 0.07, seed);
  ctx.fillStyle = dark;
  for (let row = 0; row < 4; row++) {
    ctx.fillRect(ox, oy + row * 4 + 3, TILE_PX, 1);
    const off = row % 2 === 0 ? 2 : 6;
    for (let c = 0; c < 2; c++) ctx.fillRect(ox + ((off + c * 8) % 16), oy + row * 4, 1, 3);
  }
}

function stripes(ctx: Ctx, ox: number, oy: number, a: string, b: string, vertical: boolean) {
  for (let i = 0; i < 4; i++) {
    const c = i % 2 === 0 ? a : b;
    if (vertical) px(ctx, ox, oy, i * 4, 0, c, 4, 16);
    else px(ctx, ox, oy, 0, i * 4, c, 16, 4);
  }
}

function glassTile(ctx: Ctx, ox: number, oy: number, frame: string, glass: string, light: string) {
  px(ctx, ox, oy, 0, 0, frame, 16, 16);
  px(ctx, ox, oy, 1, 1, glass, 14, 14);
  for (let i = 0; i < 14; i++) if (i < 9) px(ctx, ox, oy, 1 + i + 4, 1 + 8 - i, light);
  for (let i = 0; i < 14; i++) if (i < 4) px(ctx, ox, oy, 1 + i, 1 + 3 - i, light);
  px(ctx, ox, oy, 0, 8, frame, 16, 1);
  px(ctx, ox, oy, 8, 0, frame, 1, 16);
}

export function paintAtlas(canvas: HTMLCanvasElement): void {
  canvas.width = ATLAS_PX;
  canvas.height = ATLAS_PX;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const at = (id: number): [number, number] => [(id % ATLAS_TILES) * TILE_PX, Math.floor(id / ATLAS_TILES) * TILE_PX];
  const paint = (id: number, fn: (ox: number, oy: number) => void) => {
    const [ox, oy] = at(id);
    fn(ox, oy);
  };

  paint(T.GRASS_TOP, (ox, oy) => {
    noise(ctx, ox, oy, "#6DB33F", 0.09, 11);
    const r = rng(12);
    for (let i = 0; i < 14; i++) px(ctx, ox, oy, Math.floor(r() * 16), Math.floor(r() * 16), "#5C9E33");
    for (let i = 0; i < 6; i++) px(ctx, ox, oy, Math.floor(r() * 16), Math.floor(r() * 16), "#86C85A");
  });
  paint(T.GRASS_SIDE, (ox, oy) => {
    noise(ctx, ox, oy, "#8B5A2B", 0.1, 13);
    const r = rng(14);
    for (let x = 0; x < 16; x++) {
      const h = 3 + Math.floor(r() * 2);
      px(ctx, ox, oy, x, 0, "#6DB33F", 1, h);
      if (r() < 0.5) px(ctx, ox, oy, x, h, "#5C9E33");
    }
  });
  paint(T.DIRT, (ox, oy) => {
    noise(ctx, ox, oy, "#8B5A2B", 0.12, 15);
    const r = rng(16);
    for (let i = 0; i < 10; i++) px(ctx, ox, oy, Math.floor(r() * 16), Math.floor(r() * 16), "#6F4520");
  });
  paint(T.STONE, (ox, oy) => {
    noise(ctx, ox, oy, "#8E8E8E", 0.08, 17);
    const r = rng(18);
    for (let i = 0; i < 5; i++) px(ctx, ox, oy, Math.floor(r() * 14), Math.floor(r() * 14), "#6F6F6F", 2, 1);
  });
  paint(T.COBBLE, (ox, oy) => {
    noise(ctx, ox, oy, "#8A8A86", 0.1, 19);
    ctx.fillStyle = "#5E5E5A";
    const r = rng(20);
    for (let y = 0; y < 16; y += 4) {
      ctx.fillRect(ox, oy + y + 3, 16, 1);
      const off = (y / 4) % 2 === 0 ? 1 : 3;
      for (let x = off; x < 16; x += 5) ctx.fillRect(ox + x, oy + y, 1, 3);
    }
    for (let i = 0; i < 8; i++) px(ctx, ox, oy, Math.floor(r() * 16), Math.floor(r() * 16), "#A3A39E");
  });
  paint(T.PLANKS, (ox, oy) => planks(ctx, ox, oy, "#B8935A", "#7E5C33", 21));
  paint(T.PLANKS_DARK, (ox, oy) => planks(ctx, ox, oy, "#7A5330", "#4E331B", 22));
  paint(T.BRICKS_RED, (ox, oy) => bricks(ctx, ox, oy, "#A24B3A", "#D2C1AE", 23));
  paint(T.BRICKS_CREAM, (ox, oy) => bricks(ctx, ox, oy, "#DACBB0", "#B3A387", 24));
  paint(T.CONCRETE_LIGHT, (ox, oy) => noise(ctx, ox, oy, "#D2D2D0", 0.035, 25));
  paint(T.CONCRETE_DARK, (ox, oy) => noise(ctx, ox, oy, "#6E7075", 0.05, 26));
  paint(T.WINDOW, (ox, oy) => windowTile(ctx, ox, oy, "#4A4A4A", "#8CC5FF", "#D6ECFF", "#5E93C9"));
  paint(T.WINDOW_LIT, (ox, oy) => windowTile(ctx, ox, oy, "#4A4A4A", "#FFD466", "#FFF1B8", "#E0A93A"));
  paint(T.ROOF_RED, (ox, oy) => roof(ctx, ox, oy, "#B33A2E", "#7C2419", 27));
  paint(T.ROOF_SLATE, (ox, oy) => roof(ctx, ox, oy, "#4F5B67", "#33404B", 28));
  paint(T.DOOR, (ox, oy) => {
    planks(ctx, ox, oy, "#5C3A1E", "#3E2612", 29);
    px(ctx, ox, oy, 3, 2, "#6E4826", 10, 5);
    px(ctx, ox, oy, 3, 9, "#6E4826", 10, 5);
    px(ctx, ox, oy, 11, 8, "#E8C34A", 2, 2);
  });
  paint(T.AWNING_RED, (ox, oy) => stripes(ctx, ox, oy, "#D9463A", "#F4F1EA", true));
  paint(T.AWNING_BLUE, (ox, oy) => stripes(ctx, ox, oy, "#3B6BD6", "#F4F1EA", true));
  paint(T.GOLD, (ox, oy) => {
    noise(ctx, ox, oy, "#F2C230", 0.06, 30);
    for (let i = 0; i < 16; i++) {
      px(ctx, ox, oy, i, (i + 3) % 16, "#FFE27A");
      px(ctx, ox, oy, i, (i + 4) % 16, "#FFE27A");
      px(ctx, ox, oy, i, (i + 11) % 16, "#C9961C");
    }
    px(ctx, ox, oy, 0, 0, "#C9961C", 16, 1);
    px(ctx, ox, oy, 0, 0, "#C9961C", 1, 16);
  });
  paint(T.SIGN, (ox, oy) => {
    planks(ctx, ox, oy, "#C9A263", "#8C6A38", 31);
    px(ctx, ox, oy, 0, 0, "#6B4A26", 16, 1);
    px(ctx, ox, oy, 0, 15, "#6B4A26", 16, 1);
    px(ctx, ox, oy, 0, 0, "#6B4A26", 1, 16);
    px(ctx, ox, oy, 15, 0, "#6B4A26", 1, 16);
  });
  paint(T.LOG, (ox, oy) => {
    noise(ctx, ox, oy, "#6B4A2B", 0.08, 32);
    ctx.fillStyle = "#4E3520";
    for (const x of [2, 6, 11, 14]) ctx.fillRect(ox + x, oy, 1, 16);
  });
  paint(T.LEAVES, (ox, oy) => {
    noise(ctx, ox, oy, "#3F8F2F", 0.16, 33);
    const r = rng(34);
    for (let i = 0; i < 10; i++) px(ctx, ox, oy, Math.floor(r() * 16), Math.floor(r() * 16), "#5DB447");
    for (let i = 0; i < 8; i++) px(ctx, ox, oy, Math.floor(r() * 16), Math.floor(r() * 16), "#2B6B21");
  });
  paint(T.WATER, (ox, oy) => {
    noise(ctx, ox, oy, "#3F76E4", 0.05, 35);
    ctx.fillStyle = "#79A9F5";
    for (let y = 1; y < 16; y += 5) for (let x = (y / 5) % 2 === 0 ? 1 : 5; x < 16; x += 8) ctx.fillRect(ox + x, oy + y, 3, 1);
  });
  paint(T.ASPHALT, (ox, oy) => noise(ctx, ox, oy, "#4E4F55", 0.07, 36));
  paint(T.STRIPE_NS, (ox, oy) => {
    noise(ctx, ox, oy, "#4E4F55", 0.07, 37);
    px(ctx, ox, oy, 7, 0, "#E9D34A", 2, 16);
  });
  paint(T.STRIPE_EW, (ox, oy) => {
    noise(ctx, ox, oy, "#4E4F55", 0.07, 38);
    px(ctx, ox, oy, 0, 7, "#E9D34A", 16, 2);
  });
  paint(T.SIDEWALK, (ox, oy) => {
    noise(ctx, ox, oy, "#BDB8AA", 0.05, 39);
    px(ctx, ox, oy, 0, 7, "#9C978A", 16, 1);
    px(ctx, ox, oy, 7, 0, "#9C978A", 1, 16);
    px(ctx, ox, oy, 0, 15, "#9C978A", 16, 1);
    px(ctx, ox, oy, 15, 0, "#9C978A", 1, 16);
  });
  paint(T.GLASS_DARK, (ox, oy) => glassTile(ctx, ox, oy, "#22304A", "#2F4E7E", "#5A83C4"));
  paint(T.GLASS_DARK_LIT, (ox, oy) => glassTile(ctx, ox, oy, "#22304A", "#F5CF5E", "#FFF0B0"));
  paint(T.LAMP, (ox, oy) => {
    px(ctx, ox, oy, 0, 0, "#FFD54A", 16, 16);
    px(ctx, ox, oy, 2, 2, "#FFF6C8", 12, 12);
  });
  paint(T.GRAVEL, (ox, oy) => noise(ctx, ox, oy, "#9A9A8E", 0.13, 40));
  paint(T.STALL_RED, (ox, oy) => stripes(ctx, ox, oy, "#D9463A", "#F7F3EA", false));
  paint(T.STALL_GREEN, (ox, oy) => stripes(ctx, ox, oy, "#2E9E5B", "#F7F3EA", false));
  paint(T.CONCRETE_BEIGE, (ox, oy) => noise(ctx, ox, oy, "#E3D7BE", 0.04, 41));
  paint(T.SAND, (ox, oy) => noise(ctx, ox, oy, "#E5D8A5", 0.07, 42));
  paint(T.FOUNTAIN, (ox, oy) => {
    noise(ctx, ox, oy, "#C9CBCF", 0.035, 43);
    px(ctx, ox, oy, 0, 0, "#A6A9AE", 16, 1);
    px(ctx, ox, oy, 0, 0, "#A6A9AE", 1, 16);
  });
  paint(T.BEACON, (ox, oy) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        px(ctx, ox, oy, x, y, d < 3 ? "#FFFFFF" : d < 5.5 ? "#FFF2B0" : "#FFD24A");
      }
    }
  });
  paint(T.MARBLE, (ox, oy) => {
    noise(ctx, ox, oy, "#ECECF1", 0.025, 44);
    ctx.fillStyle = "#CFCFD8";
    for (let i = 0; i < 16; i++) px(ctx, ox, oy, i, (i * 3 + 2) % 16, "#CFCFD8");
  });
  paint(T.ANTENNA, (ox, oy) => noise(ctx, ox, oy, "#3A3A3E", 0.06, 45));
  paint(T.LOT, (ox, oy) => {
    noise(ctx, ox, oy, "#9C6B3C", 0.1, 46);
    const r = rng(47);
    for (let i = 0; i < 22; i++) px(ctx, ox, oy, Math.floor(r() * 16), Math.floor(r() * 16), "#6DB33F");
    for (let i = 0; i < 8; i++) px(ctx, ox, oy, Math.floor(r() * 16), Math.floor(r() * 16), "#7A4E26");
  });
  paint(T.PLAZA, (ox, oy) => {
    noise(ctx, ox, oy, "#D9D3C3", 0.04, 48);
    px(ctx, ox, oy, 0, 0, "#B7B09C", 16, 1);
    px(ctx, ox, oy, 0, 0, "#B7B09C", 1, 16);
    px(ctx, ox, oy, 8, 8, "#C8C1AC", 1, 1);
  });
  paint(T.BANNER, (ox, oy) => {
    noise(ctx, ox, oy, "#D64545", 0.05, 49);
    px(ctx, ox, oy, 0, 0, "#9E2E2E", 16, 1);
  });
  paint(T.WINDOW_WIDE, (ox, oy) => {
    px(ctx, ox, oy, 0, 0, "#4A4A4A", 16, 16);
    px(ctx, ox, oy, 1, 1, "#8CC5FF", 14, 14);
    for (let i = 0; i < 14; i++) if (i < 9) px(ctx, ox, oy, 1 + i + 3, 1 + 8 - i, "#D6ECFF");
    px(ctx, ox, oy, 1, 12, "#5E93C9", 14, 3);
  });
  paint(T.GLASS_GREEN, (ox, oy) => glassTile(ctx, ox, oy, "#1F3B33", "#2E6B5A", "#5FB39C"));
  paint(T.GLASS_GREEN_LIT, (ox, oy) => glassTile(ctx, ox, oy, "#1F3B33", "#F0D77A", "#FFF4C0"));
  paint(T.ROOF_GOLD, (ox, oy) => roof(ctx, ox, oy, "#E8B72A", "#B8891A", 50));
  paint(T.DOOR_GLASS, (ox, oy) => {
    px(ctx, ox, oy, 0, 0, "#33393F", 16, 16);
    px(ctx, ox, oy, 2, 1, "#9CCBFF", 5, 14);
    px(ctx, ox, oy, 9, 1, "#9CCBFF", 5, 14);
    px(ctx, ox, oy, 7, 7, "#E8C34A", 1, 2);
  });
  paint(T.CLOUD, (ox, oy) => noise(ctx, ox, oy, "#FAFCFF", 0.012, 51));
  paint(T.CHECKER, (ox, oy) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(ctx, ox, oy, x, y, ((x >> 2) + (y >> 2)) % 2 === 0 ? "#F2EFE6" : "#2E2E33");
  });
}

/** UV rectangle of a tile in the atlas, inset a quarter texel to keep neighbours out. */
export function tileUV(id: number): [number, number, number, number] {
  const e = 0.25 / ATLAS_PX;
  const u0 = (id % ATLAS_TILES) / ATLAS_TILES;
  const v0 = Math.floor(id / ATLAS_TILES) / ATLAS_TILES;
  const s = 1 / ATLAS_TILES;
  // three.js flips Y: v = 1 - canvasY
  return [u0 + e, 1 - (v0 + s) + e, u0 + s - e, 1 - v0 - e];
}
