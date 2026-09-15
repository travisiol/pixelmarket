import * as THREE from "three";
import { paintAtlas } from "./atlas";
import { buildParcel, exampleFloors } from "./buildings";
import { centerOf } from "./layout";
import { GeoSink } from "./voxel";

/**
 * One PNG per tier, rendered once on a shared offscreen WebGL canvas —
 * for the legend, the how-it-works page and the launch preview. Same
 * voxels, same atlas, same camera angle as the city.
 */
let cache: Map<string, string> | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let material: THREE.MeshBasicMaterial | null = null;

const VIEW_DIR = new THREE.Vector3(1, 0.9, 1).normalize();

function setup() {
  if (renderer && material) return { renderer, material };
  const canvas = document.createElement("canvas");
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const atlasCanvas = document.createElement("canvas");
  paintAtlas(atlasCanvas);
  const atlas = new THREE.CanvasTexture(atlasCanvas);
  atlas.magFilter = THREE.NearestFilter;
  atlas.minFilter = THREE.NearestFilter;
  atlas.generateMipmaps = false;
  atlas.colorSpace = THREE.SRGBColorSpace;
  material = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true });
  return { renderer, material };
}

/** A building of `tier` with `floors` (default: the tier's example), as a data URL. */
export function thumbnail(tier: number, floors = exampleFloors(tier), width = 180, height = 220): string {
  const key = `${tier}:${floors}:${width}x${height}`;
  cache ??= new Map();
  const hit = cache.get(key);
  if (hit) return hit;
  const { renderer, material } = setup();
  const built = buildParcel(0, tier, floors, 0);
  const sink = new GeoSink();
  sink.addVoxels(built.voxels, 0, { cullBottomAt: -1 });
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(sink.toGeometry(), material);
  scene.add(mesh);
  const c = centerOf(0);
  const h = built.height;
  // Frame the building: tall ones get a taller view.
  const viewH = Math.max(9, h * 0.62 + 4);
  const viewW = (viewH * width) / height;
  const camera = new THREE.OrthographicCamera(-viewW, viewW, viewH, -viewH, -400, 800);
  const target = new THREE.Vector3(c.x, Math.max(2, h * 0.45 - 1), c.z);
  camera.position.copy(target).addScaledVector(VIEW_DIR, 200);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/png");
  mesh.geometry.dispose();
  cache.set(key, url);
  return url;
}
