/**
 * Headless checks of the city maths — layout, tiers, meshing — without a
 * browser. `npm run check:city` (runs through the contracts' ts-node).
 */
import * as assert from "node:assert/strict";
import { buildGround, buildParcel, buildPlaza, exampleFloors } from "../src/lib/city/buildings";
import { BLOCK, CELL, LOT, STREET, cityBounds, isPlaza, isStreet, placeOf } from "../src/lib/city/layout";
import { levelOf, TIERS, tierForVolume } from "../src/lib/city/levels";
import { GeoSink } from "../src/lib/city/voxel";
import { textPixels, textWidth } from "../src/lib/city/font";

// ── layout ──────────────────────────────────────────────────────────────
const N = 400;
const seen = new Set<string>();
for (let id = 0; id < N; id++) {
  const p = placeOf(id);
  const k = `${p.x},${p.z}`;
  assert.ok(!seen.has(k), `parcel #${id} overlaps another at ${k}`);
  seen.add(k);
  // Every voxel of the cell is on a block, never on a street or the plaza.
  for (let x = p.x; x < p.x + CELL; x++) {
    for (let z = p.z; z < p.z + CELL; z++) {
      assert.ok(!isStreet(x, z), `parcel #${id} cell touches a street at ${x},${z}`);
      assert.ok(!isPlaza(x, z), `parcel #${id} cell touches the plaza at ${x},${z}`);
    }
  }
  assert.equal(p.lotX, p.x + 1);
  assert.equal(p.lotZ, p.z + 1);
  assert.ok(p.ring >= 1);
}
// The first four parcels share the block due +x of the plaza; rings grow.
assert.equal(placeOf(0).ring, 1);
assert.equal(placeOf(31).ring, 1);
assert.equal(placeOf(32).ring, 2);
assert.equal(placeOf(95).ring, 2);
assert.equal(placeOf(96).ring, 3);
assert.deepEqual(placeOf(0).block, placeOf(3).block);
assert.notDeepEqual(placeOf(3).block, placeOf(4).block);
assert.equal(cityBounds(12).ring, 1);
assert.equal(cityBounds(40).ring, 2);
assert.equal(BLOCK, CELL * 2 + STREET);
assert.equal(LOT, CELL - 2);
console.log(`layout: ${N} parcels placed, no overlaps, rings 1..${placeOf(N - 1).ring}`);

// ── levels ──────────────────────────────────────────────────────────────
assert.equal(tierForVolume(0).key, "lot");
assert.equal(tierForVolume(0.009).key, "lot");
assert.equal(tierForVolume(0.01).key, "shack");
assert.equal(tierForVolume(0.05).key, "house");
assert.equal(tierForVolume(0.2).key, "shop");
assert.equal(tierForVolume(0.6).key, "tower");
assert.equal(tierForVolume(1.5).key, "highrise");
assert.equal(tierForVolume(3.5).key, "skyscraper");
assert.equal(tierForVolume(1000).key, "skyscraper");
assert.equal(levelOf(1000, true).tier.key, "landmark");
assert.equal(levelOf(0, true).tier.key, "landmark");
assert.equal(levelOf(0, false).floors, 0);
assert.equal(levelOf(0.01, false).floors, 1);
assert.equal(levelOf(0.05, false).floors, 2);
assert.equal(levelOf(0.19, false).floors, 3);
assert.equal(levelOf(3.5, false).floors, 12);
assert.equal(levelOf(20, false).floors, 18);
assert.equal(levelOf(20, true).floors, 22);
let prev = -1;
for (const v of [0, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.4, 0.6, 1, 1.5, 2.5, 3.5, 8, 20, 100]) {
  const f = levelOf(v, false).floors;
  assert.ok(f >= prev, `floors must not shrink with volume (${v}: ${f} < ${prev})`);
  prev = f;
}
assert.equal(levelOf(0.03, false).next?.key, "house");
assert.ok(Math.abs((levelOf(0.03, false).toNext ?? 0) - 0.02) < 1e-9);
console.log(`levels: ${TIERS.length} tiers, floors climb monotonically`);

// ── buildings ───────────────────────────────────────────────────────────
for (const tier of TIERS) {
  const floors = exampleFloors(tier.id);
  const b = buildParcel(7, tier.id, floors);
  const sink = new GeoSink();
  sink.addVoxels(b.voxels, 7, { cullBottomAt: -1 });
  const p = placeOf(7);
  // Nothing outside the cell, nothing below ground.
  for (const [x, y, z] of b.voxels.entries()) {
    assert.ok(x >= p.x && x < p.x + CELL, `${tier.key}: voxel outside the cell (x ${x})`);
    assert.ok(z >= p.z && z < p.z + CELL + 1, `${tier.key}: voxel outside the cell (z ${z})`);
    assert.ok(y >= -1, `${tier.key}: voxel below ground`);
  }
  assert.ok(b.height >= (tier.id === 0 ? 1 : floors * 3), `${tier.key}: height ${b.height} too low for ${floors} floors`);
  assert.ok(b.sign.x > p.x && b.sign.x < p.x + CELL);
  const ids = new Set(sink.ids);
  assert.deepEqual([...ids], [7]);
  console.log(`  ${tier.label.padEnd(11)} ${String(floors).padStart(2)} floors  ${String(b.voxels.size).padStart(5)} voxels  ${String(sink.faceCount).padStart(5)} faces  height ${b.height}  sign ${b.sign.big ? "roof" : "post"}`);
}
const plaza = buildPlaza();
const ground = buildGround(12);
const g = new GeoSink();
g.addVoxels(ground, -1, { cullBottomAt: -1 });
g.addVoxels(plaza, -1);
// Ground leaves the built cells out and covers the plaza.
for (let id = 0; id < 12; id++) {
  const p = placeOf(id);
  assert.ok(!ground.has(p.x + 4, -1, p.z + 4), `ground drawn under parcel #${id}`);
}
assert.ok(ground.has(9, -1, 9), "plaza floor missing");
assert.ok(ground.has(BLOCK - 2, -1, 3), "street missing");
console.log(`ground for 12 parcels: ${ground.size} voxels, ${g.faceCount} faces; plaza ${plaza.size} voxels`);

// ── font ────────────────────────────────────────────────────────────────
assert.equal(textWidth("PXL"), 17);
assert.ok(textPixels("PIXEL MARKET").length > 100);
assert.equal(textPixels(" ").length, 0);
console.log("font: ok");

console.log("city checks passed");
