import * as THREE from "three";
import { tileUV, type Tile } from "./atlas";

/**
 * A sparse voxel volume and a mesher that emits only the exposed faces,
 * each textured from the atlas and shaded by direction the way Minecraft
 * shades blocks (top bright, sides darker, bottom darkest) — flat vertex
 * colours, no lights. Every vertex also carries the parcel id its voxel
 * belongs to, so a raycast hit knows which building it touched.
 */
export type Faces = {
  top: Tile;
  side: Tile;
  bottom?: Tile;
  px?: Tile;
  nx?: Tile;
  pz?: Tile;
  nz?: Tile;
};

export const SHADE = { top: 1, bottom: 0.5, px: 0.84, nx: 0.84, pz: 0.7, nz: 0.7 } as const;

const OFF = 2048;
function key(x: number, y: number, z: number): number {
  return ((x + OFF) * 4096 + (z + OFF)) * 256 + (y + 8);
}

export function faces(tile: Tile | Faces): Faces {
  return typeof tile === "number" ? { top: tile, side: tile } : tile;
}

export class Voxels {
  readonly map = new Map<number, Faces>();

  has(x: number, y: number, z: number): boolean {
    return this.map.has(key(x, y, z));
  }

  get(x: number, y: number, z: number): Faces | undefined {
    return this.map.get(key(x, y, z));
  }

  set(x: number, y: number, z: number, tile: Tile | Faces): void {
    this.map.set(key(x, y, z), faces(tile));
  }

  remove(x: number, y: number, z: number): void {
    this.map.delete(key(x, y, z));
  }

  /** A solid box from (x, y, z), w × h × d. */
  fill(x: number, y: number, z: number, w: number, h: number, d: number, tile: Tile | Faces): void {
    const f = faces(tile);
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) for (let k = 0; k < d; k++) this.map.set(key(x + i, y + j, z + k), f);
  }

  get size(): number {
    return this.map.size;
  }

  /** Iterates voxels as (x, y, z, faces). */
  *entries(): IterableIterator<[number, number, number, Faces]> {
    for (const [k, f] of this.map) {
      const y = (k % 256) - 8;
      const rest = Math.floor(k / 256);
      const z = (rest % 4096) - OFF;
      const x = Math.floor(rest / 4096) - OFF;
      yield [x, y, z, f];
    }
  }
}

type Corner = [number, number, number];

/** Collects quads into flat arrays and turns them into one BufferGeometry. */
export class GeoSink {
  positions: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  ids: number[] = [];
  indices: number[] = [];
  private count = 0;

  /** Corners in order bottom-left, bottom-right, top-right, top-left as seen from outside. */
  quad(c: [Corner, Corner, Corner, Corner], tile: Tile, shade: number, id: number, tint: [number, number, number] = [1, 1, 1]): void {
    const [u0, v0, u1, v1] = tileUV(tile);
    const uv = [u0, v0, u1, v0, u1, v1, u0, v1];
    for (let i = 0; i < 4; i++) {
      this.positions.push(c[i][0], c[i][1], c[i][2]);
      this.uvs.push(uv[i * 2], uv[i * 2 + 1]);
      this.colors.push(shade * tint[0], shade * tint[1], shade * tint[2]);
      this.ids.push(id);
    }
    const b = this.count;
    this.indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.count += 4;
  }

  /** Emits the exposed faces of every voxel in `v`. */
  addVoxels(v: Voxels, id: number, opts: { cullBottomAt?: number; tint?: [number, number, number] } = {}): void {
    const tint = opts.tint;
    for (const [x, y, z, f] of v.entries()) {
      if (!v.has(x, y + 1, z)) {
        this.quad([[x, y + 1, z + 1], [x + 1, y + 1, z + 1], [x + 1, y + 1, z], [x, y + 1, z]], f.top, SHADE.top, id, tint);
      }
      if (!v.has(x, y - 1, z) && y !== opts.cullBottomAt) {
        this.quad([[x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1]], f.bottom ?? f.side, SHADE.bottom, id, tint);
      }
      if (!v.has(x + 1, y, z)) {
        this.quad([[x + 1, y, z + 1], [x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1]], f.px ?? f.side, SHADE.px, id, tint);
      }
      if (!v.has(x - 1, y, z)) {
        this.quad([[x, y, z], [x, y, z + 1], [x, y + 1, z + 1], [x, y + 1, z]], f.nx ?? f.side, SHADE.nx, id, tint);
      }
      if (!v.has(x, y, z + 1)) {
        this.quad([[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]], f.pz ?? f.side, SHADE.pz, id, tint);
      }
      if (!v.has(x, y, z - 1)) {
        this.quad([[x + 1, y, z], [x, y, z], [x, y + 1, z], [x + 1, y + 1, z]], f.nz ?? f.side, SHADE.nz, id, tint);
      }
    }
  }

  get faceCount(): number {
    return this.count / 4;
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute("parcel", new THREE.Float32BufferAttribute(this.ids, 1));
    g.setIndex(this.count > 65_535 ? new THREE.Uint32BufferAttribute(this.indices, 1) : new THREE.Uint16BufferAttribute(this.indices, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
