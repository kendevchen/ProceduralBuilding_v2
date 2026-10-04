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
 *   - the bedrooms: large rooms have sage panels (finishes.ts), white upholstered
 *     double beds, brass-framed bedside tables and pleated glowing lamps.
 * Every solid is closed, so a cut through it shows the section colour. Blender
 * Z-up space, like rooms3d.ts.
 */
import { Color, Group, type Material, Matrix4, Mesh, Vector3 } from "three";
import { type Look, type Stamp, booksStamp, carpetStamp, salonRugStamp, diningRugStamp } from "./finishes";
import type { BuildingPlan, PlanRoom } from "./plan";
import type { Building } from "./generator";
import { type InteriorMaterials, Tris, atticCeiling } from "./rooms3d";
import type { V2 } from "./roof";
import dims from "../blender/kit_dims.json";
import { inRoom, roomAnchor, roomContains } from "./roomGeometry";

const BED = dims.interior.bedroomFurniture;
const SALON = dims.interior.salonFurniture;
const DINING = dims.interior.diningFurniture;
const KITCHEN = dims.interior.kitchenFurniture;

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
function freeStretches(plan: BuildingPlan, room: PlanRoom, splitWindows = false): { a: V2; d: V2; n: V2; s0: number; s1: number }[] {
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
    const windows = room.windows.map(wi => plan.windows[wi]).filter(w => off(w.at) < 0.3 && along(w.at) > -0.2 && along(w.at) < len + 0.2);
    if (!splitWindows && windows.length) return;
    const blocked: [number, number][] = [];
    if (splitWindows) for (const w of windows) blocked.push([along(w.at) - w.width / 2 - 0.12, along(w.at) + w.width / 2 + 0.12]);
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
type BedSide = -1 | 1;

function doubleBed(linen: Tris, m: Matrix4): void {
  const B = BED, l = new Part(linen, m);
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
  }
  l.softBox(0, length, top - B.mattressHeight * 0.28, w, B.duvetHeight, B.mattressHeight, B.rounding);
  l.softBox(0, length * 0.35, top + B.duvetHeight, w, length * 0.1, B.duvetHeight * 0.5, B.rounding);
}

function nightstand(linen: Tris, brass: Tris, m: Matrix4): void {
  const B = BED, x = 0, y = B.nightDepth / 2, l = new Part(linen, m), metal = new Part(brass, m);
  const f = B.frameThickness, hw = B.nightWidth / 2, hd = B.nightDepth / 2;
  l.softBox(x, y, B.nightHeight, B.nightWidth, B.nightDepth, f * 2, f);
  for (const sx of [-1, 1]) for (const sy of [-1, 1])
    metal.box(x + sx * (hw - f) - f / 2, y + sy * (hd - f) - f / 2, 0,
      x + sx * (hw - f) + f / 2, y + sy * (hd - f) + f / 2, B.nightHeight);
  for (const sy of [-1, 1]) metal.box(x - hw, y + sy * (hd - f) - f / 2, B.nightHeight - f * 3,
    x + hw, y + sy * (hd - f) + f / 2, B.nightHeight - f * 2);
}

function bedsideLamp(brass: Tris, shade: Tris, m: Matrix4): number {
  const B = BED, f = B.frameThickness, lm = m, stem = new Part(brass, lm), H = B.lampHeight;
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
  return H * 0.7;
}

function bedroomSet(linen: Tris, brass: Tris, shade: Tris, m: Matrix4, lamps: Vector3[], sides: BedSide[]): void {
  doubleBed(linen, m);
  for (const side of sides) {
    const x = side * (BED.bedWidth / 2 + BED.sideGap + BED.nightWidth / 2);
    nightstand(linen, brass, m.clone().multiply(at(x, 0, 0)));
    const lm = m.clone().multiply(at(x, BED.nightDepth / 2, BED.nightHeight + BED.frameThickness));
    lamps.push(new Vector3(0, 0, bedsideLamp(brass, shade, lm)).applyMatrix4(lm));
  }
}

/** Prefer two tables, then use one where several openings leave a narrow wall. */
function bedroomPlacement(plan: BuildingPlan, b: Building, room: PlanRoom): { m: Matrix4; sides: BedSide[] } | null {
  const B = BED, half = B.bedWidth / 2 + B.sideGap + B.nightWidth;
  const depth = B.bedLength + B.duvetHeight / 2;
  const attic = plan.levels[plan.levels.length - 1];
  const ceilingAt = room.level === attic.index ? atticCeiling(b, attic.ceilingZ) : () => room.ceilingZ;
  const arrangements: { scale: number; sides: BedSide[] }[] = [
    { scale: 1, sides: [-1, 1] }, { scale: 0.9, sides: [-1, 1] },
    { scale: 1, sides: [-1] }, { scale: 1, sides: [1] },
    { scale: 0.9, sides: [-1] }, { scale: 0.9, sides: [1] },
  ];
  for (const { scale, sides } of arrangements) {
    const left = sides.includes(-1) ? half : B.bedWidth / 2 + B.duvetHeight / 2;
    const right = sides.includes(1) ? half : B.bedWidth / 2 + B.duvetHeight / 2;
    for (const f of freeStretches(plan, room).sort((a, b) => (b.s1 - b.s0) - (a.s1 - a.s0))) {
      const lo = f.s0 + left * scale, hi = f.s1 - right * scale;
      const candidates = [(lo + hi) / 2];
      for (let s = lo; s <= hi; s += B.searchStep) candidates.push(s);
      if (hi < lo) continue;
      for (const s of candidates) {
        const m = new Matrix4().makeBasis(new Vector3(...f.d, 0).multiplyScalar(scale), new Vector3(...f.n, 0).multiplyScalar(scale), new Vector3(0, 0, 1))
          .setPosition(f.a[0] + f.d[0] * s + f.n[0] * B.wallGap, f.a[1] + f.d[1] * s + f.n[1] * B.wallGap, room.floorZ);
        const world = (x: number, y: number) => { const p = new Vector3(x, y, 0).applyMatrix4(m); return [p.x, p.y] as V2; };
        const fitsRect = (x0: number, y0: number, x1: number, y1: number) =>
          roomContains(room.polygon, [world(x0, y0), world(x1, y0), world(x1, y1), world(x0, y1)]);
        if (!fitsRect(-B.bedWidth / 2 - B.duvetHeight / 2, 0, B.bedWidth / 2 + B.duvetHeight / 2, depth + B.footClear / scale)) continue;
        if (!sides.every(side => side < 0
          ? fitsRect(-left, 0, -B.bedWidth / 2 - B.sideGap, B.nightDepth)
          : fitsRect(B.bedWidth / 2 + B.sideGap, 0, right, B.nightDepth))) continue;
        const lampTop = B.nightHeight + B.frameThickness + B.lampHeight;
        if (!sides.every(side => [0, B.nightDepth].every(y => ceilingAt(world(side * half, y)) - room.floorZ > lampTop + B.rounding))) continue;
        if (![-B.bedWidth / 2, B.bedWidth / 2].every(x => ceilingAt(world(x, B.headDepth)) - room.floorZ > B.headHeight + B.rounding)) continue;
        const inv = m.clone().invert();
        const clear = (a: V2, b: V2, clearance: number) => {
          // Reserve the opening's width and inward approach, rather than a circle around its jambs.
          const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
          if (len < 1e-6) return true;
          let nx = -dy / len, ny = dx / len;
          const centre: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          if (!inRoom(room.polygon, [centre[0] + nx * clearance / 2, centre[1] + ny * clearance / 2])) { nx = -nx; ny = -ny; }
          const reserved = [a, b, [b[0] + nx * clearance, b[1] + ny * clearance], [a[0] + nx * clearance, a[1] + ny * clearance]]
            .map(p => new Vector3(p[0], p[1], room.floorZ).applyMatrix4(inv));
          const furniture = [
            [-B.bedWidth / 2 - B.duvetHeight / 2, 0, B.bedWidth / 2 + B.duvetHeight / 2, depth],
            ...sides.map(side => side < 0
              ? [-half, 0, -B.bedWidth / 2 - B.sideGap, B.nightDepth]
              : [B.bedWidth / 2 + B.sideGap, 0, half, B.nightDepth]),
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
          return clear(point(dr.at - dr.width / 2), point(dr.at + dr.width / 2), B.doorClear / scale);
        });
        const windowsClear = room.windows.every(wi => {
          const w = plan.windows[wi], len = Math.hypot(...w.dir);
          const d: V2 = [w.dir[0] / len, w.dir[1] / len];
          return clear([w.at[0] - d[0] * w.width / 2, w.at[1] - d[1] * w.width / 2],
            [w.at[0] + d[0] * w.width / 2, w.at[1] + d[1] * w.width / 2], B.windowClear / scale);
        });
        if (doorsClear && windowsClear) return { m, sides };
      }
    }
  }
  return null;
}

// ------------------------------------------------------------------ building

/** where the study's lamps stand (Blender xyz), for the lights (lampLights.ts) */
// ------------------------------------------------------------------ single 2F salon prototype
type SalonRect = [number, number, number, number];

/** Positive area overlap of two convex footprints (touching is allowed). */
function overlaps(a: V2[], b: V2[]): boolean {
  for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], nx = p[1] - q[1], ny = q[0] - p[0];
    const aa = a.map(v => v[0] * nx + v[1] * ny), bb = b.map(v => v[0] * nx + v[1] * ny);
    if (Math.max(...aa) <= Math.min(...bb) + 1e-6 || Math.max(...bb) <= Math.min(...aa) + 1e-6) return false;
  }
  return true;
}

/** Complete set fits a real polygon and keeps all opening approaches free. */
function salonPlacement(plan: BuildingPlan, b: Building, r: PlanRoom): Matrix4 | null {
  const S = SALON, half = S.width / 2;
  const solids: SalonRect[] = [
    [-S.fireWidth / 2 - S.caseWidth - 0.08, 0, S.fireWidth / 2 + S.caseWidth + 0.08, S.fireDepth + 0.12],
    [-S.sofaWidth / 2, S.depth - S.sofaDepth, S.sofaWidth / 2, S.depth],
    [-half, 1.2, -half + S.sofaDepth, 1.2 + S.shortSofaWidth],
    [-S.tableWidth / 2, 2.0, S.tableWidth / 2, 2.0 + S.tableDepth],
    [0.62, 2.25, 1.17, 2.80],
    [0.05, 2.85, 0.8, 3.3],
  ];
  const openings: V2[][] = [];
  const opening = (c: V2, d: V2, width: number, clear: number) => {
    const len = Math.hypot(...d); if (!len) return;
    const u: V2 = [d[0] / len, d[1] / len];
    let n: V2 = [-u[1], u[0]];
    // Polygons are inset from structural wall axes; probe beyond the thickest wall.
    if (!inRoom(r.polygon, [c[0] + n[0] * 0.3, c[1] + n[1] * 0.3])) n = [-n[0], -n[1]];
    const p = (x: number, y: number): V2 => [c[0] + u[0] * x + n[0] * y, c[1] + u[1] * x + n[1] * y];
    openings.push([p(-width / 2 - 0.12, -0.25), p(width / 2 + 0.12, -0.25),
      p(width / 2 + 0.12, clear), p(-width / 2 - 0.12, clear)]);
  };
  for (const door of r.doors) {
    const w = plan.walls[door.wall], d: V2 = [w.b[0] - w.a[0], w.b[1] - w.a[1]], len = Math.hypot(...d);
    opening([w.a[0] + d[0] * door.at / len, w.a[1] + d[1] * door.at / len], d, door.width, S.doorClear);
  }
  for (const wi of r.windows) {
    const w = plan.windows[wi]; opening(w.at, w.dir, w.width, S.windowClear);
  }
  if (r.ceilingZ - r.floorZ + 1e-6 < S.caseHeight + 0.05) return null;
  const attic = plan.levels[plan.levels.length - 1];
  const ceilingAt = r.level === attic.index ? atticCeiling(b, attic.ceilingZ) : () => r.ceilingZ;
  const heights: [SalonRect, number][] = [
    [[-S.fireWidth / 2, 0, S.fireWidth / 2, S.fireDepth + 0.12], S.fireHeight],
    [[-S.fireWidth / 2 - 0.08 - S.caseWidth - 0.025, 0, -S.fireWidth / 2 - 0.055, S.caseDepth + 0.04], S.caseHeight],
    [[S.fireWidth / 2 + 0.055, 0, S.fireWidth / 2 + 0.08 + S.caseWidth + 0.025, S.caseDepth + 0.04], S.caseHeight],
    [[-S.pictureWidth / 2, 0.025, S.pictureWidth / 2, 0.081], S.pictureBottom + S.pictureHeight],
    [solids[1], S.sofaHeight + 0.05], [solids[2], S.sofaHeight + 0.05],
    [solids[3], S.tableHeight], [solids[4], 0.45], [solids[5], 0.49],
  ];
  for (const scale of [1, 0.9, 0.8, 0.7, 0.63]) for (const f of freeStretches(plan, r, true).sort((a, b) => b.s1 - b.s0 - (a.s1 - a.s0))) {
    const lo = f.s0 + half * scale, hi = f.s1 - half * scale;
    if (hi < lo) continue;
    const candidates = [(lo + hi) / 2];
    for (let s = lo; s <= hi; s += S.searchStep) candidates.push(s);
    for (const s of candidates) for (const mirror of [1, -1]) {
      const m = new Matrix4().makeBasis(new Vector3(...f.d, 0).multiplyScalar(scale * mirror),
        new Vector3(...f.n, 0).multiplyScalar(scale), new Vector3(0, 0, 1))
        .setPosition(f.a[0] + f.d[0] * s + f.n[0] * S.wallGap, f.a[1] + f.d[1] * s + f.n[1] * S.wallGap, r.floorZ);
      const footprint = ([x0, y0, x1, y1]: SalonRect): V2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => {
        const p = new Vector3(x, y, 0).applyMatrix4(m); return [p.x, p.y];
      });
      // Reserve the entire arrangement, including its walkway and the rug.
      if (!roomContains(r.polygon, footprint([-half, 0, half, S.depth]))) continue;
      if (solids.some(rect => openings.some(o => overlaps(footprint(rect), o)))) continue;
      if (heights.some(([rect, height]) => footprint(rect).some(p => ceilingAt(p) - r.floorZ + 1e-6 < height + 0.05))) continue;
      return m;
    }
  }
  return null;
}

/** Upholstered sofa faces +y; rounded arms, separate cushions and piping seams. */
function salonSofa(linen: Tris, wood: Tris, m: Matrix4, width: number): void {
  const S = SALON, f = new Part(linen, m), w = new Part(wood, m), d = S.sofaDepth;
  for (const x of [-width / 2 + 0.16, width / 2 - 0.16]) for (const y of [-d / 2 + 0.15, d / 2 - 0.15])
    w.lathe(x, y, [[0, 0], [0.035, 0], [0.028, 0.13], [0, 0.13]], 10);
  f.softBox(0, 0, 0.24, width, d, 0.24, 0.085);
  const count = width > 2 ? 3 : 2, seatW = (width - 0.34) / count;
  for (let i = 0; i < count; i++) {
    const x = -width / 2 + 0.17 + seatW * (i + 0.5);
    f.softBox(x, 0.07, S.seatHeight - 0.08, seatW - 0.025, d - 0.22, 0.16, 0.065);
    f.softBox(x, -d / 2 + 0.15, 0.65, seatW - 0.02, 0.25, 0.43, 0.09);
  }
  for (const side of [-1, 1]) {
    f.softBox(side * (width / 2 - 0.09), 0.02, 0.50, 0.18, d - 0.02, 0.49, 0.085);
    const pm = m.clone().multiply(new Matrix4().makeTranslation(side * (width / 2 - 0.40), -0.08, 0.66))
      .multiply(new Matrix4().makeRotationX(-0.15)).multiply(new Matrix4().makeRotationY(side * 0.14));
    new Part(linen, pm).softBox(0, 0, 0, 0.38, 0.14, 0.36, 0.055);
  }
}

/** Shared cream cabinet: the salon uses books, the dining room uses real crockery. */
function displayCabinet(linen: Tris, brass: Tris, m: Matrix4, x0: number, shelf: (x0: number, x1: number, z: number) => void, width = SALON.caseWidth): void {
  const S = SALON, x1 = x0 + width, stone = new Part(linen, m);
  stone.box(x0, 0, 0, x1, S.caseDepth, 0.63);
  stone.box(x0 + 0.03, S.caseDepth, 0.10, x1 - 0.03, S.caseDepth + 0.018, 0.57);
  new Part(brass, m).lathe((x0 + x1) / 2, S.caseDepth + 0.026, [[0, 0.42], [0.013, 0.42], [0.013, 0.45], [0, 0.45]], 8);
  stone.box(x0, 0, 0.63, x1, 0.02, S.caseHeight);
  for (const x of [x0, x1 - 0.035]) stone.box(x, 0, 0.63, x + 0.035, S.caseDepth, S.caseHeight);
  for (let z = 0.65; z < S.caseHeight - 0.2; z += 0.34) {
    stone.box(x0, 0, z, x1, S.caseDepth, z + 0.025); shelf(x0, x1, z + 0.025);
  }
  stone.box(x0 - 0.025, 0, S.caseHeight - 0.06, x1 + 0.025, S.caseDepth + 0.04, S.caseHeight);
}

/** Original framed landscape shared by the salon mantel and dining sideboard. */
function framedLandscape(linen: Tris, brass: Tris, art: Tris, m: Matrix4, r: PlanRoom, width: number, height: number, bottom: number): void {
  const stone = new Part(linen, m), pw = width / 2, top = bottom + height;
  stone.box(-pw, 0.03, bottom, pw, 0.07, top);
  const gilt = new Part(brass, m);
  for (const x of [-pw, pw - 0.025]) gilt.box(x, 0.025, bottom, x + 0.025, 0.08, top);
  for (const z of [bottom, top - 0.025]) gilt.box(-pw, 0.025, z, pw, 0.08, z + 0.025);
  const ax = pw - 0.085, az = bottom + 0.085, ah = height - 0.17;
  for (let ix = 0; ix < 36; ix++) for (let iz = 0; iz < 20; iz++) {
    const u = (ix + 0.5) / 36, v = (iz + 0.5) / 20;
    const hill = 0.40 + 0.13 * Math.sin(u * 7) + 0.04 * Math.cos(u * 21);
    const variation = 0.93 + 0.08 * Math.sin(ix * 19 + iz * 13);
    const c = (v > hill ? [0.43, 0.55, 0.57] : v > hill - 0.14 ? [0.23, 0.32, 0.18] : [0.40, 0.36, 0.20]).map(n => n * variation);
    art.stamp = [0, ...c, ...c, r.floorZ, r.ceilingZ] as Stamp;
    new Part(art, m).card(-ax + ix * ax * 2 / 36, az + iz * ah / 20, -ax + (ix + 1) * ax * 2 / 36, az + (iz + 1) * ah / 20, 0.081);
  }
}

function fireplace(linen: Tris, brass: Tris, dark: Tris, m: Matrix4): void {
  const S = SALON, stone = new Part(linen, m), black = new Part(dark, m);
  const fw = S.fireWidth / 2, fh = S.fireHeight;
  // Open recess backed with black stone, stepped mantel and fluted pilasters.
  black.box(-fw + 0.20, 0.01, 0.08, fw - 0.20, 0.025, fh - 0.24);
  stone.box(-fw - 0.09, 0, 0, fw + 0.09, S.fireDepth + 0.12, 0.06);
  for (const side of [-1, 1]) {
    const x = side * (fw - 0.13);
    stone.box(x - 0.13, 0.03, 0.06, x + 0.13, S.fireDepth, fh - 0.15);
    stone.box(x - 0.16, 0.01, 0.06, x + 0.16, S.fireDepth + 0.035, 0.16);
    for (const u of [-0.065, 0, 0.065]) stone.box(x + u - 0.009, S.fireDepth, 0.22, x + u + 0.009, S.fireDepth + 0.012, fh - 0.29);
    stone.box(x - 0.15, 0.01, fh - 0.31, x + 0.15, S.fireDepth + 0.025, fh - 0.19);
  }
  stone.box(-fw, 0.02, fh - 0.25, fw, S.fireDepth, fh - 0.10);
  stone.box(-fw - 0.04, 0, fh - 0.10, fw + 0.04, S.fireDepth + 0.025, fh - 0.055);
  stone.box(-fw - 0.09, 0, fh - 0.055, fw + 0.09, S.fireDepth + 0.08, fh);
  new Part(brass, m).lathe(0, 0.30, [[0, 0.07], [0.12, 0.07], [0.12, 0.09], [0, 0.09]], 16);
}

function salonTable(linen: Tris, wood: Tris, m: Matrix4, kind: "stone" | "wood" | "round"): void {
  const S = SALON, stone = new Part(linen, m), w = new Part(wood, m);
  if (kind === "stone") {
  for (const x of [-0.37, 0.37]) stone.box(x - 0.07, 2.1, 0.02, x + 0.07, 2.65, S.tableHeight - 0.05);
  stone.softBox(0, 2 + S.tableDepth / 2, S.tableHeight - 0.035, S.tableWidth, S.tableDepth, 0.07, 0.035);
  } else if (kind === "wood") {
  w.box(0.06, 2.91, 0.02, 0.16, 3.26, 0.43); w.box(0.67, 2.91, 0.02, 0.77, 3.26, 0.43);
  w.softBox(0.425, 3.075, 0.46, 0.75, 0.45, 0.055, 0.026);
  } else {
  w.lathe(0.895, 2.525, [[0, 0.02], [0.18, 0.02], [0.12, 0.06], [0.12, 0.40], [0.275, 0.40], [0.275, 0.45], [0, 0.45]], 28);
  }
}

function salonSet(linen: Tris, wood: Tris, brass: Tris, dark: Tris, books: Tris, rug: Tris, art: Tris,
  plan: BuildingPlan, r: PlanRoom, m: Matrix4, look: Look): void {
  const S = SALON, fw = S.fireWidth / 2;
  fireplace(linen, brass, dark, m);
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -fw - 0.08 - S.caseWidth : fw + 0.08;
    displayCabinet(linen, brass, m, x0, (x0, x1, z) => {
      books.stamp = booksStamp(r.floorZ + 0.65);
      new Part(books, m).card(x0 + 0.04, z, x1 - 0.04, Math.min(z + 0.285, S.caseHeight - 0.06), 0.20);
    });
  }
  const local = (x: number, y: number, turn = 0) => m.clone().multiply(at(x, y, 0, turn));
  salonSofa(linen, wood, local(0, S.depth - S.sofaDepth / 2, Math.PI), S.sofaWidth);
  salonSofa(linen, wood, local(-S.width / 2 + S.sofaDepth / 2, 1.2 + S.shortSofaWidth / 2, -Math.PI / 2), S.shortSofaWidth);
  salonTable(linen, wood, m, "stone");
  salonTable(linen, wood, m, "wood");
  salonTable(linen, wood, m, "round");
  framedLandscape(linen, brass, art, m, r, S.pictureWidth, S.pictureHeight, S.pictureBottom);
  if (look === "real") {
    const x0 = -S.rugWidth / 2, y0 = S.depth - S.rugDepth, origin = new Vector3(x0, y0, 0).applyMatrix4(m);
    const scale = Math.hypot(m.elements[0], m.elements[1]), angle = Math.atan2(m.elements[1], m.elements[0]);
    const handedness = Math.sign(m.elements[0] * m.elements[5] - m.elements[1] * m.elements[4]);
    rug.stamp = salonRugStamp(origin.x - plan.width / 2, plan.length / 2 - origin.y, angle, S.rugWidth * scale, S.rugDepth * scale, r.floorZ, r.ceilingZ, handedness);
    new Part(rug, m).box(x0, y0, 0.008, -x0, S.depth, 0.018);
  }
}

// ------------------------------------------------------------------ rear-right dining sample
export interface DiningInfo {
  furnished: string[];
  rooms: Record<string, { chairs: number; displayCabinets: number }>;
  unfurnished: string[];
}
interface DiningPlacement { m: Matrix4; chairs: 4 | 6; length: number; cabinets: (-1 | 1)[] }

function diningPlacement(plan: BuildingPlan, b: Building, r: PlanRoom): DiningPlacement | null {
  const D = DINING;
  const attic = plan.levels[plan.levels.length - 1];
  const ceilingAt = r.level === attic.index ? atticCeiling(b, attic.ceilingZ) : () => r.ceilingZ;
  let best: DiningPlacement | null = null, bestScore = -1;
  const openings: V2[][] = [];
  const reserve = (at: V2, dir: V2, width: number, clearance: number) => {
    const len = Math.hypot(...dir); if (!len) return;
    const d: V2 = [dir[0] / len, dir[1] / len]; let n: V2 = [-d[1], d[0]];
    if (!inRoom(r.polygon, [at[0] + n[0] * 0.3, at[1] + n[1] * 0.3])) n = [-n[0], -n[1]];
    const p = (x: number, y: number): V2 => [at[0] + d[0] * x + n[0] * y, at[1] + d[1] * x + n[1] * y];
    openings.push([p(-width / 2 - 0.12, -0.25), p(width / 2 + 0.12, -0.25), p(width / 2 + 0.12, clearance), p(-width / 2 - 0.12, clearance)]);
  };
  for (const dr of r.doors) {
    const w = plan.walls[dr.wall], d: V2 = [w.b[0] - w.a[0], w.b[1] - w.a[1]], len = Math.hypot(...d);
    reserve([w.a[0] + d[0] * dr.at / len, w.a[1] + d[1] * dr.at / len], d, dr.width, D.doorClear);
  }
  for (const wi of r.windows) { const w = plan.windows[wi]; reserve(w.at, w.dir, w.width, D.windowClear); }
  if (r.ceilingZ - r.floorZ < D.chairHeight + 0.05) return null;
  for (const chairs of [6, 4] as const) for (const scale of [1, 0.9, 0.8]) {
    const length = chairs === 6 ? D.tableLength : D.tableLength * 0.8;
    const half = chairs === 6 ? D.endOffset + D.chairDepth / 2 : length / 2 + 0.3;
    const rugWidth = chairs === 6 ? D.rugWidth : Math.min(D.rugWidth, half * 2);
    const rects: SalonRect[] = [
      [-D.cabinetWidth / 2, 0, D.cabinetWidth / 2, D.cabinetDepth],
      [-length / 2, D.tableY - D.tableWidth / 2, length / 2, D.tableY + D.tableWidth / 2],
    ];
    for (const side of [-1, 1]) for (const x of [-length / 4, length / 4]) {
      const y = D.tableY + side * D.chairOffset;
      rects.push([x - D.chairWidth / 2, y - D.chairDepth / 2, x + D.chairWidth / 2, y + D.chairDepth / 2]);
    }
    if (chairs === 6) for (const side of [-1, 1]) rects.push([side * D.endOffset - D.chairDepth / 2,
      D.tableY - D.chairWidth / 2, side * D.endOffset + D.chairDepth / 2, D.tableY + D.chairWidth / 2]);
    for (const f of freeStretches(plan, r, true).sort((a, b) => b.s1 - b.s0 - (a.s1 - a.s0))) {
      const lo = f.s0 + half * scale, hi = f.s1 - half * scale; if (hi < lo) continue;
      const candidates = [(lo + hi) / 2]; for (let s = lo; s <= hi; s += D.searchStep) candidates.push(s);
      for (const s of candidates) {
        const m = new Matrix4().makeBasis(new Vector3(...f.d, 0).multiplyScalar(scale), new Vector3(...f.n, 0).multiplyScalar(scale), new Vector3(0, 0, 1))
          .setPosition(f.a[0] + f.d[0] * s + f.n[0] * D.wallGap, f.a[1] + f.d[1] * s + f.n[1] * D.wallGap, r.floorZ);
        const poly = ([x0, y0, x1, y1]: SalonRect): V2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => {
          const p = new Vector3(x, y, 0).applyMatrix4(m); return [p.x, p.y];
        });
        if (!roomContains(r.polygon, poly([-Math.max(half, rugWidth / 2), 0, Math.max(half, rugWidth / 2), D.tableY + D.rugDepth / 2]))) continue;
        if (rects.some(rect => openings.some(o => overlaps(poly(rect), o)))) continue;
        // Pull-back space behind every chair, also clear of opening approaches.
        const pulled = rects.slice(2).map(rect => {
          const cx = (rect[0] + rect[2]) / 2, cy = (rect[1] + rect[3]) / 2;
          const dx = Math.abs(cy - D.tableY) < 0.01 ? Math.sign(cx) * 0.25 : 0;
          const dy = dx ? 0 : Math.sign(cy - D.tableY) * 0.25;
          return [rect[0] + dx, rect[1] + dy, rect[2] + dx, rect[3] + dy] as SalonRect;
        });
        if (pulled.some(rect => !roomContains(r.polygon, poly(rect)) || openings.some(o => overlaps(poly(rect), o)))) continue;
        const heightFits = (rect: SalonRect, height: number) => poly(rect).every(p => ceilingAt(p) - r.floorZ + 1e-6 >= height + 0.05);
        if (!heightFits(rects[0], D.cabinetHeight + D.flowerHeight + 0.03) ||
          !heightFits(rects[1], D.tableHeight + D.flowerHeight + 0.06) ||
          rects.slice(2).some(rect => !heightFits(rect, D.chairHeight + 0.03))) continue;
        const cabinets = ([-1, 1] as const).filter(side => {
          const start = side < 0 ? -D.cabinetWidth / 2 - D.displayGap - SALON.caseWidth : D.cabinetWidth / 2 + D.displayGap;
          const rect: SalonRect = [start - 0.025, 0, start + SALON.caseWidth + 0.025, SALON.caseDepth + 0.04];
          // The entire cabinet must sit on this same uninterrupted wall span.
          const along0 = s + rect[0] * scale, along1 = s + rect[2] * scale;
          return along0 >= f.s0 && along1 <= f.s1 && roomContains(r.polygon, poly(rect)) && !openings.some(o => overlaps(poly(rect), o)) && heightFits(rect, SALON.caseHeight);
        });
        if (!heightFits([-D.pictureWidth / 2, 0.025, D.pictureWidth / 2, 0.081], D.pictureBottom + D.pictureHeight)) continue;
        const score = chairs * 10 + cabinets.length;
        if (score > bestScore) { best = { m, chairs, length, cabinets }; bestScore = score; }
        if (chairs === 6 && cabinets.length === 2) return best;
      }
    }
  }
  return best;
}

function colour(t: Tris, hex: string): void {
  const c = new Color(hex).toArray(); t.stamp = [0, ...c, ...c, 0, 3] as Stamp;
}

/** Six Louis-style seats with oval upholstered backs, curved gilt rails and armrests. */
function diningChair(linen: Tris, brass: Tris, decor: Tris, m: Matrix4): void {
  const D = DINING, w = D.chairWidth, d = D.chairDepth, frame = new Part(linen, m), gilt = new Part(brass, m);
  for (const x of [-w * 0.38, w * 0.38]) for (const y of [-d * 0.38, d * 0.38]) frame.lathe(x, y, leg(D.seatHeight), 10);
  frame.softBox(0, 0, D.seatHeight - 0.055, w, d, 0.09, 0.025);
  colour(decor, "#aab8c7"); new Part(decor, m).softBox(0, 0, D.seatHeight + 0.035, w - 0.065, d - 0.04, 0.10, 0.045);
  for (const x of [-w * 0.35, w * 0.35]) {
    frame.strut(x, D.seatHeight, x * 0.85, D.chairHeight - 0.20, -d * 0.43, 0.032);
    frame.box(x - 0.016, 0.10, D.seatHeight, x + 0.016, 0.13, D.seatHeight + 0.21);
    frame.softBox(x, -0.02, D.seatHeight + 0.21, 0.035, 0.33, 0.04, 0.017);
  }
  const cz = D.chairHeight - 0.23, rx = w * 0.43, rz = 0.235;
  for (let i = 0; i < 24; i++) {
    const a = i * Math.PI * 2 / 24, b = (i + 1) * Math.PI * 2 / 24;
    frame.strut(rx * Math.cos(a), cz + rz * Math.sin(a), rx * Math.cos(b), cz + rz * Math.sin(b), -d * 0.43, 0.043);
    gilt.strut(rx * 0.94 * Math.cos(a), cz + rz * 0.94 * Math.sin(a), rx * 0.94 * Math.cos(b), cz + rz * 0.94 * Math.sin(b), -d * 0.43 + 0.024, 0.008);
  }
  // Thin closed elliptical cushion (front/back discs and rim).
  for (let i = 0; i < 24; i++) {
    const a = i * Math.PI * 2 / 24, b = (i + 1) * Math.PI * 2 / 24;
    const p = (angle: number, y: number) => new Vector3(rx * 0.86 * Math.cos(angle), y, cz + rz * 0.86 * Math.sin(angle)).applyMatrix4(m);
    const y0 = -d * 0.43 - 0.012, y1 = y0 + 0.045;
    for (const [y, sign] of [[y0, -1], [y1, 1]]) decor.tri(new Vector3(0, y, cz).applyMatrix4(m), p(a, y), p(b, y), new Vector3(0, sign, 0).transformDirection(m));
    decor.quad(p(a, y0), p(b, y0), p(b, y1), p(a, y1), new Vector3(Math.cos(a), 0, Math.sin(a)).transformDirection(m));
  }
}

function flowerPot(decor: Tris, m: Matrix4): void {
  const D = DINING, p = new Part(decor, m);
  colour(decor, "#77906a");
  p.lathe(0, 0, [[0, 0], [D.potRadius * 0.65, 0], [D.potRadius, D.potHeight * 0.85], [D.potRadius * 1.04, D.potHeight], [0, D.potHeight]], 20);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39996, x = Math.cos(a) * D.potRadius * 0.8, y = Math.sin(a) * D.potRadius * 0.8;
    const z = D.flowerHeight - (i % 3) * 0.035;
    colour(decor, "#526c41"); p.lathe(x, y, [[0, D.potHeight], [0.004, D.potHeight], [0.004, z], [0, z]], 6);
    for (const side of [-1, 1]) {
      const leaf = m.clone().multiply(at(x + side * 0.018, y, z - 0.06, a)).multiply(new Matrix4().makeRotationY(side * 0.6));
      new Part(decor, leaf).softBox(0, 0, 0, 0.075, 0.025, 0.018, 0.008);
    }
    colour(decor, i % 2 ? "#f2d6d8" : "#f5eee3");
    for (let k = 0; k < 5; k++) {
      const a = k * Math.PI * 2 / 5;
      p.softBox(x + Math.cos(a) * 0.022, y + Math.sin(a) * 0.022, z, 0.036, 0.032, 0.024, 0.012);
    }
    colour(decor, "#c7a450"); p.softBox(x, y, z + 0.01, 0.02, 0.02, 0.02, 0.009);
  }
}

/** Plates on stands, stacked bowls and handled cups, in the salon's cabinet frame. */
function crockeryCabinet(linen: Tris, brass: Tris, decor: Tris, m: Matrix4, x0: number, width = SALON.caseWidth): void {
  let row = 0;
  displayCabinet(linen, brass, m, x0, (left, right, z) => {
    const p = new Part(linen, m), cx = left + (right - left) * 0.28, other = left + (right - left) * 0.73;
    if (row % 2 === 0) {
      const plateM = m.clone().multiply(at(cx, SALON.caseDepth * 0.65, z + 0.115)).multiply(new Matrix4().makeRotationX(-Math.PI / 2));
      new Part(linen, plateM).lathe(0, 0, [[0, 0], [0.07, 0], [0.11, 0.013], [0.11, 0.02], [0.075, 0.008], [0, 0.008]], 28);
      colour(decor, "#536a8a");
      new Part(decor, plateM).lathe(0, 0, [[0.093, 0.012], [0.10, 0.015], [0.10, 0.018], [0.093, 0.015], [0.093, 0.012]], 28);
      p.box(cx - 0.05, 0.16, z, cx + 0.05, 0.29, z + 0.018);
      for (let k = 0; k < 3; k++) p.lathe(other, 0.19,
        [[0, z + k * 0.022], [0.05, z + k * 0.022], [0.095, z + 0.07 + k * 0.022],
          [0.087, z + 0.07 + k * 0.022], [0.045, z + 0.018 + k * 0.022], [0, z + 0.018 + k * 0.022]], 20);
    } else {
      for (const x of [cx, other]) {
        p.lathe(x, 0.19, [[0, z], [0.07, z], [0.07, z + 0.009], [0, z + 0.009]], 20);
        p.lathe(x, 0.19, [[0, z + 0.01], [0.039, z + 0.01], [0.05, z + 0.105],
          [0.043, z + 0.105], [0.032, z + 0.024], [0, z + 0.024]], 20);
        const handleM = m.clone().multiply(at(x + 0.052, 0.19, z + 0.061)).multiply(new Matrix4().makeRotationY(Math.PI / 2));
        new Part(linen, handleM).lathe(0, 0, [[0.02, -0.006], [0.03, -0.006], [0.03, 0.006], [0.02, 0.006], [0.02, -0.006]], 16);
        new Part(brass, m).lathe(x, 0.19, [[0.043, z + 0.101], [0.05, z + 0.101], [0.05, z + 0.105], [0.043, z + 0.105], [0.043, z + 0.101]], 20);
      }
    }
    row++;
  }, width);
}

function diningTable(linen: Tris, wood: Tris, table: Matrix4, length: number): void {
  const D = DINING;
  const w = new Part(wood, table), cloth = new Part(linen, table);
  for (const x of [-length / 2 + 0.15, length / 2 - 0.15]) for (const y of [-D.tableWidth / 2 + 0.12, D.tableWidth / 2 - 0.12])
    w.lathe(x, y, leg(D.tableHeight - 0.05), 10);
  w.box(-length / 2, -D.tableWidth / 2, D.tableHeight - 0.05, length / 2, D.tableWidth / 2, D.tableHeight);
  cloth.softBox(0, 0, D.tableHeight + 0.014, length + 0.035, D.tableWidth + 0.035, 0.028, 0.014);
  // Narrow closed drapes with gently varying hems, rather than a solid block below the table.
  for (const side of [-1, 1]) for (let i = 0; i < 32; i++) {
    const x0 = -length / 2 + length * i / 32, x1 = -length / 2 + length * (i + 1) / 32;
    const y = side * (D.tableWidth / 2 + 0.012 + 0.012 * Math.sin(i * 1.7));
    cloth.box(x0, y - 0.009, D.tableHeight - D.clothDrop + 0.015 * Math.sin(i * 1.7), x1, y + 0.009, D.tableHeight + 0.014);
  }
  for (const side of [-1, 1]) cloth.box(side * length / 2 - 0.009, -D.tableWidth / 2, D.tableHeight - D.clothDrop, side * length / 2 + 0.009, D.tableWidth / 2, D.tableHeight + 0.014);
}

function diningSideboard(linen: Tris, wood: Tris, brass: Tris, m: Matrix4): void {
  const D = DINING;
  const cab = new Part(wood, m), cap = new Part(linen, m), metal = new Part(brass, m), half = D.cabinetWidth / 2;
  cab.box(-half, 0.03, 0.10, half, D.cabinetDepth, D.cabinetHeight - 0.035);
  for (const x of [-half + 0.06, half - 0.06]) for (const y of [0.08, D.cabinetDepth - 0.04]) cab.lathe(x, y, leg(0.15), 10);
  for (let row = 0; row < 3; row++) {
    const z = 0.16 + row * 0.21;
    cab.box(-half + 0.025, D.cabinetDepth, z, half - 0.025, D.cabinetDepth + 0.018, z + 0.19);
    for (const x of [-half * 0.52, half * 0.52]) metal.lathe(x, D.cabinetDepth + 0.028, [[0, z + 0.08], [0.016, z + 0.08], [0.016, z + 0.10], [0, z + 0.10]], 10);
  }
  cap.softBox(0, D.cabinetDepth / 2, D.cabinetHeight - 0.018, D.cabinetWidth + 0.045, D.cabinetDepth + 0.04, 0.036, 0.017);
}

function diningSet(linen: Tris, wood: Tris, brass: Tris, decor: Tris, art: Tris, rug: Tris, plan: BuildingPlan, r: PlanRoom, placement: DiningPlacement, look: Look): void {
  const D = DINING, { m, chairs, length } = placement, table = m.clone().multiply(at(0, D.tableY, 0));
  diningTable(linen, wood, table, length);
  for (const side of [-1, 1]) for (const x of [-length / 4, length / 4]) diningChair(linen, brass, decor,
    m.clone().multiply(at(x, D.tableY + side * D.chairOffset, 0, side > 0 ? Math.PI : 0)));
  if (chairs === 6) for (const side of [-1, 1]) diningChair(linen, brass, decor, m.clone().multiply(at(side * D.endOffset, D.tableY, 0, side > 0 ? Math.PI / 2 : -Math.PI / 2)));
  diningSideboard(linen, wood, brass, m);
  flowerPot(decor, table.clone().multiply(at(0, 0, D.tableHeight + 0.029)));
  flowerPot(decor, m.clone().multiply(at(0, D.cabinetDepth / 2, D.cabinetHeight + 0.001)));
  framedLandscape(linen, brass, art, m, r, D.pictureWidth, D.pictureHeight, D.pictureBottom);
  for (const side of placement.cabinets) crockeryCabinet(linen, brass, decor, m,
    side < 0 ? -D.cabinetWidth / 2 - D.displayGap - SALON.caseWidth : D.cabinetWidth / 2 + D.displayGap);
  if (look === "real") {
    const width = chairs === 6 ? D.rugWidth : Math.min(D.rugWidth, length + 0.6), y0 = D.tableY - D.rugDepth / 2;
    const origin = new Vector3(-width / 2, y0, 0).applyMatrix4(m), scale = Math.hypot(m.elements[0], m.elements[1]);
    rug.stamp = diningRugStamp(origin.x - plan.width / 2, plan.length / 2 - origin.y, Math.atan2(m.elements[1], m.elements[0]), width * scale, D.rugDepth * scale, r.floorZ, r.ceilingZ);
    new Part(rug, m).box(-width / 2, y0, 0.008, width / 2, y0 + D.rugDepth, 0.018);
  }
}

export interface SalonInfo {
  furnished: string[];
  scales: Record<string, number>;
  unfurnished: string[];
}

export interface KitchenInfo {
  furnished: string[];
  unfurnished: string[];
  rooms: Record<string, { aisle: number; wallLength: number; displayCabinets: number }>;
}
interface KitchenPlacement {
  m: Matrix4; left: number; right: number; aisle: number;
  displays: { m: Matrix4; width: number; polygon: V2[] }[];
}

function kitchenStone(t: Tris): void {
  const a = new Color("#e7e2d7").toArray(), b = new Color("#bcb7ab").toArray();
  t.stamp = [5, ...a, ...b, 0, 3] as Stamp;
}

function kitchenHandle(brass: Tris, m: Matrix4, x: number, y: number, z: number): void {
  const K = KITCHEN;
  const bar = m.clone().multiply(at(x - K.handleLength / 2, y, z)).multiply(new Matrix4().makeRotationY(Math.PI / 2));
  new Part(brass, bar).lathe(0, 0, [[0, 0], [K.handleRadius, 0], [K.handleRadius, K.handleLength], [0, K.handleLength]], 12);
  for (const xx of [x - K.handleLength * 0.4, x + K.handleLength * 0.4]) new Part(brass, m).box(xx - K.handleRadius, y - 0.025, z - K.handleRadius, xx + K.handleRadius, y, z + K.handleRadius);
}

function kitchenPanel(linen: Tris, decor: Tris, m: Matrix4, x0: number, x1: number, y: number, z0: number, z1: number): void {
  const K = KITCHEN, p = new Part(linen, m);
  colour(decor, "#c7c3b7"); new Part(decor, m).box(x0, y, z0, x1, y + 0.005, z1);
  p.box(x0 + 0.009, y + 0.006, z0 + 0.009, x1 - 0.009, y + K.doorThickness, z1 - 0.009);
  for (const x of [x0 + 0.015, x1 - K.frame - 0.015]) p.box(x, y + K.doorThickness, z0 + 0.015, x + K.frame, y + K.doorThickness + 0.009, z1 - 0.015);
  for (const z of [z0 + 0.015, z1 - K.frame - 0.015]) p.box(x0 + 0.015, y + K.doorThickness, z, x1 - 0.015, y + K.doorThickness + 0.009, z + K.frame);
}

function kitchenBase(linen: Tris, brass: Tris, decor: Tris, m: Matrix4, width = KITCHEN.moduleWidth): void {
  const K = KITCHEN, w = width / 2, p = new Part(linen, m);
  p.box(-w + 0.025, 0.035, 0, w - 0.025, K.depth - 0.04, 0.12);
  p.box(-w, 0, 0.12, w, K.depth, K.height - K.topThickness);
  for (const [z0, z1] of [[0.15, 0.63], [0.65, K.height - K.topThickness - 0.015]]) {
    kitchenPanel(linen, decor, m, -w + 0.015, w - 0.015, K.depth, z0, z1);
    kitchenHandle(brass, m, 0, K.depth + 0.06, z1 - 0.07);
  }
  kitchenStone(decor); new Part(decor, m).softBox(0, K.depth / 2, K.height - K.topThickness / 2, width + 0.02, K.depth + 0.05, K.topThickness, 0.015);
}

function kitchenUpper(linen: Tris, brass: Tris, decor: Tris, m: Matrix4, width = KITCHEN.moduleWidth - 0.26): void {
  const K = KITCHEN, p = new Part(linen, m);
  p.box(-width / 2, 0, 0, width / 2, K.upperDepth, K.upperHeight);
  kitchenPanel(linen, decor, m, -width / 2 + 0.015, width / 2 - 0.015, K.upperDepth, 0.025, K.upperHeight - 0.025);
  kitchenHandle(brass, m, 0, K.upperDepth + 0.06, 0.13);
  p.box(-width / 2 - 0.015, 0, K.upperHeight - 0.035, width / 2 + 0.015, K.upperDepth + 0.035, K.upperHeight + 0.035);
}

function kitchenRange(linen: Tris, brass: Tris, dark: Tris, decor: Tris, m: Matrix4): void {
  const K = KITCHEN, w = K.rangeWidth / 2, p = new Part(linen, m), metal = new Part(brass, m), black = new Part(dark, m);
  p.box(-w, 0, 0.04, w, K.depth, K.height - 0.05);
  colour(decor, "#56616b"); new Part(decor, m).box(-w + 0.035, K.depth, 0.13, w - 0.035, K.depth + 0.018, 0.76);
  black.box(-w + 0.12, K.depth + 0.02, 0.23, w - 0.12, K.depth + 0.024, 0.60);
  for (const x of [-w + 0.09, w - 0.11]) metal.box(x, K.depth + 0.02, 0.19, x + 0.02, K.depth + 0.03, 0.70);
  for (const z of [0.19, 0.68]) metal.box(-w + 0.09, K.depth + 0.02, z, w - 0.09, K.depth + 0.03, z + 0.02);
  kitchenHandle(brass, m, 0, K.depth + 0.065, 0.65);
  for (let i = -2; i <= 2; i++) {
    const knob = m.clone().multiply(at(i * 0.14, K.depth + 0.035, 0.80)).multiply(new Matrix4().makeRotationX(-Math.PI / 2));
    new Part(brass, knob).lathe(0, 0, [[0, 0], [0.021, 0], [0.021, 0.025], [0, 0.025]], 14);
  }
  black.box(-w, 0, K.height - 0.05, w, K.depth, K.height);
  for (const x of [-w * 0.48, w * 0.48]) for (const y of [K.depth * 0.25, K.depth * 0.75]) {
    black.lathe(x, y, [[0, K.height], [0.058, K.height], [0.058, K.height + 0.02], [0, K.height + 0.02]], 20);
    for (const dx of [-0.085, 0.085]) black.box(x + dx - 0.009, y - 0.10, K.height + 0.02, x + dx + 0.009, y + 0.10, K.height + 0.035);
    for (const dy of [-0.085, 0.085]) black.box(x - 0.10, y + dy - 0.009, K.height + 0.02, x + 0.10, y + dy + 0.009, K.height + 0.035);
  }
}

function kitchenHood(linen: Tris, dark: Tris, m: Matrix4): void {
  const K = KITCHEN, p = new Part(linen, m), half = K.hoodWidth / 2;
  p.box(-half, 0, 0, half, K.hoodDepth, K.hoodHeight);
  for (const z of [0, 0.075, K.hoodHeight - 0.08]) p.box(-half - 0.025, 0, z, half + 0.025, K.hoodDepth + 0.035, z + 0.045);
  // Recessed framed face and two stepped corbels.
  p.box(-half + 0.06, K.hoodDepth, 0.16, half - 0.06, K.hoodDepth + 0.018, K.hoodHeight - 0.12);
  for (const x of [-half + 0.045, half - 0.12]) for (let i = 0; i < 4; i++)
    p.box(x, 0.06 + i * 0.025, -0.19 + i * 0.045, x + 0.075, K.hoodDepth - 0.08, -0.145 + i * 0.045);
  new Part(dark, m).box(-half + 0.12, 0.06, -0.008, half - 0.12, K.hoodDepth - 0.06, 0.003);
}

function kitchenIsland(linen: Tris, brass: Tris, dark: Tris, decor: Tris, m: Matrix4): void {
  const K = KITCHEN, p = new Part(linen, m), half = K.islandLength / 2, d = K.islandDepth / 2;
  p.box(-half + 0.025, -d + 0.025, 0, half - 0.025, d - 0.025, 0.12);
  p.box(-half, -d, 0.12, half, d, K.height - K.sinkDrop - 0.015);
  for (const x of [-half, half - 0.035]) p.box(x, -d, K.height - K.sinkDrop - 0.015, x + 0.035, d, K.height - K.topThickness);
  for (const y of [-d, d - 0.035]) p.box(-half, y, K.height - K.sinkDrop - 0.015, half, y + 0.035, K.height - K.topThickness);
  for (const side of [-1, 1]) {
    const front = m.clone().multiply(at(0, side * d, 0, side < 0 ? Math.PI : 0));
    for (const x of [-half / 2, half / 2]) {
      kitchenPanel(linen, decor, front, x - half / 2 + 0.014, x + half / 2 - 0.014, 0, 0.14, 0.64);
      kitchenPanel(linen, decor, front, x - half / 2 + 0.014, x + half / 2 - 0.014, 0, 0.66, K.height - K.topThickness - 0.01);
      kitchenHandle(brass, front, x, 0.055, 0.76);
    }
  }
  // Four stone slabs form a genuine sink opening, with a recessed closed basin below.
  kitchenStone(decor); const stone = new Part(decor, m), sw = K.sinkWidth / 2, sd = K.sinkDepth / 2, z0 = K.height - K.topThickness;
  stone.box(-half - 0.025, -d - 0.025, z0, -sw, d + 0.025, K.height);
  stone.box(sw, -d - 0.025, z0, half + 0.025, d + 0.025, K.height);
  stone.box(-sw, -d - 0.025, z0, sw, -sd, K.height);
  stone.box(-sw, sd, z0, sw, d + 0.025, K.height);
  const basin = new Part(dark, m), bottom = K.height - K.sinkDrop;
  basin.box(-sw, -sd, bottom, sw, sd, bottom + 0.012);
  for (const x of [-sw, sw - 0.012]) basin.box(x, -sd, bottom, x + 0.012, sd, K.height);
  for (const y of [-sd, sd - 0.012]) basin.box(-sw, y, bottom, sw, y + 0.012, K.height);
  const faucet = new Part(brass, m), r = K.tapRadius, fy = sd + 0.075;
  faucet.lathe(0, fy, [[0, K.height], [r * 2, K.height], [r * 2, K.height + 0.025], [r, K.height + 0.025], [r, K.height + K.tapHeight * 0.65], [0, K.height + K.tapHeight * 0.65]], 16);
  const crown = K.height + K.tapHeight * 0.65, radius = K.tapHeight * 0.35;
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 12, b = (i + 1) * Math.PI / 12;
    const tube = m.clone().multiply(at(0, fy - radius, crown)).multiply(new Matrix4().makeRotationZ(Math.PI / 2));
    new Part(brass, tube).strut(radius * Math.cos(a), radius * Math.sin(a), radius * Math.cos(b), radius * Math.sin(b), 0, r * 2);
  }
}

/** The island clearance is measured in metres; the set is never uniformly shrunk. */
function kitchenPlacement(plan: BuildingPlan, r: PlanRoom): KitchenPlacement | null {
  const K = KITCHEN, length = K.rangeWidth + K.moduleWidth * 2;
  const openings: V2[][] = [];
  const reserve = (c: V2, d: V2, width: number, clear: number) => {
    const len = Math.hypot(...d); if (!len) return;
    const u: V2 = [d[0] / len, d[1] / len]; let n: V2 = [-u[1], u[0]];
    if (!inRoom(r.polygon, [c[0] + n[0] * 0.3, c[1] + n[1] * 0.3])) n = [-n[0], -n[1]];
    const p = (x: number, y: number): V2 => [c[0] + u[0] * x + n[0] * y, c[1] + u[1] * x + n[1] * y];
    openings.push([p(-width / 2 - 0.10, -0.25), p(width / 2 + 0.10, -0.25), p(width / 2 + 0.10, clear), p(-width / 2 - 0.10, clear)]);
  };
  for (const dr of r.doors) {
    const w = plan.walls[dr.wall], d: V2 = [w.b[0] - w.a[0], w.b[1] - w.a[1]], len = Math.hypot(...d);
    reserve([w.a[0] + d[0] * dr.at / len, w.a[1] + d[1] * dr.at / len], d, dr.width, K.doorClear);
  }
  for (const wi of r.windows) { const w = plan.windows[wi]; reserve(w.at, w.dir, w.width, K.windowClear); }
  if (r.ceilingZ - r.floorZ < K.hoodBottom + K.hoodHeight + 0.05) return null;
  type Edge = ReturnType<typeof freeStretches>[number];
  const frame = (f: Edge, s: number) => new Matrix4().makeBasis(new Vector3(...f.d, 0), new Vector3(...f.n, 0), new Vector3(0, 0, 1))
    .setPosition(f.a[0] + f.d[0] * s + f.n[0] * K.wallGap, f.a[1] + f.d[1] * s + f.n[1] * K.wallGap, r.floorZ);
  const poly = (m: Matrix4, [x0, y0, x1, y1]: SalonRect): V2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => {
    const p = new Vector3(x, y, 0).applyMatrix4(m); return [p.x, p.y];
  });
  const spans = (f: Edge, depth: number, obstacles: V2[][]): [number, number][] => {
    let runs: [number, number][] = [[f.s0 + K.endClear, f.s1 - K.endClear]];
    const strip = poly(frame(f, 0), [f.s0, 0, f.s1, depth]);
    for (const obstacle of obstacles) {
      if (!overlaps(strip, obstacle)) continue;
      const along = obstacle.map(p => (p[0] - f.a[0]) * f.d[0] + (p[1] - f.a[1]) * f.d[1]);
      const lo = Math.min(...along) - K.displayClear, hi = Math.max(...along) + K.displayClear;
      runs = runs.flatMap(([a, b]) => hi <= a || lo >= b ? [[a, b] as [number, number]]
        : [[a, Math.min(b, lo)], [Math.max(a, hi), b]].filter(([x, y]) => y > x) as [number, number][]);
    }
    return runs;
  };
  let best: KitchenPlacement | null = null, bestScore = -Infinity;
  const edges = freeStretches(plan, r, true);
  for (const f of freeStretches(plan, r)) for (const [start, end] of spans(f, K.depth + K.frontProjection, openings)) {
    if (end - start < length) continue;
    const lo = start + K.hoodWidth / 2 + 0.35, hi = end - K.hoodWidth / 2 - 0.35;
    const candidates = [(lo + hi) / 2]; for (let s = lo; s <= hi; s += K.searchStep) candidates.push(s);
    for (const aisle of [K.aisle, (K.aisle + K.narrowAisle) / 2, K.narrowAisle]) for (const s of candidates) {
      const m = frame(f, s), left = start - s, right = end - s;
      const islandY = K.depth + K.frontProjection + aisle + K.islandDepth / 2 + K.frontProjection;
      const counter = poly(m, [left - 0.01, 0, right + 0.01, K.depth + K.frontProjection]);
      const island = poly(m, [-K.islandLength / 2 - 0.025, islandY - K.islandDepth / 2 - K.frontProjection,
        K.islandLength / 2 + 0.025, islandY + K.islandDepth / 2 + K.frontProjection]);
      if ([counter, island].some(p => !roomContains(r.polygon, p) || openings.some(o => overlaps(p, o)))) continue;
      const islandEnvelope = poly(m, [-K.islandLength / 2 - K.outerClear, islandY - K.islandDepth / 2 - K.frontProjection,
        K.islandLength / 2 + K.outerClear, islandY + K.islandDepth / 2 + K.frontProjection + K.outerClear]);
      if (!roomContains(r.polygon, islandEnvelope)) continue;
      const displays: KitchenPlacement['displays'] = [];
      if (r.ceilingZ - r.floorZ + 1e-6 >= SALON.caseHeight + 0.05) for (const other of edges) {
        if (other.n[0] * f.n[0] + other.n[1] * f.n[1] > -0.9) continue;
        for (const [a, b] of spans(other, SALON.caseDepth + 0.04, [...openings, counter, islandEnvelope])) {
          if (b - a < 0.60) continue;
          const count = Math.min(Math.ceil((b - a) / SALON.caseWidth), Math.floor((b - a) / 0.60)), unit = (b - a) / count;
          for (let i = 0; i < count; i++) {
            const displayM = frame(other, a + i * unit + K.displayClear), width = unit - 2 * K.displayClear;
            const footprint = poly(displayM, [-K.displayClear, 0, width + K.displayClear, SALON.caseDepth + 0.04]);
            if (!roomContains(r.polygon, footprint) || [...openings, counter, islandEnvelope, ...displays.map(d => d.polygon)].some(o => overlaps(footprint, o))) continue;
            displays.push({ m: displayM, width, polygon: footprint });
          }
        }
      }
      const displayLength = displays.reduce((sum, d) => sum + d.width, 0);
      const score = displayLength * 1000 + (right - left) * 100 + aisle;
      if (score > bestScore) { best = { m, left, right, aisle, displays }; bestScore = score; }
    }
  }
  return best;
}

export interface FurnitureInfo {
  lamps: Vector3[];
}

export interface FurnitureItem { name: string; zh: string; category: string; group: Group }

/** Catalogue recipes call the same component builders as furnished rooms. */
export function buildFurnitureItems(mats: InteriorMaterials): FurnitureItem[] {
  type Parts = { wood: Tris; linen: Tris; fabric: Tris; gold: Tris; dark: Tris; brass: Tris; leather: Tris; shade: Tris; books: Tris; art: Tris; rug: Tris };
  const items: FurnitureItem[] = [], m = new Matrix4();
  const room = { floorZ: 0, ceilingZ: 3 } as PlanRoom;
  const add = (category: string, name: string, zh: string, build: (p: Parts) => void) => {
    const p: Parts = { wood: new Tris(), linen: new Tris(), fabric: new Tris(), gold: new Tris(), dark: new Tris(),
      brass: new Tris(), leather: new Tris(), shade: new Tris(), books: new Tris(), art: new Tris(), rug: new Tris() };
    build(p);
    const group = new Group(); group.name = name; group.userData.furnitureItem = { name, zh, category };
    const entries: [Tris, Material][] = [[p.wood, mats.furnWood], [p.linen, mats.furnLinen], [p.fabric, mats.furnFabric],
      [p.gold, mats.furnGold], [p.dark, mats.furnDark], [p.brass, mats.furnBrass], [p.leather, mats.furnLeather],
      [p.shade, mats.furnShade], [p.books, mats.finishWall], [p.art, mats.finishWall], [p.rug, mats.finishFloor]];
    for (const [tris, material] of entries) if (tris.pos.length) {
      const mesh = new Mesh(tris.geometry(), material);
      mesh.castShadow = tris !== p.rug && tris !== p.books && tris !== p.art && tris !== p.shade;
      mesh.receiveShadow = true; group.add(mesh);
    }
    items.push({ category, name, zh, group });
  };
  const rug = (p: Parts, kind: "ballroom" | "salon" | "dining", width: number, depth: number) => {
    p.rug.stamp = kind === "ballroom" ? carpetStamp(-width / 2, depth / 2, width, depth, 0, 3)
      : kind === "salon" ? salonRugStamp(-width / 2, depth / 2, 0, width, depth, 0, 3)
        : diningRugStamp(-width / 2, depth / 2, 0, width, depth, 0, 3);
    new Part(p.rug, m).box(-width / 2, -depth / 2, 0, width / 2, depth / 2, 0.018);
  };
  add("宴會廳", "Banquet table", "宴會長桌", p => banquetTable(p.linen, p.gold, m, DINING.tableLength * 2));
  add("宴會廳", "Banquet chair", "宴會餐椅", p => banquetChair(p.wood, p.fabric, m));
  add("宴會廳", "Banquet rug", "宴會廳地毯", p => rug(p, "ballroom", SALON.rugWidth, SALON.rugDepth));
  add("書房", "Study desk", "書房書桌", p => desk(p.wood, p.dark, m, 1.4, 0.7));
  add("書房", "Reading table", "長型閱讀桌", p => desk(p.wood, p.dark, m, 2.4, 0.85));
  add("書房", "Study chair", "書房木椅", p => studyChair(p.dark, p.wood, m));
  add("書房", "Wall bookcase", "書房壁面書櫃", p => {
    p.books.stamp = booksStamp(CASE.plinth);
    bookcase(p.wood, p.books, { a: [0, 0], d: [1, 0], n: [0, 1], s0: 0, s1: 1 }, 0, CASE.top);
  });
  add("書房", "Open book", "攤開的書", p => openBook(p.leather, p.linen, m));
  add("書房", "Brass desk lamp", "黃銅書桌檯燈", p => { lamp(p.brass, p.shade, m); });
  add("臥室", "Double bed", "雙人床", p => doubleBed(p.linen, m));
  add("臥室", "Bedside table", "床頭櫃", p => nightstand(p.linen, p.brass, m));
  add("臥室", "Pleated lamp", "褶紋床頭檯燈", p => { bedsideLamp(p.brass, p.shade, m); });
  add("客廳", "Main sofa", "客廳主沙發", p => salonSofa(p.linen, p.wood, m, SALON.sofaWidth));
  add("客廳", "Short sofa", "客廳短沙發", p => salonSofa(p.linen, p.wood, m, SALON.shortSofaWidth));
  add("客廳", "Stone coffee table", "石材矮茶几", p => salonTable(p.linen, p.wood, m, "stone"));
  add("客廳", "Wood coffee table", "木色長茶几", p => salonTable(p.linen, p.wood, m, "wood"));
  add("客廳", "Round side table", "圓形側桌", p => salonTable(p.linen, p.wood, m, "round"));
  add("客廳", "French fireplace", "法式壁爐", p => fireplace(p.linen, p.brass, p.dark, m));
  add("客廳", "Cream bookcase", "奶油色書櫃", p => displayCabinet(p.linen, p.brass, m, 0, (x0, x1, z) => {
    p.books.stamp = booksStamp(0.65); new Part(p.books, m).card(x0 + 0.04, z, x1 - 0.04, Math.min(z + 0.285, SALON.caseHeight - 0.06), 0.20);
  }));
  add("客廳", "Framed landscape", "金框風景掛畫", p => framedLandscape(p.linen, p.brass, p.art, m, room, SALON.pictureWidth, SALON.pictureHeight, 0));
  add("客廳", "Salon rug", "客廳花紋地毯", p => rug(p, "salon", SALON.rugWidth, SALON.rugDepth));
  add("餐廳", "Dining table", "六人長方形餐桌", p => diningTable(p.linen, p.wood, m, DINING.tableLength));
  add("餐廳", "Compact dining table", "四人長方形餐桌", p => diningTable(p.linen, p.wood, m, DINING.tableLength * 0.8));
  add("餐廳", "French dining chair", "法式灰藍餐椅", p => diningChair(p.linen, p.brass, p.art, m));
  add("餐廳", "Dining sideboard", "餐邊櫃", p => diningSideboard(p.linen, p.wood, p.brass, m));
  add("餐廳", "Crockery cabinet", "餐具展示高櫃", p => crockeryCabinet(p.linen, p.brass, p.art, m, 0));
  add("餐廳", "Flower pot", "花盆與花束", p => flowerPot(p.art, m));
  add("餐廳", "Dining rug", "餐廳花紋地毯", p => rug(p, "dining", DINING.rugWidth, DINING.rugDepth));
  add("廚房", "Kitchen base cabinet", "廚房下櫃與檯面", p => kitchenBase(p.linen, p.brass, p.art, m));
  add("廚房", "Kitchen wall cabinet", "廚房吊櫃", p => kitchenUpper(p.linen, p.brass, p.art, m));
  add("廚房", "Gas range and oven", "瓦斯爐與烤箱", p => kitchenRange(p.linen, p.brass, p.dark, p.art, m));
  add("廚房", "French extractor hood", "法式抽油煙機", p => kitchenHood(p.linen, p.dark, m));
  add("廚房", "Island with sink", "中島、水槽與水龍頭", p => kitchenIsland(p.linen, p.brass, p.dark, p.art, m));
  return items;
}

/** Ballroom, studies and bedrooms, merged by material. */
export function buildFurniture(plan: BuildingPlan, b: Building, mats: InteriorMaterials, look: Look): Group {
  const group = new Group();
  const lamps: Vector3[] = [];
  const wood = new Tris(), fabric = new Tris(), linen = new Tris(), gold = new Tris(), rug = new Tris();
  const dark = new Tris(), brass = new Tris(), leather = new Tris(), shade = new Tris(), books = new Tris();
  const salonRug = new Tris(), salonArt = new Tris();
  const diningDecor = new Tris(), diningRug = new Tris();

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
      const units = r.level === attic.index || r.polygon.length > 4 ? Math.ceil((f.s1 - f.s0) / 1.05) : 1;
      for (let k = 0; k < units; k++) {
        const u = { ...f, s0: f.s0 + ((f.s1 - f.s0) * k) / units, s1: f.s0 + ((f.s1 - f.s0) * (k + 1)) / units };
        const corner = (s: number, d: number): V2 => [u.a[0] + u.d[0] * s + u.n[0] * d, u.a[1] + u.d[1] * s + u.n[1] * d];
        if (!roomContains(r.polygon, [corner(u.s0, 0), corner(u.s1, 0), corner(u.s1, CASE.depth + 0.04), corner(u.s0, CASE.depth + 0.04)])) continue;
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
    let big = long >= 3.8 && short >= 2.6;
    let length = big ? Math.min(2.4, long - 1.4) : Math.min(1.4, long - 1.4), dep = big ? 0.85 : 0.7;
    if (length < 1.0 || short < dep + 1.1) continue;
    let turn = alongX ? 0 : Math.PI / 2;
    // where it stands: the middle if it can, else the nearest place with the headroom for the chair and
    // the lamp, and clear of the doors
    const doors: V2[] = r.doors.map(dr => {
      const w = plan.walls[dr.wall], wl = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      return [w.a[0] + ((w.b[0] - w.a[0]) / wl) * dr.at, w.a[1] + ((w.b[1] - w.a[1]) / wl) * dr.at];
    });
    const fits = (px: number, py: number) => {
      const m = at(px, py, 0, turn);
      const inv = m.clone().invert();
      const footprint = [[-length / 2, -dep / 2 - 0.5], [length / 2, -dep / 2 - 0.5],
        [length / 2, dep / 2 + 0.5], [-length / 2, dep / 2 + 0.5]].map(([x, y]) => {
          const p = new Vector3(x, y, 0).applyMatrix4(m); return [p.x, p.y] as V2;
        });
      if (!roomContains(r.polygon, footprint)) return false;
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
    const [mx, my] = roomAnchor(r.polygon)!;
    let spot: V2 | null = null;
    const initial = { big, length, dep, turn };
    const options = [initial, { ...initial, turn: initial.turn + Math.PI / 2 }];
    if (big) options.push({ big: false, length: 1.4, dep: 0.7, turn: initial.turn }, { big: false, length: 1.4, dep: 0.7, turn: initial.turn + Math.PI / 2 });
    for (const option of options) {
      ({ big, length, dep, turn } = option);
      for (let step = 0; step <= Math.ceil(Math.max(roomW, roomD) / 0.4) && !spot; step++) {
        const ring: V2[] = [];
        for (let ix = -step; ix <= step; ix++) for (let iy = -step; iy <= step; iy++) {
          if (Math.max(Math.abs(ix), Math.abs(iy)) === step) ring.push([mx + ix * 0.2, my + iy * 0.2]);
        }
        spot = ring.sort((p, q) => Math.hypot(p[0] - mx, p[1] - my) - Math.hypot(q[0] - mx, q[1] - my)).find(p => fits(p[0], p[1])) ?? null;
      }
      if (spot) break;
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
  const oneTableBedrooms: string[] = [];
  for (const r of plan.rooms.filter(r => r.type === "bedroom")) {
    const placement = bedroomPlacement(plan, b, r);
    if (!placement) { unfurnishedBedrooms.push(r.id); continue; }
    bedroomSet(linen, brass, shade, placement.m, lamps, placement.sides);
    if (placement.sides.length === 1) oneTableBedrooms.push(r.id);
    bedrooms.push(r.id);
  }
  group.userData.bedrooms = { furnished: bedrooms, oneTable: oneTableBedrooms, unfurnished: unfurnishedBedrooms };

  // All current salons, including rooms converted or merged in the editor.
  const salonInfo: SalonInfo = { furnished: [], scales: {}, unfurnished: [] };
  for (const r of plan.rooms.filter(r => r.type === "salon")) {
    const m = salonPlacement(plan, b, r);
    if (!m) { salonInfo.unfurnished.push(r.id); continue; }
    salonSet(linen, wood, brass, dark, books, salonRug, salonArt, plan, r, m, look);
    salonInfo.furnished.push(r.id);
    salonInfo.scales[r.id] = Math.hypot(m.elements[0], m.elements[1]);
  }
  group.userData.salons = salonInfo;

  const diningInfo: DiningInfo = { furnished: [], rooms: {}, unfurnished: [] };
  for (const diningRoom of plan.rooms.filter(r => r.type === "dining")) {
    const placement = diningPlacement(plan, b, diningRoom);
    if (placement) {
      diningSet(linen, wood, brass, diningDecor, salonArt, diningRug, plan, diningRoom, placement, look);
      diningInfo.furnished.push(diningRoom.id);
      diningInfo.rooms[diningRoom.id] = { chairs: placement.chairs, displayCabinets: placement.cabinets.length };
    } else diningInfo.unfurnished.push(diningRoom.id);
  }
  group.userData.dining = diningInfo;

  const kitchenInfo: KitchenInfo = { furnished: [], unfurnished: [], rooms: {} };
  for (const r of plan.rooms.filter(r => r.type === "kitchen" && r.level === 1)) {
    const placement = kitchenPlacement(plan, r);
    if (!placement) { kitchenInfo.unfurnished.push(r.id); continue; }
    const { m, left, right, aisle, displays } = placement, K = KITCHEN;
    kitchenRange(linen, brass, dark, diningDecor, m);
    kitchenHood(linen, dark, m.clone().multiply(at(0, 0, K.hoodBottom)));
    for (const [a, b] of [[left, -K.rangeWidth / 2], [K.rangeWidth / 2, right]]) {
      const count = Math.max(1, Math.ceil((b - a) / K.moduleWidth)), width = (b - a) / count;
      for (let i = 0; i < count; i++) kitchenBase(linen, brass, diningDecor, m.clone().multiply(at(a + width * (i + 0.5), 0, 0)), width);
    }
    for (const [a, b] of [[left + 0.015, -K.hoodWidth / 2 - 0.05], [K.hoodWidth / 2 + 0.05, right - 0.015]]) {
      const count = Math.max(1, Math.ceil((b - a) / K.moduleWidth)), width = (b - a) / count;
      if (width < 0.25) continue;
      for (let i = 0; i < count; i++) kitchenUpper(linen, brass, diningDecor, m.clone().multiply(at(a + width * (i + 0.5), 0, K.upperBottom)), width);
    }
    colour(diningDecor, "#ddd7c9");
    new Part(diningDecor, m).box(left, 0, K.height, right, 0.012, K.hoodBottom);
    const islandY = K.depth + K.frontProjection + aisle + K.islandDepth / 2 + K.frontProjection;
    kitchenIsland(linen, brass, dark, diningDecor, m.clone().multiply(at(0, islandY, 0)));
    for (const display of displays) crockeryCabinet(linen, brass, diningDecor, display.m, 0, display.width);
    kitchenInfo.furnished.push(r.id);
    kitchenInfo.rooms[r.id] = { aisle, wallLength: right - left, displayCabinets: displays.length };
  }
  group.userData.kitchens = kitchenInfo;

  const parts: [Tris, Material][] = [
    [wood, mats.furnWood], [fabric, mats.furnFabric], [linen, mats.furnLinen], [gold, mats.furnGold], [rug, mats.finishFloor],
    [dark, mats.furnDark], [brass, mats.furnBrass], [leather, mats.furnLeather], [shade, mats.furnShade], [books, mats.finishWall],
    [salonRug, mats.finishFloor], [salonArt, mats.finishWall],
    [diningRug, mats.finishFloor], [diningDecor, mats.finishWall],
  ];
  for (const [t, m] of parts) {
    if (!t.pos.length) continue;
    const mesh = new Mesh(t.geometry(), m);
    mesh.castShadow = t !== rug && t !== salonRug && t !== diningRug && t !== salonArt && t !== books && t !== shade;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.userData.furniture = { lamps } satisfies FurnitureInfo;
  return group;
}
