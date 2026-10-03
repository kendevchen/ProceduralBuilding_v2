/**
 * Furnishings (INTERIOR_SPEC.md §6.8), in code like the stairs: plain geometry
 * merged per material. One ballroom per building, and a few studies, so there is
 * no need to instance or to go through Blender.
 *   - the ballroom: a long banquet table under a white cloth with a pleated gold
 *     skirt, upholstered chairs round it (turned front legs, an arched back with a
 *     cross lattice), and a wool carpet on the parquet (its pattern is drawn in
 *     finishes.ts);
 *   - the studies: bookcases along the walls without windows (the books are a
 *     shader pattern on a card in each shelf), a desk or reading table with turned
 *     legs, ebony chairs with spindle backs, an open book and brass lamps whose
 *     shades glow (the lamps' lights are lampLights.ts).
 *   - the second-floor bedrooms: sage panels (finishes.ts), white upholstered
 *     double beds, brass-framed bedside tables and pleated glowing lamps.
 * Every solid is closed, so a cut through it shows the section colour. Blender
 * Z-up space, like rooms3d.ts.
 */
import { Group, type Material, Matrix4, Mesh, Vector3 } from "three";
import { type Look, booksStamp, carpetStamp } from "./finishes";
import type { BuildingPlan, PlanRoom } from "./plan";
import type { Building } from "./generator";
import { type InteriorMaterials, Tris, atticCeiling } from "./rooms3d";
import type { V2 } from "./roof";
import dims from "../blender/kit_dims.json";

const BED = dims.interior.bedroomFurniture;

/** the parquet that shows round the carpet, and the clearance round the table */
const RUG_MARGIN = 0.55;
const TABLE = { width: 1.15, height: 0.77, cloth: 0.32, end: 1.9 };
const CHAIR = { pitch: 0.62, setback: 0.15 };
/** bookcases: depth, plinth, shelf pitch (the books' shader repeats at this), board thickness */
const CASE = { depth: 0.32, plinth: 0.12, pitch: 0.34, board: 0.025, top: 2.6 };

/** boxes, bars and turned pieces in a frame of their own, mapped into the room */
class Part {
  constructor(private t: Tris, private m: Matrix4) {}

  private p(x: number, y: number, z: number) {
    return new Vector3(x, y, z).applyMatrix4(this.m);
  }

  private n(x: number, y: number, z: number) {
    return new Vector3(x, y, z).transformDirection(this.m);
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const c = (x: number, y: number, z: number) => this.p(x, y, z);
    const t = this.t;
    t.quad(c(x0, y0, z0), c(x0, y1, z0), c(x0, y1, z1), c(x0, y0, z1), this.n(-1, 0, 0));
    t.quad(c(x1, y0, z0), c(x1, y1, z0), c(x1, y1, z1), c(x1, y0, z1), this.n(1, 0, 0));
    t.quad(c(x0, y0, z0), c(x1, y0, z0), c(x1, y0, z1), c(x0, y0, z1), this.n(0, -1, 0));
    t.quad(c(x0, y1, z0), c(x1, y1, z0), c(x1, y1, z1), c(x0, y1, z1), this.n(0, 1, 0));
    t.quad(c(x0, y0, z0), c(x1, y0, z0), c(x1, y1, z0), c(x0, y1, z0), this.n(0, 0, -1));
    t.quad(c(x0, y0, z1), c(x1, y0, z1), c(x1, y1, z1), c(x0, y1, z1), this.n(0, 0, 1));
  }

  /** Rounded closed box, shared by cushions, mattress and upholstered headboard. */
  softBox(cx: number, cy: number, cz: number, w: number, d: number, h: number, radius: number): void {
    const half = [w / 2, d / 2, h / 2];
    const r = Math.min(radius, ...half);
    const point = (axis: number, sign: number, u: number, v: number) => {
      const a = (axis + 1) % 3, b = (axis + 2) % 3;
      const q = [0, 0, 0]; q[axis] = sign * half[axis]; q[a] = u * half[a]; q[b] = v * half[b];
      const c = q.map((x, i) => Math.max(-half[i] + r, Math.min(half[i] - r, x)));
      const n = new Vector3(q[0] - c[0], q[1] - c[1], q[2] - c[2]).normalize();
      return { p: this.p(cx + c[0] + n.x * r, cy + c[1] + n.y * r, cz + c[2] + n.z * r), n: this.n(n.x, n.y, n.z) };
    };
    const steps = [-1, -0.85, -0.5, 0, 0.5, 0.85, 1];
    for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
      for (let i = 0; i < steps.length - 1; i++) for (let j = 0; j < steps.length - 1; j++) {
        const q = [point(axis, sign, steps[i], steps[j]), point(axis, sign, steps[i + 1], steps[j]),
          point(axis, sign, steps[i + 1], steps[j + 1]), point(axis, sign, steps[i], steps[j + 1])];
        this.t.quad(q[0].p, q[1].p, q[2].p, q[3].p, q[0].n.clone().add(q[1].n).add(q[2].n).add(q[3].n).normalize());
      }
    }
  }

  /** a quad in the x-z plane at depth y, facing -y or +y */
  card(x0: number, z0: number, x1: number, z1: number, y: number, facing: 1 | -1 = 1): void {
    this.t.quad(this.p(x0, y, z0), this.p(x1, y, z0), this.p(x1, y, z1), this.p(x0, y, z1), this.n(0, facing, 0));
  }

  /** a square bar of thickness w from a to b (in the x-z plane at depth y) */
  strut(ax: number, az: number, bx: number, bz: number, y: number, w: number): void {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    const nx = (-dz / len) * (w / 2), nz = (dx / len) * (w / 2);
    const h = w / 2;
    const a0 = [ax + nx, az + nz], a1 = [ax - nx, az - nz], b0 = [bx + nx, bz + nz], b1 = [bx - nx, bz - nz];
    const q = (u: number[], v: number[], y0: number, y1: number, facing: Vector3) =>
      this.t.quad(this.p(u[0], y0, u[1]), this.p(v[0], y0, v[1]), this.p(v[0], y1, v[1]), this.p(u[0], y1, u[1]), facing);
    q(a0, b0, y - h, y + h, this.n(nx, 0, nz));
    q(a1, b1, y - h, y + h, this.n(-nx, 0, -nz));
    q(a0, a1, y - h, y + h, this.n(-dx, 0, -dz));
    q(b0, b1, y - h, y + h, this.n(dx, 0, dz));
    this.t.quad(this.p(a0[0], y - h, a0[1]), this.p(b0[0], y - h, b0[1]), this.p(b1[0], y - h, b1[1]), this.p(a1[0], y - h, a1[1]), this.n(0, -1, 0));
    this.t.quad(this.p(a0[0], y + h, a0[1]), this.p(b0[0], y + h, b0[1]), this.p(b1[0], y + h, b1[1]), this.p(a1[0], y + h, a1[1]), this.n(0, 1, 0));
  }

  /**
   * A turned piece about the vertical axis through (cx, cy): `prof` is its
   * outline (radius, height) from the bottom up. With `closed` a profile that
   * starts and ends on the axis makes a solid; an open one (a lamp shade) makes
   * only its outer surface.
   */
  lathe(cx: number, cy: number, prof: [number, number][], seg = 10): void {
    const ring = (r: number, z: number, a: number) => this.p(cx + r * Math.cos(a), cy + r * Math.sin(a), z);
    for (let k = 0; k < seg; k++) {
      const a0 = (2 * Math.PI * k) / seg, a1 = (2 * Math.PI * (k + 1)) / seg, am = (a0 + a1) / 2;
      for (let i = 0; i + 1 < prof.length; i++) {
        const [r0, z0] = prof[i], [r1, z1] = prof[i + 1];
        const dr = r1 - r0, dz = z1 - z0;
        const facing = this.n(Math.cos(am) * dz, Math.sin(am) * dz, -dr);
        if (r0 < 1e-6 && r1 < 1e-6) continue;
        if (r0 < 1e-6) this.t.tri(ring(0, z0, a0), ring(r1, z1, a1), ring(r1, z1, a0), facing);
        else if (r1 < 1e-6) this.t.tri(ring(r0, z0, a0), ring(r0, z0, a1), ring(0, z1, a0), facing);
        else this.t.quad(ring(r0, z0, a0), ring(r0, z0, a1), ring(r1, z1, a1), ring(r1, z1, a0), facing);
      }
    }
  }
}

const at = (x: number, y: number, z: number, turn = 0) => {
  const m = new Matrix4().makeTranslation(x, y, z);
  return turn ? m.multiply(new Matrix4().makeRotationZ(turn)) : m;
};

// ------------------------------------------------------------------ ballroom

/** a tapered turned leg with a bead, from the floor to `top` */
const leg = (top: number): [number, number][] => [
  [0, 0], [0.014, 0], [0.017, 0.03], [0.02, 0.08], [0.024, 0.09], [0.02, 0.1], [0.019, top * 0.45], [0.026, top * 0.5],
  [0.02, top * 0.55], [0.024, top - 0.03], [0.03, top - 0.01], [0, top],
];

/** a banquet chair facing +y of its frame, origin at the centre of its footprint on the floor */
function banquetChair(wood: Tris, fabric: Tris, m: Matrix4): void {
  const w = new Part(wood, m), f = new Part(fabric, m);
  for (const sx of [-1, 1]) {
    w.lathe(sx * 0.2, 0.2, leg(0.4), 8); // front legs, turned
    w.box(sx * 0.2 - 0.022, -0.2 - 0.022, 0, sx * 0.2 + 0.022, -0.2 + 0.022, 0.99); // back posts
  }
  w.box(-0.22, -0.22, 0.38, 0.22, 0.22, 0.45); // seat frame
  w.box(-0.19, -0.2, 0.38, 0.19, -0.18, 0.45);
  f.box(-0.2, -0.2, 0.45, 0.2, 0.2, 0.5); // cushion, with a smaller dome on it
  f.box(-0.185, -0.185, 0.5, 0.185, 0.185, 0.54);
  // the arched top rail, in short bars along a curve
  const arch = (x: number) => 0.935 + 0.05 * (1 - (x / 0.2) ** 2);
  for (let i = 0; i < 8; i++) {
    const xa = -0.2 + (0.4 * i) / 8, xb = -0.2 + (0.4 * (i + 1)) / 8;
    w.strut(xa, arch(xa), xb, arch(xb), -0.205, 0.05);
  }
  w.box(-0.2, -0.225, 0.55, 0.2, -0.185, 0.6); // lower rail
  f.box(-0.17, -0.215, 0.6, 0.17, -0.195, 0.9); // upholstered back
  // the cross lattice in front of it
  w.strut(-0.17, 0.6, 0.17, 0.9, -0.18, 0.02);
  w.strut(0.17, 0.6, -0.17, 0.9, -0.18, 0.02);
}

/** the table: a gold skirt to the floor, pleated, under a white cloth that hangs below the top */
function banquetTable(linen: Tris, gold: Tris, m: Matrix4, length: number): void {
  const hl = length / 2, hw = TABLE.width / 2, top = TABLE.height - TABLE.cloth;
  const g = new Part(gold, m);
  g.box(-hl + 0.06, -hw + 0.06, 0, hl - 0.06, hw - 0.06, top);
  // pleats: thin vertical boards, every other one a little proud
  const strips = (n: number, along: (k: number) => [number, number, number, number]) => {
    for (let k = 0; k < n; k++) {
      const [x0, y0, x1, y1] = along(k);
      const o = k % 2 ? 0.02 : 0.006;
      g.box(x0 - (x1 === x0 ? o : 0), y0 - (y1 === y0 ? o : 0), 0, x1 + (x1 === x0 ? o : 0), y1 + (y1 === y0 ? o : 0), top);
    }
  };
  const nx = Math.floor((length - 0.12) / 0.1), ny = Math.floor((TABLE.width - 0.12) / 0.1);
  const sx = (length - 0.12) / nx, sy = (TABLE.width - 0.12) / ny;
  strips(nx, k => [-hl + 0.06 + k * sx, -hw + 0.06, -hl + 0.06 + (k + 0.8) * sx, -hw + 0.06]);
  strips(nx, k => [-hl + 0.06 + k * sx, hw - 0.06, -hl + 0.06 + (k + 0.8) * sx, hw - 0.06]);
  strips(ny, k => [-hl + 0.06, -hw + 0.06 + k * sy, -hl + 0.06, -hw + 0.06 + (k + 0.8) * sy]);
  strips(ny, k => [hl - 0.06, -hw + 0.06 + k * sy, hl - 0.06, -hw + 0.06 + (k + 0.8) * sy]);
  new Part(linen, m).box(-hl, -hw, top, hl, hw, TABLE.height);
}

// ------------------------------------------------------------------ study

/** the ebony chair of the reference: turned legs, a seat, a back of spindles under a carved cap */
function studyChair(dark: Tris, wood: Tris, m: Matrix4): void {
  const d = new Part(dark, m), w = new Part(wood, m);
  for (const sx of [-1, 1]) {
    d.lathe(sx * 0.2, 0.19, leg(0.44), 8);
    d.lathe(sx * 0.2, -0.19, leg(0.44), 8);
    d.box(sx * 0.2 - 0.022, -0.212, 0.44, sx * 0.2 + 0.022, -0.168, 1.12); // back posts
    d.lathe(sx * 0.2, -0.19, [[0, 1.12], [0.035, 1.12], [0.03, 1.16], [0.02, 1.2], [0, 1.22]], 8); // finials
  }
  d.box(-0.23, -0.23, 0.4, 0.23, 0.23, 0.44); // seat frame
  w.box(-0.21, -0.21, 0.44, 0.21, 0.21, 0.475); // wooden seat
  d.box(-0.2, -0.22, 0.95, 0.2, -0.16, 1.0); // upper rail
  d.box(-0.205, -0.225, 1.04, 0.205, -0.155, 1.12); // carved cap
  d.box(-0.2, -0.22, 0.52, 0.2, -0.16, 0.56); // lower rail
  for (let i = 0; i < 5; i++) {
    const x = -0.12 + i * 0.06;
    d.lathe(x, -0.19, [[0, 0.56], [0.012, 0.56], [0.016, 0.66], [0.011, 0.74], [0.017, 0.82], [0.012, 0.95], [0, 0.95]], 6);
  }
}

/** a desk or reading table: a top on turned legs with a drawer; centred, length along x */
function desk(wood: Tris, dark: Tris, m: Matrix4, length: number, depth: number): void {
  const w = new Part(wood, m), d = new Part(dark, m);
  const hl = length / 2, hd = depth / 2, h = 0.74;
  w.box(-hl, -hd, h, hl, hd, h + 0.04);
  w.box(-hl + 0.04, -hd + 0.04, h - 0.1, hl - 0.04, hd - 0.04, h); // apron
  d.box(-0.25, -hd + 0.03, h - 0.09, 0.25, -hd + 0.045, h - 0.015); // drawer front
  const prof: [number, number][] = [[0, 0], [0.025, 0], [0.03, 0.04], [0.035, 0.1], [0.028, 0.14], [0.033, 0.4], [0.04, 0.44], [0.034, 0.48], [0.04, h - 0.1], [0, h - 0.1]];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) d.lathe(sx * (hl - 0.06), sy * (hd - 0.06), prof, 10);
}

/** an open book lying on a desk, its spine along y: two covers, two blocks of pages */
function openBook(leather: Tris, linen: Tris, m: Matrix4): void {
  const c = new Part(leather, m), p = new Part(linen, m);
  c.box(-0.165, -0.115, 0, 0.165, 0.115, 0.006);
  p.box(-0.15, -0.105, 0.006, -0.004, 0.105, 0.02);
  p.box(0.004, -0.105, 0.006, 0.15, 0.105, 0.02);
  c.box(-0.006, -0.115, 0.006, 0.006, 0.115, 0.022); // the spine
}

/** a table lamp: a turned brass base, a stem, a conical shade (open, glowing); returns the bulb's height */
function lamp(brass: Tris, shade: Tris, m: Matrix4): number {
  new Part(brass, m).lathe(0, 0, [[0, 0], [0.065, 0], [0.065, 0.015], [0.04, 0.03], [0.05, 0.07], [0.028, 0.12], [0.02, 0.16], [0.012, 0.2], [0.012, 0.27], [0.02, 0.28], [0, 0.285]], 12);
  new Part(shade, m).lathe(0, 0, [[0.17, 0.2], [0.095, 0.36]], 18);
  return 0.27;
}

/** the polygon's edges with the stretches along them that doors and windows take */
function freeStretches(plan: BuildingPlan, room: PlanRoom): { a: V2; d: V2; n: V2; s0: number; s1: number }[] {
  const out: { a: V2; d: V2; n: V2; s0: number; s1: number }[] = [];
  const poly = room.polygon;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.6) return;
    const d: V2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const n: V2 = [-d[1], d[0]];
    const along = (p: V2) => ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]);
    const off = (p: V2) => Math.abs((p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1]);
    // a wall with a window gets no bookcase
    if (room.windows.some(wi => { const w = plan.windows[wi]; return off(w.at) < 0.3 && along(w.at) > -0.2 && along(w.at) < len + 0.2; })) return;
    const blocked: [number, number][] = [];
    for (const dr of room.doors) {
      const w = plan.walls[dr.wall];
      const wl = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const c: V2 = [w.a[0] + ((w.b[0] - w.a[0]) / wl) * dr.at, w.a[1] + ((w.b[1] - w.a[1]) / wl) * dr.at];
      if (off(c) < w.thickness / 2 + 0.2) blocked.push([along(c) - dr.width / 2 - 0.12, along(c) + dr.width / 2 + 0.12]);
    }
    blocked.sort((p, q) => p[0] - q[0]);
    let s = 0.0;
    for (const [b0, b1] of [...blocked, [len, len] as [number, number]]) {
      if (Math.min(b0, len) - s >= 0.5) out.push({ a, d, n, s0: s, s1: Math.min(b0, len) });
      s = Math.max(s, b1);
    }
  });
  return out;
}

/** a bookcase against a wall from s0 to s1 along the edge at a, d (inward n), up to `top` */
function bookcase(wood: Tris, books: Tris, f: { a: V2; d: V2; n: V2; s0: number; s1: number }, z: number, top: number): void {
  const len = f.s1 - f.s0;
  const m = new Matrix4().makeBasis(new Vector3(f.d[0], f.d[1], 0), new Vector3(f.n[0], f.n[1], 0), new Vector3(0, 0, 1))
    .setPosition(f.a[0] + f.d[0] * f.s0, f.a[1] + f.d[1] * f.s0, z);
  const w = new Part(wood, m), bk = new Part(books, m);
  const rows = Math.max(1, Math.floor((top - CASE.plinth) / CASE.pitch));
  const H = CASE.plinth + rows * CASE.pitch + CASE.board;
  w.box(0, 0, 0, len, CASE.depth, CASE.plinth); // plinth
  w.box(0, 0, CASE.plinth, len, 0.02, H); // back
  const parts = Math.max(1, Math.round(len / 1.0));
  for (let k = 0; k <= parts; k++) {
    const x = (len * k) / parts;
    w.box(Math.max(0, x - 0.0125 - (k === parts ? 0.0125 : 0)), 0, CASE.plinth, Math.min(len, x + 0.0125 + (k === 0 ? 0.0125 : 0)), CASE.depth, H);
  }
  for (let r = 0; r <= rows; r++) {
    const zb = CASE.plinth + r * CASE.pitch;
    w.box(0, 0, zb, len, CASE.depth, zb + CASE.board);
  }
  w.box(-0.0, 0, H, len, CASE.depth + 0.04, H + 0.06); // cornice
  // the books: a card in each row, a little in front of the back
  for (let r = 0; r < rows; r++) {
    const zb = CASE.plinth + r * CASE.pitch + CASE.board;
    bk.card(0.0125, zb, len - 0.0125, zb + CASE.pitch - CASE.board, 0.17);
  }
}

// ------------------------------------------------------------------ bedrooms

/** Head at y=0, foot towards +y, all dimensions shared with kit_dims.json. */
function bedroomSet(linen: Tris, brass: Tris, shade: Tris, m: Matrix4, lamps: Vector3[]): void {
  const B = BED, l = new Part(linen, m), metal = new Part(brass, m);
  const w = B.bedWidth, length = B.bedLength, base = B.baseHeight, top = base + B.mattressHeight;
  l.softBox(0, length / 2, base / 2, w, length, base, B.rounding);
  l.softBox(0, length / 2, base + B.mattressHeight / 2, w, length, B.mattressHeight, B.rounding);
  l.softBox(0, B.headDepth / 2, B.headHeight / 2, w + B.sideGap, B.headDepth, B.headHeight, B.rounding);
  // White duvet hangs over both sides and the foot; a turned-down fold at the head.
  l.softBox(0, length * 0.62, top + B.duvetHeight / 2, w + B.sideGap, length * 0.77, B.duvetHeight, B.rounding);
  for (const side of [-1, 1]) {
    l.softBox(side * w / 2, length * 0.64, top - B.mattressHeight * 0.28,
      B.duvetHeight, length * 0.72, B.mattressHeight, B.rounding);
    l.softBox(side * w * 0.24, length * 0.18, top + B.duvetHeight,
      w * 0.43, length * 0.24, B.duvetHeight * 1.8, B.rounding);
    l.softBox(side * w * 0.24, length * 0.12, top + B.duvetHeight * 2.1,
      w * 0.4, length * 0.17, B.duvetHeight * 1.5, B.rounding);
    const x = side * (w / 2 + B.sideGap + B.nightWidth / 2), y = B.nightDepth / 2;
    const f = B.frameThickness, hw = B.nightWidth / 2, hd = B.nightDepth / 2;
    l.softBox(x, y, B.nightHeight, B.nightWidth, B.nightDepth, f * 2, f);
    for (const sx of [-1, 1]) for (const sy of [-1, 1])
      metal.box(x + sx * (hw - f) - f / 2, y + sy * (hd - f) - f / 2, 0,
        x + sx * (hw - f) + f / 2, y + sy * (hd - f) + f / 2, B.nightHeight);
    for (const sy of [-1, 1]) metal.box(x - hw, y + sy * (hd - f) - f / 2, B.nightHeight - f * 3,
      x + hw, y + sy * (hd - f) + f / 2, B.nightHeight - f * 2);
    const lm = m.clone().multiply(new Matrix4().makeTranslation(x, y, B.nightHeight + f));
    const stem = new Part(brass, lm), H = B.lampHeight;
    stem.lathe(0, 0, [[0, 0], [B.shadeTop * 0.6, 0], [B.shadeTop * 0.6, H * 0.04],
      [f, H * 0.09], [f * 0.6, H * 0.65], [0, H * 0.65]], 16);
    // Alternating radii form real pleats; inner skin and annular rims close the shade.
    const segments = 64, thickness = B.shadeThickness;
    const ring = (k: number, upper: boolean, inner: boolean) => {
      const a = k * Math.PI * 2 / segments;
      const r = (upper ? B.shadeTop : B.shadeBottom) - (k % 2 ? thickness : 0) - (inner ? thickness : 0);
      return new Vector3(r * Math.cos(a), r * Math.sin(a), upper ? H : H * 0.52).applyMatrix4(lm);
    };
    for (let k = 0; k < segments; k++) {
      const n = new Vector3(Math.cos((k + 0.5) * Math.PI * 2 / segments), Math.sin((k + 0.5) * Math.PI * 2 / segments), 0).transformDirection(lm);
      shade.quad(ring(k, false, false), ring(k + 1, false, false), ring(k + 1, true, false), ring(k, true, false), n);
      shade.quad(ring(k, false, true), ring(k + 1, false, true), ring(k + 1, true, true), ring(k, true, true), n.clone().negate());
      for (const upper of [false, true]) shade.quad(ring(k, upper, false), ring(k + 1, upper, false), ring(k + 1, upper, true), ring(k, upper, true), new Vector3(0, 0, upper ? 1 : -1).transformDirection(lm));
    }
    lamps.push(new Vector3(0, 0, H * 0.7).applyMatrix4(lm));
  }
  l.softBox(0, length, top - B.mattressHeight * 0.28, w, B.duvetHeight, B.mattressHeight, B.rounding);
  l.softBox(0, length * 0.35, top + B.duvetHeight, w, length * 0.1, B.duvetHeight * 0.5, B.rounding);
}

/** Fit the complete bed and two tables to a windowless wall, preserving openings. */
function bedroomPlacement(plan: BuildingPlan, room: PlanRoom): Matrix4 | null {
  const B = BED, half = B.bedWidth / 2 + B.sideGap + B.nightWidth;
  const depth = B.bedLength + B.duvetHeight / 2;
  const inside = (p: V2) => room.polygon.every((a, i) => {
    const b = room.polygon[(i + 1) % room.polygon.length];
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-6;
  });
  for (const f of freeStretches(plan, room).sort((a, b) => (b.s1 - b.s0) - (a.s1 - a.s0))) {
    const lo = f.s0 + half, hi = f.s1 - half;
    const candidates = [(lo + hi) / 2];
    for (let s = lo; s <= hi; s += B.searchStep) candidates.push(s);
    if (hi < lo) continue;
    for (const s of candidates) {
      const m = new Matrix4().makeBasis(new Vector3(...f.d, 0), new Vector3(...f.n, 0), new Vector3(0, 0, 1))
        .setPosition(f.a[0] + f.d[0] * s + f.n[0] * B.wallGap, f.a[1] + f.d[1] * s + f.n[1] * B.wallGap, room.floorZ);
      const world = (x: number, y: number) => { const p = new Vector3(x, y, 0).applyMatrix4(m); return [p.x, p.y] as V2; };
      if (![-half, half].every(x => [0, depth].every(y => inside(world(x, y))))) continue;
      if (![-B.bedWidth / 2, B.bedWidth / 2].every(x => inside(world(x, depth + B.footClear)))) continue;
      const inv = m.clone().invert();
      const clear = (a: V2, b: V2, clearance: number) => {
        // Reserve the opening's width and inward approach, rather than a circle around its jambs.
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
        if (len < 1e-6) return true;
        let nx = -dy / len, ny = dx / len;
        const centre: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const roomCentre = room.polygon.reduce((p, q) => [p[0] + q[0] / room.polygon.length, p[1] + q[1] / room.polygon.length] as V2, [0, 0] as V2);
        if ((roomCentre[0] - centre[0]) * nx + (roomCentre[1] - centre[1]) * ny < 0) { nx = -nx; ny = -ny; }
        const reserved = [a, b, [b[0] + nx * clearance, b[1] + ny * clearance], [a[0] + nx * clearance, a[1] + ny * clearance]]
          .map(p => new Vector3(p[0], p[1], room.floorZ).applyMatrix4(inv));
        const furniture = [
          [-B.bedWidth / 2 - B.duvetHeight / 2, 0, B.bedWidth / 2 + B.duvetHeight / 2, depth],
          [-half, 0, -B.bedWidth / 2 - B.sideGap, B.nightDepth],
          [B.bedWidth / 2 + B.sideGap, 0, half, B.nightDepth],
        ];
        return furniture.every(([x0, y0, x1, y1]) => {
          const rect = [new Vector3(x0, y0), new Vector3(x1, y0), new Vector3(x1, y1), new Vector3(x0, y1)];
          // Separating axis test handles angled walls as well as rectangular bedrooms.
          const axes = [new Vector3(1, 0), new Vector3(0, 1)];
          for (let i = 0; i < reserved.length; i++) {
            const q = reserved[(i + 1) % reserved.length].clone().sub(reserved[i]);
            axes.push(new Vector3(-q.y, q.x));
          }
          return axes.some(axis => {
            const p = reserved.map(v => v.dot(axis)), q = rect.map(v => v.dot(axis));
            return Math.max(...p) <= Math.min(...q) + 1e-6 || Math.max(...q) <= Math.min(...p) + 1e-6;
          });
        });
      };
      const doorsClear = room.doors.every(dr => {
        const w = plan.walls[dr.wall], length = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
        const point = (s: number): V2 => [w.a[0] + (w.b[0] - w.a[0]) * s / length, w.a[1] + (w.b[1] - w.a[1]) * s / length];
        return clear(point(dr.at - dr.width / 2), point(dr.at + dr.width / 2), B.doorClear);
      });
      const windowsClear = room.windows.every(wi => {
        const w = plan.windows[wi], len = Math.hypot(...w.dir);
        const d: V2 = [w.dir[0] / len, w.dir[1] / len];
        return clear([w.at[0] - d[0] * w.width / 2, w.at[1] - d[1] * w.width / 2],
          [w.at[0] + d[0] * w.width / 2, w.at[1] + d[1] * w.width / 2], B.windowClear);
      });
      if (doorsClear && windowsClear) return m;
    }
  }
  return null;
}

// ------------------------------------------------------------------ building

/** where the study's lamps stand (Blender xyz), for the lights (lampLights.ts) */
export interface FurnitureInfo {
  lamps: Vector3[];
}

/** Ballroom, studies and second-floor bedrooms, merged by material. */
export function buildFurniture(plan: BuildingPlan, b: Building, mats: InteriorMaterials, look: Look): Group {
  const group = new Group();
  const lamps: Vector3[] = [];
  const wood = new Tris(), fabric = new Tris(), linen = new Tris(), gold = new Tris(), rug = new Tris();
  const dark = new Tris(), brass = new Tris(), leather = new Tris(), shade = new Tris(), books = new Tris();

  const room = plan.rooms.find(r => r.type === "ballroom");
  if (room) {
    const xs = room.polygon.map(p => p[0]), ys = room.polygon.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, z = room.floorZ;

    // the carpet, in the real look only (the diagram colours and the white model keep the bare floor)
    if (look === "real" && x1 - x0 > 2 * RUG_MARGIN + 1 && y1 - y0 > 2 * RUG_MARGIN + 1) {
      const [rx0, rx1, ry0, ry1] = [x0 + RUG_MARGIN, x1 - RUG_MARGIN, y0 + RUG_MARGIN, y1 - RUG_MARGIN];
      // the shader draws it in world coordinates: x - W/2, and L/2 - y for the corner nearest the front
      rug.stamp = carpetStamp(rx0 - plan.width / 2, plan.length / 2 - ry1, rx1 - rx0, ry1 - ry0, z, room.ceilingZ);
      const v = (x: number, y: number) => new Vector3(x, y, z + 0.008);
      rug.quad(v(rx0, ry0), v(rx1, ry0), v(rx1, ry1), v(rx0, ry1), new Vector3(0, 0, 1));
    }

    // a table along the room, an end clear of the walls, with chairs round it
    const length = Math.max(2.4, x1 - x0 - 2 * TABLE.end);
    banquetTable(linen, gold, at(cx, cy, z), length);
    const half = TABLE.width / 2 + CHAIR.setback + 0.2;
    const n = Math.floor((length - 0.4) / CHAIR.pitch);
    for (let k = 0; k < n; k++) {
      const x = cx - ((n - 1) * CHAIR.pitch) / 2 + k * CHAIR.pitch;
      banquetChair(wood, fabric, at(x, cy - half, z)); // faces +y, towards the table
      banquetChair(wood, fabric, at(x, cy + half, z, Math.PI));
    }
    const end = length / 2 + CHAIR.setback + 0.2;
    banquetChair(wood, fabric, at(cx - end, cy, z, -Math.PI / 2));
    banquetChair(wood, fabric, at(cx + end, cy, z, Math.PI / 2));
  }

  const attic = plan.levels[plan.levels.length - 1];
  const ceilingAt = atticCeiling(b, attic.ceilingZ);
  for (const r of plan.rooms.filter(r => r.type === "study")) {
    const xs = r.polygon.map(p => p[0]), ys = r.polygon.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const z = r.floorZ;
    // the headroom at a point: the ceiling, or in the attic the slope
    const up = r.level === attic.index ? (p: V2) => ceilingAt(p) - z : () => r.ceilingZ - z;
    // bookcases on the walls without windows; the books' pattern counts from the lowest board.
    // Under the slope they are cut into units of about a metre, each as high as its place allows.
    books.stamp = booksStamp(z + CASE.plinth);
    for (const f of freeStretches(plan, r)) {
      const units = r.level === attic.index ? Math.ceil((f.s1 - f.s0) / 1.05) : 1;
      for (let k = 0; k < units; k++) {
        const u = { ...f, s0: f.s0 + ((f.s1 - f.s0) * k) / units, s1: f.s0 + ((f.s1 - f.s0) * (k + 1)) / units };
        let room = Infinity;
        for (const s of [u.s0, u.s1]) for (const dpt of [0.05, CASE.depth]) {
          room = Math.min(room, up([u.a[0] + u.d[0] * s + u.n[0] * dpt, u.a[1] + u.d[1] * s + u.n[1] * dpt]));
        }
        const top = Math.min(CASE.top, room - 0.4);
        if (top >= CASE.plinth + CASE.pitch + 0.1) bookcase(wood, books, u, z, top);
      }
    }
    // the desk: centred in what the bookcases leave, its long side along the room's long side
    const roomW = x1 - x0 - 2 * CASE.depth, roomD = y1 - y0 - 2 * CASE.depth;
    const alongX = roomW >= roomD;
    const long = alongX ? roomW : roomD, short = alongX ? roomD : roomW;
    const big = long >= 3.8 && short >= 2.6;
    const length = big ? Math.min(2.4, long - 1.4) : Math.min(1.4, long - 1.4), dep = big ? 0.85 : 0.7;
    if (length < 1.0 || short < dep + 1.1) continue;
    const turn = alongX ? 0 : Math.PI / 2;
    // where it stands: the middle if it can, else the nearest place with the headroom for the chair and
    // the lamp, and clear of the doors
    const doors: V2[] = r.doors.map(dr => {
      const w = plan.walls[dr.wall], wl = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      return [w.a[0] + ((w.b[0] - w.a[0]) / wl) * dr.at, w.a[1] + ((w.b[1] - w.a[1]) / wl) * dr.at];
    });
    const fits = (px: number, py: number) => {
      const m = at(px, py, 0, turn);
      const inv = m.clone().invert();
      for (const sx of [-1, 0, 1]) for (const sy of [-1, 1]) {
        const p = new Vector3(sx * length / 2, sy * (dep / 2 + 0.4), 0).applyMatrix4(m);
        if (p.x < x0 + CASE.depth || p.x > x1 - CASE.depth || p.y < y0 + CASE.depth || p.y > y1 - CASE.depth) return false;
        if (up([p.x, p.y]) < 1.5) return false;
      }
      return doors.every(dp => {
        const l = new Vector3(dp[0], dp[1], 0).applyMatrix4(inv);
        return Math.abs(l.x) > length / 2 + 0.7 || Math.abs(l.y) > dep / 2 + 0.85;
      });
    };
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    let spot: V2 | null = null;
    for (let step = 0; step <= 12 && !spot; step++) {
      const ring: V2[] = [];
      for (let ix = -step; ix <= step; ix++) for (let iy = -step; iy <= step; iy++) {
        if (Math.max(Math.abs(ix), Math.abs(iy)) === step) ring.push([mx + ix * 0.2, my + iy * 0.2]);
      }
      spot = ring.sort((p, q) => Math.hypot(p[0] - mx, p[1] - my) - Math.hypot(q[0] - mx, q[1] - my)).find(p => fits(p[0], p[1])) ?? null;
    }
    if (!spot) continue;
    const [cx, cy] = spot;
    const dm = at(cx, cy, z, turn);
    desk(wood, dark, dm, length, dep);
    // chairs on the long sides (one, or one each side of a reading table), facing the desk
    const seatOff = dep / 2 + 0.12;
    const place = (lx: number, ly: number, face: number) => {
      const p = new Vector3(lx, ly, 0).applyMatrix4(dm);
      studyChair(dark, wood, at(p.x, p.y, z, turn + face));
    };
    place(0, -seatOff, 0);
    if (big) place(0, seatOff, Math.PI);
    // an open book before the chair, lamps along the far edge
    openBook(leather, linen, new Matrix4().multiplyMatrices(dm, new Matrix4().makeTranslation(-0.1, -dep / 2 + 0.28, 0.78)));
    const lampAt = (lx: number, ly: number) => {
      const m = new Matrix4().multiplyMatrices(dm, new Matrix4().makeTranslation(lx, ly, 0.78));
      const h = lamp(brass, shade, m);
      lamps.push(new Vector3(0, 0, h + 0.1).applyMatrix4(m));
    };
    lampAt(length / 2 - 0.22, dep / 2 - 0.18);
    if (big) lampAt(-length / 2 + 0.22, dep / 2 - 0.18);
  }

  const bedrooms: string[] = [], unfurnishedBedrooms: string[] = [];
  for (const r of plan.rooms.filter(r => r.level === 1 && r.type === "bedroom")) {
    const m = bedroomPlacement(plan, r);
    if (!m) { unfurnishedBedrooms.push(r.id); continue; }
    bedroomSet(linen, brass, shade, m, lamps);
    bedrooms.push(r.id);
  }
  group.userData.bedrooms = { furnished: bedrooms, unfurnished: unfurnishedBedrooms };

  const parts: [Tris, Material][] = [
    [wood, mats.furnWood], [fabric, mats.furnFabric], [linen, mats.furnLinen], [gold, mats.furnGold], [rug, mats.finishFloor],
    [dark, mats.furnDark], [brass, mats.furnBrass], [leather, mats.furnLeather], [shade, mats.furnShade], [books, mats.finishWall],
  ];
  for (const [t, m] of parts) {
    if (!t.pos.length) continue;
    const mesh = new Mesh(t.geometry(), m);
    mesh.castShadow = t !== rug && t !== books && t !== shade;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.userData.furniture = { lamps } satisfies FurnitureInfo;
  return group;
}
