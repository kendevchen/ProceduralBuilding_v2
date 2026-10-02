/**
 * The interior as geometry (INTERIOR_SPEC.md §6): a white model built from the
 * floor plan (plan.ts). It has
 *   - floors and ceilings, open at the stair wells and the ballroom's void;
 *   - the walls with their door openings;
 *   - the inner faces of the outer walls, with the kit modules' openings
 *     (outlines from the kit manifest) and the reveals behind them;
 *   - the attic under the mansard, with its dormer recesses and chimney flues.
 *
 * Every face looks into the room it bounds. Where the building is cut open,
 * one sees into a solid from behind, and the cut materials paint those back
 * faces in the section colour (cutaway.ts). Blender Z-up space, like the
 * building.
 */
import { BufferGeometry, Float32BufferAttribute, Group, type Material, Matrix4, Mesh, ShapeUtils, Vector2, Vector3 } from "three";
import dims from "../blender/kit_dims.json";
import type { Building } from "./generator";
import type { Kit } from "./kit";
import { type Look, type Stamp, stampAttributes, stampOf } from "./finishes";
import { type BuildingPlan, type PlanRoom, type PlanWall, type PlanWindow, edgeAt } from "./plan";
import { type V2, insetEdges } from "./roof";

const T = dims.wall;
const I = dims.interior;
const UP = new Vector3(0, 0, 1);
const DOWN = new Vector3(0, 0, -1);
/** keeps openings off the edges of the face they are cut from */
const GAP = 0.002;

/** triangles of one material, each turned to face a given way; with a
 *  finish (finishes.ts) every vertex also carries the current `stamp` */
export class Tris {
  pos: number[] = [];
  stamp: Stamp | null = null;
  private stamps: number[] = [];
  private ab = new Vector3();
  private ac = new Vector3();

  tri(a: Vector3, b: Vector3, c: Vector3, facing: Vector3) {
    this.ab.subVectors(b, a);
    this.ac.subVectors(c, a);
    const [p, q] = this.ab.cross(this.ac).dot(facing) < 0 ? [c, b] : [b, c];
    this.pos.push(a.x, a.y, a.z, p.x, p.y, p.z, q.x, q.y, q.z);
    if (this.stamp) for (let k = 0; k < 3; k++) this.stamps.push(...this.stamp);
  }

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, facing: Vector3) {
    this.tri(a, b, c, facing);
    this.tri(a, c, d, facing);
  }

  /** a planar polygon with holes, given in 2D and mapped into place */
  polygon(outer: V2[], holes: V2[][], to: (p: V2) => Vector3, facing: Vector3) {
    if (outer.length < 3) return;
    const faces = ShapeUtils.triangulateShape(outer.map(p => new Vector2(p[0], p[1])),
      holes.map(h => h.map(p => new Vector2(p[0], p[1]))));
    const pts = [...outer, ...holes.flat()].map(to);
    for (const [i, j, k] of faces) this.tri(pts[i], pts[j], pts[k], facing);
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    if (this.stamps.length) stampAttributes(g, this.stamps);
    g.computeVertexNormals();
    return g;
  }
}

export interface InteriorMaterials {
  wall: Material;
  floor: Material;
  ceiling: Material;
  /** faces inside a floor slab, seen only through a cut: the section colour on both sides */
  section: Material;
  /** the stairs (stairs.ts): steps, landings and stringer; the main stair's runner; railing bars; handrail */
  stair: Material;
  carpet: Material;
  iron: Material;
  wood: Material;
  /** the room finishes (finishes.ts): every room's walls, and its floor laid on the slab */
  finishWall: Material;
  finishFloor: Material;
  /** the banquet furniture (furniture.ts): chair frames, upholstery, the tablecloth, its gold skirt */
  furnWood: Material;
  furnFabric: Material;
  furnLinen: Material;
  furnGold: Material;
  /** the study's: ebony chairs, brass, leather bindings, the lit lamp shade */
  furnDark: Material;
  furnBrass: Material;
  furnLeather: Material;
  furnShade: Material;
}

const area = (p: V2[]) => p.reduce((s, q, i) => s + q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1], 0) / 2;
const v3 = (p: V2, z: number) => new Vector3(p[0], p[1], z);

/** clip a polygon to s0 <= s <= s1, z0 <= z <= z1 */
function clipBox(poly: V2[], s0: number, s1: number, z0: number, z1: number): V2[] {
  const half = (pts: V2[], d: (p: V2) => number): V2[] => {
    const out: V2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const dp = d(p), dq = d(q);
      if (dp >= 0) out.push(p);
      if ((dp >= 0) !== (dq >= 0)) {
        const t = dp / (dp - dq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    return out;
  };
  let r = half(poly, p => p[0] - s0);
  r = half(r, p => s1 - p[0]);
  r = half(r, p => p[1] - z0);
  return half(r, p => z1 - p[1]);
}

/** shrink a convex counterclockwise polygon a little, so it stays inside the face it is cut from */
function shrink(poly: V2[]): V2[] {
  return insetEdges(area(poly) > 0 ? poly : [...poly].reverse(), poly.map(() => GAP)) ?? poly;
}

export function buildRooms3d(plan: BuildingPlan, b: Building, kit: Kit, mats: InteriorMaterials, look: Look = "white"): Group {
  const walls = new Tris(), floors = new Tris(), ceilings = new Tris(), finishFloors = new Tris();
  const finished = look !== "white";
  /** the wall faces, wearing a room's finish (or plain paint; the white model: nothing) */
  const paint = (room: PlanRoom | null) => {
    walls.stamp = stampOf(look, room, "wall");
    return walls;
  };
  const levels = plan.levels;
  const attic = levels[levels.length - 1];
  const rooms = new Map(plan.rooms.map(r => [r.id, r]));
  const ballroom = plan.rooms.find(r => r.type === "ballroom");
  const inner = plan.inner;

  // ---- floors and ceilings, open at the stair wells and the ballroom
  for (const lv of levels) {
    const k = lv.index;
    const below = [
      ...plan.stairs.filter(s => k > s.from && k <= s.to).map(s => s.polygon),
      ...plan.voids.filter(v => v.level === k).map(v => v.polygon),
    ];
    floors.polygon(inner, below.map(shrink), p => v3(p, lv.floorZ), UP);
    if (lv.cls === "R") continue;
    const above = [
      ...plan.stairs.filter(s => k >= s.from && k < s.to).map(s => s.polygon),
      ...(ballroom && ballroom.level === k ? [ballroom.polygon] : []),
    ];
    ceilings.polygon(inner, above.map(shrink), p => v3(p, lv.ceilingZ), DOWN);
  }
  // each room's floor finish laid on the slab (the stairs only on the ground floor, where they stand on it)
  if (finished) {
    for (const r of plan.rooms) {
      if (r.type === "stair" && r.level > 0) continue;
      finishFloors.stamp = stampOf(look, r, "floor");
      finishFloors.polygon(r.polygon, [], p => v3(p, r.floorZ + 0.003), UP);
    }
  }

  // ---- the kit module behind each opening, and where its outline sits
  const moduleOf = (w: PlanWindow): { key: string; z: number } | null => {
    const side = b.sides[w.side];
    const bay = w.bay === -1 ? side.diag : side.bays[w.bay];
    if (!bay) return null;
    const cls = levels[w.level].cls;
    if (cls === "G") return { key: kit.key("G_bay", bay.ground), z: 0 };
    if (cls === "R") return bay.dormer ? { key: kit.key("R_mansard", `dormer_${bay.dormer}`), z: b.roofBase } : null;
    // the ballroom's tall windows reach over its two floors
    if (w.side === 0 && w.level <= 2 && b.tall.includes(w.bay)) {
      return { key: kit.key(`${b.rows[0].cls}${b.rows[1].cls}_tall`, "window"), z: b.rows[0].z };
    }
    const row = b.rows[w.level - 1];
    return { key: kit.key(`${row.cls}_bay`, "window"), z: row.z };
  };

  // ---- between a floor's ceiling and the next floor is the slab: solid, except
  // in the stair wells and the ballroom, where the walls carry on through it
  const openAbove = (id: string | null, k: number): boolean => {
    const r = id ? rooms.get(id) : undefined;
    if (!r || r.level !== k) return false;
    if (r.type === "ballroom") return true;
    if (r.type !== "stair") return false;
    const c = centroid(r.polygon);
    return plan.stairs.some(s => k >= s.from && k < s.to && inConvex(s.polygon, c));
  };

  // ---- inner faces of the outer walls, floor to ceiling, with the openings and their reveals
  const edges = inner.map((a, i) => {
    const c = inner[(i + 1) % inner.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const dir: V2 = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
    return { a, len, dir, inward: new Vector3(-dir[1], dir[0], 0), along: new Vector3(dir[0], dir[1], 0) };
  });
  /** a level's openings on edge i, clipped to s0..s1, z0..z1 of the edge's face */
  const holesOn = (e: (typeof edges)[number], i: number, k: number, s0: number, s1: number, z0: number, z1: number) => {
    const holes: { loop: V2[]; reveal: number }[] = [];
    for (const w of plan.windows) {
      if (w.level !== k || edgeAt(inner, w.at) !== i) continue;
      const mod = moduleOf(w);
      const info = mod && kit.info(mod.key);
      if (!mod || !info?.openings) continue;
      const sc = (w.at[0] - e.a[0]) * e.dir[0] + (w.at[1] - e.a[1]) * e.dir[1];
      const sign = Math.sign(w.dir[0] * e.dir[0] + w.dir[1] * e.dir[1]) || 1;
      for (const o of info.openings) {
        const loop = clipBox(o.loop.map(([x, z]) => [sc + sign * x, mod.z + z] as V2), s0 + GAP, s1 - GAP, z0 + GAP, z1 - GAP);
        if (Math.abs(area(loop)) > 1e-4) holes.push({ loop, reveal: o.reveal });
      }
    }
    return holes;
  };
  /** a face of edge e from s0 to s1, z0 to z1 in a room's finish, with its openings and the reveals behind them */
  const lining = (e: (typeof edges)[number], i: number, k: number, s0: number, s1: number, z0: number, z1: number, room: PlanRoom | null) => {
    const at = (p: V2) => new Vector3(e.a[0] + e.dir[0] * p[0], e.a[1] + e.dir[1] * p[0], p[1]);
    const holes = holesOn(e, i, k, s0, s1, z0, z1);
    paint(room).polygon([[s0, z0], [s1, z0], [s1, z1], [s0, z1]], holes.map(h => h.loop), at, e.inward);
    // reveals from where the module's end to this face, facing into the opening
    const out = e.inward.clone().negate();
    paint(null);
    for (const h of holes) {
      const ccw = area(h.loop) > 0;
      h.loop.forEach((p, j) => {
        const q = h.loop[(j + 1) % h.loop.length];
        const flatZ = (z: number) => Math.abs(p[1] - z) < 1e-5 && Math.abs(q[1] - z) < 1e-5;
        if (flatZ(z0 + GAP) || flatZ(z1 - GAP)) return;
        const ds = q[0] - p[0], dz = q[1] - p[1];
        const n = ccw ? [-dz, ds] : [dz, -ds];
        const facing = e.along.clone().multiplyScalar(n[0]).addScaledVector(UP, n[1]);
        const P = at(p), Q = at(q), d = T - h.reveal;
        walls.quad(P, Q, Q.clone().addScaledVector(out, d), P.clone().addScaledVector(out, d), facing);
      });
    }
  };
  for (const lv of levels) {
    if (lv.cls === "R") continue;
    const z0 = lv.floorZ, z1 = lv.ceilingZ, z2 = levels[lv.index + 1].floorZ;
    const open = plan.rooms.filter(r => r.level === lv.index && openAbove(r.id, lv.index));
    edges.forEach((e, i) => {
      // on up through the slab beside the stair wells and the ballroom (its tall windows cross it)
      for (const r of open) {
        const on = onEdge(r.polygon, e);
        if (on.length < 2) continue;
        const pad = I.walls.cage / 2;
        lining(e, i, lv.index, Math.max(0, Math.min(...on) - pad), Math.min(e.len, Math.max(...on) + pad), z1, z2, r);
      }
      if (!finished) {
        lining(e, i, lv.index, 0, e.len, z0, z1, null);
        return;
      }
      // finished: room by room along the edge (the walls between them hide the joins)
      for (const r of plan.rooms) {
        if (r.level !== lv.index && !(r.levels === 2 && r.level === lv.index - 1)) continue;
        const on = onEdge(r.polygon, e);
        if (on.length < 2) continue;
        lining(e, i, lv.index, Math.max(0, Math.min(...on) - 0.06), Math.min(e.len, Math.max(...on) + 0.06), z0, z1, r);
      }
    });
  }

  // ---- walls between the rooms: floor to ceiling, on through the slab where a
  // side is open (that side's face white, the other inside the slab), and the
  // ballroom's walls on up through its upper floor
  const section = new Tris();
  /** the room on the wall's left (+normal) side, and on its right */
  const sidesOf = (w: PlanWall): [string | null, string | null] => {
    const left = (id: string | null) => {
      const r = id ? rooms.get(id) : undefined;
      if (!r) return false;
      const c = centroid(r.polygon);
      return (w.b[0] - w.a[0]) * (c[1] - w.a[1]) - (w.b[1] - w.a[1]) * (c[0] - w.a[0]) > 0;
    };
    const [p, q] = w.rooms;
    return left(p) ? [p, q] : [q, p];
  };
  for (const w of plan.walls) {
    const lv = levels[w.level];
    if (lv.cls === "R") continue;
    const k = lv.index;
    const [l, r] = sidesOf(w);
    // on the ballroom's upper floor the ballroom's own walls stand instead
    const voidWall = w.rooms[1] === null;
    const L = () => paint(rooms.get(l ?? "") ?? null), R = () => paint(rooms.get(r ?? "") ?? null);
    const rim = () => paint(null), slab = () => section;
    if (!voidWall) wallSolid(L, R, rim, w, lv.floorZ, () => lv.ceilingZ, lv.floorZ, lv.ceilingZ - 0.02, true);
    const lo = openAbove(l, k), ro = openAbove(r, k);
    if (lo || ro) {
      wallSolid(lo ? L : slab, ro ? R : slab, slab, { ...w, openings: [] },
        lv.ceilingZ, () => levels[k + 1].floorZ, lv.ceilingZ, 0, true);
    }
    if (!voidWall && w.rooms.some(id => rooms.get(id ?? "")?.type === "ballroom")) {
      const up = levels[k + 1];
      wallSolid(L, R, rim, { ...w, openings: [] }, up.floorZ, () => up.ceilingZ, up.floorZ, 0, true);
    }
  }

  // ---- the attic under the mansard
  const { rise, run } = dims.mansard;
  const rb = b.roofBase;
  const F = b.footprint;
  const kinds = b.edgeKinds;
  const insetAt = (z: number) => Math.max(T, I.atticLining + ((z - rb) * run) / rise);
  const ring = (z: number) => insetEdges(F, kinds.map(k => (k === "party" ? T : insetAt(z)))) ?? inner;
  const zk = rb + ((T - I.atticLining) * rise) / run; // where the slope leaves the knee wall
  const zc = attic.ceilingZ;
  const P0 = ring(zk), Pc = ring(zc);
  const dormers = plan.windows.filter(w => w.level === attic.index && w.kind === "dormer");
  paint(null);
  F.forEach((a, i) => {
    const c = F[(i + 1) % F.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const dir: V2 = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
    const inward = new Vector3(-dir[1], dir[0], 0);
    const sOf = (q: V2) => (q[0] - a[0]) * dir[0] + (q[1] - a[1]) * dir[1];
    const j = (i + 1) % F.length;
    const at = (inset: (z: number) => number) => (p: V2) =>
      new Vector3(a[0] + dir[0] * p[0] - dir[1] * inset(p[1]), a[1] + dir[1] * p[0] + dir[0] * inset(p[1]), p[1]);
    if (kinds[i] === "party") {
      walls.polygon([[sOf(P0[i]), attic.floorZ], [sOf(P0[j]), attic.floorZ], [sOf(P0[j]), zk], [sOf(Pc[j]), zc],
        [sOf(Pc[i]), zc], [sOf(P0[i]), zk]], [], at(() => T), inward);
      return;
    }
    // knee wall, then the slope with the dormers' recesses cut out
    walls.quad(v3(P0[i], attic.floorZ), v3(P0[j], attic.floorZ), v3(P0[j], zk), v3(P0[i], zk), inward);
    const holes: V2[][] = [];
    for (const w of dormers) {
      if (edgeAt(inner, w.at) !== i) continue;
      const mod = moduleOf(w);
      const rc = mod && kit.info(mod.key)?.recess;
      if (!rc) continue;
      const sc = sOf(w.at);
      holes.push([[sc - rc.halfWidth, rb + rc.floor], [sc + rc.halfWidth, rb + rc.floor],
        [sc + rc.halfWidth, rb + rc.ceiling], [sc - rc.halfWidth, rb + rc.ceiling]]);
    }
    const slopeFacing = inward.clone().multiplyScalar(rise).addScaledVector(UP, -run).normalize();
    walls.polygon([[sOf(P0[i]), zk], [sOf(P0[j]), zk], [sOf(Pc[j]), zc], [sOf(Pc[i]), zc]], holes, at(insetAt), slopeFacing);
  });
  ceilings.polygon(Pc, [], p => v3(p, zc), DOWN);

  // dormer recesses: a short tunnel from the window back to the slope
  for (const w of dormers) {
    const mod = moduleOf(w);
    const info = mod && kit.info(mod.key);
    const rc = info?.recess;
    if (!mod || !rc) continue;
    const side = b.sides[w.side];
    const frame = w.bay === -1 ? side.diag!.frame.clone() : side.frame.clone().multiply(new Matrix4().makeTranslation(side.bays[w.bay].x, 0, 0));
    frame.multiply(new Matrix4().makeTranslation(0, 0, rb));
    const L = (x: number, y: number, z: number) => new Vector3(x, y, z).applyMatrix4(frame);
    const F3 = (x: number, y: number, z: number) => new Vector3(x, y, z).transformDirection(frame);
    const back = (z: number) => insetAt(rb + z);
    const { halfWidth: hw, floor: z0, ceiling: z1, front: yf } = rc;
    walls.quad(L(-hw, yf, z0), L(-hw, back(z0), z0), L(-hw, back(z1), z1), L(-hw, yf, z1), F3(1, 0, 0));
    walls.quad(L(hw, yf, z0), L(hw, back(z0), z0), L(hw, back(z1), z1), L(hw, yf, z1), F3(-1, 0, 0));
    walls.quad(L(-hw, yf, z0), L(hw, yf, z0), L(hw, back(z0), z0), L(-hw, back(z0), z0), F3(0, 0, 1));
    walls.quad(L(-hw, yf, z1), L(hw, yf, z1), L(hw, back(z1), z1), L(-hw, back(z1), z1), F3(0, 0, -1));
    // its front, around the window, and the reveal back to the window frame
    const loop = (info.openings?.[0]?.loop ?? []) as V2[];
    walls.polygon([[-hw, z0], [hw, z0], [hw, z1], [-hw, z1]], loop.length ? [loop] : [], p => L(p[0], yf, p[1]), F3(0, 1, 0));
    if (loop.length) {
      const ccw = area(loop) > 0, r = info.openings![0].reveal;
      loop.forEach((p, j) => {
        const q = loop[(j + 1) % loop.length];
        const ds = q[0] - p[0], dz = q[1] - p[1];
        const n = ccw ? [-dz, ds] : [dz, -ds];
        walls.quad(L(p[0], r, p[1]), L(q[0], r, q[1]), L(q[0], yf, q[1]), L(p[0], yf, p[1]), F3(n[0], 0, n[1]));
      });
    }
  }

  // the attic's walls end under the slope
  const slopes = F.map((a, i) => ({ a, i, n: [-(F[(i + 1) % F.length][1] - a[1]), F[(i + 1) % F.length][0] - a[0]] as V2 }))
    .filter(e => kinds[e.i] !== "party")
    .map(e => ({ a: e.a, n: [e.n[0] / Math.hypot(...e.n), e.n[1] / Math.hypot(...e.n)] as V2 }));
  const under = (p: V2) => {
    let h = zc;
    for (const e of slopes) {
      const d = (p[0] - e.a[0]) * e.n[0] + (p[1] - e.a[1]) * e.n[1];
      h = Math.min(h, rb + ((d - I.atticLining) * rise) / run);
    }
    return h - 0.02;
  };
  for (const w of plan.walls) {
    if (w.level !== attic.index) continue;
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const top = (s: number) => under([w.a[0] + ((w.b[0] - w.a[0]) * s) / len, w.a[1] + ((w.b[1] - w.a[1]) * s) / len]);
    const [l, r] = sidesOf(w);
    wallSolid(() => paint(rooms.get(l ?? "") ?? null), () => paint(rooms.get(r ?? "") ?? null), () => paint(null),
      w, attic.floorZ, top, attic.floorZ, zc - 0.02, false);
  }
  paint(null);

  // chimney flues: the stacks run down to here; a plastered flue from the attic floor
  for (const ch of b.chimneys) {
    const box = kit.info(ch.key)?.box;
    if (!box) continue;
    const hx = (box.max.x - box.min.x) / 2 + 0.05, hy = (box.max.y - box.min.y) / 2 + 0.05;
    const c = Math.cos(ch.angle), s = Math.sin(ch.angle);
    const corner = (x: number, y: number): V2 => [ch.at[0] + x * c - y * s, ch.at[1] + x * s + y * c];
    const q = [corner(-hx, -hy), corner(hx, -hy), corner(hx, hy), corner(-hx, hy)];
    q.forEach((p, k) => {
      const r = q[(k + 1) % 4];
      const facing = new Vector3(r[1] - p[1], -(r[0] - p[0]), 0);
      walls.quad(v3(p, attic.floorZ), v3(r, attic.floorZ), v3(r, zc - 0.01), v3(p, zc - 0.01), facing);
    });
  }

  const group = new Group();
  const parts: [Tris, Material][] = [[walls, finished ? mats.finishWall : mats.wall], [floors, mats.floor], [ceilings, mats.ceiling],
    [section, mats.section], [finishFloors, mats.finishFloor]];
  for (const [t, m] of parts) {
    if (!t.pos.length) continue;
    const mesh = new Mesh(t.geometry(), m);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** where along an outer edge the points of a polygon lie on it (a corner point lies on both its edges) */
function onEdge(poly: V2[], e: { a: V2; len: number; dir: V2 }, tol = 0.02): number[] {
  const out: number[] = [];
  for (const p of poly) {
    const s = (p[0] - e.a[0]) * e.dir[0] + (p[1] - e.a[1]) * e.dir[1];
    const d = Math.abs((p[0] - e.a[0]) * e.dir[1] - (p[1] - e.a[1]) * e.dir[0]);
    if (d < tol && s > -tol && s < e.len + tol) out.push(s);
  }
  return out;
}

function centroid(poly: V2[]): V2 {
  let x = 0, y = 0;
  for (const p of poly) {
    x += p[0];
    y += p[1];
  }
  return [x / poly.length, y / poly.length];
}

/** inside a convex counterclockwise polygon */
function inConvex(poly: V2[], p: V2): boolean {
  return poly.every((a, i) => {
    const b = poly[(i + 1) % poly.length];
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-6;
  });
}

/**
 * A wall as a solid: its profile along the centre line (bottom at z0 with the
 * door openings cut up from the floor, the top `top(s)`) extruded to its
 * thickness. It runs half its thickness into the walls it meets. The faces
 * along the floor are left out, and so are flat tops (at a ceiling or a floor,
 * where they would fight with it). `left` takes the face on the left of a -> b,
 * `right` the other, `rims` the ends, door jambs and sloping tops.
 */
function wallSolid(left: () => Tris, right: () => Tris, rims: () => Tris, w: PlanWall, z0: number, top: (s: number) => number,
  floorZ: number, doorTop: number, flatTop: boolean) {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const dir: V2 = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
  const n: V2 = [-dir[1], dir[0]];
  const e = w.thickness / 2;
  const s0 = -e, s1 = len + e;
  const prof: V2[] = [[s0, z0]];
  const doors = [...w.openings].sort((p, q) => p.at - q.at);
  for (const o of doors) {
    const d0 = Math.max(s0 + 0.01, o.at - o.width / 2), d1 = Math.min(s1 - 0.01, o.at + o.width / 2);
    const h = Math.min(floorZ + o.height, doorTop, top(o.at) - 0.1);
    if (h <= z0 + 0.5 || d1 <= d0) continue;
    prof.push([d0, z0], [d0, h], [d1, h], [d1, z0]);
  }
  prof.push([s1, z0]);
  // the top, back from s1 to s0 (sampled where it may slope)
  const topFrom = prof.length;
  const steps = flatTop ? 1 : Math.max(1, Math.ceil((s1 - s0) / 0.25));
  for (let k = 0; k <= steps; k++) {
    const s = s1 - ((s1 - s0) * k) / steps;
    prof.push([s, top(Math.min(len, Math.max(0, s)))]);
  }
  const at = (off: number) => (p: V2) => new Vector3(w.a[0] + dir[0] * p[0] + n[0] * off, w.a[1] + dir[1] * p[0] + n[1] * off, p[1]);
  const N = new Vector3(n[0], n[1], 0);
  left().polygon(prof, [], at(e), N);
  right().polygon(prof, [], at(-e), N.clone().negate());
  const along = new Vector3(dir[0], dir[1], 0);
  prof.forEach((p, k) => {
    const q = prof[(k + 1) % prof.length];
    if (Math.abs(p[1] - z0) < 1e-6 && Math.abs(q[1] - z0) < 1e-6) return;
    if (flatTop && k >= topFrom && k < topFrom + steps) return;
    const ds = q[0] - p[0], dz = q[1] - p[1];
    const facing = along.clone().multiplyScalar(dz).addScaledVector(UP, -ds);
    rims().quad(at(e)(p), at(e)(q), at(-e)(q), at(-e)(p), facing);
  });
}
