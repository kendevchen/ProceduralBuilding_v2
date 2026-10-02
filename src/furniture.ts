/**
 * The ballroom's furnishings (INTERIOR_SPEC.md §6.8): a long banquet table
 * under a white cloth with a gold skirt, upholstered chairs along both sides
 * and at the ends (a frame with a cross-lattice back, after the reference
 * photo), and a wool carpet on the parquet (the carpet's pattern is drawn in
 * finishes.ts). One ballroom per building, so the pieces are plain geometry
 * merged per material, like the stairs; closed boxes, so a cut through them
 * shows the section colour. Blender Z-up space, like rooms3d.ts.
 */
import { Group, type Material, Matrix4, Mesh, Vector3 } from "three";
import { type Look, carpetStamp } from "./finishes";
import { type BuildingPlan } from "./plan";
import { type InteriorMaterials, Tris } from "./rooms3d";

/** the parquet that shows round the carpet, and the clearance round the table */
const RUG_MARGIN = 0.55;
const TABLE = { width: 1.15, height: 0.77, cloth: 0.32, end: 1.9 };
const CHAIR = { pitch: 0.62, setback: 0.15 };

/** boxes and struts in a frame of their own (a chair's), mapped into the room */
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
}

/** a banquet chair facing +y of its frame, origin at the centre of its footprint on the floor */
function chair(wood: Tris, fabric: Tris, m: Matrix4): void {
  const w = new Part(wood, m), f = new Part(fabric, m);
  const leg = 0.022; // half thickness
  for (const sx of [-1, 1]) {
    // front legs to the seat, back legs run on up as the posts of the back
    w.box(sx * 0.2 - leg, 0.2 - leg, 0, sx * 0.2 + leg, 0.2 + leg, 0.42);
    w.box(sx * 0.2 - leg, -0.2 - leg, 0, sx * 0.2 + leg, -0.2 + leg, 0.98);
  }
  w.box(-0.22, -0.22, 0.38, 0.22, 0.22, 0.45); // seat frame
  f.box(-0.2, -0.2, 0.45, 0.2, 0.2, 0.53); // cushion
  w.box(-0.2, -0.225, 0.92, 0.2, -0.185, 0.99); // top rail
  w.box(-0.2, -0.225, 0.55, 0.2, -0.185, 0.6); // lower rail
  f.box(-0.17, -0.215, 0.6, 0.17, -0.195, 0.92); // upholstered back
  // the cross lattice in front of it
  w.strut(-0.17, 0.6, 0.17, 0.92, -0.18, 0.02);
  w.strut(0.17, 0.6, -0.17, 0.92, -0.18, 0.02);
}

/** the table: a gold skirt to the floor under a white cloth that hangs below the top */
function table(linen: Tris, gold: Tris, m: Matrix4, length: number): void {
  const hl = length / 2, hw = TABLE.width / 2;
  new Part(gold, m).box(-hl + 0.06, -hw + 0.06, 0, hl - 0.06, hw - 0.06, TABLE.height - TABLE.cloth);
  new Part(linen, m).box(-hl, -hw, TABLE.height - TABLE.cloth, hl, hw, TABLE.height);
}

/** the ballroom's table, chairs and carpet; none when the building has no ballroom */
export function buildFurniture(plan: BuildingPlan, mats: InteriorMaterials, look: Look): Group {
  const group = new Group();
  const room = plan.rooms.find(r => r.type === "ballroom");
  if (!room) return group;
  const xs = room.polygon.map(p => p[0]), ys = room.polygon.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, z = room.floorZ;

  const wood = new Tris(), fabric = new Tris(), linen = new Tris(), gold = new Tris(), rug = new Tris();

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
  table(linen, gold, new Matrix4().makeTranslation(cx, cy, z), length);
  const half = TABLE.width / 2 + CHAIR.setback + 0.2;
  const n = Math.floor((length - 0.4) / CHAIR.pitch);
  for (let k = 0; k < n; k++) {
    const x = cx - ((n - 1) * CHAIR.pitch) / 2 + k * CHAIR.pitch;
    chair(wood, fabric, new Matrix4().makeTranslation(x, cy - half, z)); // faces +y, towards the table
    chair(wood, fabric, new Matrix4().makeTranslation(x, cy + half, z).multiply(new Matrix4().makeRotationZ(Math.PI)));
  }
  const end = length / 2 + CHAIR.setback + 0.2;
  chair(wood, fabric, new Matrix4().makeTranslation(cx - end, cy, z).multiply(new Matrix4().makeRotationZ(-Math.PI / 2)));
  chair(wood, fabric, new Matrix4().makeTranslation(cx + end, cy, z).multiply(new Matrix4().makeRotationZ(Math.PI / 2)));

  const parts: [Tris, Material][] = [[wood, mats.furnWood], [fabric, mats.furnFabric], [linen, mats.furnLinen], [gold, mats.furnGold], [rug, mats.finishFloor]];
  for (const [t, m] of parts) {
    if (!t.pos.length) continue;
    const mesh = new Mesh(t.geometry(), m);
    mesh.castShadow = t !== rug;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
