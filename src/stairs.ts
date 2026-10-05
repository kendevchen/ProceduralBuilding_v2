/**
 * The stairs (INTERIOR_SPEC.md §7), from the plan's stair layouts (plan.ts).
 * Every floor has a landing slab along the cage's front. From it a flight
 * climbs the left side, turns round the well's half-round end and comes back
 * along the right side to the landing above.
 *
 * A flight is one solid swept along the walking line: the steps on top, the
 * soffit under them, cut square across the straight sides and radially round
 * the end; its flat ends lengthen the landings. Along the well's edge, from the
 * ground floor to the top, run a stringer and the railing (the main stair: the
 * kit's railing lace; the service stair: plain bars) under a handrail. The main
 * stair also has a runner up its steps and a first step with a rounded end.
 *
 * The solids close up and stay off the walls, so a cut shows them filled
 * (cutaway.ts). Blender Z-up space like rooms3d.ts.
 */
import { BufferGeometry, Float32BufferAttribute, Group, type Material, Mesh, Vector3 } from "three";
import dims from "../blender/kit_dims.json";
import type { BuildingPlan, PlanStair, StairFlight } from "./plan";
import { type InteriorMaterials, Tris } from "./rooms3d";
import type { V2 } from "./roof";
import { type Look, stairMarbleStamp, stampOf } from "./finishes";

const S = dims.interior.stair;
/** keeps the stairs off the cage's walls */
const GAP = 0.002;
const UP = new Vector3(0, 0, 1);
const DOWN = new Vector3(0, 0, -1);
/** the finest step round the well's end */
const TURN_STEP = Math.PI / 30;
/** the stringer along the well: its width, how far it stands above the nosings and below the soffit */
const STRINGER = { width: 0.06, above: 0.06, below: 0.02 };
/** half the handrail's width and height */
const HANDRAIL = { rx: 0.032, rz: 0.024 };
/** the main stair's first step: how far its rounded end reaches into the well (to the half circle's centre) */
const CURTAIL = 0.14;
/** the runner: across the flight (0 at the well, 1 at the wall), and how far it stands off the steps */
const RUNNER = { from: 0.14, to: 0.86, lift: 0.006 };
/** the service stair's railing: bars this far apart, this wide */
const BARS = { every: 0.12, width: 0.016 };

const v = (p: V2, z: number) => new Vector3(p[0], p[1], z);
const lerp = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** where a stair's flights run in its cage: the walking line and the cut across the flight at each place on it */
class Well {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** the well: its axis, front end (the landings' edge), the centre of its half-round end, its radius */
  readonly xc: number;
  readonly yL: number;
  readonly yc: number;
  readonly rw: number;
  /** the walking line: its radius round the end, the lengths of a straight side, of the turn, of all */
  readonly R: number;
  readonly straight: number;
  readonly turn: number;
  readonly walk: number;
  /** angles of the turn at which the cuts reach the cage's back corners */
  private corners: [number, number];

  constructor(s: PlanStair) {
    const L = s.layout;
    const [rx0, ry0, rx1, ry1] = L.rect;
    this.x0 = rx0 + GAP;
    this.y0 = ry0 + GAP;
    this.x1 = rx1 - GAP;
    this.y1 = ry1 - GAP;
    this.xc = (rx0 + rx1) / 2;
    this.rw = L.wellRadius;
    this.yL = ry0 + L.landing;
    this.yc = this.yL + L.straight;
    this.R = L.wellRadius + L.walkOffset;
    this.straight = L.straight;
    this.turn = Math.PI * this.R;
    this.walk = L.walk;
    this.corners = [Math.atan2(this.y1 - this.yc, this.xc - this.x0), Math.PI - Math.atan2(this.y1 - this.yc, this.x1 - this.xc)];
  }

  /** the cut across the flight at s along the walking line: its ends at the well and at the wall */
  cross(s: number): [V2, V2] {
    const { xc, rw, yL, yc } = this;
    if (s <= this.straight) return [[xc - rw, yL + s], [this.x0, yL + s]];
    const t = s - this.straight;
    if (t >= this.turn) {
      const y = yc - (t - this.turn);
      return [[xc + rw, y], [this.x1, y]];
    }
    const phi = t / this.R, dx = -Math.cos(phi), dy = Math.sin(phi);
    const toSide = dx < -1e-9 ? (this.x0 - xc) / dx : dx > 1e-9 ? (this.x1 - xc) / dx : Infinity;
    const toBack = dy > 1e-9 ? (this.y1 - yc) / dy : Infinity;
    const k = Math.min(toSide, toBack);
    return [[xc + dx * rw, yc + dy * rw], [xc + dx * k, yc + dy * k]];
  }

  /** the way up at s (horizontal) */
  tangent(s: number): V2 {
    if (s <= this.straight) return [0, 1];
    const t = s - this.straight;
    if (t >= this.turn) return [0, -1];
    return [Math.sin(t / this.R), Math.cos(t / this.R)];
  }

  /** places strictly between a and b where the flight bends or meets a corner */
  bends(a: number, b: number): number[] {
    const out = [this.straight, this.straight + this.turn, ...this.corners.map(c => this.straight + c * this.R)];
    for (let phi = TURN_STEP; phi < Math.PI - 1e-9; phi += TURN_STEP) out.push(this.straight + phi * this.R);
    return out.filter(s => s > a && s < b);
  }

  /** a and b and the places between them where something changes, in order */
  samples(a: number, b: number, extra: number[]): number[] {
    const mid = [...extra, ...this.bends(a, b)].filter(s => s > a + 1e-4 && s < b - 1e-4).sort((p, q) => p - q);
    const out = [a];
    for (const s of mid) if (s - out[out.length - 1] > 1e-4) out.push(s);
    out.push(b);
    return out;
  }
}

/** heights along a flight's walking line */
interface Profile {
  /** top of the step (anywhere inside a tread) */
  top(s: number): number;
  /** underside */
  bottom(s: number): number;
  /** the railing's line: through the nosings, flat at the landings */
  rail(s: number): number;
  /** where the risers stand */
  risers: number[];
}

/**
 * `first`: the ground floor's flight, which stands on the floor; `below`,
 * `above`: the landing slabs' depths at its foot and head, which its underside
 * meets.
 */
function profile(F: StairFlight, first: boolean, below: number, above: number): Profile {
  const { z0, z1, riser: r, going: g, start: a, end: e } = F;
  const slope = r / g;
  // the soffit under the steps' inner corners, its thickness square to the pitch
  const under = r + (S.soffit * Math.hypot(r, g)) / g;
  return {
    top: s => (s < a ? z0 : s >= e ? z1 : z0 + (Math.floor((s - a) / g) + 1) * r),
    bottom: s => {
      const b = z0 + r + (s - a) * slope - under;
      const foot = first ? Math.max(z0 + GAP, b) : Math.max(z0 - below, Math.min(b, z0 - below + 2 * s * slope));
      return Math.min(z1 - above, foot);
    },
    rail: s => Math.min(z1, Math.max(z0, z0 + (s - a + g) * slope)),
    risers: Array.from({ length: F.risers }, (_, i) => a + i * g),
  };
}

/**
 * A flight as a solid from s0 along the walking line to the landing above: the
 * steps, the soffit, the sides at the well and at the wall, and the risers
 * (the first from `from`). Its head, against the landing, is left open, and so
 * is its foot below `from`. `skip`: where the first step's rounded end closes
 * the well side. Returns the top it ends at.
 */
function flightSolid(t: Tris, w: Well, P: Profile, s0: number, from: number, skip: [number, number] | null): number {
  const ss = w.samples(s0, w.walk, P.risers);
  let prev = from;
  for (let j = 0; j + 1 < ss.length; j++) {
    const sa = ss[j], sb = ss[j + 1], z = P.top((sa + sb) / 2);
    const [ia, oa] = w.cross(sa), [ib, ob] = w.cross(sb);
    const ba = P.bottom(sa), bb = P.bottom(sb);
    if (z > prev + 1e-6) {
      const tg = w.tangent(sa);
      t.quad(v(ia, prev), v(oa, prev), v(oa, z), v(ia, z), new Vector3(-tg[0], -tg[1], 0));
    }
    t.quad(v(ia, z), v(ib, z), v(ob, z), v(oa, z), UP);
    t.quad(v(ia, ba), v(ib, bb), v(ob, bb), v(oa, ba), DOWN);
    const [im, om] = w.cross((sa + sb) / 2);
    const out = new Vector3(im[0] - om[0], im[1] - om[1], 0);
    if (!skip || sb <= skip[0] + 1e-6 || sa >= skip[1] - 1e-6) t.quad(v(ia, ba), v(ib, bb), v(ib, z), v(ia, z), out);
    t.quad(v(oa, ba), v(ob, bb), v(ob, z), v(oa, z), out.clone().negate());
    prev = z;
  }
  return prev;
}

/**
 * A floor's landing: a slab along the cage's front, as deep as the floor. Its
 * back edge meets the flight leaving it (left, unless `leftOpen`: the top
 * floor) and the one arriving (right; open above `rightFrom`, the top of that
 * flight's last tread when it has no flat end).
 */
function landingSlab(t: Tris, w: Well, z: number, depth: number, leftOpen: boolean, rightFrom: number) {
  const { x0, y0, x1, xc, rw, yL } = w;
  const zb = z - depth;
  const c = (x: number, y: number, h: number) => new Vector3(x, y, h);
  t.quad(c(x0, y0, z), c(x1, y0, z), c(x1, yL, z), c(x0, yL, z), UP);
  t.quad(c(x0, y0, zb), c(x1, y0, zb), c(x1, yL, zb), c(x0, yL, zb), DOWN);
  t.quad(c(x0, y0, zb), c(x1, y0, zb), c(x1, y0, z), c(x0, y0, z), new Vector3(0, -1, 0));
  t.quad(c(x0, y0, zb), c(x0, yL, zb), c(x0, yL, z), c(x0, y0, z), new Vector3(-1, 0, 0));
  t.quad(c(x1, y0, zb), c(x1, yL, zb), c(x1, yL, z), c(x1, y0, z), new Vector3(1, 0, 0));
  const back = new Vector3(0, 1, 0);
  t.quad(c(xc - rw, yL, zb), c(xc + rw, yL, zb), c(xc + rw, yL, z), c(xc - rw, yL, z), back);
  if (leftOpen) t.quad(c(x0, yL, zb), c(xc - rw, yL, zb), c(xc - rw, yL, z), c(x0, yL, z), back);
  if (rightFrom < z - 1e-6) t.quad(c(xc + rw, yL, rightFrom), c(x1, yL, rightFrom), c(x1, yL, z), c(xc + rw, yL, z), back);
}

/** the main stair's first step reaching on into the well, its end a half circle; returns where the newel stands */
function curtail(t: Tris, w: Well, F: StairFlight): V2 {
  const g = F.going, y0 = w.yL + F.start, x = w.xc - w.rw;
  const rc = g / 2, cx = x + CURTAIL, cy = y0 + rc;
  const outline: V2[] = [[x, y0], [cx, y0]];
  for (let k = 1; k < 12; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / 12;
    outline.push([cx + rc * Math.cos(a), cy + rc * Math.sin(a)]);
  }
  outline.push([cx, y0 + g], [x, y0 + g]);
  const zb = F.z0 + GAP, zt = F.z0 + F.riser;
  t.polygon(outline, [], p => v(p, zt), UP);
  t.polygon(outline, [], p => v(p, zb), DOWN);
  // its edge, but not the side against the flight
  for (let k = 0; k + 1 < outline.length; k++) {
    const p = outline[k], q = outline[k + 1];
    t.quad(v(p, zb), v(q, zb), v(q, zt), v(p, zt), new Vector3(q[1] - p[1], p[0] - q[0], 0));
  }
  return [cx, cy];
}

/** the runner up a flight's steps, from its first riser to just past its last */
function runner(t: Tris, w: Well, P: Profile, F: StairFlight) {
  const ss = w.samples(F.start, Math.min(w.walk, F.end + 0.05), P.risers);
  let prev = F.z0;
  for (let j = 0; j + 1 < ss.length; j++) {
    const sa = ss[j], sb = ss[j + 1], z = P.top((sa + sb) / 2) + RUNNER.lift;
    const [ia, oa] = w.cross(sa), [ib, ob] = w.cross(sb);
    const a0 = lerp(ia, oa, RUNNER.from), a1 = lerp(ia, oa, RUNNER.to);
    if (z > prev + 1e-6) {
      const tg = w.tangent(sa), dx = -tg[0] * RUNNER.lift, dy = -tg[1] * RUNNER.lift;
      const p0: V2 = [a0[0] + dx, a0[1] + dy], p1: V2 = [a1[0] + dx, a1[1] + dy];
      t.quad(v(p0, prev), v(p1, prev), v(p1, z), v(p0, z), new Vector3(-tg[0], -tg[1], 0));
    }
    t.quad(v(a0, z), v(lerp(ib, ob, RUNNER.from), z), v(lerp(ib, ob, RUNNER.to), z), v(a1, z), UP);
    prev = z;
  }
}

/** a place along the well's edge: the point, the railing's line there, the underside of the flight or landing */
interface EdgePoint {
  p: V2;
  rail: number;
  low: number;
}

/** a place along the railing: on the stringer's middle, the stringer's top there and the railing's line */
interface RailPoint {
  p: V2;
  base: number;
  rail: number;
}

/**
 * The stringer along the well's edge (into the well, off the steps by GAP), a
 * solid; returns the line along its middle for the railing. `floor`: the
 * ground floor, which it stays on.
 */
function stringer(t: Tris, path: EdgePoint[], floor: number): RailPoint[] {
  const n = path.length;
  const dirs = path.slice(0, -1).map((e, j) => {
    const q = path[j + 1].p, len = Math.hypot(q[0] - e.p[0], q[1] - e.p[1]);
    return [(q[0] - e.p[0]) / len, (q[1] - e.p[1]) / len] as V2;
  });
  // the well lies right of the way up; mitred where the edge turns
  const offset = (j: number, d: number): V2 => {
    const a = dirs[Math.max(0, j - 1)], b = dirs[Math.min(dirs.length - 1, j)];
    const na: V2 = [a[1], -a[0]], nb: V2 = [b[1], -b[0]];
    const m: V2 = [na[0] + nb[0], na[1] + nb[1]];
    const len = Math.hypot(m[0], m[1]) || 1;
    const k = d / Math.max(0.5, (m[0] * na[0] + m[1] * na[1]) / len);
    return [path[j].p[0] + (m[0] / len) * k, path[j].p[1] + (m[1] / len) * k];
  };
  const inner = path.map((_, j) => offset(j, GAP));
  const outer = path.map((_, j) => offset(j, GAP + STRINGER.width));
  const top = path.map(e => e.rail + STRINGER.above);
  const bot = path.map(e => Math.max(floor + GAP, e.low - STRINGER.below));
  for (let j = 0; j + 1 < n; j++) {
    const d = dirs[j], nrm = new Vector3(d[1], -d[0], 0);
    t.quad(v(inner[j], bot[j]), v(inner[j + 1], bot[j + 1]), v(inner[j + 1], top[j + 1]), v(inner[j], top[j]), nrm.clone().negate());
    t.quad(v(outer[j], bot[j]), v(outer[j + 1], bot[j + 1]), v(outer[j + 1], top[j + 1]), v(outer[j], top[j]), nrm);
    t.quad(v(inner[j], top[j]), v(inner[j + 1], top[j + 1]), v(outer[j + 1], top[j + 1]), v(outer[j], top[j]), UP);
    t.quad(v(inner[j], bot[j]), v(inner[j + 1], bot[j + 1]), v(outer[j + 1], bot[j + 1]), v(outer[j], bot[j]), DOWN);
  }
  const cap = (j: number, d: V2) => t.quad(v(inner[j], bot[j]), v(outer[j], bot[j]), v(outer[j], top[j]), v(inner[j], top[j]), new Vector3(d[0], d[1], 0));
  cap(0, [-dirs[0][0], -dirs[0][1]]);
  cap(n - 1, dirs[dirs.length - 1]);
  return path.map((e, j) => ({ p: offset(j, GAP + STRINGER.width / 2), base: top[j], rail: e.rail }));
}

/** the handrail's centre above a railing point */
const handrailZ = (r: RailPoint) => r.rail + S.rail - HANDRAIL.rz;

/** the handrail: a flattened tube along the railing */
function handrail(t: Tris, rail: RailPoint[]) {
  const SIDES = 6;
  const centre = rail.map(r => v(r.p, handrailZ(r)));
  const rings = centre.map((c, j) => {
    const a = centre[Math.max(0, j - 1)], b = centre[Math.min(centre.length - 1, j + 1)];
    const along = b.clone().sub(a).normalize();
    const side = along.clone().cross(UP).normalize();
    const up = side.clone().cross(along).normalize();
    return Array.from({ length: SIDES }, (_, k) => {
      const th = (2 * Math.PI * k) / SIDES;
      return c.clone().addScaledVector(side, Math.cos(th) * HANDRAIL.rx).addScaledVector(up, Math.sin(th) * HANDRAIL.rz);
    });
  });
  for (let j = 0; j + 1 < rings.length; j++) {
    for (let k = 0; k < SIDES; k++) {
      const k1 = (k + 1) % SIDES;
      const facing = rings[j][k].clone().add(rings[j][k1]).multiplyScalar(0.5).sub(centre[j]);
      t.quad(rings[j][k], rings[j + 1][k], rings[j + 1][k1], rings[j][k1], facing);
    }
  }
}

/** the main stair's railing: the lace between the stringer and the handrail, its pattern running along it in metres */
function laceRibbon(out: { pos: number[]; uv: number[] }, rail: RailPoint[]) {
  let u = 0;
  for (let j = 0; j + 1 < rail.length; j++) {
    const a = rail[j], b = rail[j + 1];
    const du = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]);
    const ta = handrailZ(a) - HANDRAIL.rz, tb = handrailZ(b) - HANDRAIL.rz;
    const quad = [[a.p, a.base, u, 0], [b.p, b.base, u + du, 0], [b.p, tb, u + du, 1], [a.p, a.base, u, 0], [b.p, tb, u + du, 1], [a.p, ta, u, 1]] as const;
    for (const [p, z, s, tv] of quad) {
      out.pos.push(p[0], p[1], z);
      out.uv.push(s, tv);
    }
    u += du;
  }
}

/** the service stair's railing: plain square bars between the stringer and the handrail */
function bars(t: Tris, rail: RailPoint[]) {
  const h = BARS.width / 2;
  let next = BARS.every / 2;
  let u = 0;
  for (let j = 0; j + 1 < rail.length; j++) {
    const a = rail[j], b = rail[j + 1];
    const len = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]);
    if (len < 1e-6) continue;
    const d: V2 = [(b.p[0] - a.p[0]) / len, (b.p[1] - a.p[1]) / len], n: V2 = [d[1], -d[0]];
    for (; next <= u + len; next += BARS.every) {
      const f = (next - u) / len;
      const c = lerp(a.p, b.p, f);
      const z0 = a.base + (b.base - a.base) * f;
      const z1 = handrailZ(a) + (handrailZ(b) - handrailZ(a)) * f - HANDRAIL.rz;
      const corner = (sa: number, sn: number): V2 => [c[0] + d[0] * sa * h + n[0] * sn * h, c[1] + d[1] * sa * h + n[1] * sn * h];
      const q = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      q.forEach((p, k) => {
        const r = q[(k + 1) % 4];
        const facing = new Vector3((p[0] + r[0]) / 2 - c[0], (p[1] + r[1]) / 2 - c[1], 0);
        t.quad(v(p, z0), v(r, z0), v(r, z1), v(p, z1), facing);
      });
    }
    u += len;
  }
}

/** the newel on the first step: a post up to the handrail, with a knob */
function newel(t: Tris, at: V2, z0: number, z1: number) {
  const post = (r: number, a: number, b: number) => {
    const SIDES = 10;
    const ring = (z: number) => Array.from({ length: SIDES }, (_, k) => {
      const th = (2 * Math.PI * k) / SIDES;
      return new Vector3(at[0] + r * Math.cos(th), at[1] + r * Math.sin(th), z);
    });
    const lo = ring(a), hi = ring(b);
    for (let k = 0; k < SIDES; k++) {
      const k1 = (k + 1) % SIDES;
      t.quad(lo[k], lo[k1], hi[k1], hi[k], new Vector3(Math.cos((2 * Math.PI * (k + 0.5)) / SIDES), Math.sin((2 * Math.PI * (k + 0.5)) / SIDES), 0));
    }
    for (let k = 1; k + 1 < SIDES; k++) {
      t.tri(hi[0], hi[k], hi[k + 1], UP);
      t.tri(lo[0], lo[k], lo[k + 1], DOWN);
    }
  };
  post(0.045, z0, z1);
  post(0.065, z1, z1 + 0.06);
}

/** the stairs of a plan (white model), shown with the rest of the interior while the building is cut */
export function buildStairs(plan: BuildingPlan, mats: InteriorMaterials, lace: Material, laceDepth: Material, look: Look = "white"): Group {
  const solid = new Tris(), carpet = new Tris(), iron = new Tris(), wood = new Tris();
  const ribbon = { pos: [] as number[], uv: [] as number[] };
  const levels = plan.levels;
  /** depth of the slab under a floor */
  const slab = (k: number) => levels[k].floorZ - levels[k - 1].ceilingZ;

  for (const s of plan.stairs) {
    solid.stamp = look === "real" ? stairMarbleStamp()
      : stampOf(look, plan.rooms.find(r => r.type === "stair" && r.level === s.from) ?? null, "floor");
    const w = new Well(s);
    const main = s.kind === "main";
    const flights = s.layout.flights;
    if (!flights.length) continue;
    const profiles = flights.map(F => profile(F, F.level === s.from, F.level > s.from ? slab(F.level) : 0, slab(F.level + 1)));
    const first = flights[0];
    const curl = main && first.start + 2 * first.going <= w.straight ? curtail(solid, w, first) : null;

    // landings and flights, floor by floor; the well's edge as it goes
    const edge: EdgePoint[] = [];
    const push = (p: V2, rail: number, low: number) => {
      const q = edge[edge.length - 1];
      if (q && Math.hypot(q.p[0] - p[0], q.p[1] - p[1]) < 1e-4) Object.assign(q, { rail, low });
      else edge.push({ p, rail, low });
    };
    let lastTop = 0;
    flights.forEach((F, i) => {
      const P = profiles[i], k = F.level, foot = k === s.from;
      if (!foot) landingSlab(solid, w, levels[k].floorZ, slab(k), false, lastTop);
      const s0 = foot ? F.start : 0;
      lastTop = flightSolid(solid, w, P, s0, foot ? P.bottom(s0) : F.z0, foot && curl ? [F.start, F.start + F.going] : null);
      if (main) runner(carpet, w, P, F);
      // the edge: up the flight (on the ground floor from past the first step), then across the landing above
      const e0 = foot ? (curl ? F.start + F.going : F.start) : 0;
      for (const sv of w.samples(e0, w.walk, [F.start - F.going, ...P.risers])) push(w.cross(sv)[0], P.rail(sv), P.bottom(sv));
      const up = levels[k + 1];
      push([w.xc - w.rw, w.yL], i + 1 < flights.length ? profiles[i + 1].rail(0) : up.floorZ, up.floorZ - slab(k + 1));
    });
    const top = levels[s.to];
    landingSlab(solid, w, top.floorZ, slab(s.to), true, lastTop);
    // the top landing's open side, above the flight below
    push([w.x0, w.yL], top.floorZ, top.floorZ - slab(s.to));

    const rail = stringer(solid, edge, levels[s.from].floorZ);
    if (curl) {
      const z0 = first.z0 + first.riser;
      newel(wood, curl, z0, z0 + S.rail - 2 * HANDRAIL.rz);
      rail.unshift({ p: curl, base: z0, rail: z0 });
    }
    handrail(wood, rail);
    if (main) laceRibbon(ribbon, rail);
    else bars(iron, rail);
  }

  const group = new Group();
  const parts: [Tris, Material][] = [[solid, look === "white" ? mats.stair : mats.finishWall], [carpet, mats.carpet], [iron, mats.iron], [wood, mats.wood]];
  for (const [t, m] of parts) {
    if (!t.pos.length) continue;
    const mesh = new Mesh(t.geometry(), m);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (ribbon.pos.length) {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(ribbon.pos, 3));
    g.setAttribute("uv", new Float32BufferAttribute(ribbon.uv, 2));
    g.computeVertexNormals();
    const mesh = new Mesh(g, lace);
    mesh.customDepthMaterial = laceDepth;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
