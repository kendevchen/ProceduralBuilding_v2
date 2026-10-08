/**
 * Plan view (INTERIOR_SPEC.md §13, phase I1): one floor of a BuildingPlan on
 * its own, without the facades. Rooms are coloured plates; walls are cut at
 * 1.2 m with their door gaps; the outer walls show their openings; rooms carry
 * their names. Blender Z-up space, like the building.
 */
import {
  BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineLoop, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, type Material,
} from "three";
import dims from "../blender/kit_dims.json";
import { textSprite } from "./labels";
import { type BuildingPlan, ROOM_INFO, edgeAt } from "./plan";
import type { V2 } from "./roof";

/** walls drawn up to this height above the floor, like a plan's cut */
const CUT = 1.2;
const WALL_COLOR = new Color("#3b3835");
const GLASS_COLOR = new Color("#9fd3ff");

class Builder {
  pos: number[] = [];
  col: number[] = [];
  tri(a: number[], b: number[], c: number[], color: Color) {
    this.pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.col.push(color.r, color.g, color.b);
  }
  quad(a: number[], b: number[], c: number[], d: number[], color: Color) {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }
  /** a 2D quad (counterclockwise) extruded from z0 to z1 */
  prism(q: V2[], z0: number, z1: number, color: Color) {
    const lo = q.map(([x, y]) => [x, y, z0]), hi = q.map(([x, y]) => [x, y, z1]);
    this.quad(hi[0], hi[1], hi[2], hi[3], color);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(lo[i], lo[j], hi[j], hi[i], color);
    }
  }
  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

let mats: { plate: Material; wall: Material; glass: Material; ghost: Material; line: LineBasicMaterial } | null = null;
function materials() {
  mats ??= {
    plate: new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }),
    wall: new MeshLambertMaterial({ vertexColors: true }),
    glass: new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }),
    ghost: new MeshBasicMaterial({ color: ROOM_INFO.ballroom.color, transparent: true, opacity: 0.25, depthWrite: false, side: DoubleSide }),
    line: new LineBasicMaterial({ color: ROOM_INFO.ballroom.color }),
  };
  return mats;
}

/** a wall piece from p to q along its centre line, thickness t */
function segment(p: V2, q: V2, t: number): V2[] {
  const dx = q[0] - p[0], dy = q[1] - p[1];
  const len = Math.hypot(dx, dy);
  const nx = (-dy / len) * t / 2, ny = (dx / len) * t / 2;
  return [[p[0] - nx, p[1] - ny], [q[0] - nx, q[1] - ny], [q[0] + nx, q[1] + ny], [p[0] + nx, p[1] + ny]];
}

/** solid stretches of a run of length len outside the openings [at - w/2, at + w/2] */
function solids(len: number, openings: { at: number; width: number }[]): [number, number][] {
  const out: [number, number][] = [];
  let s = 0;
  for (const o of [...openings].sort((a, b) => a.at - b.at)) {
    const a = o.at - o.width / 2, b = o.at + o.width / 2;
    if (a > s + 1e-3) out.push([s, a]);
    s = Math.max(s, b);
  }
  if (len > s + 1e-3) out.push([s, len]);
  return out;
}

export interface PlanViewOptions {
  labels: boolean;
  area: boolean;
}

export function buildPlanView(plan: BuildingPlan, level: number, opts: PlanViewOptions): Group {
  const m = materials();
  const lv = plan.levels[level];
  const z = lv.floorZ;
  const group = new Group();
  const plates = new Builder(), walls = new Builder(), glass = new Builder();

  // room plates
  const rooms = plan.rooms.filter(r => r.level === level);
  for (const r of rooms) {
    const c = new Color(ROOM_INFO[r.type].color);
    const p = r.polygon.map(([x, y]) => [x, y, z + 0.02]);
    for (let i = 1; i + 1 < p.length; i++) plates.tri(p[0], p[i], p[i + 1], c);
  }
  // interior walls with their door gaps
  for (const w of plan.walls) {
    if (w.level !== level) continue;
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1];
    const len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    // run the walls into the ones they meet, so the corners close
    const e = w.thickness / 2;
    for (const [s0, s1] of solids(len, w.openings)) {
      const a: V2 = [w.a[0] + ux * (s0 - (s0 === 0 ? e : 0)), w.a[1] + uy * (s0 - (s0 === 0 ? e : 0))];
      const b: V2 = [w.a[0] + ux * (s1 + (s1 === len ? e : 0)), w.a[1] + uy * (s1 + (s1 === len ? e : 0))];
      walls.prism(segment(a, b, w.thickness), z, z + CUT, WALL_COLOR);
    }
  }
  // outer walls, open at the windows, doors and shopfronts of this floor
  for (const boundary of [plan.inner, ...(plan.innerBoundaries?.map(v => v.polygon) ?? [])]) {
  const n = boundary.length;
  const out = (i: number): V2 => {
    const a = boundary[i], b = boundary[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
  };
  const T = dims.wall;
  for (let i = 0; i < n; i++) {
    const a = boundary[i], b = boundary[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u: V2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const o = out(i);
    const ops = plan.windows.filter(w => w.level === level && edgeAt(boundary, w.at) === i)
      .map(w => ({ at: (w.at[0] - a[0]) * u[0] + (w.at[1] - a[1]) * u[1], width: w.width, kind: w.kind }));
    const at = (s: number, d: number): V2 => [a[0] + u[0] * s + o[0] * d, a[1] + u[1] * s + o[1] * d];
    // (counterclockwise: inner face, then outward)
    for (const [s0, s1] of solids(len, ops)) walls.prism([at(s0, 0), at(s0, T), at(s1, T), at(s1, 0)], z, z + CUT, WALL_COLOR);
    for (const op of ops) {
      if (op.kind === "door") continue;
      const s0 = op.at - op.width / 2, s1 = op.at + op.width / 2;
      glass.prism([at(s0, T * 0.4), at(s0, T * 0.6), at(s1, T * 0.6), at(s1, T * 0.4)], z + 0.05, z + CUT, GLASS_COLOR);
    }
    // the outer corner at the end of this edge (mitred)
    const o2 = out((i + 1) % n);
    const k = T / (1 + o[0] * o2[0] + o[1] * o2[1]);
    walls.prism([b, [b[0] + o[0] * T, b[1] + o[1] * T], [b[0] + (o[0] + o2[0]) * k, b[1] + (o[1] + o2[1]) * k],
      [b[0] + o2[0] * T, b[1] + o2[1] * T]], z, z + CUT, WALL_COLOR);
  }
  }
  group.add(new Mesh(plates.geometry(), m.plate));
  group.add(new Mesh(walls.geometry(), m.wall));
  if (glass.pos.length) group.add(new Mesh(glass.geometry(), m.glass));

  // the ballroom below, seen through the opening in this floor
  for (const v of plan.voids.filter(v => v.level === level)) {
    const ghost = new Builder();
    const p = v.polygon.map(([x, y]) => [x, y, z + 0.02]);
    for (let i = 1; i + 1 < p.length; i++) ghost.tri(p[0], p[i], p[i + 1], new Color(1, 1, 1));
    group.add(new Mesh(ghost.geometry(), m.ghost));
    const line = new BufferGeometry();
    line.setAttribute("position", new Float32BufferAttribute(p.flat(), 3));
    group.add(new LineLoop(line, m.line));
    if (opts.labels) {
      const c = centroid(v.polygon);
      const s = textSprite(v.kind === "courtyard" ? "中庭" : v.kind === "lightwell" ? "採光井" : v.kind === "elevator" ? "電梯井" : v.kind === "shaft" ? "管道井" : "宴會廳挑空", 2.4);
      s.position.set(c[0], c[1], z + CUT + 0.6);
      group.add(s);
    }
  }
  if (opts.labels) {
    for (const r of rooms) {
      const c = centroid(r.polygon);
      const xs = r.polygon.map(q => q[0]), ys = r.polygon.map(q => q[1]);
      const size = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      const text = opts.area && r.type !== "corridor" ? `${r.name}\n${r.area.toFixed(1)} m²` : r.name;
      const s = textSprite(text, Math.min(3.2, Math.max(1.8, size * 0.95)));
      s.position.set(c[0], c[1], z + CUT + 0.6);
      group.add(s);
    }
  }
  return group;
}

function centroid(poly: V2[]): V2 {
  let a = 0, x = 0, y = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    const k = x0 * y1 - x1 * y0;
    a += k;
    x += (x0 + x1) * k;
    y += (y0 + y1) * k;
  }
  return Math.abs(a) < 1e-9 ? poly[0] : [x / (3 * a), y / (3 * a)];
}
