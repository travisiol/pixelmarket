/**
 * Where parcel #n stands.
 *
 * The city is a grid of blocks, 2 × 2 parcels each, separated by streets.
 * Block (0, 0) is the market square. Parcels are handed out in launch
 * order, block by block, in a spiral around the square — so #0 is next to
 * the plaza, and the city grows outwards as tokens launch. Pure functions
 * of the parcel number: the chain never stores a position.
 *
 * Units are voxels. A parcel cell is CELL × CELL: a sidewalk ring one
 * voxel wide around a LOT × LOT buildable lot.
 */
export const CELL = 9;
export const LOT = 7;
export const STREET = 4;
/** A block is two cells wide plus its street. */
export const BLOCK = CELL * 2 + STREET;
export const CELLS_PER_BLOCK = 4;

export type Block = { bx: number; bz: number };
export type Cell = { cx: number; cz: number };

/** Ring 0 is the plaza; ring r has 8r blocks, listed clockwise from (r, 0). */
function ringBlocks(r: number): Block[] {
  if (r === 0) return [{ bx: 0, bz: 0 }];
  const out: Block[] = [];
  // Sorted by angle around the plaza so a ring fills in a sweep rather than
  // by side; the sort key is the block centre's angle.
  for (let bx = -r; bx <= r; bx++) {
    for (let bz = -r; bz <= r; bz++) {
      if (Math.max(Math.abs(bx), Math.abs(bz)) === r) out.push({ bx, bz });
    }
  }
  out.sort((a, b) => angle(a) - angle(b));
  return out;
}

function angle(b: Block): number {
  // Start at the block due +x of the plaza and sweep clockwise when seen
  // from above (x right, z down on the map).
  const a = Math.atan2(b.bz + 0.5, b.bx + 0.5);
  return a < 0 ? a + Math.PI * 2 : a;
}

const blockCache: Block[] = [];
let cachedRing = -1;

/** The n-th block handed out (0 = first block after the plaza). */
export function blockAt(n: number): Block {
  while (blockCache.length <= n) {
    cachedRing++;
    if (cachedRing === 0) continue; // the plaza is never a parcel block
    blockCache.push(...ringBlocks(cachedRing));
  }
  return blockCache[n];
}

/** Local cell order inside a block: front-left, front-right, back-left, back-right. */
const LOCAL: readonly [number, number][] = [
  [0, 1],
  [1, 1],
  [0, 0],
  [1, 0],
];

export type ParcelPlace = {
  id: number;
  block: Block;
  /** Cell coordinates in the global cell grid. */
  cell: Cell;
  /** World origin of the 9 × 9 cell (min x, min z). */
  x: number;
  z: number;
  /** World origin of the 7 × 7 lot inside it. */
  lotX: number;
  lotZ: number;
  /** Ring around the plaza (1 = adjacent). */
  ring: number;
};

export function blockOrigin(b: Block): { x: number; z: number } {
  return { x: b.bx * BLOCK, z: b.bz * BLOCK };
}

export function placeOf(id: number): ParcelPlace {
  const block = blockAt(Math.floor(id / CELLS_PER_BLOCK));
  const [i, j] = LOCAL[id % CELLS_PER_BLOCK];
  const o = blockOrigin(block);
  const x = o.x + i * CELL;
  const z = o.z + j * CELL;
  return {
    id,
    block,
    cell: { cx: block.bx * 2 + i, cz: block.bz * 2 + j },
    x,
    z,
    lotX: x + 1,
    lotZ: z + 1,
    ring: Math.max(Math.abs(block.bx), Math.abs(block.bz)),
  };
}

/** Centre of a parcel's lot, for cameras and markers. */
export function centerOf(id: number): { x: number; z: number } {
  const p = placeOf(id);
  return { x: p.lotX + LOT / 2, z: p.lotZ + LOT / 2 };
}

/** Bounding box (in blocks) of everything built for `count` parcels, plus the plaza. */
export function cityBounds(count: number): { minBx: number; maxBx: number; minBz: number; maxBz: number; ring: number } {
  let minBx = 0;
  let maxBx = 0;
  let minBz = 0;
  let maxBz = 0;
  let ring = 0;
  const blocks = Math.ceil(count / CELLS_PER_BLOCK);
  for (let n = 0; n < blocks; n++) {
    const b = blockAt(n);
    minBx = Math.min(minBx, b.bx);
    maxBx = Math.max(maxBx, b.bx);
    minBz = Math.min(minBz, b.bz);
    maxBz = Math.max(maxBz, b.bz);
    ring = Math.max(ring, Math.abs(b.bx), Math.abs(b.bz));
  }
  return { minBx, maxBx, minBz, maxBz, ring };
}

/** World extent of the ground to draw: the built rings plus one empty ring of grass and streets. */
export function groundExtent(count: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const b = cityBounds(count);
  const r = b.ring + 1;
  return { minX: -r * BLOCK, maxX: (r + 1) * BLOCK - STREET, minZ: -r * BLOCK, maxZ: (r + 1) * BLOCK - STREET };
}

/** The street grid: true when the world column (x, z) is street rather than block. */
export function isStreet(x: number, z: number): boolean {
  const mx = ((x % BLOCK) + BLOCK) % BLOCK;
  const mz = ((z % BLOCK) + BLOCK) % BLOCK;
  return mx >= BLOCK - STREET || mz >= BLOCK - STREET;
}

/** The plaza is block (0, 0) without its streets. */
export function isPlaza(x: number, z: number): boolean {
  return x >= 0 && x < BLOCK - STREET && z >= 0 && z < BLOCK - STREET;
}

/** Street centre-line dashes, along the street's direction. */
export function isStreetStripe(x: number, z: number): boolean {
  const mx = ((x % BLOCK) + BLOCK) % BLOCK;
  const mz = ((z % BLOCK) + BLOCK) % BLOCK;
  const inX = mx >= BLOCK - STREET; // a north-south street column
  const inZ = mz >= BLOCK - STREET; // an east-west street row
  if (inX && inZ) return false; // intersection
  if (inX) return mx === BLOCK - STREET + 1 && ((z % 3) + 3) % 3 !== 2;
  if (inZ) return mz === BLOCK - STREET + 1 && ((x % 3) + 3) % 3 !== 2;
  return false;
}
