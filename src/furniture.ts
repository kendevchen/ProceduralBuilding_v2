/**
 * Furnishings (INTERIOR_SPEC.md §6.8), in code like the stairs: plain geometry
 * merged per material, with repeated recipes sharing instanced geometry.
 * Geometry remains generated here rather than going through Blender.
 *   - the ballroom: a rounded walnut table, gilt upholstered chairs, cards and
 *     floral centerpieces, chandeliers, painting, consoles and glass cabinets;
 *     its original carpet remains on the parquet (finishes.ts);
 *   - the studies: bookcases along the walls without windows (the books are a
 *     shader pattern on a card in each shelf), a desk or reading table with turned
 *     legs, ebony chairs with spindle backs, an open book and brass lamps whose
 *     shades glow (the lamps' lights are lampLights.ts).
 *   - the bedrooms: large rooms have sage panels (finishes.ts), white upholstered
 *     double beds, brass-framed bedside tables and pleated glowing lamps.
 * Every solid is closed, so a cut through it shows the section colour. Blender
 * Z-up space, like rooms3d.ts.
 */
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CanvasTexture, Color, Group, type Material, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from "three";
import { type Look, type Stamp, atticWoodStamp, atticBooksStamp, atticFabricStamp, atticGlassStamp, booksStamp, carpetStamp, salonRugStamp, diningRugStamp, kitchenBacksplashStamp, kitchenWorktopStamp, banquetWoodStamp, banquetFabricStamp, cafeWoodStamp, cafeFurnitureStamp, cafeStoneStamp, cafeWickerStamp, stampOf } from "./finishes";
import type { BuildingPlan, PlanRoom } from "./plan";
import { buildingFacade, type Building } from "./generator";
import type { CafeTheme } from "./cafes";
import type { AtticTheme } from "./attics";
import { ballroomPainting, ballroomHighPainting, banquetPlaceCard } from "./ballroomArt";
import { type InteriorMaterials, Tris, atticCeiling } from "./rooms3d";
import type { V2 } from "./roof";
import dims from "../blender/kit_dims.json";
import { inRoom, roomAnchor, roomContains } from "./roomGeometry";
import { FurnitureInstances, instanceRecipe } from './furnitureInstances';

const BANQUET = dims.interior.banquetFurniture;
const BED = dims.interior.bedroomFurniture;
const SALON = dims.interior.salonFurniture;
const DINING = dims.interior.diningFurniture;
const KITCHEN = dims.interior.kitchenFurniture;

/** the parquet that shows round the carpet, and the clearance round the table */
const RUG_MARGIN = 0.55;
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

/** Closed capsule slab: rounded ends without dense bevel geometry. */
function banquetSlab(t: Tris, m: Matrix4, length: number, width: number, z0: number, z1: number): void {
  const r = width / 2, straight = Math.max(0, (length - width) / 2), outline: V2[] = [];
  for (const side of [1, -1]) for (let i = 0; i <= 12; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / 12 + (side < 0 ? Math.PI : 0);
    outline.push([side * straight + r * Math.cos(angle), r * Math.sin(angle)]);
  }
  const point = (v: V2, z: number) => new Vector3(v[0], v[1], z).applyMatrix4(m);
  const up = new Vector3(0, 0, 1).transformDirection(m);
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const normal = new Vector3(b[1] - a[1], a[0] - b[0], 0).transformDirection(m);
    t.quad(point(a, z0), point(b, z0), point(b, z1), point(a, z1), normal);
    t.tri(new Vector3(0, 0, z1).applyMatrix4(m), point(a, z1), point(b, z1), up);
    t.tri(new Vector3(0, 0, z0).applyMatrix4(m), point(b, z0), point(a, z0), up.clone().negate());
  });
}

function banquetTable(decor: Tris, brass: Tris, m: Matrix4, length: number): void {
  const B = BANQUET, h = B.tableHeight, p = new Part(decor, m);
  decor.stamp = banquetWoodStamp();
  banquetSlab(decor, m, length, B.tableWidth, h - 0.065, h);
  banquetSlab(decor, m, length - 0.12, B.tableWidth - 0.12, h - 0.17, h - 0.065);
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    p.lathe(x * (length / 2 - B.tableWidth * 0.45), y * B.tableWidth * 0.32, leg(h - 0.13).map(([r, z]) => [r * 1.8, z]), 8);
    new Part(brass, m).lathe(x * (length / 2 - B.tableWidth * 0.45), y * B.tableWidth * 0.32,
      [[0.044, 0.04], [0.047, 0.04], [0.047, 0.075], [0.044, 0.075], [0.044, 0.04]], 8);
  }
  banquetSlab(brass, m, length + 0.006, B.tableWidth + 0.006, h - 0.062, h - 0.053);
}

/** Gilt rectangular upholstered back; end chairs have curved arm supports. */
function banquetChair(brass: Tris, decor: Tris, m: Matrix4, arms = false): void {
  const B = BANQUET, w = B.chairWidth / 2, d = B.chairDepth / 2, g = new Part(brass, m);
  for (const x of [-w * 0.85, w * 0.85]) for (const y of [-d * 0.85, d * 0.85]) g.lathe(x, y, leg(B.seatHeight - 0.03), 6);
  g.box(-w, -d, B.seatHeight - 0.055, w, d, B.seatHeight);
  for (const x of [-w, w - 0.025]) g.box(x, -d - 0.015, B.seatHeight, x + 0.025, -d + 0.025, B.chairHeight);
  for (const z of [B.seatHeight + 0.1, B.chairHeight - 0.04]) g.box(-w, -d - 0.018, z, w, -d + 0.03, z + 0.035);
  decor.stamp = banquetFabricStamp();
  const pad = new Part(decor, m);
  pad.box(-w + 0.025, -d + 0.02, B.seatHeight, w - 0.025, d - 0.02, B.seatHeight + 0.055);
  pad.box(-w + 0.03, -d - 0.012, B.seatHeight + 0.14, w - 0.03, -d + 0.024, B.chairHeight - 0.05);
  if (arms) for (const sign of [-1, 1]) {
    const arm = new Part(brass, m.clone().multiply(at(sign * (w + 0.025), 0, 0)).multiply(new Matrix4().makeRotationZ(Math.PI / 2)));
    arm.strut(-d, B.seatHeight + 0.08, -d * 0.4, B.seatHeight + 0.22, 0, 0.025);
    arm.strut(-d * 0.4, B.seatHeight + 0.22, d * 0.85, B.seatHeight + 0.23, 0, 0.035);
    arm.strut(d * 0.85, B.seatHeight + 0.23, d * 0.75, B.seatHeight, 0, 0.025);
  }
}

function banquetCard(linen: Tris, brass: Tris, m: Matrix4): void {
  const B = BANQUET;
  new Part(linen, m).box(-B.placeCardWidth / 2, -0.018, 0, B.placeCardWidth / 2, 0.018, B.placeCardHeight);
  new Part(brass, m).box(-B.placeCardWidth / 2 - 0.005, -0.024, 0, B.placeCardWidth / 2 + 0.005, 0.024, 0.008);
}

function banquetCenterpiece(brass: Tris, decor: Tris, bulb: Tris, m: Matrix4): void {
  flowerPot(decor, m.clone().multiply(new Matrix4().makeScale(0.75, 0.75, 0.75)));
  for (const side of [-1, 1]) {
    const local = m.clone().multiply(at(side * 0.26, 0, 0)), stem = new Part(brass, local);
    stem.lathe(0, 0, [[0, 0], [0.065, 0], [0.065, 0.025], [0.02, 0.05], [0.015, 0.22], [0.045, 0.23], [0, 0.23]], 8);
    colour(decor, "#eee4ca"); new Part(decor, local).lathe(0, 0, [[0, 0.23], [0.018, 0.23], [0.018, 0.38], [0, 0.38]], 8);
    new Part(bulb, local).lathe(0, 0, [[0, 0.38], [0.012, 0.40], [0, 0.425]], 6);
  }
}

function banquetChandelier(brass: Tris, crystal: Tris, bulb: Tris, m: Matrix4, suspension: number): void {
  const B = BANQUET, g = new Part(brass, m), h = B.chandelierHeight;
  g.lathe(0, 0, [[0, 0.12], [0.07, 0.14], [0.10, 0.25], [0.055, 0.38], [0.08, h * 0.65], [0.025, h], [0, h]], 10);
  g.lathe(0, 0, [[0, h], [0.012, h], [0.012, suspension], [0, suspension]], 6);
  g.lathe(0, 0, [[0, suspension - 0.015], [0.12, suspension - 0.015], [0.12, suspension], [0, suspension]], 12);
  for (const tier of [0, 1]) {
    const count = tier ? 4 : 8, radius = B.chandelierRadius * (tier ? 0.65 : 1), z = tier ? h * 0.60 : h * 0.32;
    for (let i = 0; i < count; i++) {
      const angle = i * Math.PI * 2 / count + tier * 0.4, armM = m.clone().multiply(new Matrix4().makeRotationZ(angle)), arm = new Part(brass, armM);
      const points: V2[] = [[0.035, z], [radius * 0.3, z - 0.12], [radius * 0.65, z - 0.11], [radius, z], [radius, z + 0.15]];
      for (let j = 1; j < points.length; j++) arm.strut(points[j - 1][0], points[j - 1][1], points[j][0], points[j][1], 0, 0.023);
      arm.lathe(radius, 0, [[0, z + 0.14], [0.065, z + 0.14], [0.065, z + 0.16], [0.025, z + 0.18], [0, z + 0.18]], 8);
      new Part(bulb, armM).lathe(radius, 0, [[0, z + 0.18], [0.019, z + 0.18], [0.019, z + 0.26], [0.026, z + 0.29], [0, z + 0.34]], 8);
      for (const u of [0.6, 0.95]) new Part(crystal, armM).lathe(radius * u, 0,
        [[0, z - 0.27], [0.030, z - 0.20], [0.020, z - 0.14], [0, z - 0.11]], 4);
    }
  }
  new Part(crystal, m).lathe(0, 0, [[0, 0], [0.075, 0.08], [0.065, 0.15], [0, 0.19]], 6);
}

function banquetConsole(decor: Tris, brass: Tris, m: Matrix4): void {
  const B = BANQUET, p = new Part(decor, m), w = B.consoleWidth / 2, d = B.consoleDepth, h = B.consoleHeight;
  decor.stamp = banquetWoodStamp();
  p.box(-w, 0, h - 0.055, w, d, h);
  p.box(-w + 0.025, 0.025, h - 0.16, w - 0.025, d - 0.025, h - 0.055);
  for (const x of [-w + 0.07, w - 0.07]) for (const y of [0.06, d - 0.06]) p.lathe(x, y, leg(h - 0.1), 8);
  new Part(brass, m).box(-w, d, h - 0.055, w, d + 0.01, h - 0.043);
  new Part(brass, m).lathe(0, d + 0.018, [[0, h - 0.12], [0.016, h - 0.12], [0.016, h - 0.09], [0, h - 0.09]], 6);
}

function banquetLamp(brass: Tris, crystal: Tris, bulb: Tris, m: Matrix4): number {
  const B = BANQUET, p = new Part(brass, m), h = B.lampHeight;
  p.lathe(0, 0, [[0, 0], [0.10, 0], [0.10, 0.025], [0.055, 0.045], [0, 0.045]], 12);
  new Part(crystal, m).lathe(0, 0, [[0, 0.045], [0.045, 0.045], [0.035, h * 0.54], [0.045, h * 0.57], [0, h * 0.57]], 8);
  // Closed lampshade with a thin inner surface; faint emissive glow.
  new Part(bulb, m).lathe(0, 0, [[B.lampShadeRadius, h * 0.55], [B.lampShadeRadius * 0.52, h],
    [B.lampShadeRadius * 0.52 - 0.007, h], [B.lampShadeRadius - 0.007, h * 0.55], [B.lampShadeRadius, h * 0.55]], 16);
  return h * 0.70;
}

function banquetCabinet(decor: Tris, brass: Tris, linen: Tris, glass: Tris, m: Matrix4): void {
  const B = BANQUET, w = B.cabinetWidth / 2, d = B.cabinetDepth, h = B.cabinetHeight, p = new Part(decor, m);
  decor.stamp = banquetWoodStamp();
  p.box(-w, 0, 0.08, w, 0.025, h);
  for (const x of [-w, w - 0.03]) p.box(x, 0, 0, x + 0.03, d, h);
  p.box(-w, 0, 0, w, d, 0.15); p.box(-w - 0.025, 0, h - 0.05, w + 0.025, d + 0.02, h);
  for (let i = 1; i <= 4; i++) p.box(-w, 0, i * h / 5, w, d, i * h / 5 + 0.018);
  for (const x of [-w, -0.015, w - 0.03]) p.box(x, d, 0.15, x + 0.03, d + 0.025, h - 0.05);
  for (const z of [0.15, h - 0.09]) p.box(-w, d, z, w, d + 0.025, z + 0.04);
  const gp = new Part(glass, m);
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -w + 0.03 : 0.015, x1 = side < 0 ? -0.015 : w - 0.03;
    gp.card(x0, 0.19, x1, h - 0.09, d + 0.008);
    new Part(brass, m).box(side * 0.035 - 0.008, d + 0.025, 0.98, side * 0.035 + 0.008, d + 0.045, 1.10);
  }
  // Only three small crockery displays; no populated grid of shelves.
  for (let i = 1; i <= 3; i++) {
    const z = i * h / 5 + 0.018, p = new Part(linen, m);
    p.lathe(0, d * 0.6, [[0, z], [0.07, z], [0.085, z + 0.045], [0.085, z + 0.05], [0.02, z + 0.015], [0, z + 0.015]], 10);
  }
}

function banquetPictureFrame(brass: Tris, m: Matrix4, width: number, height: number, bottom: number): void {
  const f = BANQUET.frameWidth, w = width / 2, p = new Part(brass, m);
  for (const x of [-w, w - f]) p.box(x, 0.01, bottom, x + f, 0.07, bottom + height);
  for (const z of [bottom, bottom + height - f]) p.box(-w, 0.01, z, w, 0.07, z + f);
  for (const side of [-1, 1]) for (const z of [bottom + f / 2, bottom + height - f / 2]) {
    const detail = m.clone().multiply(at(side * (w - f / 2), 0.071, z)).multiply(new Matrix4().makeRotationX(Math.PI / 2));
    new Part(brass, detail).lathe(0, 0, [[0, -0.006], [f * 0.6, -0.006], [f * 0.6, 0.006], [0, 0.006]], 8);
  }
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

// ------------------------------------------------------------------ attic reading/bed rooms
const ATTIC = dims.interior.atticFurniture;
export interface AtticRoomInfo {
  bed: boolean; reading: boolean; lamp: boolean; shelves: number; compact: boolean; missing: string[]; theme: AtticTheme;
}
export interface AtticInfo { rooms: Record<string, AtticRoomInfo>; furnished: string[]; unfurnished: string[]; }
interface AtticPlacement {
  bed: Matrix4; reading: Matrix4 | null; lamp: Matrix4 | null;
  shelves: { m: Matrix4; width: number; height: number }[]; compact: boolean;
}
function atticSingleBed(linen: Tris, decor: Tris, m: Matrix4, dark = false): void {
  const A = ATTIC, p = new Part(decor, m), w = A.bedWidth / 2, h = A.bedBaseHeight;
  decor.stamp = atticWoodStamp(dark);
  p.box(-w, 0, 0.08, w, A.bedLength, h);
  p.box(-w, 0, h, w, 0.07, A.headHeight);
  for (const x of [-w + 0.04, w - 0.04]) for (const y of [0.06, A.bedLength - 0.06]) p.box(x - 0.025, y - 0.025, 0, x + 0.025, y + 0.025, 0.10);
  const bedding = new Part(linen, m), top = h + A.mattressHeight;
  bedding.softBox(0, A.bedLength / 2, h + A.mattressHeight / 2, A.bedWidth - 0.03, A.bedLength - 0.08, A.mattressHeight, 0.035);
  bedding.softBox(0, A.bedLength * 0.60, top + A.duvetHeight / 2, A.bedWidth + 0.04, A.bedLength * 0.72, A.duvetHeight, 0.035);
  bedding.softBox(0, A.bedLength * 0.18, top + 0.07, A.bedWidth * 0.76, 0.38, 0.14, 0.055);
}
function atticArmchair(decor: Tris, m: Matrix4, dark = false): void {
  const A = ATTIC, w = A.chairWidth, d = A.chairDepth;
  decor.stamp = atticWoodStamp(dark); const wood = new Part(decor, m);
  for (const x of [-w * 0.35, w * 0.35]) for (const y of [-d * 0.35, d * 0.35]) wood.lathe(x, y, leg(A.seatHeight * 0.65), 6);
  decor.stamp = atticFabricStamp(); const pad = new Part(decor, m);
  pad.softBox(0, 0, A.seatHeight - 0.06, w * 0.9, d * 0.9, 0.20, 0.055);
  pad.softBox(0, d * 0.06, A.seatHeight + 0.045, w * 0.70, d * 0.70, 0.09, 0.035);
  pad.softBox(0, -d * 0.36, (A.chairHeight + A.seatHeight) / 2, w * 0.80, 0.17, A.chairHeight - A.seatHeight, 0.055);
  for (const side of [-1, 1]) {
    pad.box(side * w * 0.38 - 0.07, -d * 0.30, A.seatHeight, side * w * 0.38 + 0.07, d * 0.35, A.seatHeight + 0.19);
    const arm = m.clone().multiply(at(side * w * 0.38, 0, A.seatHeight + 0.21));
    new Part(decor, arm).lathe(0, 0, [[0, -0.06], [0.07, -0.06], [0.07, 0.06], [0, 0.06]], 8);
  }
}
function atticRoundTable(decor: Tris, m: Matrix4, diameter = ATTIC.tableDiameter, dark = false): void {
  const A = ATTIC, p = new Part(decor, m); decor.stamp = atticWoodStamp(dark);
  p.lathe(0, 0, [[0, 0], [diameter * 0.33, 0], [diameter * 0.33, 0.025], [0.035, 0.08], [0.028, A.tableHeight - 0.05], [0, A.tableHeight - 0.05]], 10);
  banquetSlab(decor, m, diameter, diameter, A.tableHeight - 0.045, A.tableHeight);
}
function atticBookshelf(decor: Tris, books: Tris, m: Matrix4, width: number, height: number, dark = false): void {
  const A = ATTIC, rows = Math.max(1, Math.floor((height - A.shelfPlinth - A.shelfBoard) / A.shelfPitch));
  const top = A.shelfPlinth + rows * A.shelfPitch + A.shelfBoard;
  decor.stamp = atticWoodStamp(dark); const p = new Part(decor, m);
  p.box(-width / 2, 0, 0, width / 2, A.shelfDepth, A.shelfPlinth);
  p.box(-width / 2, 0, A.shelfPlinth, width / 2, 0.018, top);
  for (const x of [-width / 2, width / 2 - A.shelfBoard]) p.box(x, 0, A.shelfPlinth, x + A.shelfBoard, A.shelfDepth, top);
  books.stamp = atticBooksStamp(m.elements[14] + A.shelfPlinth);
  for (let row = 0; row <= rows; row++) {
    const z = A.shelfPlinth + row * A.shelfPitch;
    p.box(-width / 2, 0, z, width / 2, A.shelfDepth, z + A.shelfBoard);
    if (row < rows) new Part(books, m).card(-width / 2 + A.shelfBoard, z + A.shelfBoard, width / 2 - A.shelfBoard, z + A.shelfPitch - 0.008, A.shelfDepth - 0.05);
  }
}
function atticFloorLamp(brass: Tris, decor: Tris, bulb: Tris, m: Matrix4): void {
  const A = ATTIC, h = A.lampHeight, p = new Part(brass, m);
  p.lathe(0, 0, [[0, 0], [A.lampBaseRadius, 0], [A.lampBaseRadius, 0.035], [0.04, 0.07], [0.015, 0.10], [0.012, h - 0.18], [0, h - 0.18]], 10);
  decor.stamp = atticGlassStamp();
  new Part(decor, m).lathe(0, 0, [[A.lampShadeRadius, h - 0.22], [A.lampShadeRadius * 0.75, h - 0.09], [0.04, h],
    [0.03, h], [A.lampShadeRadius * 0.75 - 0.008, h - 0.09], [A.lampShadeRadius - 0.008, h - 0.22], [A.lampShadeRadius, h - 0.22]], 24);
  new Part(bulb, m).lathe(0, 0, [[0, h - 0.27], [0.035, h - 0.25], [0.035, h - 0.15], [0, h - 0.13]], 8);
}

function atticPlacement(plan: BuildingPlan, b: Building, room: PlanRoom): AtticPlacement | null {
  const A = ATTIC, up = atticCeiling(b, room.ceilingZ), openings: V2[][] = [];
  const poly = (m: Matrix4, rect: SalonRect): V2[] => [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]].map(([x, y]) => {
    const p = new Vector3(x, y, 0).applyMatrix4(m); return [p.x, p.y];
  });
  const reserve = (c: V2, d: V2, width: number, depth: number) => {
    let n: V2 = [-d[1], d[0]]; if (!inRoom(room.polygon, [c[0] + n[0] * 0.2, c[1] + n[1] * 0.2])) n = [-n[0], -n[1]];
    const m = new Matrix4().makeBasis(new Vector3(...d, 0), new Vector3(...n, 0), new Vector3(0, 0, 1)).setPosition(...c, room.floorZ);
    openings.push(poly(m, [-width / 2 - 0.10, -0.10, width / 2 + 0.10, depth]));
  };
  for (const door of room.doors) {
    const w = plan.walls[door.wall], length = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const d: V2 = [(w.b[0] - w.a[0]) / length, (w.b[1] - w.a[1]) / length];
    reserve([w.a[0] + d[0] * door.at, w.a[1] + d[1] * door.at], d, door.width, A.doorClear);
  }
  for (const i of room.windows) { const w = plan.windows[i]; reserve(w.at, w.dir, w.width, A.windowClear); }
  const fits = (p: V2[], occupied: V2[][]) => roomContains(room.polygon, p) && ![...openings, ...occupied].some(o => overlaps(p, o));
  const headroom = (m: Matrix4, rect: SalonRect, height: number) => poly(m, rect).every(p => up(p) - room.floorZ >= height + A.roofClear);
  const edges = freeStretches(plan, room).sort((a, b) => (b.s1 - b.s0) - (a.s1 - a.s0));
  const wall = (f: typeof edges[number], s: number, depth: number) => new Matrix4().makeBasis(new Vector3(...f.d, 0), new Vector3(...f.n, 0), new Vector3(0, 0, 1))
    .setPosition(f.a[0] + f.d[0] * s + f.n[0] * depth, f.a[1] + f.d[1] * s + f.n[1] * depth, room.floorZ);
  let best: AtticPlacement | null = null, bestScore = -Infinity;
  for (const compact of [false, true]) for (const edge of edges) {
    const width = compact ? A.compactBedWidth : A.bedWidth;
    if (edge.s1 - edge.s0 < width + A.bedSideClear * 2) continue;
    const positions = [(edge.s0 + edge.s1) / 2];
    for (let s = edge.s0 + width / 2 + A.bedSideClear; s <= edge.s1 - width / 2 - A.bedSideClear; s += A.searchStep) positions.push(s);
    for (const depth of A.bedWallOffsets) for (const s of positions) {
      const bed = wall(edge, s, depth).multiply(new Matrix4().makeScale(width / A.bedWidth, 1, 1));
      const bedBlock = poly(bed, [-A.bedWidth / 2 - A.bedSideClear, 0, A.bedWidth / 2 + A.bedSideClear, A.bedLength + A.bedFootClear]);
      if (!fits(bedBlock, []) || !headroom(bed, [-A.bedWidth / 2, 0, A.bedWidth / 2, 0.45], A.bedSitClear) ||
        !headroom(bed, [-A.bedWidth / 2, 0.45, A.bedWidth / 2, A.bedLength], A.bedBodyClear)) continue;
      const occupied = [bedBlock];
      let reading: Matrix4 | null = null, lamp: Matrix4 | null = null;
      const scale = compact ? A.chairCompactScale : 1, diameter = compact ? A.compactTableDiameter : A.tableDiameter;
      for (const f of edges) {
        for (let u = f.s0 + A.chairWidth * scale / 2 + A.wallGap; u <= f.s1 - A.chairWidth * scale / 2 - A.wallGap; u += A.searchStep) {
          const m = wall(f, u, A.chairDepth * scale / 2 + A.wallGap);
          const block = poly(m, [-A.chairWidth * scale / 2 - A.tableClear, -A.chairDepth * scale / 2,
            A.chairWidth * scale / 2 + A.tableClear, A.tableOffset + diameter / 2 + A.tableClear]);
          if (!fits(block, occupied) || !headroom(m, [-A.chairWidth * scale / 2, -A.chairDepth * scale / 2,
            A.chairWidth * scale / 2, A.chairDepth * scale / 2], A.chairSitClear) ||
            !headroom(m, [-diameter / 2, A.tableOffset - diameter / 2, diameter / 2, A.tableOffset + diameter / 2], A.tableHeight)) continue;
          reading = m; occupied.push(block); break;
        }
        if (reading) break;
      }
      if (reading) {
        for (const x of [-A.lampSideOffset, A.lampSideOffset]) {
          const m = reading.clone().multiply(at(x, 0, 0)), r = A.lampShadeRadius + 0.04, footprint = poly(m, [-r, -r, r, r]);
          if (fits(footprint, occupied) && headroom(m, [-r, -r, r, r], A.lampHeight)) { lamp = m; occupied.push(footprint); break; }
        }
      }
      const shelves: AtticPlacement["shelves"] = [];
      for (const f of edges) {
        const count = Math.floor((f.s1 - f.s0 - A.wallGap * 2) / A.shelfWidth);
        for (let i = 0; i < count; i++) {
          const m = wall(f, f.s0 + A.wallGap + (i + 0.5) * A.shelfWidth, A.wallGap);
          const footprint = poly(m, [-A.shelfWidth / 2, 0, A.shelfWidth / 2, A.shelfDepth + A.shelfAccess]);
          if (!fits(footprint, occupied)) continue;
          const points = poly(m, [-A.shelfWidth / 2, 0, A.shelfWidth / 2, A.shelfDepth]);
          const height = Math.min(A.shelfMaxHeight, ...points.map(p => up(p) - room.floorZ - A.roofClear));
          if (height < A.shelfMinHeight) continue;
          shelves.push({ m, width: A.shelfWidth, height }); occupied.push(footprint);
        }
      }
      const score = Number(!!reading) * 10000 + Number(!!lamp) * 1000 + Math.min(shelves.length, 4) * 100 + Number(!compact);
      if (score > bestScore) { best = { bed, reading, lamp, shelves, compact }; bestScore = score; }
      if (reading && lamp && shelves.length >= 1) return best;
    }
  }
  return best;
}
function atticSet(linen: Tris, brass: Tris, decor: Tris, books: Tris, bulb: Tris, placement: AtticPlacement, sources: FurnitureLight[], theme: AtticTheme = 0): void {
  const dark = theme === 1;
  const A = ATTIC, { bed, reading, lamp, shelves, compact } = placement;
  atticSingleBed(linen, decor, bed, dark);
  if (reading) {
    const scale = compact ? A.chairCompactScale : 1;
    atticArmchair(decor, reading.clone().multiply(new Matrix4().makeScale(scale, scale, 1)), dark);
    atticRoundTable(decor, reading.clone().multiply(at(0, A.tableOffset, 0)), compact ? A.compactTableDiameter : A.tableDiameter, dark);
  }
  if (lamp) {
    atticFloorLamp(brass, decor, bulb, lamp);
    sources.push({ position: new Vector3(0, 0, A.lampHeight - 0.19).applyMatrix4(lamp), intensity: A.lampIntensity, distance: A.lampRange });
  }
  for (const shelf of shelves) atticBookshelf(decor, books, shelf.m, shelf.width, shelf.height, dark);
}

// ------------------------------------------------------------------ bedrooms

/** Head at y=0, foot towards +y, all dimensions shared with kit_dims.json. */
type BedSide = -1 | 1;

function doubleBed(linen: Tris, m: Matrix4): void {
  if (instanceRecipe('doubleBed', [linen], m, [], ([l], local) => doubleBed(l, local))) return;
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
  if (instanceRecipe('nightstand', [linen, brass], m, [], ([l, b], local) => nightstand(l, b, local))) return;
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
  const instance = instanceRecipe('bedsideLamp', [brass, shade], m, [], ([b, s], local) => bedsideLamp(b, s, local));
  if (instance) return instance.value;
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
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const v of a) { const t = v[0] * nx + v[1] * ny; amin = Math.min(amin, t); amax = Math.max(amax, t); }
    for (const v of b) { const t = v[0] * nx + v[1] * ny; bmin = Math.min(bmin, t); bmax = Math.max(bmax, t); }
    if (amax <= bmin + 1e-6 || bmax <= amin + 1e-6) return false;
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
  if (instanceRecipe('salonSofa', [linen, wood], m, [width], ([l, w], local) => salonSofa(l, w, local, width))) return;
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
  if (instanceRecipe('diningChair', [linen, brass, decor], m, [], ([l, b, d], local) => diningChair(l, b, d, local))) return;
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
  // Closed, low-poly oval solids preserve volume when viewed or cut from any side.
  const oval = (frame: Matrix4, x: number, y: number, z: number, w: number, d: number, h: number) => {
    const local = frame.clone().multiply(at(x, y, z)).multiply(new Matrix4().makeScale(w / 2, d / 2, h / 2));
    new Part(decor, local).lathe(0, 0, [[0, -1], [0.85, -0.5], [0.85, 0.5], [0, 1]], 8);
  };
  colour(decor, "#77906a");
  p.lathe(0, 0, [[0, 0], [D.potRadius * 0.65, 0], [D.potRadius, D.potHeight * 0.85], [D.potRadius * 1.04, D.potHeight], [0, D.potHeight]], 12);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39996, x = Math.cos(a) * D.potRadius * 0.8, y = Math.sin(a) * D.potRadius * 0.8;
    const z = D.flowerHeight - (i % 3) * 0.035;
    colour(decor, "#526c41"); p.lathe(x, y, [[0, D.potHeight], [0.004, D.potHeight], [0.004, z], [0, z]], 4);
    for (const side of [-1, 1]) {
      const leaf = m.clone().multiply(at(x + side * 0.018, y, z - 0.06, a)).multiply(new Matrix4().makeRotationY(side * 0.6));
      oval(leaf, 0, 0, 0, 0.075, 0.025, 0.018);
    }
    colour(decor, i % 2 ? "#f2d6d8" : "#f5eee3");
    for (let k = 0; k < 5; k++) {
      const a = k * Math.PI * 2 / 5;
      oval(m, x + Math.cos(a) * 0.022, y + Math.sin(a) * 0.022, z, 0.036, 0.032, 0.024);
    }
    colour(decor, "#c7a450"); oval(m, x, y, z + 0.01, 0.02, 0.02, 0.02);
  }
}

/** Three curated shelves, with empty shelves between the plate, bowls and cup. */
function crockeryCabinet(linen: Tris, brass: Tris, decor: Tris, m: Matrix4, x0: number, width = SALON.caseWidth): void {
  if (instanceRecipe('crockeryCabinet', [linen, brass, decor], m, [x0, width], ([l, b, d], local) => crockeryCabinet(l, b, d, local, x0, width))) return;
  let row = 0;
  displayCabinet(linen, brass, m, x0, (left, right, z) => {
    const shelf = row++;
    if (shelf % 2 !== 0) return;
    const p = new Part(linen, m), cx = (left + right) / 2;
    if (shelf === 0) {
      const plateM = m.clone().multiply(at(cx, SALON.caseDepth * 0.65, z + 0.115)).multiply(new Matrix4().makeRotationX(-Math.PI / 2));
      new Part(linen, plateM).lathe(0, 0, [[0, 0], [0.07, 0], [0.11, 0.013], [0.11, 0.02], [0.075, 0.008], [0, 0.008]], 12);
      colour(decor, "#536a8a");
      new Part(decor, plateM).lathe(0, 0, [[0.093, 0.012], [0.10, 0.015], [0.10, 0.018], [0.093, 0.015], [0.093, 0.012]], 12);
      p.box(cx - 0.05, 0.16, z, cx + 0.05, 0.29, z + 0.018);
    } else if (shelf === 2) {
      for (let k = 0; k < 2; k++) p.lathe(cx, 0.19,
        [[0, z + k * 0.022], [0.05, z + k * 0.022], [0.095, z + 0.07 + k * 0.022],
          [0.087, z + 0.07 + k * 0.022], [0.045, z + 0.018 + k * 0.022], [0, z + 0.018 + k * 0.022]], 12);
    } else if (shelf === 4) {
      p.lathe(cx, 0.19, [[0, z], [0.07, z], [0.07, z + 0.009], [0, z + 0.009]], 12);
      p.lathe(cx, 0.19, [[0, z + 0.01], [0.039, z + 0.01], [0.05, z + 0.105],
        [0.043, z + 0.105], [0.032, z + 0.024], [0, z + 0.024]], 12);
      const handleM = m.clone().multiply(at(cx + 0.052, 0.19, z + 0.061)).multiply(new Matrix4().makeRotationY(Math.PI / 2));
      new Part(linen, handleM).lathe(0, 0, [[0.02, -0.006], [0.03, -0.006], [0.03, 0.006], [0.02, 0.006], [0.02, -0.006]], 8);
      new Part(brass, m).lathe(cx, 0.19, [[0.043, z + 0.101], [0.05, z + 0.101], [0.05, z + 0.105], [0.043, z + 0.105], [0.043, z + 0.101]], 12);
    }
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
  rooms: Record<string, { aisle: number; wallLength: number; displayCabinets: number; hasIsland: boolean }>;
}
interface KitchenPlacement {
  m: Matrix4; left: number; right: number; aisle: number; hasIsland: boolean; hoodHeight: number;
  displays: { m: Matrix4; width: number; polygon: V2[] }[];
}

function kitchenStone(t: Tris): void {
  t.stamp = kitchenWorktopStamp();
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
  if (instanceRecipe('kitchenBase', [linen, brass, decor], m, [width], ([l, b, d], local) => kitchenBase(l, b, d, local, width))) return;
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
  if (instanceRecipe('kitchenUpper', [linen, brass, decor], m, [width], ([l, b, d], local) => kitchenUpper(l, b, d, local, width))) return;
  const K = KITCHEN, p = new Part(linen, m);
  p.box(-width / 2, 0, 0, width / 2, K.upperDepth, K.upperHeight);
  kitchenPanel(linen, decor, m, -width / 2 + 0.015, width / 2 - 0.015, K.upperDepth, 0.025, K.upperHeight - 0.025);
  kitchenHandle(brass, m, 0, K.upperDepth + 0.06, 0.13);
  p.box(-width / 2 - 0.015, 0, K.upperHeight - 0.035, width / 2 + 0.015, K.upperDepth + 0.035, K.upperHeight + 0.035);
}

function kitchenRange(linen: Tris, brass: Tris, dark: Tris, decor: Tris, m: Matrix4): void {
  if (instanceRecipe('kitchenRange', [linen, brass, dark, decor], m, [], ([l, b, k, d], local) => kitchenRange(l, b, k, d, local))) return;
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

function kitchenHood(linen: Tris, dark: Tris, m: Matrix4, height = KITCHEN.hoodHeight): void {
  const K = KITCHEN, p = new Part(linen, m), half = K.hoodWidth / 2;
  p.box(-half, 0, 0, half, K.hoodDepth, height);
  for (const z of [0, 0.075, height - 0.08]) p.box(-half - 0.025, 0, z, half + 0.025, K.hoodDepth + 0.035, z + 0.045);
  // Recessed framed face and two stepped corbels.
  p.box(-half + 0.06, K.hoodDepth, 0.16, half - 0.06, K.hoodDepth + 0.018, height - 0.12);
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
function kitchenPlacement(plan: BuildingPlan, b: Building, r: PlanRoom): KitchenPlacement | null {
  const K = KITCHEN, length = K.hoodWidth + K.minCounterSide * 2;
  const attic = plan.levels[plan.levels.length - 1];
  const ceilingAt = r.level === attic.index ? atticCeiling(b, attic.ceilingZ) : () => r.ceilingZ;
  const heightFits = (polygon: V2[], height: number) => polygon.every(p => ceilingAt(p) - r.floorZ + 1e-6 >= height + 0.05);
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
  if (r.ceilingZ - r.floorZ < K.upperBottom + K.upperHeight + 0.05) return null;
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
    const lo = start + K.hoodWidth / 2 + K.minCounterSide, hi = end - K.hoodWidth / 2 - K.minCounterSide;
    const candidates = [(lo + hi) / 2]; for (let s = lo; s <= hi; s += K.searchStep) candidates.push(s);
    for (const hasIsland of [true, false]) for (const aisle of hasIsland ? [K.aisle, (K.aisle + K.narrowAisle) / 2, K.narrowAisle] : [0]) for (const s of candidates) {
      const m = frame(f, s), left = start - s, right = end - s;
      const islandY = K.depth + K.frontProjection + aisle + K.islandDepth / 2 + K.frontProjection;
      const counter = poly(m, [left - 0.01, 0, right + 0.01, K.depth + K.frontProjection]);
      const island = poly(m, [-K.islandLength / 2 - 0.025, islandY - K.islandDepth / 2 - K.frontProjection,
        K.islandLength / 2 + 0.025, islandY + K.islandDepth / 2 + K.frontProjection]);
      const hood = poly(m, [-K.hoodWidth / 2 - 0.025, 0, K.hoodWidth / 2 + 0.025, K.hoodDepth + 0.035]);
      const hoodHeight = Math.min(K.hoodHeight, ...hood.map(p => ceilingAt(p) - r.floorZ - K.hoodBottom - 0.05));
      if (hoodHeight < K.minHoodHeight) continue;
      if ((hasIsland ? [counter, island] : [counter]).some(p => !roomContains(r.polygon, p) || openings.some(o => overlaps(p, o)))) continue;
      if (!heightFits(counter, K.height) || (hasIsland && !heightFits(island, K.height + K.tapHeight)) ||
        !heightFits(hood, K.hoodBottom + hoodHeight) ||
        !heightFits(poly(m, [left, 0, -K.hoodWidth / 2 - 0.05, K.upperDepth + K.frontProjection]), K.upperBottom + K.upperHeight) ||
        !heightFits(poly(m, [K.hoodWidth / 2 + 0.05, 0, right, K.upperDepth + K.frontProjection]), K.upperBottom + K.upperHeight)) continue;
      const islandEnvelope = poly(m, [-K.islandLength / 2 - K.outerClear, islandY - K.islandDepth / 2 - K.frontProjection,
        K.islandLength / 2 + K.outerClear, islandY + K.islandDepth / 2 + K.frontProjection + K.outerClear]);
      if (hasIsland && !roomContains(r.polygon, islandEnvelope)) continue;
      const reserved = hasIsland ? [counter, islandEnvelope] : [counter];
      const displays: KitchenPlacement['displays'] = [];
      if (r.ceilingZ - r.floorZ + 1e-6 >= SALON.caseHeight + 0.05) for (const other of edges) {
        if (other.n[0] * f.n[0] + other.n[1] * f.n[1] > -0.9) continue;
        for (const [a, b] of spans(other, SALON.caseDepth + 0.04, [...openings, ...reserved])) {
          if (b - a < 0.60) continue;
          const count = Math.min(Math.ceil((b - a) / SALON.caseWidth), Math.floor((b - a) / 0.60)), unit = (b - a) / count;
          for (let i = 0; i < count; i++) {
            const displayM = frame(other, a + i * unit + K.displayClear), width = unit - 2 * K.displayClear;
            const footprint = poly(displayM, [-K.displayClear, 0, width + K.displayClear, SALON.caseDepth + 0.04]);
            if (!roomContains(r.polygon, footprint) || !heightFits(footprint, SALON.caseHeight) ||
              [...openings, ...reserved, ...displays.map(d => d.polygon)].some(o => overlaps(footprint, o))) continue;
            displays.push({ m: displayM, width, polygon: footprint });
          }
        }
      }
      const displayLength = displays.reduce((sum, d) => sum + d.width, 0);
      const score = (hasIsland ? 1e6 : 0) + (right - left) * 1000 + displayLength * 100 + aisle;
      if (score > bestScore) { best = { m, left, right, aisle, displays, hasIsland, hoodHeight }; bestScore = score; }
    }
  }
  return best;
}

// ------------------------------------------------------------------ ground-floor cafes
const CAFE = dims.interior.cafeFurniture;
export interface CafeRoomInfo {
  theme: CafeTheme; furnished: boolean; tables: number; chairs: number;
  stools: number; cabinet: boolean; outdoorTables: number; outdoorChairs: number;
}
export interface CafeInfo { furnished: string[]; unfurnished: string[]; rooms: Record<string, CafeRoomInfo> }
interface CafePlacement { wall: Matrix4; bar: Matrix4; length: number; tables: Matrix4[]; chairs: Matrix4[]; stools: Matrix4[]; cabinet: Matrix4 | null }

function cafeTable(linen: Tris, wood: Tris, dark: Tris, decor: Tris, m: Matrix4, outdoor = false, theme: CafeTheme = 0): void {
  const C = CAFE, r = (outdoor ? C.outdoorDiameter : C.tableDiameter) / 2;
  const frame = new Part(dark, m);
  frame.lathe(0, 0, [[0, 0], [0.21, 0], [0.21, 0.025], [0.035, 0.07], [0.025, C.tableHeight - 0.035], [0, C.tableHeight - 0.035]], 12);
  new Part(wood, m).lathe(0, 0, [[0, C.tableHeight - 0.04], [r, C.tableHeight - 0.04], [r, C.tableHeight - 0.025], [0, C.tableHeight - 0.025]], 16);
  if (theme === 0) kitchenStone(decor); else decor.stamp = cafeFurnitureStamp(theme);
  new Part(decor, m).lathe(0, 0, [[0, C.tableHeight - 0.025], [r, C.tableHeight - 0.025], [r, C.tableHeight], [0, C.tableHeight]], 16);
}

function cafeChair(linen: Tris, wood: Tris, brass: Tris, decor: Tris, m: Matrix4, outdoor = false, theme: CafeTheme = 0): void {
  const whiteParts = theme === 0 ? linen : decor;
  const C = CAFE, w = C.chairWidth, d = C.chairDepth, p = new Part(wood, m);
  for (const x of [-w * 0.38, w * 0.38]) for (const y of [-d * 0.38, d * 0.38]) {
    p.lathe(x, y, [[0, 0], [0.018, 0], [0.024, C.seatHeight], [0, C.seatHeight]], 6);
  }
  p.box(-w / 2, -d / 2, C.seatHeight - 0.04, w / 2, d / 2, C.seatHeight);
  if (theme !== 0) decor.stamp = cafeFurnitureStamp(theme);
  else if (outdoor) decor.stamp = cafeWickerStamp(); else colour(decor, "#e8deca");
  new Part(decor, m).box(-w / 2 + 0.025, -d / 2 + 0.02, C.seatHeight, w / 2 - 0.025, d / 2 - 0.02, C.seatHeight + 0.025);
  for (const x of [-w * 0.38, w * 0.38]) p.strut(x, C.seatHeight, x, C.chairHeight - 0.08, -d * 0.42, 0.028);
  // Low-segment closed oval back; weaving is a shader pattern, not geometry.
  const back = m.clone().multiply(at(0, -d * 0.42, C.chairHeight - 0.17)).multiply(new Matrix4().makeRotationX(Math.PI / 2)).multiply(new Matrix4().makeScale(w * 0.43, 0.17, 1));
  new Part(whiteParts, back).lathe(0, 0, [[0, -0.025], [1, -0.025], [1, 0.025], [0, 0.025]], 12);
  const face = back.clone().multiply(new Matrix4().makeScale(0.85, 0.85, 1));
  new Part(decor, face).lathe(0, 0, [[0, -0.03], [1, -0.03], [1, 0.03], [0, 0.03]], 12);
  if (!outdoor) new Part(brass, back).lathe(0, 0, [[0.90, -0.027], [0.95, -0.027], [0.95, 0.027], [0.90, 0.027], [0.90, -0.027]], 12);
}

function cafeStool(wood: Tris, dark: Tris, m: Matrix4): void {
  const C = CAFE, p = new Part(dark, m);
  p.lathe(0, 0, [[0, 0], [0.025, 0], [0.025, C.stoolHeight - 0.04], [0, C.stoolHeight - 0.04]], 8);
  for (let i = 0; i < 4; i++) {
    const foot = m.clone().multiply(new Matrix4().makeRotationZ(i * Math.PI / 2));
    new Part(dark, foot).strut(0, 0.23, 0.22, 0.015, 0, 0.025);
  }
  p.lathe(0, 0, [[0.12, 0.24], [0.135, 0.24], [0.135, 0.26], [0.12, 0.26], [0.12, 0.24]], 12);
  new Part(wood, m).lathe(0, 0, [[0, C.stoolHeight - 0.04], [C.stoolRadius, C.stoolHeight - 0.04], [C.stoolRadius, C.stoolHeight], [0, C.stoolHeight]], 12);
}

function cafeBar(wood: Tris, brass: Tris, decor: Tris, m: Matrix4, length: number): void {
  const C = CAFE, w = length / 2, p = new Part(wood, m);
  p.box(-w, 0, 0, w, C.barDepth, C.barHeight - 0.045);
  p.box(-w, 0, 0.03, w, C.barDepth + 0.025, 0.11);
  const panels = Math.max(1, Math.round(length / 0.7)), pitch = length / panels;
  for (let i = 0; i < panels; i++) {
    const x0 = -w + i * pitch + 0.035, x1 = x0 + pitch - 0.07;
    for (const x of [x0, x1 - 0.025]) p.box(x, C.barDepth, 0.22, x + 0.025, C.barDepth + 0.018, C.barHeight - 0.17);
    for (const z of [0.22, C.barHeight - 0.195]) p.box(x0, C.barDepth, z, x1, C.barDepth + 0.018, z + 0.025);
  }
  decor.stamp = cafeStoneStamp();
  new Part(decor, m).box(-w - 0.025, 0, C.barHeight - 0.045, w + 0.025, C.barDepth + 0.04, C.barHeight);
  new Part(brass, m).box(-w, C.barDepth + 0.075, 0.22, w, C.barDepth + 0.09, 0.24);
}

function cafeCabinet(linen: Tris, brass: Tris, decor: Tris, m: Matrix4): void {
  const C = CAFE, p = new Part(linen, m), w = C.cabinetWidth, d = C.cabinetDepth, h = C.cabinetHeight;
  p.box(0, 0, 0, w, d, 0.64);
  p.box(0, 0, 0.64, w, 0.025, h);
  for (const x of [0, w - 0.03]) p.box(x, 0, 0.64, x + 0.03, d, h);
  for (const z of [0.66, 1.03, h - 0.04]) p.box(0, 0, z, w, d, z + 0.025);
  for (const x of [0.03, w - 0.06]) new Part(brass, m).box(x, d, 0.1, x + 0.03, d + 0.018, 0.57);
  colour(decor, "#f0e8d8");
  new Part(decor, m).lathe(w / 2, d / 2, [[0, 0.70], [0.055, 0.70], [0.065, 0.86], [0.035, 0.89], [0, 0.89]], 10);
}

let menuMaterial: MeshStandardMaterial | null = null;
function cafeMenu(m: Matrix4): Mesh {
  if (!menuMaterial) {
    if (typeof document === "undefined") menuMaterial = new MeshStandardMaterial({ name: "cafe_menu", color: "#19382f" });
    else {
    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#19382f"; ctx.fillRect(0, 0, 256, 512);
    ctx.textAlign = "center"; ctx.fillStyle = "#efe2bf"; ctx.font = "bold 29px Georgia";
    ctx.fillText("CAFE", 128, 56); ctx.fillText("MENU", 128, 96);
    ctx.font = "21px Georgia";
    ["Espresso   3", "Cafe creme   5", "Chocolat   6", "The   4", "Croissant   4", "Tarte   7"].forEach((text, i) => ctx.fillText(text, 128, 158 + i * 47));
    ctx.strokeStyle = "#b99b5a"; ctx.strokeRect(13, 13, 230, 486);
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
    menuMaterial = new MeshStandardMaterial({ name: "cafe_menu", map: texture, roughness: 0.85 });
    }
  }
  const geometry = new PlaneGeometry(CAFE.menuWidth - 0.04, CAFE.menuHeight - 0.04);
  geometry.rotateX(Math.PI / 2); geometry.rotateZ(Math.PI); geometry.translate(0, 0.002, 0); geometry.applyMatrix4(m);
  const mesh = new Mesh(geometry, menuMaterial); mesh.receiveShadow = true; return mesh;
}

function cafePlacement(plan: BuildingPlan, r: PlanRoom): CafePlacement | null {
  const C = CAFE, openings: V2[][] = [];
  const poly = (m: Matrix4, rect: SalonRect): V2[] => [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]].map(([x, y]) => {
    const p = new Vector3(x, y, 0).applyMatrix4(m); return [p.x, p.y];
  });
  const reserve = (c: V2, d: V2, width: number, depth: number) => {
    let n: V2 = [-d[1], d[0]]; if (!inRoom(r.polygon, [c[0] + n[0] * 0.2, c[1] + n[1] * 0.2])) n = [-n[0], -n[1]];
    const m = new Matrix4().makeBasis(new Vector3(...d, 0), new Vector3(...n, 0), new Vector3(0, 0, 1)).setPosition(...c, r.floorZ);
    openings.push(poly(m, [-width / 2 - 0.1, -0.3, width / 2 + 0.1, depth]));
  };
  for (const door of r.doors) {
    const wall = plan.walls[door.wall], len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    const d: V2 = [(wall.b[0] - wall.a[0]) / len, (wall.b[1] - wall.a[1]) / len];
    reserve([wall.a[0] + d[0] * door.at, wall.a[1] + d[1] * door.at], d, door.width, C.doorClear);
  }
  for (const wi of r.windows) {
    const win = plan.windows[wi], shift = win.kind === "shop" ? (win.width - C.terraceEntryWidth) / 2 : 0;
    reserve([win.at[0] + win.dir[0] * shift, win.at[1] + win.dir[1] * shift], win.dir,
      win.kind === "shop" ? C.terraceEntryWidth : win.width, win.kind === "shop" ? C.doorClear : C.windowClear);
  }
  const windows = r.windows.map(i => plan.windows[i]);
  const edge = r.polygon.map((a, i) => ({ a, b: r.polygon[(i + 1) % r.polygon.length] }))
    .sort((a, b) => Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1]) - Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1]))[0];
  const edgeLength = Math.hypot(edge.b[0] - edge.a[0], edge.b[1] - edge.a[1]);
  const front = windows.find(w => w.kind === "shop") ?? windows[0] ?? {
    at: [(edge.a[0] + edge.b[0]) / 2, (edge.a[1] + edge.b[1]) / 2] as V2,
    dir: [(edge.b[0] - edge.a[0]) / edgeLength, (edge.b[1] - edge.a[1]) / edgeLength] as V2,
  };
  let inward: V2 = [-front.dir[1], front.dir[0]];
  if (!inRoom(r.polygon, [front.at[0] + inward[0] * 0.2, front.at[1] + inward[1] * 0.2])) inward = [-inward[0], -inward[1]];
  const seatingFrame = new Matrix4().makeBasis(new Vector3(...front.dir, 0), new Vector3(...inward, 0), new Vector3(0, 0, 1)).setPosition(...front.at, r.floorZ);
  const inverseSeating = seatingFrame.clone().invert();
  const localRoom = r.polygon.map(([x, y]) => new Vector3(x, y, r.floorZ).applyMatrix4(inverseSeating));
  const x0 = Math.min(...localRoom.map(p => p.x)), x1 = Math.max(...localRoom.map(p => p.x));
  const y0 = Math.min(...localRoom.map(p => p.y)), y1 = Math.max(...localRoom.map(p => p.y));
  const frame = (f: ReturnType<typeof freeStretches>[number], s: number) => new Matrix4().makeBasis(new Vector3(...f.d, 0), new Vector3(...f.n, 0), new Vector3(0, 0, 1))
    .setPosition(f.a[0] + f.d[0] * s + f.n[0] * C.wallGap, f.a[1] + f.d[1] * s + f.n[1] * C.wallGap, r.floorZ);
  const fits = (polygon: V2[], occupied: V2[][]) => roomContains(r.polygon, polygon) && ![...openings, ...occupied].some(o => overlaps(polygon, o));
  let best: CafePlacement | null = null, bestScore = -Infinity;
  for (const f of freeStretches(plan, r).sort((a, b) => b.s1 - b.s0 - (a.s1 - a.s0))) {
    if (r.ceilingZ - r.floorZ < C.panelTop + 0.05) return null;
    const maximum = Math.min(C.barMaxLength, f.s1 - f.s0 - C.endClear * 2 - C.barEntryClear);
    if (maximum < C.barMinLength) continue;
    for (const length of [...new Set([maximum, Math.min(maximum, C.barCompactLength), C.barMinLength])]) {
      const positions = [(f.s0 + f.s1 - C.barEntryClear) / 2, f.s0 + C.endClear + length / 2, f.s1 - C.endClear - C.barEntryClear - length / 2];
      for (const position of [...new Set(positions)]) {
        const wall = frame(f, position);
        const bar = wall.clone().multiply(at(0, C.barWorkClear, 0));
        // Reserve the rear service aisle, the side entrance and the customer side.
        const barBlock = poly(wall, [-length / 2 - 0.04, 0, length / 2 + C.barEntryClear, C.barWorkClear + C.barDepth + C.barFrontClear]);
        if (!fits(barBlock, [])) continue;
        const tables: Matrix4[] = [], chairs: Matrix4[] = [], occupied = [barBlock];
        // Follow the sketch: two wall-side rows, with each chair before/after its table.
        const long = C.chairOffset + C.chairDepth / 2 + C.tableClear;
        const short = C.tableDiameter / 2 + C.tableClear;
        for (const x of [x0 + short, x1 - short]) {
          let rowTables: Matrix4[] = [], rowChairs: Matrix4[] = [], rowBlocks: V2[][] = [];
          for (const rotation of [Math.PI / 2, -Math.PI / 2]) {
            const candidateTables: Matrix4[] = [], candidateChairs: Matrix4[] = [], candidateBlocks: V2[][] = [];
            for (let y = y0 + short; y <= y1 - short; y += C.searchStep) {
              const m = seatingFrame.clone().multiply(at(x, y, 0, rotation)), footprint = poly(m, [-short, -short, long, short]);
              if (!fits(footprint, [...occupied, ...candidateBlocks])) continue;
              candidateTables.push(m); candidateChairs.push(m.clone().multiply(at(C.chairOffset, 0, 0, Math.PI / 2)));
              candidateBlocks.push(footprint);
            }
            if (candidateTables.length > rowTables.length) { rowTables = candidateTables; rowChairs = candidateChairs; rowBlocks = candidateBlocks; }
          }
          tables.push(...rowTables); chairs.push(...rowChairs); occupied.push(...rowBlocks);
        }
        const stools: Matrix4[] = [];
        for (let x = -length / 2 + C.stoolPitch / 2; x < length / 2 - 0.1; x += C.stoolPitch) {
          const m = bar.clone().multiply(at(x, C.barDepth + 0.4, 0));
          if (fits(poly(m, [-0.24, -0.24, 0.24, 0.24]), occupied.slice(1))) stools.push(m);
        }
        let cabinet: Matrix4 | null = null;
        for (const edge of freeStretches(plan, r)) {
          for (let s = edge.s0 + C.endClear; s + C.cabinetWidth < edge.s1 - C.endClear; s += C.searchStep) {
            const m = frame(edge, s), footprint = poly(m, [-0.04, 0, C.cabinetWidth + 0.04, C.cabinetDepth + 0.25]);
            if (fits(footprint, occupied)) { cabinet = m; break; }
          }
          if (cabinet) break;
        }
        const score = tables.length * 1000 + stools.length * 10 + Number(!!cabinet) + length;
        if (score > bestScore) { best = { wall, bar, length, tables, chairs, stools, cabinet }; bestScore = score; }
      }
    }
  }
  return best;
}

function cafeSet(linen: Tris, wood: Tris, brass: Tris, dark: Tris, decor: Tris, group: Group, r: PlanRoom, placement: CafePlacement, look: Look): void {
  const C = CAFE, { wall, bar, length, tables, chairs, stools, cabinet } = placement;
  cafeBar(wood, brass, decor, bar, length);
  colour(decor, "#ece6d8");
  if (look === "real") decor.stamp = cafeWoodStamp(r.floorZ, r.ceilingZ);
  else if (look === "diagram") decor.stamp = stampOf(look, r, "wall");
  new Part(decor, wall).box(-length / 2, 0, C.barHeight, length / 2, 0.018, C.panelTop);
  const menus = Math.max(1, Math.min(3, Math.floor(length / (C.menuWidth + 0.16))));
  for (let i = 0; i < menus; i++) {
    const x = (i - (menus - 1) / 2) * (C.menuWidth + 0.16);
    const m = wall.clone().multiply(at(x, 0.04, C.menuBottom + C.menuHeight / 2));
    new Part(wood, m).box(-C.menuWidth / 2, -0.018, -C.menuHeight / 2, C.menuWidth / 2, 0, C.menuHeight / 2);
    group.add(cafeMenu(m));
  }
  for (const table of tables) cafeTable(linen, wood, dark, decor, table, false, r.cafeTheme);
  for (const chair of chairs) cafeChair(linen, wood, brass, decor, chair, false, r.cafeTheme);
  for (const m of stools) cafeStool(wood, dark, m);
  if (cabinet) cafeCabinet(linen, brass, decor, cabinet);
}

/** Exterior tables are generated first; street trees subsequently avoid these polygons. */
export function buildCafeTerrace(plan: BuildingPlan, b: Building, mats: InteriorMaterials, sidewalk: { sidewalk: boolean; width: number }): { group: Group; reserved: V2[][]; tables: number; rooms: Record<string, number> } {
  const group = new Group(), reserved: V2[][] = [], C = CAFE, rooms: Record<string, number> = {};
  // Street terraces need a sidewalk wide enough; court terraces stand on the court floor
  const streetFits = sidewalk.sidewalk && sidewalk.width - dims.street.curb - C.walkClear >= C.terraceOffset + C.terraceHalfDepth;
  if (!streetFits && !plan.windows.some(w => w.kind === "shop" && w.facadeId)) return { group, reserved, tables: 0, rooms };
  const linen = new Tris(), wood = new Tris(), brass = new Tris(), dark = new Tris(), decor = new Tris();
  for (const room of plan.rooms.filter(r => r.level === 0 && r.type === "shop" && r.cafeTheme !== undefined)) {
    rooms[room.id] = 0;
    for (const wi of room.windows) {
      const w = plan.windows[wi], side = buildingFacade(b, w.side, w.facadeId);
      if (w.kind !== "shop" || !side || w.bay < 0) continue;
      if (side.kind === "street" ? !streetFits : side.kind !== "court") continue;
      const bay = side.bays[w.bay], centre = bay?.x;
      if (!bay) continue;
      const lo = side.bays[0].x - dims.bay / 2, hi = side.bays[side.bays.length - 1].x + dims.bay / 2;
      // Three tables across the frontage, chairs towards the facade/street.
      // Leave the right-hand end open for entry instead of splitting the row.
      for (let i = 0; i < C.terraceTableCount; i++) {
        const x = centre - dims.bay / 2 + C.terraceHalfWidth + C.terraceEndClear + i * C.terraceTablePitch, y = -C.terraceOffset;
        if (x - C.terraceHalfWidth < lo || x + C.terraceHalfWidth > hi) continue;
        const m = side.frame.clone().multiply(at(x, y, side.kind === "court" ? 0 : dims.street.top));
        const polygon: V2[] = [[-C.terraceHalfWidth, -C.terraceHalfDepth], [C.terraceHalfWidth, -C.terraceHalfDepth],
          [C.terraceHalfWidth, C.terraceHalfDepth], [-C.terraceHalfWidth, C.terraceHalfDepth]].map(([u, v]) => { const p = new Vector3(u, v, 0).applyMatrix4(m); return [p.x, p.y]; });
        if (reserved.some(p => overlaps(polygon, p))) continue;
        reserved.push(polygon); rooms[room.id]++; cafeTable(linen, wood, dark, decor, m, true, room.cafeTheme);
        for (const s of [-1, 1]) cafeChair(linen, wood, brass, decor, m.clone().multiply(at(0, s * C.outdoorChairOffset, 0, s > 0 ? Math.PI : 0)), true, room.cafeTheme);
      }
    }
  }
  for (const [tris, material] of [[linen, mats.furnLinen], [wood, mats.furnWood], [brass, mats.furnBrass], [dark, mats.furnDark], [decor, mats.finishWall]] as [Tris, Material][]) {
    if (!tris.pos.length) continue;
    const mesh = new Mesh(tris.geometry(), material); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
  }
  return { group, reserved, tables: reserved.length, rooms };
}

export interface BallroomInfo {
  roomId: string | null; furnished: boolean; chairs: number; chandeliers: number; consoles: number; cabinets: number; picture: boolean; highPictures: number;
}

function ballroomSet(plan: BuildingPlan, room: PlanRoom, group: Group, linen: Tris, brass: Tris, decor: Tris,
  crystal: Tris, bulb: Tris, glass: Tris, sources: FurnitureLight[]): BallroomInfo {
  const B = BANQUET, info: BallroomInfo = { roomId: room.id, furnished: false, chairs: 0, chandeliers: 0, consoles: 0, cabinets: 0, picture: false, highPictures: 0 };
  const poly = (m: Matrix4, rect: SalonRect): V2[] => [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]].map(([x, y]) => {
    const p = new Vector3(x, y, 0).applyMatrix4(m); return [p.x, p.y];
  });
  const openings: V2[][] = [];
  const reserve = (c: V2, d: V2, width: number, depth: number) => {
    let n: V2 = [-d[1], d[0]];
    if (!inRoom(room.polygon, [c[0] + n[0] * 0.2, c[1] + n[1] * 0.2])) n = [-n[0], -n[1]];
    const m = new Matrix4().makeBasis(new Vector3(...d, 0), new Vector3(...n, 0), new Vector3(0, 0, 1)).setPosition(...c, room.floorZ);
    openings.push(poly(m, [-width / 2 - 0.12, -0.1, width / 2 + 0.12, depth]));
  };
  for (const door of room.doors) {
    const w = plan.walls[door.wall], length = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const d: V2 = [(w.b[0] - w.a[0]) / length, (w.b[1] - w.a[1]) / length];
    reserve([w.a[0] + d[0] * door.at, w.a[1] + d[1] * door.at], d, door.width, B.doorClear);
  }
  for (const i of room.windows) { const w = plan.windows[i]; reserve(w.at, w.dir, w.width, B.windowClear); }
  const fits = (p: V2[], blocked: V2[][]) => roomContains(room.polygon, p) && ![...openings, ...blocked].some(o => overlaps(p, o));
  const [x0, y0, x1, y1] = room.rect, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const halfDepth = B.tableWidth / 2 + B.chairOffset + B.chairDepth / 2 + B.pullClear;
  let placement: { m: Matrix4; length: number; footprint: V2[] } | null = null;
  const rotations = x1 - x0 >= y1 - y0 ? [0, Math.PI / 2] : [Math.PI / 2, 0];
  for (const rotation of rotations) {
    const span = rotation ? y1 - y0 : x1 - x0, maximum = Math.min(B.tableMaxLength, span - B.endClear * 2);
    const lengths: number[] = [];
    for (let length = maximum; length >= B.tableMinLength - 0.001; length -= B.searchStep * 2) lengths.push(length);
    if (maximum >= B.tableMinLength) lengths.push(B.tableMinLength);
    for (const length of [...new Set(lengths)]) {
      const offsets: V2[] = [[0, 0], [0, -B.searchStep], [0, B.searchStep], [-B.searchStep, 0], [B.searchStep, 0], [0, -B.searchStep * 2], [0, B.searchStep * 2]];
      for (const [dx, dy] of offsets) {
        const m = at(cx + dx, cy + dy, room.floorZ, rotation);
        const footprint = poly(m, [-length / 2 - B.chairOffset - B.chairDepth / 2 - B.pullClear, -halfDepth,
          length / 2 + B.chairOffset + B.chairDepth / 2 + B.pullClear, halfDepth]);
        if (fits(footprint, [])) { placement = { m, length, footprint }; break; }
      }
      if (placement) break;
    }
    if (placement) break;
  }
  if (!placement) return info;
  const { m, length } = placement, occupied = [placement.footprint];
  banquetTable(decor, brass, m, length);
  const local = (x: number, y: number, z = 0, turn = 0) => m.clone().multiply(at(x, y, z, turn));
  const seats = Math.max(2, Math.floor((length - B.tableWidth * 0.55) / B.chairPitch));
  for (let i = 0; i < seats; i++) for (const side of [-1, 1]) {
    const x = (i - (seats - 1) / 2) * B.chairPitch;
    banquetChair(brass, decor, local(x, side * (B.tableWidth / 2 + B.chairOffset), 0, side > 0 ? Math.PI : 0));
    const card = local(x, side * B.tableWidth * 0.30, B.tableHeight, side < 0 ? Math.PI : 0);
    banquetCard(linen, brass, card); group.add(banquetPlaceCard(card, B.placeCardWidth, B.placeCardHeight));
  }
  for (const side of [-1, 1]) {
    banquetChair(brass, decor, local(side * (length / 2 + B.chairOffset), 0, 0, side > 0 ? Math.PI / 2 : -Math.PI / 2), true);
    const card = local(side * (length / 2 - 0.18), 0, B.tableHeight, side > 0 ? -Math.PI / 2 : Math.PI / 2);
    banquetCard(linen, brass, card); group.add(banquetPlaceCard(card, B.placeCardWidth, B.placeCardHeight));
  }
  info.chairs = seats * 2 + 2;
  const arrangements = Math.max(1, Math.floor(length / B.centerpiecePitch));
  for (let i = 0; i < arrangements; i++) banquetCenterpiece(brass, decor, bulb,
    local((i - (arrangements - 1) / 2) * B.centerpiecePitch, 0, B.tableHeight));
  const height = room.ceilingZ - room.floorZ;
  const bottom = Math.min(B.chandelierBottom, height - B.chandelierHeight - B.chandelierTopGap);
  if (bottom >= B.chandelierMinBottom) {
    const count = length >= B.twoLightsMinLength ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const x = count === 2 ? (i ? 1 : -1) * length / 6 : 0, chandelierM = local(x, 0, bottom);
      banquetChandelier(brass, crystal, bulb, chandelierM, height - bottom - B.chandelierTopGap);
      sources.push({ position: new Vector3(0, 0, B.chandelierHeight * 0.45).applyMatrix4(chandelierM), intensity: B.chandelierIntensity, distance: B.chandelierRange });
    }
    info.chandeliers = count;
  }
  const edges = freeStretches(plan, room).sort((a, b) => (b.s1 - b.s0) - (a.s1 - a.s0));
  const wallFrame = (f: typeof edges[number], s: number) => new Matrix4().makeBasis(new Vector3(...f.d, 0), new Vector3(...f.n, 0), new Vector3(0, 0, 1))
    .setPosition(f.a[0] + f.d[0] * s + f.n[0] * B.wallGap, f.a[1] + f.d[1] * s + f.n[1] * B.wallGap, room.floorZ);
  const consoleAt = (wall: Matrix4): boolean => {
    const footprint = poly(wall, [-B.consoleWidth / 2 - 0.03, 0, B.consoleWidth / 2 + 0.03, B.consoleDepth + B.wallFurnitureClear]);
    if (!fits(footprint, occupied)) return false;
    banquetConsole(decor, brass, wall); occupied.push(footprint); info.consoles++;
    const lm = wall.clone().multiply(at(0, B.consoleDepth / 2, B.consoleHeight));
    const z = banquetLamp(brass, crystal, bulb, lm);
    sources.push({ position: new Vector3(0, 0, z).applyMatrix4(lm), intensity: B.consoleIntensity, distance: B.consoleRange });
    return true;
  };
  let pictureBlock: V2[] | null = null;
  for (const edge of edges) {
    const width = Math.min(B.pictureWidth, edge.s1 - edge.s0 - 0.16), pictureHeight = Math.min(B.pictureHeight, height - B.pictureBottom - 0.35);
    if (width < B.pictureMinWidth || pictureHeight < B.pictureMinHeight) continue;
    const wall = wallFrame(edge, (edge.s0 + edge.s1) / 2);
    banquetPictureFrame(brass, wall, width, pictureHeight, B.pictureBottom);
    group.add(ballroomPainting(wall, width, pictureHeight, B.pictureBottom, B.frameWidth));
    pictureBlock = poly(wall, [-width / 2, 0, width / 2, 0.10]); info.picture = true;
    if (edge.s1 - edge.s0 >= B.consoleWidth + 0.12) consoleAt(wall);
    break;
  }
  for (const edge of edges) {
    if (info.consoles >= 2) break;
    if (edge.s1 - edge.s0 < B.consoleWidth + 0.12) continue;
    for (let s = edge.s0 + B.consoleWidth / 2 + 0.06; s <= edge.s1 - B.consoleWidth / 2 - 0.06; s += B.searchStep) {
      if (consoleAt(wallFrame(edge, s))) break;
    }
  }
  if (height >= B.cabinetHeight + 0.15) for (const edge of edges) {
    if (info.cabinets >= 2) break;
    for (let s = edge.s0 + B.cabinetWidth / 2 + 0.06; s <= edge.s1 - B.cabinetWidth / 2 - 0.06; s += B.searchStep) {
      const wall = wallFrame(edge, s), footprint = poly(wall, [-B.cabinetWidth / 2 - 0.04, 0, B.cabinetWidth / 2 + 0.04, B.cabinetDepth + B.wallFurnitureClear]);
      if (!fits(footprint, occupied) || (pictureBlock && overlaps(footprint, pictureBlock))) continue;
      banquetCabinet(decor, brass, linen, glass, wall); occupied.push(footprint); info.cabinets++; break;
    }
  }
  // Upper gallery on every wall; window spans remain excluded even for tall windows.
  const upperBottom = Math.max(B.upperPictureMinBottom, height * B.upperPictureHeightRatio, B.pictureBottom + B.pictureHeight + 0.20);
  const upperHeight = Math.min(B.upperPictureHeight, height - upperBottom - B.upperPictureTopClear);
  const wallCounts = new Map<string, number>(), portraits: Mesh[] = [];
  if (upperHeight >= B.upperPictureMinHeight) for (const edge of edges) {
    const key = `${Math.round(edge.n[0] * 100)},${Math.round(edge.n[1] * 100)}`;
    const remaining = B.upperPicturesPerWall - (wallCounts.get(key) ?? 0);
    const span = edge.s1 - edge.s0 - B.upperPictureEndClear * 2;
    const width = Math.min(B.upperPictureWidth, span);
    if (width < B.upperPictureMinWidth || remaining <= 0) continue;
    const count = Math.min(remaining, Math.max(1, Math.floor((span + B.upperPictureGap) / (width + B.upperPictureGap))));
    for (let i = 0; i < count; i++) {
      const s = (edge.s0 + edge.s1) / 2 + (i - (count - 1) / 2) * (width + B.upperPictureGap), wall = wallFrame(edge, s);
      banquetPictureFrame(brass, wall, width, upperHeight, upperBottom);
      portraits.push(ballroomHighPainting(wall, width, upperHeight, upperBottom, B.frameWidth, info.highPictures++));
    }
    wallCounts.set(key, (wallCounts.get(key) ?? 0) + count);
  }
  // All copies of one portrait share a merged mesh: at most three extra draw calls.
  const byMaterial = new Map<Material, Mesh[]>();
  for (const portrait of portraits) {
    const material = portrait.material as Material;
    const copies = byMaterial.get(material) ?? []; copies.push(portrait); byMaterial.set(material, copies);
  }
  for (const [material, copies] of byMaterial) {
    const geometry = mergeGeometries(copies.map(p => p.geometry));
    for (const copy of copies) copy.geometry.dispose();
    if (geometry) { const mesh = new Mesh(geometry, material); mesh.receiveShadow = true; group.add(mesh); }
  }
  info.furnished = true;
  return info;
}

export interface FurnitureLight { position: Vector3; intensity: number; distance: number }
export interface FurnitureInfo {
  lamps: Vector3[];
  lightSources: FurnitureLight[];
}

export interface FurnitureItem { name: string; zh: string; category: string; triangles: number; group: Group }

/** Catalogue recipes call the same component builders as furnished rooms. */
export function buildFurnitureItems(mats: InteriorMaterials): FurnitureItem[] {
  type Parts = { wood: Tris; linen: Tris; fabric: Tris; gold: Tris; dark: Tris; brass: Tris; leather: Tris; shade: Tris; books: Tris; art: Tris; rug: Tris; crystal: Tris; bulb: Tris; glass: Tris };
  const items: FurnitureItem[] = [], m = new Matrix4();
  const room = { floorZ: 0, ceilingZ: 3 } as PlanRoom;
  const add = (category: string, name: string, zh: string, build: (p: Parts) => void, extra?: () => Mesh) => {
    const p: Parts = { wood: new Tris(), linen: new Tris(), fabric: new Tris(), gold: new Tris(), dark: new Tris(),
      brass: new Tris(), leather: new Tris(), shade: new Tris(), books: new Tris(), art: new Tris(), rug: new Tris(), crystal: new Tris(), bulb: new Tris(), glass: new Tris() };
    build(p);
    const group = new Group(); group.name = name;
    let triangles = 0;
    const entries: [Tris, Material][] = [[p.wood, mats.furnWood], [p.linen, mats.furnLinen], [p.fabric, mats.furnFabric],
      [p.gold, mats.furnGold], [p.dark, mats.furnDark], [p.brass, mats.furnBrass], [p.leather, mats.furnLeather],
      [p.shade, mats.furnShade], [p.books, mats.finishWall], [p.art, mats.finishWall], [p.rug, mats.finishFloor],
      [p.crystal, mats.furnCrystal], [p.bulb, mats.furnBulb], [p.glass, mats.furnGlass]];
    for (const [tris, material] of entries) if (tris.pos.length) {
      const mesh = new Mesh(tris.geometry(), material);
      triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3;
      mesh.castShadow = tris !== p.rug && tris !== p.books && tris !== p.art && tris !== p.shade && tris !== p.bulb && tris !== p.glass;
      mesh.receiveShadow = true; group.add(mesh);
    }
    if (extra) { const mesh = extra(); triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3; group.add(mesh); }
    group.userData.furnitureItem = { name, zh, category, triangles };
    items.push({ category, name, zh, triangles, group });
  };
  const rug = (p: Parts, kind: "ballroom" | "salon" | "dining", width: number, depth: number) => {
    p.rug.stamp = kind === "ballroom" ? carpetStamp(-width / 2, depth / 2, width, depth, 0, 3)
      : kind === "salon" ? salonRugStamp(-width / 2, depth / 2, 0, width, depth, 0, 3)
        : diningRugStamp(-width / 2, depth / 2, 0, width, depth, 0, 3);
    new Part(p.rug, m).box(-width / 2, -depth / 2, 0, width / 2, depth / 2, 0.018);
  };
  add("宴會廳", "Banquet table", "宴會長桌", p => banquetTable(p.art, p.brass, m, DINING.tableLength * 2));
  add("宴會廳", "Banquet chair", "宴會餐椅", p => banquetChair(p.brass, p.art, m));
  add("宴會廳", "Banquet armchair", "宴會桌頭扶手椅", p => banquetChair(p.brass, p.art, m, true));
  add("宴會廳", "Banquet place card", "宴會餐牌", p => banquetCard(p.linen, p.brass, m), () => banquetPlaceCard(m, BANQUET.placeCardWidth, BANQUET.placeCardHeight));
  add("宴會廳", "Banquet centerpiece", "宴會花盆燭台擺設", p => banquetCenterpiece(p.brass, p.art, p.bulb, m));
  add("宴會廳", "Gilt chandelier", "金色水晶吊燈", p => banquetChandelier(p.brass, p.crystal, p.bulb, m, BANQUET.chandelierHeight + 0.40));
  add("宴會廳", "Peacock painting", "巨幅孔雀花卉掛畫", p => banquetPictureFrame(p.brass, m, BANQUET.pictureWidth, BANQUET.pictureHeight, 0),
    () => ballroomPainting(m, BANQUET.pictureWidth, BANQUET.pictureHeight, 0, BANQUET.frameWidth));
  add("宴會廳", "Upper portrait painting", "宴會廳高處肖像掛畫", p => banquetPictureFrame(p.brass, m, BANQUET.upperPictureWidth, BANQUET.upperPictureHeight, 0),
    () => ballroomHighPainting(m, BANQUET.upperPictureWidth, BANQUET.upperPictureHeight, 0, BANQUET.frameWidth, 0));
  add("宴會廳", "Banquet console", "宴會廳邊桌", p => banquetConsole(p.art, p.brass, m));
  add("宴會廳", "Crystal console lamp", "水晶燈座邊桌檯燈", p => { banquetLamp(p.brass, p.crystal, p.bulb, m); });
  add("宴會廳", "Glass crockery cabinet", "木質玻璃餐具櫃", p => banquetCabinet(p.art, p.brass, p.linen, p.glass, m));
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
  add("閣樓房", "Attic single bed", "閣樓原木單人床", p => atticSingleBed(p.linen, p.art, m));
  add("閣樓房", "Attic reading armchair", "閣樓花紋單人沙發", p => atticArmchair(p.art, m));
  add("閣樓房", "Attic round table", "閣樓原木小圓桌", p => atticRoundTable(p.art, m));
  add("閣樓房", "Stepped pale-book shelves", "階梯式淺色書本書櫃", p => {
    for (const [i, height] of [1.25, 2.20, 1.56].entries()) atticBookshelf(p.art, p.books, at((i - 1) * ATTIC.shelfWidth, 0, 0), ATTIC.shelfWidth, height);
  });
  add("閣樓房", "Stained-glass floor lamp", "彩繪玻璃立燈", p => atticFloorLamp(p.brass, p.art, p.bulb, m));
  add("閣樓房", "Dark attic single bed", "深原木閣樓單人床", p => atticSingleBed(p.linen, p.art, m, true));
  add("閣樓房", "Dark attic reading armchair", "深原木閣樓單人沙發", p => atticArmchair(p.art, m, true));
  add("閣樓房", "Dark attic round table", "深原木閣樓小圓桌", p => atticRoundTable(p.art, m, ATTIC.tableDiameter, true));
  add("閣樓房", "Dark pale-book shelves", "深原木淺色書本書櫃", p => {
    for (const [i, height] of [1.25, 2.20, 1.56].entries()) atticBookshelf(p.art, p.books, at((i - 1) * ATTIC.shelfWidth, 0, 0), ATTIC.shelfWidth, height, true);
  });
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
  add("咖啡店", "Cafe round table", "咖啡店圓桌", p => cafeTable(p.linen, p.wood, p.dark, p.art, m));
  add("咖啡店", "Cafe upholstered chair", "咖啡店軟墊椅", p => cafeChair(p.linen, p.wood, p.brass, p.art, m));
  add("咖啡店", "Terrace round table", "戶外咖啡圓桌", p => cafeTable(p.linen, p.wood, p.dark, p.art, m, true));
  add("咖啡店", "Terrace wicker chair", "戶外藤編椅", p => cafeChair(p.linen, p.wood, p.brass, p.art, m, true));
  add("咖啡店", "Cafe wall bar", "靠牆木質吧台", p => cafeBar(p.wood, p.brass, p.art, m, CAFE.barMaxLength));
  add("咖啡店", "Cafe bar stool", "咖啡店吧台椅", p => cafeStool(p.wood, p.dark, m));
  add("咖啡店", "Cafe display cabinet", "咖啡店展示櫃", p => cafeCabinet(p.linen, p.brass, p.art, m));
  add("咖啡店", "Cafe menu board", "木框菜單", p => new Part(p.wood, m).box(-CAFE.menuWidth / 2, -0.018, -CAFE.menuHeight / 2, CAFE.menuWidth / 2, 0, CAFE.menuHeight / 2), () => cafeMenu(m));
  return items;
}

/** Furniture merged by material, with repeated recipes sharing instance geometry. */
export function buildFurniture(plan: BuildingPlan, b: Building, mats: InteriorMaterials, look: Look, options: { instancing?: boolean } = {}): Group {
  const group = new Group();
  const lamps: Vector3[] = [], lightSources: FurnitureLight[] = [];
  const banquetCrystal = new Tris(), banquetBulb = new Tris(), banquetGlass = new Tris();
  const wood = new Tris(), fabric = new Tris(), linen = new Tris(), gold = new Tris(), rug = new Tris();
  const dark = new Tris(), brass = new Tris(), leather = new Tris(), shade = new Tris(), books = new Tris();
  const salonRug = new Tris(), salonArt = new Tris();
  const diningDecor = new Tris(), diningRug = new Tris();
  const instances = new FurnitureInstances();
  if (options.instancing !== false) instances.register([wood, fabric, linen, gold, rug, dark, brass, leather, shade, books,
    salonRug, salonArt, diningRug, diningDecor, banquetCrystal, banquetBulb, banquetGlass]);

  const room = plan.rooms.find(r => r.type === "ballroom");
  if (room) {
    const xs = room.polygon.map(p => p[0]), ys = room.polygon.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const z = room.floorZ;

    // the carpet, in the real look only (the diagram colours and the white model keep the bare floor)
    if (look === "real" && x1 - x0 > 2 * RUG_MARGIN + 1 && y1 - y0 > 2 * RUG_MARGIN + 1) {
      const [rx0, rx1, ry0, ry1] = [x0 + RUG_MARGIN, x1 - RUG_MARGIN, y0 + RUG_MARGIN, y1 - RUG_MARGIN];
      // the shader draws it in world coordinates: x - W/2, and L/2 - y for the corner nearest the front
      rug.stamp = carpetStamp(rx0 - plan.width / 2, plan.length / 2 - ry1, rx1 - rx0, ry1 - ry0, z, room.ceilingZ);
      const v = (x: number, y: number) => new Vector3(x, y, z + 0.008);
      rug.quad(v(rx0, ry0), v(rx1, ry0), v(rx1, ry1), v(rx0, ry1), new Vector3(0, 0, 1));
    }

    group.userData.ballroom = ballroomSet(plan, room, group, linen, brass, diningDecor, banquetCrystal, banquetBulb, banquetGlass, lightSources);
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

  const atticInfo: AtticInfo = { rooms: {}, furnished: [], unfurnished: [] };
  for (const room of plan.rooms.filter(r => r.type === "maid" && plan.levels[r.level].cls === "R")) {
    const placement = atticPlacement(plan, b, room), theme = room.atticTheme ?? 0;
    const info: AtticRoomInfo = { bed: !!placement, reading: !!placement?.reading, lamp: !!placement?.lamp,
      shelves: placement?.shelves.length ?? 0, compact: !!placement?.compact, missing: [], theme };
    if (!info.bed) info.missing.push("單人床");
    if (!info.reading) info.missing.push("單人沙發與小桌");
    if (!info.lamp) info.missing.push("立燈");
    if (!info.shelves) info.missing.push("書櫃");
    atticInfo.rooms[room.id] = info;
    (info.missing.length ? atticInfo.unfurnished : atticInfo.furnished).push(room.id);
    if (placement) atticSet(linen, brass, diningDecor, books, banquetBulb, placement, lightSources, theme);
  }
  group.userData.attic = atticInfo;

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
  for (const r of plan.rooms.filter(r => r.type === "kitchen" || (r.type === "shopBack" && r.level === 0))) {
    const placement = kitchenPlacement(plan, b, r);
    if (!placement) { kitchenInfo.unfurnished.push(r.id); continue; }
    const { m, left, right, aisle, displays, hasIsland, hoodHeight } = placement, K = KITCHEN;
    kitchenRange(linen, brass, dark, diningDecor, m);
    kitchenHood(linen, dark, m.clone().multiply(at(0, 0, K.hoodBottom)), hoodHeight);
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
    if (look === "real") diningDecor.stamp = kitchenBacksplashStamp(r.floorZ, r.ceilingZ);
    else if (look === "diagram") diningDecor.stamp = stampOf(look, r, "wall");
    const backsplash = new Part(diningDecor, m);
    backsplash.box(left, 0, K.height, right, 0.012, K.upperBottom);
    if (K.hoodBottom > K.upperBottom) backsplash.box(-K.hoodWidth / 2, 0, K.upperBottom, K.hoodWidth / 2, 0.012, K.hoodBottom);
    const islandY = K.depth + K.frontProjection + aisle + K.islandDepth / 2 + K.frontProjection;
    if (hasIsland) kitchenIsland(linen, brass, dark, diningDecor, m.clone().multiply(at(0, islandY, 0)));
    for (const display of displays) crockeryCabinet(linen, brass, diningDecor, display.m, 0, display.width);
    kitchenInfo.furnished.push(r.id);
    kitchenInfo.rooms[r.id] = { aisle, wallLength: right - left, displayCabinets: displays.length, hasIsland };
  }
  group.userData.kitchens = kitchenInfo;

  const cafes: CafeInfo = { furnished: [], unfurnished: [], rooms: {} };
  for (const room of plan.rooms.filter(r => r.level === 0 && r.type === "shop" && r.cafeTheme !== undefined)) {
    const placement = cafePlacement(plan, room);
    if (placement) { cafeSet(linen, wood, brass, dark, diningDecor, group, room, placement, look); cafes.furnished.push(room.id); }
    else cafes.unfurnished.push(room.id);
    cafes.rooms[room.id] = { theme: room.cafeTheme!, furnished: !!placement, tables: placement?.tables.length ?? 0,
      chairs: placement?.chairs.length ?? 0, stools: placement?.stools.length ?? 0, cabinet: !!placement?.cabinet,
      outdoorTables: 0, outdoorChairs: 0 };
  }
  group.userData.cafe = cafes;

  const parts: [Tris, Material][] = [
    [wood, mats.furnWood], [fabric, mats.furnFabric], [linen, mats.furnLinen], [gold, mats.furnGold], [rug, mats.finishFloor],
    [dark, mats.furnDark], [brass, mats.furnBrass], [leather, mats.furnLeather], [shade, mats.furnShade], [books, mats.finishWall],
    [salonRug, mats.finishFloor], [salonArt, mats.finishWall],
    [diningRug, mats.finishFloor], [diningDecor, mats.finishWall],
    [banquetCrystal, mats.furnCrystal], [banquetBulb, mats.furnBulb], [banquetGlass, mats.furnGlass],
  ];
  const castShadow = (t: Tris) => t !== rug && t !== salonRug && t !== diningRug && t !== salonArt && t !== books && t !== shade && t !== banquetBulb && t !== banquetGlass;
  instances.append(group, new Map(parts.map(([t, m]) => [t, { material: m, castShadow: castShadow(t) }])));
  for (const [t, m] of parts) {
    if (!t.pos.length) continue;
    const mesh = new Mesh(t.geometry(), m);
    mesh.castShadow = castShadow(t);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.userData.furniture = { lamps, lightSources } satisfies FurnitureInfo;
  return group;
}
