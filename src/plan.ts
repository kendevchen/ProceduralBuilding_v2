/**
 * Floor plans (INTERIOR_SPEC.md §5): the rooms of every floor of a building,
 * laid out on the facades' bay grid so that partitions meet the outer walls
 * only between windows and stack the same way on every floor. Pure data that
 * can be saved as JSON (the later furniture stage reads it); the views draw it.
 *
 * Blender space like the footprint: x across the front (0..W), y from the
 * front facade inwards (0..L), z up. The plan is a grid of cells between wall
 * centre lines:
 *   - columns from the front facade's bays (a square corner or end pier shares
 *     its column with the first / last bay, a pan coupé has its own);
 *   - bands from front to back: rooms on the street, a corridor, rooms at the
 *     back (with a central zone and a second corridor in deep buildings);
 *   - in a column along a side facade with windows, rows from that facade's
 *     bays instead, so its walls also land between windows.
 * Rooms are cells or runs of cells (rectangles; pan coupés clip them).
 */
import type { Matrix4 } from "three";
import dims from "../blender/kit_dims.json";
import type { BayInfo, Building } from "./generator";
import type { BuildingParams } from "./params";
import { PURPOSE, rand } from "./rng";
import { type V2, insetEdges } from "./roof";

const I = dims.interior;
const T = dims.wall;
const BAY = dims.bay;
const EPS = 1e-6;
/** opening widths only modules.py knows (G_door_glazed, SHOP_HW), until the
 *  kit manifest carries the opening outlines (INTERIOR_SPEC.md §6.3) */
const GLAZED_DOOR = 1.6;
const SHOP = 2.4;
const OEIL = 0.6;

export type RoomType =
  | "vestibule" | "concierge" | "shop" | "shopBack" | "stair" | "corridor"
  | "salon" | "dining" | "ballroom" | "study" | "bedroom" | "kitchen" | "wc" | "maid" | "storage";

/** names and diagram colours (INTERIOR_SPEC.md §4) */
export const ROOM_INFO: Record<RoomType, { name: string; color: string }> = {
  vestibule: { name: "門口大廳", color: "#d8c3a5" },
  concierge: { name: "門房", color: "#b5c99a" },
  shop: { name: "店面", color: "#d98e4a" },
  shopBack: { name: "店面後場", color: "#d9bf9f" },
  stair: { name: "樓梯", color: "#a89f91" },
  corridor: { name: "走廊", color: "#e4e0d8" },
  salon: { name: "客廳", color: "#f2c14e" },
  dining: { name: "餐廳", color: "#f08a4b" },
  ballroom: { name: "宴會廳", color: "#d1495b" },
  study: { name: "書房", color: "#8fb36a" },
  bedroom: { name: "臥室", color: "#8fb8de" },
  kitchen: { name: "廚房", color: "#5fb3a8" },
  wc: { name: "廁所", color: "#9ad8e3" },
  maid: { name: "閣樓房", color: "#b8a1d9" },
  storage: { name: "儲藏間", color: "#bdb5a6" },
};

export type LevelClass = "G" | "N" | "S" | "A" | "R";
export type WallKind = "spine" | "cage" | "partition";

export interface PlanLevel {
  index: number;
  /** 1F, 2F, ... 閣樓 */
  name: string;
  cls: LevelClass;
  /** finished floor and ceiling (Blender z) */
  floorZ: number;
  ceilingZ: number;
}

export interface PlanWindow {
  level: number;
  side: number;
  /** bay on its side; -1: the pan coupé diagonal */
  bay: number;
  kind: "window" | "door" | "shop" | "dormer";
  /** centre of the opening on the inner face of the outer wall */
  at: V2;
  /** along the facade (left to right seen from outside) */
  dir: V2;
  width: number;
  room: string | null;
}

export interface PlanDoor {
  wall: number;
  /** door centre, distance from the wall's start */
  at: number;
  width: number;
  height: number;
  /** the room on the other side */
  to: string;
}

export interface PlanRoom {
  /** e.g. "2F-03" */
  id: string;
  type: RoomType;
  name: string;
  level: number;
  /** floors it spans (the ballroom 2) */
  levels: number;
  apartment: number | null;
  /** between wall centre lines: x0, y0, x1, y1 */
  rect: [number, number, number, number];
  /** clear floor inside the walls, counterclockwise */
  polygon: V2[];
  area: number;
  floorZ: number;
  ceilingZ: number;
  /** indices into BuildingPlan.windows */
  windows: number[];
  doors: PlanDoor[];
}

export interface PlanWall {
  level: number;
  /** centre line */
  a: V2;
  b: V2;
  thickness: number;
  kind: WallKind;
  /** room ids on either side; null: the ballroom's void */
  rooms: [string, string | null];
  openings: { at: number; width: number; height: number }[];
}

export interface PlanStair {
  kind: "main" | "service";
  polygon: V2[];
  /** first and last level served */
  from: number;
  to: number;
  layout: StairLayout;
}

/**
 * A stair winding round a well (INTERIOR_SPEC.md §7): every floor has its
 * landing along the cage's front (its y0 side); a flight leaves the landing up
 * the left side, turns round the well's half-round far end and climbs back
 * along the right side to the landing above, half a turn per floor. Lengths
 * along the walking line, which runs `walkOffset` from the well's edge.
 */
export interface StairLayout {
  /** clear rectangle of the cage: x0, y0, x1, y1 */
  rect: [number, number, number, number];
  /** width of a flight; depth of the landings from y0; radius of the well's end */
  flight: number;
  landing: number;
  wellRadius: number;
  walkOffset: number;
  /** the walking line's length per turn, and of each straight side */
  walk: number;
  straight: number;
  flights: StairFlight[];
}

export interface StairFlight {
  /** the level it rises from, its foot and head (Blender z) */
  level: number;
  z0: number;
  z1: number;
  risers: number;
  riser: number;
  /** tread depth on the walking line */
  going: number;
  /** where the steps begin and end on the walking line; before and after them the landings reach on */
  start: number;
  end: number;
}

export interface BuildingPlan {
  width: number;
  length: number;
  /** inner faces of the outer walls */
  inner: V2[];
  levels: PlanLevel[];
  rooms: PlanRoom[];
  walls: PlanWall[];
  windows: PlanWindow[];
  stairs: PlanStair[];
  /** floor openings besides the stair wells: the ballroom's upper half */
  voids: { level: number; polygon: V2[] }[];
  issues: string[];
}

// ------------------------------------------------------------------ geometry

type Rect = [number, number, number, number];

/** a side frame's (x, y) point in Blender xy */
function toWorld(m: Matrix4, x: number, y: number): V2 {
  const e = m.elements;
  return [e[0] * x + e[4] * y + e[12], e[1] * x + e[5] * y + e[13]];
}

export function polygonArea(poly: V2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** clip a polygon by a convex counterclockwise one (Sutherland-Hodgman) */
function clipConvex(poly: V2[], clip: V2[]): V2[] {
  let out = poly;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const side = (p: V2) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k++) {
      const p = input[k], q = input[(k + 1) % input.length];
      const sp = side(p), sq = side(q);
      if (sp >= -EPS) out.push(p);
      if ((sp >= -EPS) !== (sq >= -EPS)) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out.filter((p, k) => {
    const q = out[(k + 1) % out.length];
    return Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-4;
  });
}

const inRect = (r: Rect, p: V2) => p[0] > r[0] - EPS && p[0] < r[2] + EPS && p[1] > r[1] - EPS && p[1] < r[3] + EPS;

/** index of the polygon edge a point lies on, or -1 */
export function edgeAt(poly: V2[], p: V2, tol = 0.02): number {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const s = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len;
    const d = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
    if (d < tol && s > -tol && s < len + tol) return i;
  }
  return -1;
}

// ------------------------------------------------------------------ the grid

type Zone = "front" | "corridor" | "core" | "back";

interface Band {
  y0: number;
  y1: number;
  zone: Zone;
}

interface Col {
  x0: number;
  x1: number;
  /** the side facade with windows this column runs along (1 right, 3 left), or null */
  end: number | null;
}

interface Cell {
  id: number;
  col: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  zone: Zone;
}

interface FacadeBay {
  side: number;
  bay: number;
  frame: Matrix4;
  x: number;
  info: BayInfo;
}

interface Grid {
  W: number;
  L: number;
  cols: Col[];
  cells: Cell[];
  inner: V2[];
  mainCol: number;
  /** cells of the main stair, of the service stair */
  cage: number[];
  service: number[] | null;
  /** deep plans: the central-zone cells of the passage between the two corridors */
  cross: number[];
  ballroom: number[];
  bays: FacadeBay[];
}

/** a side facade's bay boundaries (Blender y) where walls may meet it, far
 *  enough from the corners to leave a room on either side */
function pierLines(b: Building, si: number): number[] {
  const s = b.sides[si];
  const ys: number[] = [];
  for (let j = 0; j <= s.bays.length; j++) ys.push(toWorld(s.frame, s.x0 + BAY * j, 0)[1]);
  const m = I.bands.endCell;
  return ys.filter(y => y - T >= m - EPS && b.length - T - y >= m - EPS).sort((p, q) => p - q);
}

/** bands from front to back (INTERIOR_SPEC.md §5.2). With windows on the side
 *  facades, the corridor's back wall lands on one of their piers: it is also
 *  the wall that splits the rooms along those facades. */
function zoning(L: number, lines: number[] | null): Band[] {
  const B = I.bands, C = I.corridor;
  const y1 = L - T, D = L - 2 * T;
  let ycb: number | null = null;
  if (D >= B.double - EPS) {
    if (lines) {
      let best = Infinity;
      for (const y of lines) {
        const front = y - C - T, back = y1 - y;
        if (front < B.minFront - EPS || back < B.minBack - EPS) continue;
        const cost = Math.abs(front - B.front);
        if (cost < best - EPS) {
          best = cost;
          ycb = y;
        }
      }
    } else {
      ycb = T + Math.max(B.minFront, Math.min(B.front, D - C - B.minBack)) + C;
    }
  }
  if (ycb === null) {
    // one band of rooms from front to back, split once
    const mid = T + D / 2;
    const ys = lines ? (lines.length ? lines.reduce((a, y) => (Math.abs(y - mid) < Math.abs(a - mid) ? y : a)) : null) : mid;
    return ys === null ? [{ y0: T, y1, zone: "front" }] : [{ y0: T, y1: ys, zone: "front" }, { y0: ys, y1, zone: "back" }];
  }
  const out: Band[] = [{ y0: T, y1: ycb - C, zone: "front" }, { y0: ycb - C, y1: ycb, zone: "corridor" }];
  const yb = y1 - B.back;
  if (D >= B.core - EPS && yb - C - ycb >= B.minCore - EPS) {
    // the central zone, in two strips when deep: one opening on each corridor
    const c0 = ycb, c1 = yb - C, cm = (c0 + c1) / 2;
    if (c1 - c0 > B.maxCore + EPS) out.push({ y0: c0, y1: cm, zone: "core" }, { y0: cm, y1: c1, zone: "core" });
    else out.push({ y0: c0, y1: c1, zone: "core" });
    out.push({ y0: c1, y1: yb, zone: "corridor" }, { y0: yb, y1, zone: "back" });
  } else out.push({ y0: ycb, y1, zone: "back" });
  return out;
}

/** rows of a column along a side facade: between its piers */
function endRows(lines: number[], bands: Band[], L: number): Band[] {
  const ys = [T, ...lines, L - T];
  const out: Band[] = [];
  for (let k = 0; k + 1 < ys.length; k++) {
    const c = (ys[k] + ys[k + 1]) / 2;
    let i = bands.findIndex(b => c >= b.y0 - EPS && c <= b.y1 + EPS);
    // a room across a corridor's end counts with the nearer band
    if (bands[i].zone === "corridor") i += c - bands[i].y0 < bands[i].y1 - c ? -1 : 1;
    out.push({ y0: ys[k], y1: ys[k + 1], zone: bands[i].zone });
  }
  return out;
}

function buildGrid(b: Building, p: BuildingParams): Grid {
  const W = b.width, L = b.length;
  const win = (si: number) => b.sides[si].kind !== "party";
  const s0 = b.sides[0];
  const n0 = s0.bays.length;
  const xs = [T];
  if (s0.left === "pc") xs.push(s0.x0);
  for (let i = 1; i < n0; i++) xs.push(s0.x0 + BAY * i);
  if (s0.right === "pc") xs.push(s0.x0 + BAY * n0);
  xs.push(W - T);
  const xl = xs.filter((x, i) => i === 0 || x - xs[i - 1] > 0.5);
  const cols: Col[] = xl.slice(0, -1).map((x0, i) => ({ x0, x1: xl[i + 1], end: null }));
  if (win(3)) cols[0].end = 3;
  if (win(1)) cols[cols.length - 1].end = 1;

  const lines1 = win(1) ? pierLines(b, 1) : null;
  const lines3 = win(3) ? pierLines(b, 3) : null;
  const common = lines1 && lines3 ? lines1.filter(y => lines3.some(z => Math.abs(z - y) < 0.01)) : lines1 ?? lines3;
  const bands = zoning(L, common);
  const cells: Cell[] = [];
  cols.forEach((c, ci) => {
    const rows = c.end === null ? bands : endRows(c.end === 1 ? lines1! : lines3!, bands, L);
    for (const r of rows) cells.push({ id: cells.length, col: ci, x0: c.x0, x1: c.x1, y0: r.y0, y1: r.y1, zone: r.zone });
  });
  const colOf = (x: number) => Math.max(0, cols.findIndex(c => x >= c.x0 - EPS && x <= c.x1 + EPS));
  const column = (ci: number) => cells.filter(c => c.col === ci).sort((u, v) => u.y0 - v.y0);
  const depth = (cs: Cell[]) => cs.length ? cs[cs.length - 1].y1 - cs[0].y0 : 0;

  // main stair: behind the entrance (INTERIOR_SPEC.md §5.3), deep enough for a
  // turn of the stair from floor to floor
  const mainCol = b.door >= 0 ? colOf(s0.x0 + BAY * (b.door + 0.5)) : Math.floor(cols.length / 2);
  const middle = cols[mainCol].end === null;
  const mc = column(mainCol);
  const { depth: need, minDepth } = I.stair.main;
  /** the least a room split off beside the cage must keep */
  const spare = I.minRoom.bedroom + I.walls.cage / 2;
  const cage: Cell[] = [];
  const k0 = mc.findIndex(c => c.zone === "corridor");
  if (k0 >= 0) {
    // from the corridor back; much deeper than the stair needs, it leaves a room behind it
    for (const c of mc.slice(k0)) {
      cage.push(c);
      if (depth(cage) >= need - EPS) break;
    }
    const last = cage[cage.length - 1];
    const ys = Math.min(cage[0].y0 + I.stair.maxDepth, last.y1 - spare);
    if (middle && depth(cage) > I.stair.maxDepth + EPS && ys >= cage[0].y0 + minDepth - EPS && ys > last.y0 + 0.5) {
      cells.push({ ...last, id: cells.length, y0: ys });
      last.y1 = ys;
    }
  } else if (!middle) {
    // along a side facade the rows stay as they are: from the back as many as it needs
    for (const c of [...mc].reverse()) {
      cage.unshift(c);
      if (depth(cage) >= need - EPS) break;
    }
  } else {
    // no corridor: at the back, the rest of the column in front a room, where
    // the landing still opens onto a room of each next column; else from the
    // facade (the entrance opens into the stairs), a room behind if it fits
    const bottom = mc[0].y0, top = mc[mc.length - 1].y1;
    const sides = [mainCol - 1, mainCol + 1].filter(ci => ci >= 0 && ci < cols.length);
    const opens = (y: number) => sides.every(ci => column(ci).some(c => c.y0 <= y + EPS && c.y1 >= y + I.stair.landing - EPS));
    // depths that leave a room, nearest the stair's own first
    const depths: number[] = [];
    for (let d = minDepth; d <= top - bottom - spare + EPS; d += 0.025) depths.push(d);
    depths.sort((p, q) => Math.abs(p - need) - Math.abs(q - need));
    const back = depths.find(d => opens(top - d));
    const [y0, y1] = back !== undefined ? [top - back, top] : depths.length ? [bottom, bottom + depths[0]] : [bottom, top];
    for (const y of [y0, y1]) {
      const c = column(mainCol).find(o => o.y0 < y - EPS && o.y1 > y + EPS);
      if (!c) continue;
      cells.push({ ...c, id: cells.length, y0: y });
      c.y1 = y;
    }
    cage.push(...column(mainCol).filter(c => c.y0 >= y0 - EPS && c.y1 <= y1 + EPS));
  }
  // deep plans: a passage beside the stairs through the central zone joins the
  // two corridors (the stairs open on the front one only, at their landings);
  // on both sides when the stairs cut the second corridor
  let cross: number[] = [];
  if (cells.some(c => c.zone === "core")) {
    const sides = [mainCol - 1, mainCol + 1].filter(ci => ci >= 0 && ci < cols.length && cols[ci].end === null);
    const cut = cage.filter(c => c.zone === "corridor").length > 1;
    const pick = cut ? sides : sides.length ? [sides[Math.floor(rand(p.seed, PURPOSE.planService, 1) * sides.length)]] : [];
    cross = pick.flatMap(ci => column(ci).filter(c => c.zone === "core").map(c => c.id));
  }

  // service stair: in big buildings, at the back far from the main one
  let service: number[] | null = null;
  if (p.baysX >= I.serviceStair.bays || L - 2 * T >= I.serviceStair.depth - EPS) {
    const cand = cells.filter(c => c.zone === "back" && cols[c.col].end === null && Math.abs(c.col - mainCol) >= 2 &&
      !cage.includes(c) && c.y1 - c.y0 >= I.stair.service.depth - EPS);
    if (cand.length) {
      const far = Math.max(...cand.map(c => Math.abs(c.col - mainCol)));
      const pick = cand.filter(c => Math.abs(c.col - mainCol) === far);
      service = [pick[Math.floor(rand(p.seed, PURPOSE.planService) * pick.length)].id];
    }
  }

  // ballroom: the street-side cells of its bays
  const ballroom = (b.ballroom ?? []).map(i => colOf(s0.x0 + BAY * (i + 0.5)))
    .map(ci => column(ci).find(c => c.zone === "front")!).filter(Boolean).map(c => c.id);

  const bays: FacadeBay[] = [];
  b.sides.forEach((s, si) => {
    if (s.kind === "party") return;
    s.bays.forEach((info, bi) => bays.push({ side: si, bay: bi, frame: s.frame, x: info.x, info }));
    if (s.diag) bays.push({ side: si, bay: -1, frame: s.diag.frame, x: 0, info: s.diag });
  });
  const inner = insetEdges(b.footprint, b.footprint.map(() => T))!;
  return { W, L, cols, cells, inner, mainCol, cage: cage.map(c => c.id), service, cross, ballroom, bays };
}

// ------------------------------------------------------------------ levels

function planLevels(b: Building): PlanLevel[] {
  const out: PlanLevel[] = [{
    index: 0, name: "1F", cls: "G", floorZ: I.groundFloor, ceilingZ: (b.rows[0]?.z ?? b.wallTop) - I.ceiling,
  }];
  b.rows.forEach((r, ri) => {
    const next = ri + 1 < b.rows.length ? b.rows[ri + 1].z : b.wallTop;
    out.push({ index: ri + 1, name: `${ri + 2}F`, cls: r.cls, floorZ: r.z + I.floor, ceilingZ: next - I.ceiling });
  });
  out.push({
    index: b.rows.length + 1, name: "閣樓", cls: "R",
    floorZ: b.wallTop + I.floor, ceilingZ: b.roofBase + dims.mansard.rise - I.atticCeiling,
  });
  return out;
}

/** every opening of every floor on the facades */
function facadeWindows(g: Grid, levels: PlanLevel[]): PlanWindow[] {
  const out: PlanWindow[] = [];
  for (const lv of levels) {
    for (const fb of g.bays) {
      let kind: PlanWindow["kind"] | null = null;
      let width = 0;
      const v = fb.info.ground;
      if (lv.cls === "G") {
        if (v.startsWith("window")) [kind, width] = ["window", dims.ground.window.width];
        else if (v === "door_glazed") [kind, width] = ["door", GLAZED_DOOR];
        else if (v.startsWith("door")) [kind, width] = ["door", dims.ground.door.width];
        else if (v.startsWith("shop")) [kind, width] = ["shop", SHOP];
      } else if (lv.cls === "R") {
        if (fb.info.dormer) {
          const big = fb.info.dormer === "atelier" ? dims.dormer.atelier : fb.info.dormer === "studio" ? dims.dormer.studio : null;
          [kind, width] = ["dormer", fb.info.dormer === "oeil" ? OEIL : big ? big.front - 2 * big.pier : dims.dormer.width];
        }
      } else [kind, width] = ["window", dims.window.width];
      if (!kind) continue;
      const at = toWorld(fb.frame, fb.x, T);
      const r = toWorld(fb.frame, fb.x + 1, T);
      out.push({ level: lv.index, side: fb.side, bay: fb.bay, kind, at, dir: [r[0] - at[0], r[1] - at[1]], width, room: null });
    }
  }
  return out;
}

// ------------------------------------------------------------------ rooms of a floor

interface Unit {
  cells: Cell[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  type: RoomType | null;
  apartment: number | null;
  /** windows of this floor (indices into the plan's windows) */
  win: number[];
  /** the shop front variant (1F) */
  shop?: string;
  id?: string;
}

const unitOf = (c: Cell): Unit => ({ cells: [c], x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, type: null, apartment: null, win: [] });
const cx = (u: Unit) => (u.x0 + u.x1) / 2;
const sameRows = (a: Unit, b: Unit) => Math.abs(a.y0 - b.y0) < EPS && Math.abs(a.y1 - b.y1) < EPS;
const xAdjacent = (a: Unit, b: Unit) => sameRows(a, b) && (Math.abs(a.x1 - b.x0) < EPS || Math.abs(b.x1 - a.x0) < EPS);

/** length of the wall two units share */
function shared(a: Rect, b: Rect): number {
  if (Math.abs(a[2] - b[0]) < EPS || Math.abs(a[0] - b[2]) < EPS) return Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  if (Math.abs(a[3] - b[1]) < EPS || Math.abs(a[1] - b[3]) < EPS) return Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  return 0;
}
const rectOf = (u: Unit): Rect => [u.x0, u.y0, u.x1, u.y1];
const touching = (a: Unit, b: Unit) => shared(rectOf(a), rectOf(b)) > 0.5;

/** how far from its front a stair may have doors on its side walls: a cage
 *  deeper than its stair needs has room for them further back on its landing */
const landingReach = (s: Unit, main: boolean) => I.stair.landing + Math.max(0, s.y1 - s.y0 - I.stair[main ? "main" : "service"].depth);

/** the length of wall a unit shares with a stair where the stair may have a
 *  door: its front wall, and its side walls beside the landing */
function stairOpening(u: Unit, s: Unit, reach: number): number {
  if (Math.abs(u.y1 - s.y0) < EPS) return Math.max(0, Math.min(u.x1, s.x1) - Math.max(u.x0, s.x0));
  if (Math.abs(u.x1 - s.x0) < EPS || Math.abs(u.x0 - s.x1) < EPS) return Math.max(0, Math.min(u.y1, s.y0 + reach) - Math.max(u.y0, s.y0));
  return 0;
}

interface Floor {
  units: Unit[];
  /** the ballroom's upper half (the floor above it) */
  voids: Rect[];
}

interface Ctx {
  g: Grid;
  b: Building;
  p: BuildingParams;
  lv: PlanLevel;
  windows: PlanWindow[];
  units: Unit[];
}

/** fuse units into one (they must make a rectangle) */
function fuse(ctx: Ctx, us: Unit[], type: RoomType | null): Unit {
  const list = [...new Set(us)];
  const m: Unit = {
    cells: list.flatMap(u => u.cells), win: list.flatMap(u => u.win), type, apartment: list[0].apartment,
    x0: Math.min(...list.map(u => u.x0)), y0: Math.min(...list.map(u => u.y0)),
    x1: Math.max(...list.map(u => u.x1)), y1: Math.max(...list.map(u => u.y1)), shop: list.find(u => u.shop)?.shop,
  };
  ctx.units = ctx.units.filter(u => !list.includes(u));
  ctx.units.push(m);
  return m;
}

const unitsOfCells = (ctx: Ctx, ids: number[]) => ctx.units.filter(u => u.cells.some(c => ids.includes(c.id)));

/** merge neighbouring free units of a type into runs along the rows */
function mergeRuns(ctx: Ctx, type: RoomType, same: (a: Unit, b: Unit) => boolean = () => true) {
  for (let again = true; again;) {
    again = false;
    const us = ctx.units.filter(u => u.type === type).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    for (const a of us) {
      const b = us.find(o => o !== a && xAdjacent(a, o) && same(a, o));
      if (b) {
        fuse(ctx, [a, b], type);
        again = true;
        break;
      }
    }
  }
}

/** the rooms of one apartment (INTERIOR_SPEC.md §5.4): reception rooms on the
 *  street, the kitchen and WC at the back next to the stairs, bedrooms */
function program(ctx: Ctx, groupCells: Set<number>, apt: number) {
  const { g, p, lv } = ctx;
  const L = g.L;
  const lastCol = g.cols.length - 1;
  const mine = () => ctx.units.filter(u => u.type === null && u.cells.every(c => groupCells.has(c.id)));
  const pick = <V>(arr: V[], k: number): V => arr[Math.floor(rand(p.seed, lv.index, apt, k, PURPOSE.plan) * arr.length)];
  const set = (u: Unit, t: RoomType) => {
    u.type = t;
    u.apartment = apt;
  };
  const front = (u: Unit) => u.y0 <= T + EPS && u.win.length > 0;
  const back = (u: Unit) => u.y1 >= L - T - EPS && u.win.length > 0;
  const corner = (u: Unit) => u.cells.some(c => c.col === 0 || c.col === lastCol);
  const all = mine();
  if (!all.length) return;
  // no window at all: service rooms, not a flat
  if (!all.some(u => u.win.length)) {
    for (const u of all) u.type = "storage";
    return;
  }
  const centre = all.reduce((s, u) => s + cx(u), 0) / all.length;
  const closest = (us: Unit[]) => us.reduce((a, u) => (Math.abs(cx(u) - centre) < Math.abs(cx(a) - centre) ? u : a));
  const large = (lv.cls === "N" || lv.cls === "S") && all.length >= 5;

  // the study goes in the left corner of the front (INTERIOR_SPEC.md §5.4); nothing else takes it first
  const wantsStudy = lv.cls !== "A" && all.length >= 6;
  const studyCorner = wantsStudy
    ? mine().filter(u => front(u) && corner(u)).sort((a, b) => a.x0 - b.x0)[0] ?? null
    : null;

  // salon: two bays in the middle of the front on the larger floors
  let salon: Unit | null = null;
  const mid = mine().filter(u => front(u) && !corner(u)).sort((a, b) => a.x0 - b.x0);
  if (large) {
    const pairs: [Unit, Unit][] = [];
    for (let k = 0; k + 1 < mid.length; k++) if (xAdjacent(mid[k], mid[k + 1])) pairs.push([mid[k], mid[k + 1]]);
    const off = (q: [Unit, Unit]) => Math.abs((q[0].x0 + q[1].x1) / 2 - centre);
    const best = pairs.filter(q => off(q) < Math.min(...pairs.map(off)) + 0.01);
    if (best.length) salon = fuse(ctx, pick(best, 0), null);
  }
  if (!salon) {
    const fr = mine().filter(u => front(u) && u !== studyCorner);
    salon = mid.length ? closest(mid) : fr.length ? closest(fr) : mine().find(u => u.win.length && u !== studyCorner) ?? mine().find(u => u.win.length) ?? null;
  }
  if (salon) set(salon, "salon");
  // kitchen and WC at the back, either side of the stairs (the kitchen by the service stair)
  const stairX = (ids: number[]) => {
    const c = g.cells[ids[0]];
    return (c.x0 + c.x1) / 2;
  };
  const kx = g.service ? stairX(g.service) : stairX(g.cage);
  const mx = stairX(g.cage);
  const byDist = (us: Unit[], x: number) => us.sort((a, b) => Math.abs(cx(a) - x) - Math.abs(cx(b) - x) || a.x0 - b.x0);
  const backs = () => mine().filter(u => back(u) && !corner(u));
  let kitchen: Unit | null = null;
  {
    const bk = byDist(backs(), kx);
    const near = bk.filter(u => Math.abs(Math.abs(cx(u) - kx) - Math.abs(cx(bk[0]) - kx)) < 0.01);
    kitchen = near.length ? pick(near, 3) : null;
    if (!kitchen) kitchen = mine().find(u => u.win.length && !front(u)) ?? mine().find(u => !u.win.length) ?? null;
    if (kitchen) set(kitchen, "kitchen");
  }
  {
    // the WC: a room without a window first (next to the kitchen), else at the back across the stairs
    const k = kitchen;
    const dry = byDist(mine().filter(u => !u.win.length), k ? cx(k) : mx);
    let cand = byDist(backs(), mx);
    if (k) {
      const other = cand.filter(u => Math.sign(cx(u) - mx) !== Math.sign(cx(k) - mx));
      if (other.length) cand = other;
    }
    // with only street rooms left, the smallest of them (when a bedroom remains)
    const size = (u: Unit) => (u.x1 - u.x0) * (u.y1 - u.y0);
    const rest = mine().sort((a, b) => size(a) - size(b));
    const wc = dry[0] ?? cand[0] ?? mine().find(u => !front(u)) ?? (rest.length > 1 ? rest[0] : undefined);
    if (wc) {
      set(wc, "wc");
      // a whole windowless bay is far more than a WC needs: the rest is a storeroom
      const w = wc.x1 - wc.x0, d = wc.y1 - wc.y0;
      if (!wc.win.length && w * d > I.wcSplit.area && w >= 2 * I.wcSplit.width) {
        const store: Unit = { ...wc, cells: [...wc.cells], win: [], x0: wc.x0 + I.wcSplit.width, type: "storage" };
        wc.x1 = store.x0;
        ctx.units.push(store);
      }
    }
  }
  // a bedroom in the quietest windowed room left: at the back, on a side, on a corner
  {
    const w = mine().filter(u => u.win.length);
    const quiet = (u: Unit) => (back(u) ? 0 : !front(u) ? 1 : corner(u) ? 2 : 3);
    const bed = w.sort((a, b) => quiet(a) - quiet(b) || Math.abs(cx(b) - centre) - Math.abs(cx(a) - centre))[0];
    if (bed) set(bed, "bedroom");
  }
  // the pan coupé's room on the street is a corner salon
  const diagonal = mine().filter(u => front(u) && u.win.some(wi => ctx.windows[wi].bay === -1));
  if (diagonal.length) set(pick(diagonal, 4), "salon");
  // then a dining room next to the salon and a study on a corner
  const s = salon;
  if (s && all.length >= 5) {
    const nb = mine().filter(u => front(u) && xAdjacent(u, s));
    if (nb.length) set(pick(nb, 1), "dining");
  }
  if (wantsStudy) {
    const cs = mine().filter(u => front(u) && corner(u));
    const fr = mine().filter(front);
    if (studyCorner && studyCorner.type === null) set(studyCorner, "study");
    else if (cs.length) set(pick(cs, 2), "study");
    else if (large && fr.length) set(pick(fr, 2), "study");
  }
  for (const u of mine()) set(u, u.win.length ? "bedroom" : "storage");
}

function layoutFloor(g: Grid, b: Building, p: BuildingParams, lv: PlanLevel, windows: PlanWindow[], ballroomLevel: number | null): Floor {
  const voidCells = ballroomLevel !== null && lv.index === ballroomLevel + 1 ? g.ballroom : [];
  const ctx: Ctx = { g, b, p, lv, windows, units: g.cells.filter(c => !voidCells.includes(c.id)).map(unitOf) };
  const voids: Rect[] = voidCells.map(id => [g.cells[id].x0, g.cells[id].y0, g.cells[id].x1, g.cells[id].y1]);
  windows.forEach((w, wi) => {
    if (w.level !== lv.index) return;
    const probe: V2 = [w.at[0] - w.dir[1] * 0.5, w.at[1] + w.dir[0] * 0.5];
    const u = ctx.units.find(o => inRect(rectOf(o), probe));
    if (u) {
      u.win.push(wi);
      if (w.kind === "shop") u.shop = g.bays.find(fb => fb.side === w.side && fb.bay === w.bay)!.info.ground;
    }
  });
  const attic = lv.cls === "R";
  const lastUpper = b.rows.length;

  // stairs
  const cageUnit = fuse(ctx, unitsOfCells(ctx, g.cage), g.service && lv.index > lastUpper ? null : "stair");
  if (g.service) fuse(ctx, unitsOfCells(ctx, g.service), "stair");
  const cageX = cx(cageUnit);
  /** -1 left of the main stair, 1 right of it, 0 in its column */
  const sideOf = (u: Unit) => (u.x1 <= cageUnit.x0 + EPS ? -1 : u.x0 >= cageUnit.x1 - EPS ? 1 : 0);
  // corridors, one each side of the main stair, and the passage between them in deep plans
  for (const u of ctx.units) {
    if (u.type === null && (u.cells[0].zone === "corridor" || g.cross.includes(u.cells[0].id))) u.type = "corridor";
  }
  mergeRuns(ctx, "corridor", (a, c) => sideOf(a) === sideOf(c));

  if (lv.cls === "G") {
    // entrance hall behind the door, shops with their back rooms, the concierge
    const mainFront = ctx.units.find(u => u.type === null && u.cells.some(c => c.col === g.mainCol) && u.y0 <= T + EPS);
    if (mainFront) mainFront.type = "vestibule";
    for (const u of ctx.units) if (u.type === null && u.shop) u.type = "shop";
    mergeRuns(ctx, "shop", (a, c) => a.shop === c.shop && a.y0 <= T + EPS && c.y0 <= T + EPS);
    // each street shop has the room right behind it (past the corridor) in every column it covers
    for (const s of ctx.units.filter(u => u.type === "shop" && u.y0 <= T + EPS)) {
      for (const ci of new Set(s.cells.map(c => c.col))) {
        const behind = ctx.units.filter(u => u.type === null && u.cells.every(c => c.col === ci) && u.y0 >= s.y1 - EPS)
          .sort((a, c) => a.y0 - c.y0)[0];
        if (behind && behind.win.every(wi => windows[wi].kind === "window")) behind.type = "shopBack";
      }
    }
    mergeRuns(ctx, "shopBack");
    // mixed use: the front's left corner, left of the entrance, is a study of its own
    if (p.groundUse === "mixed") {
      const corner = ctx.units.filter(u => u.type === null && !u.shop && u.y0 <= T + EPS && u.win.length > 0 &&
        u.cells.some(c => c.col === 0)).sort((a, c) => a.x0 - c.x0)[0];
      if (corner) corner.type = "study";
    }
    const hall = ctx.units.find(u => u.type === "vestibule");
    if (hall) {
      const nb = ctx.units.filter(u => u.type === null && xAdjacent(u, hall));
      const any = ctx.units.filter(u => u.type === null && (touching(u, hall) || touching(u, cageUnit)));
      const c = nb.length ? nb : any;
      if (c.length) c[Math.floor(rand(p.seed, PURPOSE.plan, 7) * c.length)].type = "concierge";
    }
    // what the stairs and the entrance hall lead to through corridors and rooms
    // (a stair opens only at its landing); rooms the shops cut off go with the
    // shops (or are storage)
    const wide = I.doors.single[0] + 0.3;
    const open = (u: Unit, v: Unit) => {
      if (u.type === "stair" || v.type === "stair") {
        const [s, o] = u.type === "stair" ? [u, v] : [v, u];
        return stairOpening(o, s, landingReach(s, s === cageUnit)) >= wide;
      }
      return shared(rectOf(u), rectOf(v)) >= wide;
    };
    const free = ctx.units.filter(u => u.type === null);
    const linked = new Set(ctx.units.filter(u => u.type === "stair" || u.type === "vestibule"));
    for (let grew = true; grew;) {
      grew = false;
      for (const u of ctx.units) {
        if (linked.has(u) || (u.type !== null && u.type !== "corridor")) continue;
        if ([...linked].some(v => open(u, v))) {
          linked.add(u);
          grew = true;
        }
      }
    }
    for (const u of free) {
      if (linked.has(u)) continue;
      u.type = ctx.units.some(s => (s.type === "shop" || s.type === "shopBack") && open(s, u)) ? "shopBack" : "storage";
    }
  }
  if (ballroomLevel !== null && lv.index === ballroomLevel && g.ballroom.length) {
    fuse(ctx, unitsOfCells(ctx, g.ballroom), "ballroom").apartment = 0;
  }

  if (attic) {
    // maids' rooms behind the dormers, storage where there is none, one shared WC by the stairs
    for (const u of ctx.units) if (u.type === null) u.type = u.win.length ? "maid" : "storage";
    // one of them is a study: the left-most room at the front
    const study = ctx.units.filter(u => u.type === "maid").sort((a, c) => a.x0 - c.x0 || a.y0 - c.y0)[0];
    if (study) study.type = "study";
    const nearStair = (u: Unit) => Math.abs(cx(u) - cageX) + Math.abs((u.y0 + u.y1) / 2 - (cageUnit.y0 + cageUnit.y1) / 2);
    const onCorridor = ctx.units.filter(u => (u.type === "maid" || u.type === "storage") &&
      ctx.units.some(c => c.type === "corridor" && touching(u, c)));
    const pool = onCorridor.length ? onCorridor : ctx.units.filter(u => u.type === "maid" || u.type === "storage");
    const dry = pool.filter(u => u.type === "storage");
    const wc = (dry.length ? dry : pool).sort((a, c) => nearStair(a) - nearStair(c))[0];
    if (wc) wc.type = "wc";
    return { units: ctx.units, voids };
  }

  // apartments: one, or one each side of the stairs
  const free = ctx.units.filter(u => u.type === null);
  const auto = p.baysX >= I.twoFlatsBays;
  const two = lv.cls === "G" || (voidCells.length > 0) ||
    (lv.index !== ballroomLevel && (p.apartments === "two" || (p.apartments === "auto" && auto)));
  let groups: Set<number>[] = [];
  const ids = (us: Unit[]) => new Set(us.flatMap(u => u.cells.map(c => c.id)));
  if (two) {
    const leftward = rand(p.seed, lv.index, PURPOSE.planFlats) < 0.5;
    const side = (u: Unit) => (Math.abs(cx(u) - cageX) < 0.01 ? leftward : cx(u) < cageX);
    const halves = [free.filter(side), free.filter(u => !side(u))];
    // a side too small for a flat of its own stays with the other (above the ground floor)
    const small = halves.some(h => h.filter(u => u.win.length).length < I.flatWindows);
    groups = lv.cls !== "G" && small ? [ids(free)] : halves.map(ids);
  } else groups.push(ids(free));
  groups.forEach((gc, k) => {
    // on the ground floor, what is left between the shops is too small for a flat:
    // the shops' back rooms, or storage
    const us = free.filter(u => u.cells.every(c => gc.has(c.id)));
    if (lv.cls === "G" && us.filter(u => u.win.length).length < I.flatWindows) {
      for (const u of us) u.type = ctx.units.some(s => s.type === "shop" && touching(s, u)) ? "shopBack" : "storage";
      return;
    }
    program(ctx, gc, k);
  });
  for (const u of ctx.units) {
    if (u.type !== "corridor") continue;
    const s = sideOf(u);
    u.apartment = s === 0 ? null : groups.length === 2 ? (s < 0 ? 0 : 1) : 0;
  }
  return { units: ctx.units, voids };
}

// ------------------------------------------------------------------ walls and doors

const CIRCULATION = new Set<RoomType>(["corridor", "stair", "vestibule"]);
const RECEPTION = new Set<RoomType>(["salon", "dining", "study", "ballroom"]);

/** how well a room opens into a neighbour (higher is better) */
function affinity(u: Unit, v: Unit): number {
  const tu = u.type!, tv = v.type!;
  if (tv === "corridor" || tv === "vestibule") return 10;
  if (tv === "stair") return tu === "corridor" ? 10 : 6;
  if (tu === "shopBack" && tv === "shop") return 9;
  if (RECEPTION.has(tu) && RECEPTION.has(tv)) return 8;
  if (tu === "kitchen" && tv === "dining") return 8;
  if (tu === "bedroom" && (tv === "bedroom" || tv === "study")) return 6;
  if (tu === "bedroom" && RECEPTION.has(tv)) return 5;
  if (tu === "wc" && tv === "bedroom") return 5;
  if (tu === "storage") return 4;
  return 2;
}

interface Edge {
  u: Unit;
  v: Unit | null;
  a: V2;
  b: V2;
}

function edgesOf(units: Unit[], voids: Rect[]): Edge[] {
  const out: Edge[] = [];
  const items: { u: Unit | null; r: Rect }[] = [...units.map(u => ({ u, r: rectOf(u) })), ...voids.map(r => ({ u: null, r }))];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const A = items[i], B = items[j];
      if (!A.u && !B.u) continue;
      const [a, b] = A.u ? [A, B] : [B, A];
      const ra = a.r, rb = b.r;
      for (const [xa, xb] of [[ra[2], rb[0]], [ra[0], rb[2]]]) {
        if (Math.abs(xa - xb) > EPS) continue;
        const lo = Math.max(ra[1], rb[1]), hi = Math.min(ra[3], rb[3]);
        if (hi - lo > 0.05) out.push({ u: a.u!, v: b.u, a: [xa, lo], b: [xa, hi] });
      }
      for (const [ya, yb] of [[ra[3], rb[1]], [ra[1], rb[3]]]) {
        if (Math.abs(ya - yb) > EPS) continue;
        const lo = Math.max(ra[0], rb[0]), hi = Math.min(ra[2], rb[2]);
        if (hi - lo > 0.05) out.push({ u: a.u!, v: b.u, a: [lo, ya], b: [hi, ya] });
      }
    }
  }
  return out;
}

function wallKind(e: Edge): WallKind {
  const t = [e.u.type, e.v?.type];
  if (t.includes("stair")) return "cage";
  if (t.includes("corridor")) return "spine";
  // the central wall of a plan without a corridor
  const zone = (u: Unit | null) => u?.cells[0].zone;
  if (e.a[1] === e.b[1] && zone(e.u) !== zone(e.v) && e.v) return "spine";
  return "partition";
}

interface WallBuild {
  edge: Edge;
  wall: PlanWall;
}

/** `landing`: how far from its front a stair may have doors on its side walls */
function connect(units: Unit[], voids: Rect[], lv: PlanLevel, cageX: number, landing: (stair: Unit) => number): WallBuild[] {
  const walls: WallBuild[] = edgesOf(units, voids).map(edge => {
    const kind = wallKind(edge);
    return {
      edge,
      wall: {
        level: lv.index, a: edge.a, b: edge.b, thickness: I.walls[kind], kind,
        rooms: [edge.u.id!, edge.v?.id ?? null], openings: [],
      },
    };
  });
  const linked = new Set<string>();
  const key = (a: Unit, b: Unit) => [a.id, b.id].sort().join("|");
  type DoorKind = keyof typeof I.doors;
  /** the stretch of a wall (from its start) a door may take: a stair opens only
   *  at its landing, on the front wall or the side walls beside the landing */
  const span = (w: WallBuild, a: Unit, b: Unit): [number, number] => {
    const { a: p, b: q } = w.wall;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const s = a.type === "stair" ? a : b.type === "stair" ? b : null;
    if (!s) return [0, len];
    if (Math.abs(p[1] - q[1]) < EPS) return Math.abs(p[1] - s.y0) < EPS ? [0, len] : [0, 0];
    return [Math.max(0, s.y0 - p[1]), Math.max(0, Math.min(len, s.y0 + landing(s) - p[1]))];
  };
  /** a door on the wall between a and b; mode front: near the street facade
   *  (enfilade), near: close to the stairs, else in the middle */
  const door = (a: Unit, b: Unit, kind: DoorKind, mode: "front" | "near" | "middle"): boolean => {
    if (linked.has(key(a, b))) return true;
    const cand = walls.filter(w => (w.edge.u === a && w.edge.v === b) || (w.edge.u === b && w.edge.v === a));
    const [width, height] = I.doors[kind];
    // clear of the walls it meets; a landing door may fill a corridor's whole end
    const margin = kind === "landing" ? I.walls.spine / 2 : 0.15;
    let best: WallBuild | null = null;
    let room: [number, number] = [0, 0];
    for (const w of cand) {
      const [s0, s1] = span(w, a, b);
      if (s1 - s0 >= width + 2 * margin - 1e-6 && s1 - s0 > room[1] - room[0]) [best, room] = [w, [s0, s1]];
    }
    if (!best) return false;
    const { a: p, b: q } = best.wall;
    const bestLen = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const lo = room[0] + width / 2 + margin, hi = room[1] - width / 2 - margin;
    let at = (room[0] + room[1]) / 2;
    if (mode === "front" && p[0] === q[0]) at = T + 0.9 + width / 2 - p[1];
    if (mode === "near") {
      // the end nearer the stairs (the end towards the street for walls across the plan)
      const along = p[1] === q[1] ? (Math.abs(p[0] - cageX) < Math.abs(q[0] - cageX) ? 0 : bestLen) : 0;
      at = along === 0 ? lo + 0.15 : hi - 0.15;
    }
    // on a stair's side wall as near its front as it goes, so the landing stays short
    if (p[0] === q[0] && (a.type === "stair" || b.type === "stair")) at = lo;
    at = Math.min(hi, Math.max(lo, at));
    best.wall.openings.push({ at, width, height });
    linked.add(key(a, b));
    return true;
  };
  const neighbours = (u: Unit) => walls.filter(w => w.edge.u === u || w.edge.v === u)
    .map(w => (w.edge.u === u ? w.edge.v : w.edge.u)).filter((v): v is Unit => !!v);
  const sameFlat = (a: Unit, b: Unit) => a.apartment === null || b.apartment === null || a.apartment === b.apartment;

  for (const u of units) {
    if (u.type === "stair") {
      for (const v of neighbours(u)) {
        if (v.type === "corridor") door(u, v, "landing", "middle");
        if (v.type === "vestibule") door(u, v, "hall", "middle");
      }
    }
  }
  for (const u of units) {
    if (!u.type || CIRCULATION.has(u.type) || u.type === "shop") continue;
    if (u.type === "concierge") {
      const h = neighbours(u).find(v => v.type === "vestibule");
      if (h && door(u, h, "single", "middle")) continue;
    }
    if (u.type === "shopBack") {
      const s = neighbours(u).find(v => v.type === "shop");
      if (s) door(u, s, "single", "middle");
    }
    const corridors = neighbours(u).filter(v => v.type === "corridor" && sameFlat(u, v));
    corridors.sort((a, b) => shared(rectOf(b), rectOf(u)) - shared(rectOf(a), rectOf(u)));
    for (const c of corridors) {
      if (door(u, c, u.type === "ballroom" ? "double" : "single", "near")) break;
    }
  }
  // enfilade: double doors between the reception rooms along the street
  for (const u of units) {
    for (const v of neighbours(u)) {
      if (!RECEPTION.has(u.type!) || !RECEPTION.has(v.type!) || !sameFlat(u, v)) continue;
      if (u.y0 <= T + EPS && v.y0 <= T + EPS) door(u, v, "double", "front");
    }
  }
  // every room reachable from the stairs, the entrance hall or the street (shops)
  const reached = () => {
    const seen = new Set(units.filter(u => u.type === "stair" || u.type === "vestibule" || u.type === "shop"));
    for (let grew = true; grew;) {
      grew = false;
      for (const u of units) {
        if (seen.has(u)) continue;
        if (neighbours(u).some(v => seen.has(v) && linked.has(key(u, v)))) {
          seen.add(u);
          grew = true;
        }
      }
    }
    return seen;
  };
  const failed = new Set<string>();
  for (let guard = 0; guard < units.length * 4; guard++) {
    const seen = reached();
    let best: { u: Unit; v: Unit; s: number } | null = null;
    for (const u of units) {
      if (seen.has(u)) continue;
      for (const v of neighbours(u)) {
        if (!seen.has(v) || !sameFlat(u, v) || failed.has(key(u, v))) continue;
        if (v.type === "shop" && u.type !== "shopBack") continue;
        const s = affinity(u, v) * 100 + shared(rectOf(u), rectOf(v));
        if (!best || s > best.s) best = { u, v, s };
      }
    }
    if (!best) break;
    const t = best.u.type!, w = best.v.type!;
    const wide = RECEPTION.has(t) && RECEPTION.has(w);
    if (!(wide && door(best.u, best.v, "double", "near")) && !door(best.u, best.v, "single", "near")) failed.add(key(best.u, best.v));
  }
  // rooms still cut off on the ground floor go to the shop next to them, or
  // to its back rooms (one after another)
  for (let grew = lv.cls === "G"; grew;) {
    grew = false;
    const seen = reached();
    for (const u of units) {
      if (seen.has(u)) continue;
      const shop = neighbours(u).find(v => seen.has(v) && (v.type === "shop" || v.type === "shopBack") && !failed.has(key(u, v)));
      if (!shop) continue;
      if (door(u, shop, "single", "middle")) {
        u.type = "shopBack";
        u.apartment = null;
        grew = true;
        break;
      }
      failed.add(key(u, shop));
      grew = true;
    }
  }
  return walls;
}

// ------------------------------------------------------------------ the plan

export function planBuilding(b: Building, p: BuildingParams): BuildingPlan {
  const g = buildGrid(b, p);
  const levels = planLevels(b);
  const windows = facadeWindows(g, levels);
  const ballroomLevel = b.ballroom && g.ballroom.length ? 1 : null;
  const rooms: PlanRoom[] = [];
  const walls: PlanWall[] = [];
  const voids: BuildingPlan["voids"] = [];
  let ballroomId: string | null = null;
  let ballroomPoly: V2[] = [];
  let mainPoly: V2[] = [], servicePoly: V2[] = [];
  /** every floor's room of each stair, for the doors on their landings */
  const stairRooms: Record<PlanStair["kind"], PlanRoom[]> = { main: [], service: [] };

  for (const lv of levels) {
    const floor = layoutFloor(g, b, p, lv, windows, ballroomLevel);
    const units = floor.units.sort((a, c) => a.y0 - c.y0 || a.x0 - c.x0);
    units.forEach((u, k) => (u.id = `${lv.name}-${String(k + 1).padStart(2, "0")}`));
    const cage = units.find(u => u.cells.some(c => c.id === g.cage[0]))!;
    const built = connect(units, floor.voids, lv, cx(cage), s => landingReach(s, s === cage));
    const base = walls.length;
    walls.push(...built.map(w => w.wall));
    for (const u of units) {
      // clear floor: inside half of each wall, clipped by the outer walls
      const mine = built.filter(w => w.edge.u === u || w.edge.v === u);
      const inset = (test: (w: PlanWall) => boolean) => Math.max(0, ...mine.map(w => w.wall).filter(test).map(w => w.thickness)) / 2;
      const l = inset(w => w.a[0] === w.b[0] && Math.abs(w.a[0] - u.x0) < EPS);
      const r = inset(w => w.a[0] === w.b[0] && Math.abs(w.a[0] - u.x1) < EPS);
      const d = inset(w => w.a[1] === w.b[1] && Math.abs(w.a[1] - u.y0) < EPS);
      const t = inset(w => w.a[1] === w.b[1] && Math.abs(w.a[1] - u.y1) < EPS);
      const polygon = clipConvex([[u.x0 + l, u.y0 + d], [u.x1 - r, u.y0 + d], [u.x1 - r, u.y1 - t], [u.x0 + l, u.y1 - t]], g.inner);
      const type = u.type ?? "storage";
      const tall = type === "ballroom";
      const room: PlanRoom = {
        id: u.id!, type, name: type === "storage" && lv.cls === "R" ? "閣樓儲藏間" : ROOM_INFO[type].name,
        level: lv.index, levels: tall ? 2 : 1, apartment: u.apartment, rect: rectOf(u), polygon,
        area: polygonArea(polygon), floorZ: lv.floorZ, ceilingZ: tall ? levels[lv.index + 1].ceilingZ : lv.ceilingZ,
        windows: [...u.win], doors: [],
      };
      for (const wi of u.win) windows[wi].room = room.id;
      built.forEach((w, k) => {
        const other = w.edge.u === u ? w.edge.v : w.edge.v === u ? w.edge.u : undefined;
        if (other === undefined || !other) return;
        for (const o of w.wall.openings) room.doors.push({ wall: base + k, at: o.at, width: o.width, height: o.height, to: other.id! });
      });
      rooms.push(room);
      if (tall) {
        ballroomId = room.id;
        ballroomPoly = polygon;
      }
      if (type === "stair") {
        const kind = u === cage ? "main" : "service";
        stairRooms[kind].push(room);
        if (lv.index === 0) [mainPoly, servicePoly] = kind === "main" ? [polygon, servicePoly] : [mainPoly, polygon];
      }
    }
    if (floor.voids.length && ballroomId) {
      voids.push({ level: lv.index, polygon: ballroomPoly });
      // the windows of the ballroom's upper half
      windows.forEach((w, wi) => {
        if (w.level !== lv.index || w.room) return;
        const probe: V2 = [w.at[0] - w.dir[1] * 0.5, w.at[1] + w.dir[0] * 0.5];
        if (floor.voids.some(r => inRect(r, probe))) {
          w.room = ballroomId;
          rooms.find(r => r.id === ballroomId)!.windows.push(wi);
        }
      });
    }
  }
  const top = levels[levels.length - 1].index;
  const stair = (kind: PlanStair["kind"], polygon: V2[], to: number): PlanStair => {
    // the landing reaches past the doors on the cage's side walls
    let doorEdge = -Infinity;
    for (const r of stairRooms[kind]) {
      for (const d of r.doors) {
        const w = walls[d.wall];
        if (Math.abs(w.a[0] - w.b[0]) > EPS) continue;
        const dy = Math.sign(w.b[1] - w.a[1]);
        doorEdge = Math.max(doorEdge, w.a[1] + dy * (d.at - d.width / 2), w.a[1] + dy * (d.at + d.width / 2));
      }
    }
    return { kind, polygon, from: 0, to, layout: layoutStair(kind, polygon, doorEdge, levels, 0, to) };
  };
  const stairs: PlanStair[] = [stair("main", mainPoly, g.service ? top - 1 : top)];
  if (g.service) stairs.push(stair("service", servicePoly, top));
  const plan: BuildingPlan = { width: g.W, length: g.L, inner: g.inner, levels, rooms, walls, windows, stairs, voids, issues: [] };
  plan.issues = checkPlan(plan);
  return plan;
}

/**
 * Fit a stair into its cage (INTERIOR_SPEC.md §7.1): flights round a well of
 * about the set width; the landing deep enough for a flight's width and for the
 * doors on the side walls; then per floor the fewest risers within the limit,
 * and treads of the target going as far as the walking line is long enough.
 * What is left of the line lengthens the landings on both sides (the end of the
 * flight below, the start of the one above). Narrower flights make the walking
 * line longer: the widest that give every floor the target going, else the
 * narrowest.
 */
function layoutStair(kind: PlanStair["kind"], poly: V2[], doorEdge: number, levels: PlanLevel[], from: number, to: number): StairLayout {
  const S = I.stair, K = S[kind];
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  const rect: Rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const W = rect[2] - rect[0], D = rect[3] - rect[1];
  const fit = (flight: number): StairLayout => {
    const wellRadius = Math.max(0.05, W / 2 - flight);
    const landing = Math.max(flight + 0.05, doorEdge - rect[1] + 0.1);
    const walkOffset = Math.min(S.walkOffset, flight / 2);
    const straight = Math.max(0, D - landing - flight - wellRadius);
    const walk = 2 * straight + Math.PI * (wellRadius + walkOffset);
    const flights: StairFlight[] = [];
    for (let k = from; k < to; k++) {
      const z0 = levels[k].floorZ, z1 = levels[k + 1].floorZ;
      const risers = Math.ceil((z1 - z0) / K.maxRiser - 1e-9);
      const treads = risers - 1;
      let going = Math.min(K.goingTarget, walk / treads);
      let start = (walk - treads * going) / 2;
      // the steps stay on the straight sides' far parts and round the end
      if (start > straight) {
        start = straight;
        going = (walk - 2 * start) / treads;
      }
      flights.push({ level: k, z0, z1, risers, riser: (z1 - z0) / risers, going, start, end: start + treads * going });
    }
    return { rect, flight, landing, wellRadius, walkOffset, walk, straight, flights };
  };
  const shortest = (l: StairLayout) => Math.min(...l.flights.map(f => f.going));
  let best: StairLayout | null = null;
  for (let f = Math.min(K.flight[1], Math.max(K.flight[0], (W - K.well) / 2)); f >= K.flight[0] - 1e-9; f -= 0.025) {
    const l = fit(f);
    if (!best || shortest(l) > shortest(best) + 1e-9) best = l;
    if (shortest(l) >= K.goingTarget - 1e-9) return l;
  }
  return best!;
}

// ------------------------------------------------------------------ checks

const KIND_NAME: Record<PlanWindow["kind"], string> = { window: "窗", door: "大門", shop: "店面", dormer: "老虎窗" };

/** the rules of INTERIOR_SPEC.md §12; returns the problems found */
export function checkPlan(plan: BuildingPlan, checkUses = true): string[] {
  const issues: string[] = [];
  const name = (i: number) => plan.levels[i]?.name ?? `L${i}`;
  const M = I.minRoom;
  // every window belongs to a room
  for (const w of plan.windows) {
    if (!w.room) issues.push(`${name(w.level)}：第 ${w.side} 面第 ${w.bay} 開間的${KIND_NAME[w.kind]}沒有房間`);
  }
  // walls meet the outer walls only between windows
  for (const wall of plan.walls) {
    for (const end of [wall.a, wall.b]) {
      const e = edgeAt(plan.inner, end);
      if (e < 0) continue;
      for (const w of plan.windows) {
        if (w.level !== wall.level || edgeAt(plan.inner, w.at) !== e) continue;
        const d = Math.abs((end[0] - w.at[0]) * w.dir[0] + (end[1] - w.at[1]) * w.dir[1]);
        if (d < w.width / 2 + wall.thickness / 2 + 0.02) {
          issues.push(`${name(wall.level)}：牆 ${wall.rooms.join("/")} 碰到${KIND_NAME[w.kind]}`);
        }
      }
    }
  }
  // every room reachable from the stairs, the entrance hall or the street
  for (const lv of plan.levels) {
    const rs = plan.rooms.filter(r => r.level === lv.index);
    const byId = new Map(rs.map(r => [r.id, r]));
    const seen = new Set(rs.filter(r => r.type === "stair" || r.type === "vestibule" || r.type === "shop").map(r => r.id));
    const queue = [...seen];
    while (queue.length) {
      const r = byId.get(queue.pop()!)!;
      for (const d of r.doors) {
        if (byId.has(d.to) && !seen.has(d.to)) {
          seen.add(d.to);
          queue.push(d.to);
        }
      }
    }
    for (const r of rs) if (!seen.has(r.id)) issues.push(`${lv.name}：${r.name} ${r.id} 走不到`);
  }
  // sizes
  for (const r of plan.rooms) {
    const xs = r.polygon.map(q => q[0]), ys = r.polygon.map(q => q[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    const small = Math.min(w, h), big = Math.max(w, h);
    const min = r.type === "bedroom" || r.type === "maid" ? M.bedroom : r.type === "wc" ? M.wc : r.type === "corridor" ? M.corridor : 0;
    if (small < min - 0.01) issues.push(`${name(r.level)}：${r.name} ${r.id} 太小（${small.toFixed(2)} m）`);
    if (r.type === "stair" && (small < M.stair[0] - 0.01 || big < M.stair[1] - 0.01)) {
      issues.push(`${name(r.level)}：樓梯間 ${r.id} 太小（${w.toFixed(2)} × ${h.toFixed(2)} m）`);
    }
  }
  // the steps: risers and goings within the limits
  for (const s of plan.stairs) {
    const K = I.stair[s.kind];
    const nm = s.kind === "main" ? "主樓梯" : "服務樓梯";
    for (const f of s.layout.flights) {
      if (f.riser > K.maxRiser + 1e-6) issues.push(`${name(f.level)}：${nm}踏步太高（${f.riser.toFixed(3)} m）`);
      if (f.going < K.going[0] - 1e-6 || f.going > K.going[1] + 1e-6) {
        issues.push(`${name(f.level)}：${nm}踏面 ${f.going.toFixed(3)} m 不在 ${K.going[0]}–${K.going[1]} m 之間`);
      }
    }
  }
  // every flat has the essentials
  const flats = new Map<string, PlanRoom[]>();
  for (const r of plan.rooms) {
    if (r.apartment === null || plan.levels[r.level].cls === "R") continue;
    const k = `${r.level}|${r.apartment}`;
    flats.set(k, [...(flats.get(k) ?? []), r]);
  }
  for (const [k, rs] of checkUses ? flats : []) {
    const rooms = rs.filter(r => r.type !== "corridor");
    if (rooms.length < 4) continue;
    const missing = (["salon", "kitchen", "wc", "bedroom"] as RoomType[]).filter(t => !rooms.some(r => r.type === t));
    if (missing.length) issues.push(`${name(Number(k.split("|")[0]))}：住戶 ${k.split("|")[1]} 缺少${missing.map(t => ROOM_INFO[t].name).join("、")}`);
  }
  return issues;
}
