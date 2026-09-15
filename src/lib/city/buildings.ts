import { T, type Tile } from "./atlas";
import { BLOCK, CELL, LOT, STREET, groundExtent, isPlaza, isStreet, isStreetStripe, placeOf, type ParcelPlace } from "./layout";
import { TIERS } from "./levels";
import { Voxels, type Faces } from "./voxel";

/** Voxels per floor. */
export const FLOOR = 3;

export type Sign = {
  /** World centre of the sign plane. */
  x: number;
  y: number;
  z: number;
  /** Rooftop billboard (true) or a small board on a post (false). */
  big: boolean;
};

export type Built = { voxels: Voxels; sign: Sign; height: number };

/** Deterministic per-window hash, for which windows are lit. */
function lit(seed: number, x: number, y: number, z: number, fraction: number): boolean {
  let h = (seed * 374761393 + x * 668265263 + y * 2246822519 + z * 3266489917) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) % 1000 < fraction * 1000;
}

/**
 * Builds parcel #id's cell: the sidewalk ring, the lot and its building
 * for `tier` and `floors`. Coordinates inside are lot-local (0..6) and
 * converted through `L`.
 */
export function buildParcel(id: number, tier: number, floors: number, seed = id): Built {
  const place = placeOf(id);
  const v = new Voxels();
  const L = (x: number, y: number, z: number, t: Tile | Faces) => v.set(place.lotX + x, y, place.lotZ + z, t);
  const fill = (x: number, y: number, z: number, w: number, h: number, d: number, t: Tile | Faces) => v.fill(place.lotX + x, y, place.lotZ + z, w, h, d, t);

  // The cell floor: a sidewalk ring around the lot.
  v.fill(place.x, -1, place.z, CELL, 1, CELL, { top: T.SIDEWALK, side: T.STONE, bottom: T.DIRT });
  const lotFloor: Tile = tier === 0 ? T.LOT : tier <= 2 ? T.GRASS_TOP : tier === 3 ? T.PLAZA : T.SIDEWALK;
  v.fill(place.lotX, -1, place.lotZ, LOT, 1, LOT, { top: lotFloor, side: T.DIRT, bottom: T.DIRT });

  const H = Math.max(1, floors) * FLOOR;
  let sign: Sign = { x: place.lotX + 6.5, y: 2.6, z: place.lotZ + 6.5, big: false };
  let height = 0;

  const post = () => {
    fill(6, 0, 6, 1, 2, 1, T.LOG);
  };
  const sapling = (x: number, z: number) => {
    L(x, 0, z, T.LOG);
    L(x, 1, z, T.LEAVES);
  };

  switch (tier) {
    case 0: {
      // Lot: a sign, a sapling, a shrub.
      post();
      sapling(1, 1);
      L(4, 0, 1, T.LEAVES);
      height = 2;
      break;
    }
    case 1: {
      // Shack: 5 × 5 planks, one floor, a flat dark roof with an overhang.
      fill(1, 0, 1, 5, 3, 5, T.PLANKS);
      fill(0, 3, 0, 7, 1, 7, { top: T.PLANKS_DARK, side: T.PLANKS_DARK });
      L(3, 0, 5, { top: T.PLANKS, side: T.PLANKS, pz: T.DOOR });
      L(2, 1, 5, { top: T.PLANKS, side: T.PLANKS, pz: T.WINDOW });
      L(4, 1, 5, { top: T.PLANKS, side: T.PLANKS, pz: T.WINDOW });
      L(5, 1, 2, { top: T.PLANKS, side: T.PLANKS, px: T.WINDOW });
      L(5, 1, 4, { top: T.PLANKS, side: T.PLANKS, px: T.WINDOW });
      L(1, 4, 1, T.BRICKS_RED);
      post();
      sapling(0, 6);
      height = 5;
      break;
    }
    case 2: {
      // House: 6 × 6 bricks, a pitched roof, a chimney, a lawn.
      fill(0, 0, 1, 6, H, 6, T.BRICKS_RED);
      for (let f = 0; f < floors; f++) {
        const y = f * FLOOR + 1;
        for (const x of f === 0 ? [4] : [1, 4]) L(x, y, 6, { top: T.BRICKS_RED, side: T.BRICKS_RED, pz: T.WINDOW });
        for (const z of [2, 4]) L(5, y, z, { top: T.BRICKS_RED, side: T.BRICKS_RED, px: T.WINDOW });
      }
      L(2, 0, 6, { top: T.BRICKS_RED, side: T.BRICKS_RED, pz: T.DOOR });
      fill(0, H, 1, 6, 1, 6, T.ROOF_RED);
      fill(1, H + 1, 2, 4, 1, 4, T.ROOF_RED);
      fill(2, H + 2, 3, 2, 1, 2, T.ROOF_RED);
      fill(4, H, 2, 1, 3, 1, T.BRICKS_RED);
      post();
      sapling(6, 1);
      height = H + 3;
      break;
    }
    case 3: {
      // Shop: the whole lot in cream bricks, a glass storefront, an awning over the sidewalk.
      fill(0, 0, 0, 7, H, 7, { top: T.GRAVEL, side: T.BRICKS_CREAM });
      for (const x of [1, 2, 4, 5]) {
        L(x, 0, 6, { top: T.GRAVEL, side: T.BRICKS_CREAM, pz: T.WINDOW_WIDE });
        L(x, 1, 6, { top: T.GRAVEL, side: T.BRICKS_CREAM, pz: T.WINDOW_WIDE });
      }
      L(3, 0, 6, { top: T.GRAVEL, side: T.BRICKS_CREAM, pz: T.DOOR_GLASS });
      for (const z of [1, 3, 5]) L(6, 1, z, { top: T.GRAVEL, side: T.BRICKS_CREAM, px: T.WINDOW_WIDE });
      fill(1, 2, 7, 5, 1, 1, seed % 2 === 0 ? T.AWNING_RED : T.AWNING_BLUE);
      for (let f = 1; f < floors; f++) {
        const y = f * FLOOR + 1;
        for (const x of [1, 3, 5]) L(x, y, 6, { top: T.GRAVEL, side: T.BRICKS_CREAM, pz: T.WINDOW });
        for (const z of [1, 3, 5]) L(6, y, z, { top: T.GRAVEL, side: T.BRICKS_CREAM, px: T.WINDOW });
      }
      // Parapet and a rooftop unit.
      for (let i = 0; i < 7; i++) {
        L(i, H, 0, T.BRICKS_CREAM);
        L(i, H, 6, T.BRICKS_CREAM);
        L(0, H, i, T.BRICKS_CREAM);
        L(6, H, i, T.BRICKS_CREAM);
      }
      fill(1, H, 1, 2, 1, 2, T.CONCRETE_DARK);
      fill(3, H, 3, 1, 2, 1, T.ANTENNA);
      sign = { x: place.lotX + 3.5, y: H + 3, z: place.lotZ + 3.5, big: true };
      height = H + 4;
      break;
    }
    case 4: {
      // Tower: concrete with window bands, a water tank and an antenna on the roof.
      fill(0, 0, 1, 6, H, 6, { top: T.CONCRETE_DARK, side: T.CONCRETE_LIGHT });
      for (let f = 0; f < floors; f++) {
        const y = f * FLOOR + 1;
        for (let x = 1; x <= 4; x++) L(x, y, 6, { top: T.CONCRETE_DARK, side: T.CONCRETE_LIGHT, pz: T.WINDOW });
        for (let z = 2; z <= 5; z++) L(5, y, z, { top: T.CONCRETE_DARK, side: T.CONCRETE_LIGHT, px: T.WINDOW });
      }
      L(2, 0, 6, { top: T.CONCRETE_DARK, side: T.CONCRETE_LIGHT, pz: T.DOOR_GLASS });
      L(3, 0, 6, { top: T.CONCRETE_DARK, side: T.CONCRETE_LIGHT, pz: T.DOOR_GLASS });
      fill(1, H, 2, 2, 2, 2, T.STONE);
      fill(4, H, 4, 1, 3, 1, T.ANTENNA);
      L(4, H + 3, 4, T.LAMP);
      post();
      sign = { x: place.lotX + 2.5, y: H + 4.2, z: place.lotZ + 3.5, big: true };
      height = H + 5;
      break;
    }
    case 5: {
      // Highrise: a green glass curtain wall, some windows lit, a mechanical floor on top.
      const wall = (x: number, y: number, z: number) => (lit(seed, x, y, z, 0.3) ? T.GLASS_GREEN_LIT : T.GLASS_GREEN);
      fill(0, 0, 0, 7, H, 7, { top: T.CONCRETE_DARK, side: T.GLASS_GREEN });
      for (let y = 0; y < H; y++) {
        for (let i = 0; i < 7; i++) {
          L(i, y, 6, { top: T.CONCRETE_DARK, side: wall(i, y, 6) });
          L(6, y, i, { top: T.CONCRETE_DARK, side: wall(6, y, i) });
          L(i, y, 0, { top: T.CONCRETE_DARK, side: wall(i, y, 0) });
          L(0, y, i, { top: T.CONCRETE_DARK, side: wall(0, y, i) });
        }
        for (const [x, z] of [[0, 0], [6, 0], [0, 6], [6, 6]] as const) L(x, y, z, T.CONCRETE_DARK);
      }
      for (let i = 1; i < 6; i++) L(i, 0, 6, { top: T.CONCRETE_DARK, side: T.CONCRETE_DARK, pz: i === 3 ? T.DOOR_GLASS : T.WINDOW_WIDE });
      fill(1, H, 1, 5, 1, 5, T.CONCRETE_DARK);
      fill(3, H + 1, 3, 1, 1, 1, T.ANTENNA);
      L(3, H + 2, 3, T.LAMP);
      sign = { x: place.lotX + 3.5, y: H + 4, z: place.lotZ + 3.5, big: true };
      height = H + 5;
      break;
    }
    case 6:
    case 7: {
      // Skyscraper: a wide base, a shaft, a crown and a spire. Landmark: gold trims and a beacon.
      const landmark = tier === 7;
      const base = 4;
      const crown = 2;
      const shaftFloors = Math.max(1, floors - base - crown);
      const wall = (x: number, y: number, z: number) => (lit(seed, x, y, z, landmark ? 0.5 : 0.35) ? T.GLASS_DARK_LIT : T.GLASS_DARK);
      const box = (x0: number, z0: number, size: number, y0: number, y1: number) => {
        v.fill(place.lotX + x0, y0, place.lotZ + z0, size, y1 - y0, size, { top: T.CONCRETE_DARK, side: T.GLASS_DARK });
        for (let y = y0; y < y1; y++) {
          for (let i = 0; i < size; i++) {
            L(x0 + i, y, z0 + size - 1, { top: T.CONCRETE_DARK, side: wall(x0 + i, y, z0 + size - 1) });
            L(x0 + size - 1, y, z0 + i, { top: T.CONCRETE_DARK, side: wall(x0 + size - 1, y, z0 + i) });
            L(x0 + i, y, z0, { top: T.CONCRETE_DARK, side: wall(x0 + i, y, z0) });
            L(x0, y, z0 + i, { top: T.CONCRETE_DARK, side: wall(x0, y, z0 + i) });
          }
          for (const [x, z] of [[x0, z0], [x0 + size - 1, z0], [x0, z0 + size - 1], [x0 + size - 1, z0 + size - 1]] as const) L(x, y, z, T.CONCRETE_DARK);
        }
      };
      const yBase = base * FLOOR;
      const yShaft = yBase + shaftFloors * FLOOR;
      const yCrown = yShaft + crown * FLOOR;
      box(0, 0, 7, 0, yBase);
      box(1, 1, 5, yBase, yShaft);
      box(2, 2, 3, yShaft, yCrown);
      for (let i = 1; i < 6; i++) L(i, 0, 6, { top: T.CONCRETE_DARK, side: T.CONCRETE_DARK, pz: i === 3 ? T.DOOR_GLASS : T.WINDOW_WIDE });
      if (landmark) {
        for (let i = 0; i < 7; i++) {
          L(i, yBase - 1, 6, T.GOLD);
          L(6, yBase - 1, i, T.GOLD);
          L(i, yBase - 1, 0, T.GOLD);
          L(0, yBase - 1, i, T.GOLD);
        }
        for (let i = 0; i < 5; i++) {
          L(1 + i, yShaft - 1, 5, T.GOLD);
          L(5, yShaft - 1, 1 + i, T.GOLD);
        }
        fill(2, yCrown, 2, 3, 1, 3, { top: T.ROOF_GOLD, side: T.GOLD });
        fill(3, yCrown + 1, 3, 1, 6, 1, T.BEACON);
        height = yCrown + 7;
      } else {
        fill(3, yCrown, 3, 1, 4, 1, T.ANTENNA);
        L(3, yCrown + 4, 3, T.LAMP);
        height = yCrown + 5;
      }
      sign = { x: place.lotX + 3.5, y: height + 1.2, z: place.lotZ + 3.5, big: true };
      break;
    }
  }
  return { voxels: v, sign, height };
}

/** The market square: fountain, stalls, trees, lamps. Block (0, 0). */
export function buildPlaza(): Voxels {
  const v = new Voxels();
  const W = BLOCK - STREET; // 18
  // Fountain
  for (let x = 6; x < 12; x++) {
    for (let z = 6; z < 12; z++) {
      const ring = x === 6 || x === 11 || z === 6 || z === 11;
      v.set(x, 0, z, ring ? T.FOUNTAIN : T.WATER);
    }
  }
  v.fill(8, 1, 8, 2, 1, 2, T.FOUNTAIN);
  v.set(8, 2, 8, T.WATER);
  v.set(9, 2, 9, T.WATER);
  // Stalls in the four corners
  const stall = (x: number, z: number, cloth: Tile) => {
    for (const [dx, dz] of [[0, 0], [2, 0], [0, 2], [2, 2]] as const) v.fill(x + dx, 0, z + dz, 1, 2, 1, T.LOG);
    v.fill(x, 2, z, 3, 1, 3, { top: cloth, side: cloth });
    v.fill(x, 0, z + 2, 3, 1, 1, T.PLANKS);
    v.set(x + 1, 1, z + 1, T.BANNER);
  };
  stall(2, 2, T.STALL_RED);
  stall(W - 5, 2, T.STALL_GREEN);
  stall(2, W - 5, T.STALL_GREEN);
  stall(W - 5, W - 5, T.STALL_RED);
  // Trees
  const tree = (x: number, z: number) => {
    v.fill(x - 1, 2, z - 1, 3, 2, 3, T.LEAVES);
    v.set(x, 4, z, T.LEAVES);
    v.fill(x, 0, z, 1, 3, 1, T.LOG);
  };
  tree(2, 9);
  tree(W - 3, 8);
  tree(9, 2);
  tree(8, W - 3);
  // Lamps at the corners
  for (const [x, z] of [[0, 0], [W - 1, 0], [0, W - 1], [W - 1, W - 1]] as const) {
    v.fill(x, 0, z, 1, 3, 1, T.ANTENNA);
    v.set(x, 3, z, T.LAMP);
  }
  return v;
}

/** The plaza's own sign: a name tag floating over the fountain, the way names float over players. */
export const PLAZA_SIGN = { x: 9, y: 7.5, z: 9 };


/**
 * The ground for a city of `count` parcels: streets, the plaza floor and
 * grass, one voxel thick; the cells of built parcels are left out (their
 * own mesh draws them).
 */
export function buildGround(count: number): Voxels {
  const v = new Voxels();
  const e = groundExtent(count);
  const built = new Set<string>();
  for (let id = 0; id < count; id++) {
    const p = placeOf(id);
    built.add(`${p.cell.cx},${p.cell.cz}`);
  }
  const cellOf = (x: number, z: number): string | null => {
    const bx = Math.floor(x / BLOCK);
    const bz = Math.floor(z / BLOCK);
    const mx = x - bx * BLOCK;
    const mz = z - bz * BLOCK;
    if (mx >= BLOCK - STREET || mz >= BLOCK - STREET) return null;
    return `${bx * 2 + Math.floor(mx / CELL)},${bz * 2 + Math.floor(mz / CELL)}`;
  };
  for (let x = e.minX; x < e.maxX; x++) {
    for (let z = e.minZ; z < e.maxZ; z++) {
      let top: Tile;
      if (isPlaza(x, z)) top = T.PLAZA;
      else if (isStreet(x, z)) top = isStreetStripe(x, z) ? (((x % BLOCK) + BLOCK) % BLOCK >= BLOCK - STREET ? T.STRIPE_NS : T.STRIPE_EW) : T.ASPHALT;
      else {
        const c = cellOf(x, z);
        if (c && built.has(c)) continue;
        top = T.GRASS_TOP;
      }
      v.set(x, -1, z, { top, side: top === T.GRASS_TOP ? T.GRASS_SIDE : T.STONE, bottom: T.DIRT });
    }
  }
  return v;
}

/** One example building per tier, for legends and thumbnails. */
export function exampleFloors(tier: number): number {
  const t = TIERS[tier];
  return Math.round((t.floors[0] + t.floors[1]) / 2);
}

export type { ParcelPlace };
