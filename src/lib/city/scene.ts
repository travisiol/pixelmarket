import * as THREE from "three";
import { paintAtlas, T } from "./atlas";
import { buildGround, buildParcel, buildPlaza, PLAZA_SIGN, type Sign } from "./buildings";
import { drawText, textWidth, GLYPH_H } from "./font";
import { BLOCK, CELL, centerOf, cityBounds, placeOf, STREET } from "./layout";
import { GeoSink, Voxels } from "./voxel";

/**
 * The city on screen. One orthographic camera looking down the (+x, +z)
 * diagonal, one atlas material, three meshes: the ground (rebuilt when a
 * parcel is added), the buildings (rebuilt when any building changes) and
 * the plaza. Signs are camera-facing planes with the ticker painted in
 * the bitmap font. Drag to pan, wheel or pinch to zoom, click a building
 * to select it.
 */
export type CityParcel = { id: number; tier: number; floors: number; symbol: string };

export type SceneEvents = {
  onHover: (id: number | null, x: number, y: number) => void;
  onSelect: (id: number | null) => void;
  onMove?: () => void;
};

const VIEW_DIR = new THREE.Vector3(1, 0.9, 1).normalize();
const BASE_VIEW = 26; // half-height of the view in voxels at zoom 1
const MIN_ZOOM = 0.28;
const MAX_ZOOM = 3.2;
const SIGN_PX = 3; // canvas pixels per glyph pixel

export class CityScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly atlas: THREE.CanvasTexture;
  private ground: THREE.Mesh | null = null;
  private buildings: THREE.Mesh | null = null;
  private plaza: THREE.Mesh;
  private signs = new THREE.Group();
  private signTextures = new Map<string, THREE.CanvasTexture>();
  private clouds: THREE.Mesh;
  private hoverBox: THREE.LineSegments;
  private selectBox: THREE.LineSegments;
  private marker: THREE.Mesh;
  private target = new THREE.Vector3(BLOCK / 2, 0, BLOCK / 2);
  private goal: THREE.Vector3 | null = null;
  private zoom = 1;
  private zoomGoal: number | null = null;
  private heights = new Map<number, number>();
  private shape = "";
  private count = -1;
  private selected: number | null = null;
  private hovered: number | null = null;
  private raf = 0;
  private disposed = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private pinch: number | null = null;
  private start = performance.now();
  private raycaster = new THREE.Raycaster();
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    readonly container: HTMLElement,
    readonly canvas: HTMLCanvasElement,
    private readonly events: SceneEvents,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);

    const atlasCanvas = document.createElement("canvas");
    paintAtlas(atlasCanvas);
    this.atlas = new THREE.CanvasTexture(atlasCanvas);
    this.atlas.magFilter = THREE.NearestFilter;
    this.atlas.minFilter = THREE.NearestFilter;
    this.atlas.generateMipmaps = false;
    this.atlas.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshBasicMaterial({ map: this.atlas, vertexColors: true });

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -600, 1200);
    this.camera.up.set(0, 1, 0);

    const plazaSink = new GeoSink();
    plazaSink.addVoxels(buildPlaza(), -1);
    this.plaza = new THREE.Mesh(plazaSink.toGeometry(), this.material);
    this.scene.add(this.plaza);
    this.scene.add(this.signs);
    this.signs.add(this.makeSign("PIXEL MARKET", PLAZA_SIGN.x, PLAZA_SIGN.y, PLAZA_SIGN.z, "plaza"));

    this.clouds = new THREE.Mesh(this.makeClouds(), this.material);
    this.scene.add(this.clouds);

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(CELL + 0.2, 1, CELL + 0.2));
    this.hoverBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }));
    this.hoverBox.visible = false;
    this.hoverBox.renderOrder = 10;
    this.selectBox = new THREE.LineSegments(edges.clone(), new THREE.LineBasicMaterial({ color: 0xffd23f, depthTest: false }));
    this.selectBox.visible = false;
    this.selectBox.renderOrder = 11;
    this.scene.add(this.hoverBox, this.selectBox);

    const markerSink = new GeoSink();
    const mv = new Voxels();
    mv.set(0, 1, 0, T.GOLD);
    mv.set(2, 1, 0, T.GOLD);
    mv.set(1, 0, 0, T.GOLD);
    mv.set(1, 2, 0, T.BEACON);
    mv.set(0, 1, 1, T.GOLD);
    mv.set(2, 1, 1, T.GOLD);
    mv.set(1, 0, 1, T.GOLD);
    mv.set(1, 2, 1, T.BEACON);
    markerSink.addVoxels(mv, -1);
    this.marker = new THREE.Mesh(markerSink.toGeometry(), this.material);
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.bind();
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    window.addEventListener("resize", this.resize);
    this.loop();
  }

  // ───────────────────────────────────────────── content ──

  /** Rebuilds what changed: the ground when parcels are added, the buildings when any level moved. */
  setCity(parcels: CityParcel[]): void {
    const count = parcels.length;
    if (count !== this.count) {
      this.count = count;
      if (this.ground) {
        this.scene.remove(this.ground);
        this.ground.geometry.dispose();
      }
      const sink = new GeoSink();
      sink.addVoxels(buildGround(count), -1, { cullBottomAt: -1 });
      this.ground = new THREE.Mesh(sink.toGeometry(), this.material);
      this.scene.add(this.ground);
      this.clouds.geometry.dispose();
      this.clouds.geometry = this.makeClouds();
    }
    const shape = parcels.map((p) => `${p.id}:${p.tier}:${p.floors}:${p.symbol}`).join("|");
    if (shape === this.shape) return;
    this.shape = shape;
    if (this.buildings) {
      this.scene.remove(this.buildings);
      this.buildings.geometry.dispose();
    }
    for (const s of [...this.signs.children]) {
      if (s.userData.kind === "parcel") this.signs.remove(s);
    }
    const sink = new GeoSink();
    this.heights.clear();
    for (const p of parcels) {
      const b = buildParcel(p.id, p.tier, p.floors);
      sink.addVoxels(b.voxels, p.id, { cullBottomAt: -1 });
      this.heights.set(p.id, b.height);
      this.signs.add(this.makeSign(`$${p.symbol}`.slice(0, 12), b.sign.x, b.sign.y, b.sign.z, b.sign.big ? "big" : "small", p.id));
    }
    this.buildings = new THREE.Mesh(sink.toGeometry(), this.material);
    this.scene.add(this.buildings);
    this.placeSelection();
  }

  private makeSign(text: string, x: number, y: number, z: number, kind: "plaza" | "big" | "small", id = -1): THREE.Mesh {
    const key = `${kind}:${text}`;
    let tex = this.signTextures.get(key);
    if (!tex) {
      const c = document.createElement("canvas");
      const w = textWidth(text) * SIGN_PX + SIGN_PX * 4;
      const h = GLYPH_H * SIGN_PX + SIGN_PX * 4;
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      const dark = kind !== "small";
      ctx.fillStyle = dark ? "#1f2430" : "#c9a263";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = dark ? "#0b0d12" : "#6b4a26";
      ctx.fillRect(0, 0, w, SIGN_PX);
      ctx.fillRect(0, h - SIGN_PX, w, SIGN_PX);
      ctx.fillRect(0, 0, SIGN_PX, h);
      ctx.fillRect(w - SIGN_PX, 0, SIGN_PX, h);
      drawText(ctx, text, SIGN_PX * 2 + SIGN_PX / 2, SIGN_PX * 2 + SIGN_PX / 2, dark ? "#0b0d12" : "#3a2410", SIGN_PX);
      drawText(ctx, text, SIGN_PX * 2, SIGN_PX * 2, kind === "plaza" ? "#ffd23f" : dark ? "#ffffff" : "#2a1a0a", SIGN_PX);
      tex = new THREE.CanvasTexture(c);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.signTextures.set(key, tex);
    }
    const glyph = kind === "plaza" ? 0.26 : kind === "big" ? 0.19 : 0.13; // world units per glyph pixel
    const w = (tex.image as HTMLCanvasElement).width * (glyph / SIGN_PX);
    const h = (tex.image as HTMLCanvasElement).height * (glyph / SIGN_PX);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: false }));
    mesh.position.set(x, y, z);
    mesh.rotation.y = Math.PI / 4;
    mesh.userData = { kind: id >= 0 ? "parcel" : "plaza", id };
    return mesh;
  }

  private makeClouds(): THREE.BufferGeometry {
    const sink = new GeoSink();
    const v = new Voxels();
    const b = cityBounds(Math.max(this.count, 0));
    const r = b.ring + 2;
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const n = 6 + r * 3;
    for (let i = 0; i < n; i++) {
      const x = Math.floor((rnd() * 2 - 1) * r * BLOCK * 1.4);
      const z = Math.floor((rnd() * 2 - 1) * r * BLOCK * 1.4);
      const w = 4 + Math.floor(rnd() * 6);
      const d = 3 + Math.floor(rnd() * 4);
      v.fill(x, 54, z, w, 1, d, T.CLOUD);
      if (rnd() < 0.6) v.fill(x + 1, 55, z + 1, Math.max(1, w - 2), 1, Math.max(1, d - 2), T.CLOUD);
    }
    sink.addVoxels(v, -1);
    return sink.toGeometry();
  }

  // ───────────────────────────────────────────── camera ──

  private resize = () => {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.applyCamera();
  };

  private applyCamera() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const viewH = BASE_VIEW / this.zoom;
    const viewW = (viewH * w) / h;
    this.camera.left = -viewW;
    this.camera.right = viewW;
    this.camera.top = viewH;
    this.camera.bottom = -viewH;
    this.camera.position.copy(this.target).addScaledVector(VIEW_DIR, 300);
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  /** Frames the whole built city: every block that has a parcel, plus the plaza. */
  fitCity(animate = false): void {
    const b = cityBounds(Math.max(this.count, 0));
    const minX = b.minBx * BLOCK;
    const maxX = (b.maxBx + 1) * BLOCK - STREET;
    const minZ = b.minBz * BLOCK;
    const maxZ = (b.maxBz + 1) * BLOCK - STREET;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    let tallest = 8;
    for (const h of this.heights.values()) tallest = Math.max(tallest, h);
    const h = this.container.clientHeight || 1;
    const w = this.container.clientWidth || 1;
    // Seen down the diagonal, the ground rectangle is (W + D) / √2 wide on
    // screen and that times sin(elevation) tall, plus the buildings' height
    // times cos(elevation). A margin of a street on every side.
    const elev = Math.asin(VIEW_DIR.y);
    const W = maxX - minX + STREET * 2;
    const D = maxZ - minZ + STREET * 2;
    const needW = (W + D) / Math.SQRT2;
    const needH = needW * Math.sin(elev) + tallest * Math.cos(elev) + 6;
    const zoom = Math.min(1.6, Math.max(MIN_ZOOM, Math.min((2 * BASE_VIEW) / needH, (2 * BASE_VIEW * (w / h)) / needW)));
    const t = new THREE.Vector3(cx, tallest * 0.3, cz);
    if (animate) {
      this.goal = t;
      this.zoomGoal = zoom;
    } else {
      this.target.copy(t);
      this.zoom = zoom;
      this.goal = null;
      this.zoomGoal = null;
      this.applyCamera();
    }
  }

  /**
   * Glides to a parcel. `shiftPx` moves the building left on screen by that
   * many pixels (room for a sheet on the right); `shiftPxY` moves it up
   * (room for a sheet at the bottom).
   */
  focus(id: number, zoom = Math.max(this.zoom, 1.3), shiftPx = 0, shiftPxY = 0): void {
    const c = centerOf(id);
    const h = (this.heights.get(id) ?? 6) * 0.45;
    const z = Math.min(MAX_ZOOM, zoom);
    const goal = new THREE.Vector3(c.x, h, c.z);
    const screenH = this.container.clientHeight || 1;
    const unitsPerPixel = (2 * BASE_VIEW) / z / screenH;
    if (shiftPx !== 0) goal.addScaledVector(new THREE.Vector3(1, 0, -1).normalize(), shiftPx * unitsPerPixel);
    if (shiftPxY !== 0) goal.addScaledVector(new THREE.Vector3(1, 0, 1).normalize(), (shiftPxY * unitsPerPixel) / Math.sin(Math.asin(VIEW_DIR.y)));
    this.goal = goal;
    this.zoomGoal = z;
  }

  select(id: number | null): void {
    this.selected = id;
    this.placeSelection();
  }

  private placeSelection() {
    if (this.selected === null || !this.heights.has(this.selected)) {
      this.selectBox.visible = false;
      this.marker.visible = false;
      return;
    }
    const p = placeOf(this.selected);
    this.selectBox.position.set(p.x + CELL / 2, -0.5, p.z + CELL / 2);
    this.selectBox.visible = true;
    this.marker.visible = true;
  }

  private setHover(id: number | null, x: number, y: number) {
    if (id !== this.hovered) {
      this.hovered = id;
      if (id === null || !this.heights.has(id)) this.hoverBox.visible = false;
      else {
        const p = placeOf(id);
        this.hoverBox.position.set(p.x + CELL / 2, -0.5, p.z + CELL / 2);
        this.hoverBox.visible = true;
      }
      this.container.style.cursor = id === null ? (this.drag ? "grabbing" : "grab") : "pointer";
    }
    this.events.onHover(id, x, y);
  }

  private pick(clientX: number, clientY: number): number | null {
    if (!this.buildings) return null;
    const r = this.canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([this.buildings, ...this.signs.children.filter((s) => s.userData.kind === "parcel")], false);
    const hit = hits[0];
    if (!hit) return null;
    if (hit.object !== this.buildings) return (hit.object.userData.id as number) ?? null;
    const attr = (this.buildings.geometry as THREE.BufferGeometry).getAttribute("parcel") as THREE.BufferAttribute;
    const id = attr.getX(hit.face!.a);
    return id >= 0 ? id : null;
  }

  // ───────────────────────────────────────────── input ──

  private bind() {
    const el = this.canvas;
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onUp);
    el.addEventListener("pointerleave", this.onLeave);
    el.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private onDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.drag = { x: e.clientX, y: e.clientY, moved: false };
      this.goal = null;
      this.zoomGoal = null;
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      this.drag = null;
    }
  };

  private onMove = (e: PointerEvent) => {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2 && this.pinch !== null) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 0 && this.pinch > 0) this.zoomBy(d / this.pinch);
      this.pinch = d;
      return;
    }
    if (this.drag) {
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) > 4) this.drag.moved = true;
      if (this.drag.moved) {
        this.pan(dx, dy);
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
        this.events.onMove?.();
      }
      return;
    }
    if (e.pointerType === "mouse") this.setHover(this.pick(e.clientX, e.clientY), e.clientX, e.clientY);
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.drag && !this.drag.moved) {
      const id = this.pick(e.clientX, e.clientY);
      this.events.onSelect(id);
    }
    if (this.pointers.size === 0) this.drag = null;
    this.container.style.cursor = this.hovered === null ? "grab" : "pointer";
  };

  private onLeave = () => {
    if (!this.drag) this.setHover(null, 0, 0);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const k = Math.exp(-e.deltaY * 0.0012);
    this.zoomBy(k, e.clientX, e.clientY);
  };

  private zoomBy(k: number, cx?: number, cy?: number) {
    const before = this.zoom;
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * k));
    this.zoomGoal = null;
    if (cx !== undefined && cy !== undefined && this.zoom !== before) {
      // Keep the world point under the cursor still.
      const r = this.canvas.getBoundingClientRect();
      const px = cx - r.left - r.width / 2;
      const py = cy - r.top - r.height / 2;
      const scale = 1 / before - 1 / this.zoom;
      this.panWorld(px * scale, py * scale);
    }
    this.applyCamera();
    this.events.onMove?.();
  }

  /** Pixel delta → world delta along the ground. */
  private pan(dx: number, dy: number) {
    this.panWorld(-dx / this.zoom, -dy / this.zoom);
  }

  private panWorld(px: number, py: number) {
    const h = this.container.clientHeight || 1;
    const unitsPerPixel = (2 * BASE_VIEW) / h; // at zoom 1; callers already divided by zoom
    const right = new THREE.Vector3(1, 0, -1).normalize();
    const forward = new THREE.Vector3(-1, 0, -1).normalize();
    const elev = Math.asin(VIEW_DIR.y);
    this.target.addScaledVector(right, px * unitsPerPixel);
    this.target.addScaledVector(forward, (-py * unitsPerPixel) / Math.sin(elev));
    this.applyCamera();
  }

  // ───────────────────────────────────────────── frame ──

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const t = (performance.now() - this.start) / 1000;
    let dirty = false;
    if (this.goal) {
      this.target.lerp(this.goal, 0.12);
      if (this.target.distanceTo(this.goal) < 0.05) this.goal = null;
      dirty = true;
    }
    if (this.zoomGoal !== null) {
      this.zoom += (this.zoomGoal - this.zoom) * 0.12;
      if (Math.abs(this.zoomGoal - this.zoom) < 0.002) this.zoomGoal = null;
      dirty = true;
    }
    if (dirty) this.applyCamera();
    this.clouds.position.x = (t * 0.6) % (BLOCK * 2);
    if (this.marker.visible && this.selected !== null) {
      const c = centerOf(this.selected);
      const h = this.heights.get(this.selected) ?? 4;
      this.marker.position.set(c.x - 1.5, h + 2.5 + Math.sin(t * 3) * 0.5, c.z - 1);
      this.marker.rotation.y = t * 1.2;
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    window.removeEventListener("resize", this.resize);
    const el = this.canvas;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointercancel", this.onUp);
    el.removeEventListener("pointerleave", this.onLeave);
    el.removeEventListener("wheel", this.onWheel);
    this.ground?.geometry.dispose();
    this.buildings?.geometry.dispose();
    this.plaza.geometry.dispose();
    this.clouds.geometry.dispose();
    for (const tex of this.signTextures.values()) tex.dispose();
    this.atlas.dispose();
    this.material.dispose();
    this.renderer.dispose();
  }
}

export type { Sign };
