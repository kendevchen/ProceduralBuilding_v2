/**
 * The geometry that follows the building's size (KIT_SPEC.md §4.5): the roof
 * above the mansard slopes, and the party walls with their firewall gables.
 *
 * Roof: the footprint is inset by the slope's run at the top of the steep
 * slopes (brisis); from there the terrasson rises inward at its pitch to a flat
 * top no narrower than minFlat. Party edges carry no slope: the roof runs to
 * the wall there. Works for any convex footprint (pan coupé chamfers included).
 * Blender Z-up, UV0 in metres.
 */
import { BufferGeometry, Float32BufferAttribute } from "three";
import dims from "../blender/kit_dims.json";

export type V2 = [number, number];
/** what an edge of the footprint is: a facade with a mansard slope, or a party wall */
export type EdgeKind = "slope" | "party";

function leftNormal(a: V2, b: V2): V2 {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  return [-dy / l, dx / l];
}

/** inset a convex counterclockwise polygon, edge i (vertex i to i + 1) by d[i];
 *  null once an edge collapses */
export function insetEdges(poly: V2[], d: number[]): V2[] | null {
  const n = poly.length;
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n], p = poly[i], b = poly[(i + 1) % n];
    const n0 = leftNormal(a, p), n1 = leftNormal(p, b);
    const c0 = d[(i + n - 1) % n] + p[0] * n0[0] + p[1] * n0[1];
    const c1 = d[i] + p[0] * n1[0] + p[1] * n1[1];
    const det = n0[0] * n1[1] - n0[1] * n1[0];
    if (Math.abs(det) < 1e-9) out.push([p[0] + n1[0] * d[i], p[1] + n1[1] * d[i]]);
    else out.push([(c0 * n1[1] - n0[1] * c1) / det, (n0[0] * c1 - c0 * n1[0]) / det]);
  }
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], c = out[i], e = out[(i + 1) % n];
    if ((b[0] - a[0]) * (e[0] - c[0]) + (b[1] - a[1]) * (e[1] - c[1]) <= 1e-9) return null;
  }
  return out;
}

export function inset(poly: V2[], d: number): V2[] | null {
  return insetEdges(poly, poly.map(() => d));
}

export interface RoofShape {
  /** top of the steep slopes, at z1 */
  p1: V2[];
  /** the flat top, at z2 */
  p2: V2[];
  z1: number;
  z2: number;
  /** terrasson run */
  run: number;
}

export function roofShape(footprint: V2[], kinds: EdgeKind[], roofBase: number): RoofShape {
  const { rise, run } = dims.mansard;
  const t = dims.terrasson;
  const z1 = roofBase + rise;
  const by = (d: number) => kinds.map(k => (k === "party" ? 0 : d));
  const p1 = insetEdges(footprint, by(run));
  if (!p1) throw new Error("roof: footprint too small for the mansard slopes");
  // longest terrasson run that still leaves a flat top of minFlat
  let lo = 0;
  let hi = t.maxRun;
  if (insetEdges(p1, by(hi + t.minFlat / 2))) lo = hi;
  else for (let k = 0; k < 30; k++) {
    const m = (lo + hi) / 2;
    if (insetEdges(p1, by(m + t.minFlat / 2))) lo = m;
    else hi = m;
  }
  const p2 = insetEdges(p1, by(lo)) ?? p1;
  return { p1, p2, z1, z2: z1 + lo * Math.tan((t.pitchDeg * Math.PI) / 180), run: lo };
}

export interface RoofCap {
  geometry: BufferGeometry;
  /** height of the flat top */
  top: number;
}

class Tris {
  constructor(private holes: V2[][] = []) {}
  pos: number[] = [];
  uv: number[] = [];
  /** points are [x, y, z, u, v] */
  tri(a: number[], b: number[], c: number[]) {
    if (this.holes.length) {
      let fragments = [[a, b, c]];
      for (const hole of this.holes) fragments = fragments.flatMap(poly => subtractConvex(poly, hole));
      const plain = new Tris();
      for (const poly of fragments) for (let i = 1; i + 1 < poly.length; i++) plain.tri(poly[0], poly[i], poly[i + 1]);
      this.pos.push(...plain.pos); this.uv.push(...plain.uv); return;
    }
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.uv.push(a[3], a[4], b[3], b[4], c[3], c[4]);
  }
  quad(a: number[], b: number[], c: number[], d: number[]) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("uv", new Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

/** Clip each roof patch independently; intersections interpolate height and UV.
 * Also supports a well crossing a terrasson seam without bridging the opening. */
export function subtractConvex(poly: number[][], hole: V2[]): number[][][] {
  const fragments: number[][][] = [];
  let remainder = poly;
  for (let i = 0; i < hole.length && remainder.length >= 3; i++) {
    const a = hole[i], b = hole[(i + 1) % hole.length];
    const side = (p: number[]) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const cut = (inside: boolean) => {
      const out: number[][] = [];
      for (let j = 0; j < remainder.length; j++) {
        const p = remainder[j], q = remainder[(j + 1) % remainder.length], sp = side(p), sq = side(q);
        const pin = inside ? sp >= 0 : sp <= 0, qin = inside ? sq >= 0 : sq <= 0;
        if (pin) out.push(p);
        if (pin !== qin) { const t = sp / (sp - sq); out.push(p.map((v, k) => v + t * (q[k] - v))); }
      }
      return out;
    };
    const outside = cut(false); if (outside.length >= 3) fragments.push(outside);
    remainder = cut(true);
  }
  return fragments;
}
/** A court wall line whose mansard rises away from the court (`inward` points into
 *  the building); `covered` are the along-ranges carried by kit mansard bays. */
export interface InnerSlope { start: V2; along: V2; inward: V2; covered: [number, number][] }

/** The court facades of a courtyard building carry mansards like the street. */
export function courtSlopes(topology: import('./buildingTopology').BuildingTopology): InnerSlope[] {
  if (!topology.courtyardLayout) return [];
  return topology.facades.slice(4).map(f => ({ start: f.start, along: f.along, inward: f.inward,
    covered: f.bays.map(q => [q.x - dims.bay / 2, q.x + dims.bay / 2] as [number, number]) }));
}

/** the mansard profile at distance d from its wall line, capped by the flat top */
function profile(shape: RoofShape, roofBase: number, d: number): number {
  const { rise, run } = dims.mansard;
  const tan = Math.tan((dims.terrasson.pitchDeg * Math.PI) / 180);
  return d <= 0 ? roofBase : d <= run ? roofBase + (rise * d) / run : Math.min(shape.z2, shape.z1 + (d - run) * tan);
}

/** distance from the court into the building: the largest over its walls, so
 *  the slopes of two walls meet in a valley at each court corner */
const courtDistance = (inner: InnerSlope[], q: V2) =>
  Math.max(...inner.map(e => (q[0] - e.start[0]) * e.inward[0] + (q[1] - e.start[1]) * e.inward[1]));

/** convex polygon clipped to c + g·q >= 0 */
function clipHalf(poly: V2[], gx: number, gy: number, c: number): V2[] {
  const out: V2[] = [];
  const f = (q: V2) => c + gx * q[0] + gy * q[1];
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length], fp = f(p), fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
  });
  return out;
}

/** One roof plane z = z0 + k·((q - a)·n). `draw`: hidden under kit slopes, drawn,
 *  or drawn only outside the given along-ranges (the court valleys). */
interface Plane { a: V2; n: V2; k: number; z0: number; along: V2 | null; v0: number; draw: boolean | [number, number][] }

/** The roof as the lower envelope of every slope plane, cut into the court's
 *  wedges (one per court wall) where the court profile is a single plane. */
function courtRoofCap(footprint: V2[], kinds: EdgeKind[], roofBase: number, holes: V2[][], inner: InnerSlope[]): RoofCap {
  const shape = roofShape(footprint, kinds, roofBase);
  const { rise, run } = dims.mansard;
  const tan = Math.tan((dims.terrasson.pitchDeg * Math.PI) / 180);
  const steep = rise / run;
  const slopes = (a: V2, n: V2, along: V2, brisis: Plane["draw"]): Plane[] => [
    { a, n, k: steep, z0: roofBase, along, v0: 0, draw: brisis },
    { a, n, k: tan, z0: shape.z1 - run * tan, along, v0: -run, draw: true },
  ];
  const outer: Plane[] = [{ a: [0, 0], n: [1, 0], k: 0, z0: shape.z2, along: null, v0: 0, draw: true }];
  footprint.forEach((a, i) => {
    if (kinds[i] === "party") return;
    const b = footprint[(i + 1) % footprint.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    outer.push(...slopes(a, leftNormal(a, b), [(b[0] - a[0]) / l, (b[1] - a[1]) / l], false));
  });
  const lin = (p: Plane): [number, number, number] => [p.k * p.n[0], p.k * p.n[1], p.z0 - p.k * (p.a[0] * p.n[0] + p.a[1] * p.n[1])];
  const out = new Tris(holes);
  const draw = (p: Plane, poly: V2[]) => {
    if (poly.length < 3) return;
    const sec = Math.sqrt(1 + p.k * p.k);
    const pt = (q: V2) => {
      const z = p.z0 + p.k * ((q[0] - p.a[0]) * p.n[0] + (q[1] - p.a[1]) * p.n[1]);
      if (!p.along) return [q[0], q[1], z, q[0], q[1]];
      const d = (q[0] - p.a[0]) * p.n[0] + (q[1] - p.a[1]) * p.n[1];
      return [q[0], q[1], z, (q[0] - p.a[0]) * p.along[0] + (q[1] - p.a[1]) * p.along[1], (d + p.v0) * sec];
    };
    for (let i = 1; i + 1 < poly.length; i++) out.tri(pt(poly[0]), pt(poly[i]), pt(poly[i + 1]));
  };
  inner.forEach((e, ei) => {
    // the wedge where this wall is the court's nearest (largest distance)
    let wedge: V2[] = footprint;
    inner.forEach((f, fi) => {
      if (fi === ei) return;
      const gx = e.inward[0] - f.inward[0], gy = e.inward[1] - f.inward[1];
      const c = -(e.start[0] * e.inward[0] + e.start[1] * e.inward[1]) + (f.start[0] * f.inward[0] + f.start[1] * f.inward[1]);
      if (Math.hypot(gx, gy) < 1e-9) { if (fi < ei) wedge = []; return; }
      wedge = clipHalf(wedge, gx, gy, c);
    });
    if (wedge.length < 3) return;
    // gaps between the kit bays along this wall: the brisis is drawn there
    const covered = [...e.covered].sort((p, q) => p[0] - q[0]), gaps: [number, number][] = [];
    let from = -Infinity;
    for (const [lo, hi] of covered) { if (lo > from + 1e-6) gaps.push([from, lo]); from = Math.max(from, hi); }
    gaps.push([from, Infinity]);
    const planes = [...outer, ...slopes(e.start, e.inward, e.along, gaps)];
    planes.forEach((p, i) => {
      if (p.draw === false) return;
      const [ax, ay, ac] = lin(p);
      let cell = wedge;
      for (let j = 0; j < planes.length && cell.length >= 3; j++) {
        if (j === i) continue;
        const [bx, by, bc] = lin(planes[j]);
        if (Math.hypot(bx - ax, by - ay) < 1e-9) { if (bc < ac - 1e-9 || (Math.abs(bc - ac) <= 1e-9 && j < i)) cell = []; continue; }
        cell = clipHalf(cell, bx - ax, by - ay, bc - ac);
      }
      if (cell.length < 3) return;
      if (p.draw === true) { draw(p, cell); return; }
      for (const [lo, hi] of p.draw) {
        const d0 = p.a[0] * e.along[0] + p.a[1] * e.along[1];
        let part = cell;
        if (Number.isFinite(lo)) part = clipHalf(part, e.along[0], e.along[1], -d0 - lo);
        if (Number.isFinite(hi)) part = clipHalf(part, -e.along[0], -e.along[1], d0 + hi);
        draw(p, part);
      }
    });
  });
  return { geometry: out.geometry(), top: shape.z2 };
}

export function roofCap(footprint: V2[], kinds: EdgeKind[], roofBase: number, holes: V2[][] = [], inner: InnerSlope[] = []): RoofCap {
  if (inner.length) return courtRoofCap(footprint, kinds, roofBase, holes, inner);
  const { p1, p2, z1, z2, run: tr } = roofShape(footprint, kinds, roofBase);
  const slope = tr / Math.cos((dims.terrasson.pitchDeg * Math.PI) / 180);
  const out = new Tris(holes);
  const n = p1.length;
  for (let i = 0; i < n; i++) {
    if (kinds[i] === "party") continue;
    const a = p1[i], b = p1[(i + 1) % n], c = p2[(i + 1) % n], d = p2[i];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const el = Math.hypot(ex, ey);
    const u = (q: V2) => ((q[0] - a[0]) * ex + (q[1] - a[1]) * ey) / el;
    out.quad([a[0], a[1], z1, 0, 0], [b[0], b[1], z1, el, 0], [c[0], c[1], z2, u(c), slope], [d[0], d[1], z2, u(d), slope]);
  }
  const v = (q: V2) => [q[0], q[1], z2, q[0], q[1]];
  for (let i = 1; i + 1 < p2.length; i++) out.tri(v(p2[0]), v(p2[i]), v(p2[i + 1]));
  return { geometry: out.geometry(), top: z2 };
}

const FIREWALL = 0.3; // gable rise above the roof line, and its thickness

/** height of the roof surface at a point of the footprint (top of the cornice
 *  at the facades, the steep slope, the terrasson, the flat top) */
export function roofHeight(footprint: V2[], kinds: EdgeKind[], shape: RoofShape, roofBase: number, q: V2, inner: InnerSlope[] = []): number {
  const { rise, run } = dims.mansard;
  const tan = Math.tan((dims.terrasson.pitchDeg * Math.PI) / 180);
  let h = shape.z2;
  const n = footprint.length;
  for (let i = 0; i < n; i++) {
    if (kinds[i] === "party") continue;
    const a = footprint[i];
    const nn = leftNormal(a, footprint[(i + 1) % n]);
    const d = (q[0] - a[0]) * nn[0] + (q[1] - a[1]) * nn[1];
    const he = d <= 0 ? roofBase : d <= run ? roofBase + (rise * d) / run : shape.z1 + (d - run) * tan;
    h = Math.min(h, he);
  }
  return inner.length ? Math.min(h, profile(shape, roofBase, courtDistance(inner, q))) : h;
}

export interface PartyWalls {
  geometry: BufferGeometry;
  /** per party edge: its ends and where the flat top runs along it (for chimneys) */
  edges: { a: V2; b: V2; flat: [number, number] | null }[];
}

/** the blind party walls: from the ground up to the roof line plus a firewall,
 *  with a coping and the firewall's inner face above the roof */
export function partyWalls(footprint: V2[], kinds: EdgeKind[], roofBase: number, inner: InnerSlope[] = []): PartyWalls {
  const shape = roofShape(footprint, kinds, roofBase);
  const out = new Tris();
  const edges: PartyWalls["edges"] = [];
  const n = footprint.length;
  for (let i = 0; i < n; i++) {
    if (kinds[i] !== "party") continue;
    const a = footprint[i], b = footprint[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dir: V2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const inn = leftNormal(a, b);
    // sample the roof line along the wall, keeping only the bends
    const raw: [number, number][] = [];
    const steps = Math.max(2, Math.ceil(len / 0.05));
    for (let k = 0; k <= steps; k++) {
      const s = (len * k) / steps;
      raw.push([s, roofHeight(footprint, kinds, shape, roofBase, [a[0] + dir[0] * s, a[1] + dir[1] * s], inner)]);
    }
    const line = raw.filter((p, k) => k === 0 || k === raw.length - 1 ||
      Math.abs((raw[k + 1][1] - p[1]) / (raw[k + 1][0] - p[0]) - (p[1] - raw[k - 1][1]) / (p[0] - raw[k - 1][0])) > 1e-4);
    const at = (s: number, off: number, z: number, u: number, v: number) =>
      [a[0] + dir[0] * s + inn[0] * off, a[1] + dir[1] * s + inn[1] * off, z, u, v];
    for (let k = 0; k + 1 < line.length; k++) {
      const [s0, h0] = line[k], [s1, h1] = line[k + 1];
      const t0 = h0 + FIREWALL, t1 = h1 + FIREWALL;
      out.quad(at(s0, 0, 0, s0, 0), at(s1, 0, 0, s1, 0), at(s1, 0, t1, s1, t1), at(s0, 0, t0, s0, t0)); // outer face
      out.quad(at(s0, 0, t0, s0, 0), at(s1, 0, t1, s1, 0), at(s1, FIREWALL, t1, s1, FIREWALL), at(s0, FIREWALL, t0, s0, FIREWALL)); // coping
      out.quad(at(s1, FIREWALL, h1, s1, h1), at(s0, FIREWALL, h0, s0, h0), at(s0, FIREWALL, t0, s0, t0), at(s1, FIREWALL, t1, s1, t1)); // inner face
    }
    const flatS = line.filter(([, h]) => Math.abs(h - shape.z2) < 1e-6).map(([s]) => s);
    edges.push({ a, b, flat: flatS.length ? [Math.min(...flatS), Math.max(...flatS)] : null });
  }
  return { geometry: out.geometry(), edges };
}

/** One shared roof region: convex exterior envelope, clipped by sky volumes.
 * Court walls are vertical, so their half-planes never lower another wing's attic. */
export function buildingRoof(b: import('./generator').Building) {
  return { footprint: b.topology.roofEnvelope?.footprint ?? b.footprint,
    edgeKinds: b.topology.roofEnvelope?.edgeKinds ?? b.edgeKinds,
    holes: b.topology.voids.filter(v => v.kind === 'lightwell' || v.kind === 'courtyard').map(v => v.polygon!),
    inner: courtSlopes(b.topology) };
}
export function buildingRoofCap(b: import('./generator').Building): RoofCap {
  const r = buildingRoof(b); return roofCap(r.footprint, r.edgeKinds, b.roofBase, r.holes, r.inner);
}
/** Court-wall strips no kit bay covers (the U's open ends), up to the roof line.
 * Exterior geometry, also present when the interior is hidden. */
export function courtyardClosure(b: import('./generator').Building): BufferGeometry {
  const out = new Tris(), r = buildingRoof(b), shape = roofShape(r.footprint, r.edgeKinds, b.roofBase), T = dims.wall;
  if (!b.topology.courtyardLayout) return out.geometry();
  for (const face of b.topology.facades.slice(4)) {
    const at = (s: number, z: number, off = 0) => [face.start[0] + face.along[0] * s + face.inward[0] * off,
      face.start[1] + face.along[1] * s + face.inward[1] * off, z, s, z];
    const top = (s: number) => { const q = at(s, 0); return roofHeight(r.footprint, r.edgeKinds, shape, b.roofBase, [q[0], q[1]], r.inner); };
    const wall = (lo: number, hi: number) => {
      if (hi - lo < 1e-6) return;
      const ha = top(lo), hc = top(hi);
      out.quad(at(lo, 0), at(hi, 0), at(hi, hc), at(lo, ha));
      out.quad(at(lo, ha), at(hi, hc), at(hi, hc, T), at(lo, ha, T));
    };
    let end = 0;
    for (const bay of face.bays) { wall(end, bay.x - dims.bay / 2); end = bay.x + dims.bay / 2; }
    wall(end, face.length);
  }
  return out.geometry();
}
