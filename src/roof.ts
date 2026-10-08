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
export function roofCap(footprint: V2[], kinds: EdgeKind[], roofBase: number, holes: V2[][] = []): RoofCap {
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
export function roofHeight(footprint: V2[], kinds: EdgeKind[], shape: RoofShape, roofBase: number, q: V2): number {
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
  return h;
}

export interface PartyWalls {
  geometry: BufferGeometry;
  /** per party edge: its ends and where the flat top runs along it (for chimneys) */
  edges: { a: V2; b: V2; flat: [number, number] | null }[];
}

/** the blind party walls: from the ground up to the roof line plus a firewall,
 *  with a coping and the firewall's inner face above the roof */
export function partyWalls(footprint: V2[], kinds: EdgeKind[], roofBase: number): PartyWalls {
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
      raw.push([s, roofHeight(footprint, kinds, shape, roofBase, [a[0] + dir[0] * s, a[1] + dir[1] * s])]);
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
    holes: b.topology.voids.filter(v => v.kind === 'lightwell' || v.kind === 'courtyard').map(v => v.polygon!) };
}
export function buildingRoofCap(b: import('./generator').Building): RoofCap {
  const r = buildingRoof(b); return roofCap(r.footprint, r.edgeKinds, b.roofBase, r.holes);
}
/** Non-windowed end strips and the variable-height attic coping of court facades.
 * These are exterior geometry, also present when the interior is hidden. */
export function courtyardClosure(b: import('./generator').Building): BufferGeometry {
  const out = new Tris(), r = buildingRoof(b), shape = roofShape(r.footprint, r.edgeKinds, b.roofBase), T = dims.wall;
  if (!b.topology.courtyardLayout) return out.geometry();
  for (const face of b.topology.facades.slice(4)) {
    const side = b.innerSides![face.side - 4];
    const at = (s: number, z: number, off = 0) => [face.start[0] + face.along[0] * s + face.inward[0] * off,
      face.start[1] + face.along[1] * s + face.inward[1] * off, z, s, z];
    const top = (s: number) => { const q = at(s, 0); return roofHeight(r.footprint, r.edgeKinds, shape, b.roofBase, [q[0],q[1]]); };
    const wall = (lo: number, hi: number, z: number) => {
      if (hi-lo < 1e-6) return;
      // Intersect the face with every exterior roof break, preserving exact seams.
      const cuts = [lo, hi];
      r.footprint.forEach((q, i) => {
        if (r.edgeKinds[i] === 'party') return;
        const n = leftNormal(q, r.footprint[(i+1)%r.footprint.length]);
        const d0 = (face.start[0]-q[0])*n[0]+(face.start[1]-q[1])*n[1];
        const slope = face.along[0]*n[0]+face.along[1]*n[1];
        if (Math.abs(slope)<1e-6) return;
        for (const distance of [0, dims.mansard.run, dims.mansard.run+shape.run]) {
          const s = (distance-d0)/slope; if (s>lo+1e-6 && s<hi-1e-6) cuts.push(s);
        }
      });
      cuts.sort((a,c)=>a-c);
      for(let i=0;i+1<cuts.length;i++) { const a=cuts[i],c=cuts[i+1],ha=top(a),hc=top(c);
        out.quad(at(a,z),at(c,z),at(c,hc),at(a,ha));
        const innerZ = Math.max(z, b.roofBase + dims.mansard.rise - dims.interior.atticCeiling);
        out.quad(at(c,innerZ,T),at(a,innerZ,T),at(a,ha,T),at(c,hc,T));
        out.quad(at(a,ha),at(c,hc),at(c,hc,T),at(a,ha,T));
      }
    };
    let end=0;
    for(const bay of side.bays) { const lo=bay.x-dims.bay/2,hi=bay.x+dims.bay/2;
      wall(end,lo,0); wall(lo,hi,b.wallTop+(bay.atticWindow===false?0:dims.classes.S.height)); end=hi;
    }
    wall(end,face.length,0);
  }
  return out.geometry();
}
