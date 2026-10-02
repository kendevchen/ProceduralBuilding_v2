/**
 * A simple sidewalk and street trees around the building, ported from v1's
 * streetlife.ts (its water tanks and rooftop sign stay behind): a paved slab
 * of grey granite slabs with a granite kerb and a cobbled gutter along the street
 * sides, and procedural trees (faceted canopies on forked trunks) in cast-iron
 * grilles set in cobbles.
 * Everything is drawn here, no textures from files.
 *
 * Built in WORLD space (Y-up): the building is centred on the origin, its front
 * (the bay 0 side of the footprint) at +z. v1 worked in bay units; the sizes
 * here are metres from kit_dims.json (street). A placeholder until the street
 * layout is rewritten: the ground under the building is paved too, and only
 * street facades get a sidewalk (party walls and court sides do not).
 */
import {
  BoxGeometry, BufferGeometry, CanvasTexture, Color, CylinderGeometry, ExtrudeGeometry, Float32BufferAttribute, Group,
  IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Path, Quaternion,
  RepeatWrapping, Shape, SRGBColorSpace, Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import dims from "../blender/kit_dims.json";
import type { Building } from "./generator";
import { PURPOSE, rand } from "./rng";
import { type V2, insetEdges } from "./roof";

const D = dims.street;
const BAY = dims.bay;

export interface StreetParams {
  sidewalk: boolean;
  /** sidewalk depth from the facade, metres */
  width: number;
  /** trees along each street facade (0: none) */
  count: number;
}

export function defaultStreet(): StreetParams {
  return { sidewalk: true, width: D.width, count: D.tree.count };
}

// ---------------------------------------------------------------------------
// textures (canvas, drawn here)
// ---------------------------------------------------------------------------

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function repeatTexture(c: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** shade of a grey granite, slightly cool, from a 0..1 value */
const granite = (v: number, lo: number, hi: number) => {
  const g = Math.round(lo + (hi - lo) * v);
  return `rgb(${g - 2}, ${g}, ${g + 3})`;
};

/** grey granite slabs 1.0 x 0.5 m laid in running bond, each its own shade and speckle; a texture is 2 x 2 m */
function pavingTexture(): CanvasTexture {
  const size = 512, unit = size / 2;
  const [c, g] = canvas(size, size);
  g.fillStyle = "#5e6063"; // joint
  g.fillRect(0, 0, size, size);
  const rowH = unit * 0.5, len = unit;
  for (let r = 0; r < 4; r++) {
    for (let k = -1; k < 3; k++) {
      const x = k * len + (r % 2) * (len / 2), y = r * rowH;
      g.fillStyle = granite(rand(k + 4, r, 31), 150, 172);
      g.fillRect(x + 1.5, y + 1.5, len - 3, rowH - 3);
    }
  }
  for (let i = 0; i < 2600; i++) { // speckle
    g.fillStyle = rand(i, 41) < 0.5 ? "rgba(255,255,255,0.18)" : "rgba(40,42,46,0.22)";
    g.fillRect(rand(i, 42) * size, rand(i, 43) * size, 1.4, 1.4);
  }
  const t = repeatTexture(c);
  t.repeat.set(1 / 2, 1 / 2);
  return t;
}

/** cobbles (pavés) 0.1 m in staggered rows; a texture is 0.8 m */
function cobbleTexture(): CanvasTexture {
  const size = 256, n = 8, cell = size / n;
  const [c, g] = canvas(size, size);
  g.fillStyle = "#4b4d50";
  g.fillRect(0, 0, size, size);
  for (let r = 0; r < n; r++) {
    for (let k = -1; k < n; k++) {
      const x = k * cell + (r % 2) * (cell / 2) + 1, y = r * cell + 1;
      g.fillStyle = granite(rand(k + 3, r, 51), 104, 146);
      g.beginPath();
      g.roundRect(x, y, cell - 2, cell - 2, 5);
      g.fill();
    }
  }
  const t = repeatTexture(c);
  t.repeat.set(1 / 0.8, 1 / 0.8);
  return t;
}

/** cast-iron tree grille: concentric rings of slots round a central hole; a texture is 1.2 m, centred */
function grilleTexture(): CanvasTexture {
  const size = 512, mid = size / 2, m = size / 1.2;
  const [c, g] = canvas(size, size);
  g.fillStyle = "#26282a";
  g.fillRect(0, 0, size, size);
  g.strokeStyle = "#0c0d0e";
  g.lineCap = "round";
  g.lineWidth = 0.035 * m;
  for (const [r, n] of [[0.2, 8], [0.31, 12], [0.42, 16]] as const) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      g.beginPath();
      g.arc(mid, mid, r * m, a, a + (Math.PI * 2 * 0.62) / n);
      g.stroke();
    }
  }
  g.fillStyle = "#0c0d0e";
  g.beginPath();
  g.arc(mid, mid, 0.09 * m, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#3a3d40"; // rim
  g.lineWidth = 0.02 * m;
  g.beginPath();
  g.arc(mid, mid, 0.53 * m, 0, Math.PI * 2);
  g.stroke();
  const t = repeatTexture(c);
  t.repeat.set(1 / 1.2, 1 / 1.2);
  t.offset.set(0.5, 0.5);
  return t;
}

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------

/**
 * The building's outline pushed out by dS on the street edges and dO on the
 * others (negative: pulled in), the corners between two street edges rounded
 * with radius rho. Blender xy, counterclockwise.
 */
function ring(F: V2[], street: boolean[], dS: number, dO: number, rho: number): V2[] {
  const n = F.length;
  const P = insetEdges(F, street.map(s => -(s ? dS : dO)));
  if (!P) return F;
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = P[(i + n - 1) % n], V = P[i], next = P[(i + 1) % n];
    const u0: V2 = [V[0] - prev[0], V[1] - prev[1]], u1: V2 = [next[0] - V[0], next[1] - V[1]];
    const l0 = Math.hypot(...u0), l1 = Math.hypot(...u1);
    const cross = (u0[0] * u1[1] - u0[1] * u1[0]) / (l0 * l1);
    if (rho <= 0.002 || !street[(i + n - 1) % n] || !street[i] || cross < 1e-6) {
      out.push(V);
      continue;
    }
    // a fillet of radius rho: a quadratic curve between the two tangent points
    const phi = Math.atan2(cross, (u0[0] * u1[0] + u0[1] * u1[1]) / (l0 * l1));
    const t = Math.min(rho * Math.tan(phi / 2), l0 * 0.45, l1 * 0.45);
    const a: V2 = [V[0] - (u0[0] / l0) * t, V[1] - (u0[1] / l0) * t];
    const b: V2 = [V[0] + (u1[0] / l1) * t, V[1] + (u1[1] / l1) * t];
    const steps = 6;
    for (let k = 0; k <= steps; k++) {
      const f = k / steps;
      out.push([(1 - f) * (1 - f) * a[0] + 2 * f * (1 - f) * V[0] + f * f * b[0], (1 - f) * (1 - f) * a[1] + 2 * f * (1 - f) * V[1] + f * f * b[1]]);
    }
  }
  return out;
}

/** a flat slab (or a ring, with a hole) on y in [y0, y0 + depth] from outlines in Blender xy, centred on the
 *  building; the cap UVs are metres */
function slab(outer: V2[], c: V2, y0: number, depth: number, hole?: V2[]): BufferGeometry {
  // the extrusion's rotateX(-90 deg) sends the shape's y to world -z, which is Blender y (centred): use it as is
  const path = <T extends Path>(h: T, pts: V2[]): T => {
    pts.forEach((p, i) => (i ? h.lineTo(p[0] - c[0], p[1] - c[1]) : h.moveTo(p[0] - c[0], p[1] - c[1])));
    h.closePath();
    return h;
  };
  const shape = path(new Shape(), outer);
  if (hole) shape.holes.push(path(new Path(), hole));
  const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

/** a flat disc (or a ring, with a hole) of radius r on y in [0, depth]; the cap UVs are metres from its centre */
function disc(r: number, hole: number, depth: number): BufferGeometry {
  const shape = new Shape();
  shape.absarc(0, 0, r, 0, Math.PI * 2, false);
  if (hole > 0) {
    const h = new Path();
    h.absarc(0, 0, hole, 0, Math.PI * 2, true);
    shape.holes.push(h);
  }
  const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 });
  g.rotateX(-Math.PI / 2);
  return g;
}

const _q = new Quaternion();
const _m = new Matrix4();
const _s = new Vector3();

/** thin box between two points (limbs) */
function strut(a: Vector3, b: Vector3, t: number): BufferGeometry {
  const d = new Vector3().subVectors(b, a);
  const g = new BoxGeometry(t, d.length(), t);
  _q.setFromUnitVectors(new Vector3(0, 1, 0), d.normalize());
  _m.compose(new Vector3().addVectors(a, b).multiplyScalar(0.5), _q, _s.setScalar(1));
  return g.applyMatrix4(_m);
}

/** one stylised tree 1.9 m tall: faceted canopy blobs with per-face green variation */
function makeTree(v: number): { canopy: BufferGeometry; trunk: BufferGeometry } {
  // many small clumps on a flattened, irregular dome (golden-angle spread) instead of
  // a few big spheres: reads as foliage rather than a lollipop
  const blobs: BufferGeometry[] = [];
  const count = 13 + (v % 3) * 2;
  for (let b = 0; b < count; b++) {
    const u = (b + 0.5) / count;
    const a = b * 2.39996 + rand(b, 60 + v) * 0.8;
    const d = Math.sqrt(u) * (0.42 + 0.1 * rand(b, 70 + v));
    const y = 1.35 + 0.5 * (1 - u) * (0.7 + 0.6 * rand(b, 80 + v));
    const g = new IcosahedronGeometry(0.15 + 0.1 * rand(b, 50 + v), 1);
    g.scale(1, 0.8, 1);
    g.translate(Math.cos(a) * d, y, Math.sin(a) * d);
    blobs.push(g);
  }
  const canopy = mergeGeometries(blobs)!;
  blobs.forEach(g => g.dispose());

  // jitter vertices (keyed by position, so shared corners stay welded) and colour
  // each triangle: a leafy, faceted read
  const pos = canopy.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const key = (Math.round(pos.getX(i) * 997) * 73856093) ^ (Math.round(pos.getY(i) * 997) * 19349663) ^
      (Math.round(pos.getZ(i) * 997) * 83492791);
    pos.setXYZ(i,
      pos.getX(i) + (rand(key, 1) - 0.5) * 0.07,
      pos.getY(i) + (rand(key, 2) - 0.5) * 0.07,
      pos.getZ(i) + (rand(key, 3) - 0.5) * 0.07);
  }
  canopy.computeVertexNormals();
  const colors = new Float32Array(pos.count * 3);
  const dark = new Color(0x2c5220);
  const light = new Color(0x77a33c);
  const c = new Color();
  for (let f = 0; f < pos.count; f += 3) {
    const y = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
    const t = Math.min(1, Math.max(0, (y - 1.2) / 0.7 + (rand(f, 90 + v) - 0.5) * 0.8));
    c.copy(dark).lerp(light, t);
    for (let k = 0; k < 3; k++) c.toArray(colors, (f + k) * 3);
  }
  canopy.setAttribute("color", new Float32BufferAttribute(colors, 3));

  // trunk and three limbs forking into the canopy
  const limbs: BufferGeometry[] = [];
  const stem = new CylinderGeometry(0.032, 0.055, 1.25, 7);
  stem.translate(0, 0.625, 0);
  limbs.push(stem);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + rand(k, 100 + v) * 1.2;
    const tip = new Vector3(Math.cos(a) * 0.3, 1.6 + 0.15 * rand(k, 110 + v), Math.sin(a) * 0.3);
    limbs.push(strut(new Vector3(0, 1.05, 0), tip, 0.03));
  }
  const trunk = mergeGeometries(limbs)!;
  limbs.forEach(g => g.dispose());
  return { canopy, trunk };
}

// ---------------------------------------------------------------------------

export class StreetLife {
  readonly group = new Group();
  readonly params = defaultStreet();

  private mats = {
    paving: new MeshStandardMaterial({ name: "paving", map: pavingTexture(), roughness: 0.85 }),
    curb: new MeshStandardMaterial({ name: "curb", color: 0xa3a5a4, roughness: 0.8 }),
    cobbles: new MeshStandardMaterial({ name: "cobbles", map: cobbleTexture(), roughness: 0.9 }),
    grate: new MeshStandardMaterial({ name: "tree grille", map: grilleTexture(), roughness: 0.6, metalness: 0.5 }),
    trunk: new MeshStandardMaterial({ name: "trunk", color: 0x5b4632, roughness: 0.95 }),
    leaves: new MeshStandardMaterial({ name: "leaves", vertexColors: true, roughness: 0.85, flatShading: true }),
  };
  private trees = [0, 1, 2].map(makeTree);
  /** the iron grille of a tree pit, and the cobbles round it */
  private grille = disc(D.tree.grate, 0, 0.014);
  private ring = disc(D.tree.grate + D.tree.ring, D.tree.grate - 0.01, 0.006);

  constructor() {
    for (const t of this.trees) t.canopy.userData.shared = t.trunk.userData.shared = true;
    this.grille.userData.shared = this.ring.userData.shared = true;
  }

  /** rebuild the sidewalk and the trees for a building */
  rebuild(b: Building, seed: number): void {
    this.clear();
    const s = this.params;
    // which footprint edges face a street: the street facades and the pan coupés between them
    const edgeStreet: boolean[] = [];
    b.sides.forEach((side, i) => {
      if (side.left === "pc") edgeStreet.push(true);
      edgeStreet.push(side.kind === "street");
    });
    const w = s.width;
    if (s.sidewalk) this.buildSidewalk(b, edgeStreet);
    if (s.count > 0) this.buildTrees(b, edgeStreet, seed, w);
  }

  private clear(): void {
    for (const o of [...this.group.children]) {
      const mesh = o as Mesh;
      if (!mesh.geometry.userData.shared) mesh.geometry.dispose();
      if ((mesh as InstancedMesh).isInstancedMesh) (mesh as InstancedMesh).dispose();
      this.group.remove(o);
    }
  }

  private add(geom: BufferGeometry, mat: MeshStandardMaterial, name: string, shadows = true): Mesh {
    const m = new Mesh(geom, mat);
    m.name = name;
    m.castShadow = shadows;
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  private buildSidewalk(b: Building, street: boolean[]): void {
    const F = b.footprint, w = this.params.width, c: V2 = [b.width / 2, b.length / 2];
    const curb = D.curb, g = D.gutter;
    const r = Math.min(1.5, w * 0.4); // radius of the kerb's rounded corners
    // paving inside the kerb; the kerb band; the cobbled gutter outside it. Where the building
    // meets a neighbour or a court there is no street: those bands lie under the building.
    const paving = ring(F, street, w - curb, -curb, r - curb);
    this.add(slab(paving, c, 0, D.top), this.mats.paving, "sidewalk", false);
    this.add(slab(ring(F, street, w, 0, r), c, 0, D.top + D.curbRise, paving), this.mats.curb, "curb", false);
    this.add(slab(ring(F, street, w + g, 0, r + g), c, 0, 0.02, ring(F, street, w, -g, r)), this.mats.cobbles, "gutter", false);
  }

  private buildTrees(b: Building, street: boolean[], seed: number, w: number): void {
    const T = D.tree;
    const off = w * T.offset;
    const n = this.params.count;
    // world (x, z) of a point in a frame: Blender (x, y) -> world (x - W/2, L/2 - y)
    const toWorld = (frame: Matrix4, sx: number, sy: number) => {
      const p = new Vector3(sx, sy, 0).applyMatrix4(frame);
      return { x: p.x - b.width / 2, z: b.length / 2 - p.y };
    };
    const spots: { x: number; z: number }[] = [];
    b.sides.forEach(side => {
      if (side.kind !== "street") return;
      const door = side === b.sides[0] && b.door >= 0 ? side.x0 + BAY * (b.door + 0.5) : null;
      // n trunks spread over the facade, clear of the corners and the front door
      const lo = side.x0 + 1.0, hi = side.x0 + BAY * side.bays.length - 1.0;
      const xs: number[] = [];
      for (let k = 0; k < n; k++) {
        let x = lo + ((hi - lo) * (k + 0.5)) / n;
        if (door !== null && Math.abs(x - door) < T.clear) x = door + (x >= door ? 1 : -1) * T.clear;
        if (x < lo || x > hi || xs.some(o => Math.abs(o - x) < 2.4)) continue;
        xs.push(x);
      }
      for (const x of xs) spots.push(toWorld(side.frame, x, -off));
      // the pan coupé's diagonal gets one
      if (side.diag && n > 0) spots.push(toWorld(side.diag.frame, 0, -off));
    });
    if (!spots.length) return;

    const byVariant = this.trees.map(() => [] as Matrix4[]);
    const grates: Matrix4[] = [];
    const top = this.params.sidewalk ? D.top : 0;
    spots.forEach((sp, k) => {
      const v = Math.floor(rand(seed, k, PURPOSE.tree) * this.trees.length);
      _q.setFromAxisAngle(new Vector3(0, 1, 0), rand(seed, k, PURPOSE.treeTurn) * Math.PI * 2);
      const scale = T.scale * (0.85 + 0.3 * rand(seed, k, PURPOSE.treeSize));
      byVariant[v].push(new Matrix4().compose(new Vector3(sp.x, top, sp.z), _q, new Vector3(scale, scale, scale)));
      grates.push(new Matrix4().makeTranslation(sp.x, top, sp.z));
    });

    const inst = (geom: BufferGeometry, mat: MeshStandardMaterial, list: Matrix4[], name: string, cast: boolean) => {
      if (!list.length) return;
      const im = new InstancedMesh(geom, mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.name = name;
      im.castShadow = cast;
      im.receiveShadow = true;
      this.group.add(im);
    };
    this.trees.forEach((t, v) => {
      inst(t.canopy, this.mats.leaves, byVariant[v], "tree canopy", true);
      inst(t.trunk, this.mats.trunk, byVariant[v], "tree trunk", true);
    });
    if (this.params.sidewalk) {
      inst(this.ring, this.mats.cobbles, grates, "tree pit cobbles", false);
      inst(this.grille, this.mats.grate, grates, "tree grille", false);
    }
  }
}
