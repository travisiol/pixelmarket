/**
 * How a parcel's building grows.
 *
 * The one input is the curve's traded volume in ETH — every buy's quoteIn
 * plus every sell's quoteOut, read from the curve's own CurveBuy /
 * CurveSell logs — and whether the curve graduated. Eight tiers, each
 * unlocked at a volume threshold; inside a tier the floor count keeps
 * climbing with volume (log scale), so a building visibly grows between
 * tiers too. Graduation is the landmark: gold on the roof, a beacon.
 *
 * Same numbers everywhere: the city, the sheet, the how-it-works page and
 * the README all read this file.
 */
export type TierKey = "lot" | "shack" | "house" | "shop" | "tower" | "highrise" | "skyscraper" | "landmark";

export type Tier = {
  id: number;
  key: TierKey;
  label: string;
  /** Volume in ETH that unlocks the tier (landmark: graduation instead). */
  minVolume: number;
  /** Floors at the bottom and the top of the tier. */
  floors: [number, number];
  blurb: string;
};

export const TIERS: readonly Tier[] = [
  { id: 0, key: "lot", label: "Lot", minVolume: 0, floors: [0, 0], blurb: "launched. a sign on an empty lot." },
  { id: 1, key: "shack", label: "Shack", minVolume: 0.01, floors: [1, 1], blurb: "the first trades. one floor of planks." },
  { id: 2, key: "house", label: "House", minVolume: 0.05, floors: [2, 3], blurb: "bricks, a pitched roof, a chimney." },
  { id: 3, key: "shop", label: "Shop", minVolume: 0.2, floors: [3, 4], blurb: "an awning, a storefront, a name above the door." },
  { id: 4, key: "tower", label: "Tower", minVolume: 0.6, floors: [5, 7], blurb: "concrete and window bands. a water tank on the roof." },
  { id: 5, key: "highrise", label: "Highrise", minVolume: 1.5, floors: [8, 11], blurb: "a glass curtain wall. lights on at night." },
  { id: 6, key: "skyscraper", label: "Skyscraper", minVolume: 3.5, floors: [12, 18], blurb: "setbacks, a crown and a spire." },
  { id: 7, key: "landmark", label: "Landmark", minVolume: Number.POSITIVE_INFINITY, floors: [18, 22], blurb: "graduated to the pool. gold on the roof and a beacon." },
];

/** Volume at which a landmark reaches its tallest form. */
const LANDMARK_FULL_VOLUME = 20;

export type Level = {
  tier: Tier;
  floors: number;
  /** 0..1 progress inside the tier (towards the next tier's threshold). */
  progress: number;
  /** ETH still to trade before the next tier; null at the top or when graduation is the gate. */
  toNext: number | null;
  next: Tier | null;
};

/** The tier a volume unlocks, graduation aside. */
export function tierForVolume(volume: number): Tier {
  let t = TIERS[0];
  for (const tier of TIERS) {
    if (tier.key === "landmark") break;
    if (volume >= tier.minVolume) t = tier;
  }
  return t;
}

function lerpLog(volume: number, from: number, to: number): number {
  if (!(volume > from)) return 0;
  if (!(to > from) || volume >= to) return 1;
  const a = Math.log(Math.max(from, 1e-6));
  const b = Math.log(to);
  const v = Math.log(Math.max(volume, 1e-6));
  return Math.min(1, Math.max(0, (v - a) / (b - a)));
}

export function levelOf(volumeEth: number, graduated: boolean): Level {
  const volume = Number.isFinite(volumeEth) && volumeEth > 0 ? volumeEth : 0;
  if (graduated) {
    const tier = TIERS[7];
    const p = lerpLog(volume, TIERS[6].minVolume, LANDMARK_FULL_VOLUME);
    return { tier, floors: Math.round(tier.floors[0] + (tier.floors[1] - tier.floors[0]) * p), progress: p, toNext: null, next: null };
  }
  const tier = tierForVolume(volume);
  const next = tier.id < 6 ? TIERS[tier.id + 1] : null;
  const ceiling = next ? next.minVolume : LANDMARK_FULL_VOLUME;
  const p = tier.id === 0 ? lerpLog(volume, 0.001, ceiling) : lerpLog(volume, tier.minVolume, ceiling);
  const floors = tier.id === 0 ? 0 : Math.round(tier.floors[0] + (tier.floors[1] - tier.floors[0]) * p);
  return { tier, floors, progress: p, toNext: next ? Math.max(0, next.minVolume - volume) : null, next };
}

/** `0.31 eth traded · shop · 3 floors` */
export function levelLine(level: Level, volumeEth: number): string {
  const floors = level.floors === 0 ? "" : ` · ${level.floors} floor${level.floors > 1 ? "s" : ""}`;
  return `${volumeEth.toFixed(volumeEth < 1 ? 3 : 2)} eth traded · ${level.tier.label.toLowerCase()}${floors}`;
}
