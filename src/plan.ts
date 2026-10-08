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
import type { V2 } from "./roof";
import type { Cell, LegacyGrid } from "./planning/legacyGrid";
import { sharedEdges } from "./planning/edgeIndex";
import { varyApartment, programRoll, type ProgramUnit as Unit, type ProgramChoice } from "./planning/program";
import { floorSignature } from "./planning/signature";
import { buildCorePlan } from "./planning/corePlan";
import { checkCirculation, type CirculationMetadata } from "./planning/circulation";
import type { CoreFrame } from "./planning/cores";
import { roomsOverlap } from "./roomGeometry";

const I = dims.interior;
const T = dims.wall;
const EPS = 1e-6;
/** opening widths only modules.py knows (G_door_glazed, SHOP_HW), until the
 *  kit manifest carries the opening outlines (INTERIOR_SPEC.md §6.3) */
const GLAZED_DOOR = 1.6;
const SHOP = 2.4;
const OEIL = 0.6;

export type RoomType =
  | "porch" | "vestibule" | "concierge" | "shop" | "shopBack" | "stair" | "corridor"
  | "salon" | "dining" | "ballroom" | "study" | "bedroom" | "kitchen" | "wc" | "maid" | "storage"
  | "bathroom" | "closet" | "foyer" | "pantry" | "laundry" | "liftHall" | "elevator" | "shaft";

/** names and diagram colours (INTERIOR_SPEC.md §4) */
export const ROOM_INFO: Record<RoomType, { name: string; color: string }> = {
  porch: { name: "車道門廊", color: "#c9b08c" },
  liftHall: { name: "電梯廳", color: "#c4d4de" },
  elevator: { name: "電梯井", color: "#8297ab" },
  shaft: { name: "管道井", color: "#69767b" },
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
  laundry: { name: "洗衣間", color: "#b7d3d0" },
  bathroom: { name: "浴室", color: "#a9cfe0" },
  closet: { name: "衣帽間", color: "#b9c6d6" },
  foyer: { name: "玄關", color: "#ddd5c6" },
  pantry: { name: "備餐室", color: "#8fc7bd" },
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
  facadeId?: string;
  openingKey?: string;
  openingRole?: "maintenance";
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
  structuralId?: string;
  coreId?: string;
  circulation?: "public" | "private" | "equipment";
  /** Stable fixed-cell membership, present only for opt-in floor programming. */
  cellIds?: string[];
  part?: string;
  /** Generated private-room door targets; retained as generation metadata during editing. */
  programTargets?: string[];
  /** Ground-floor cafe palette: carpet/white, red checks/red, grey wood/wood. */
  cafeTheme?: 0 | 1 | 2;
  atticTheme?: 0 | 1;
  /** Spatially chosen 2F rear-right dining prototype, independent of room numbering. */
  diningPrototype?: boolean;
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
  openings: { at: number; width: number; height: number; role?: "equipment" }[];
}

export interface PlanStair {
  id?: string;
  coreId?: string;
  frame?: CoreFrame;
  landingEdge?: [V2, V2];
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

export interface FloorProgramDiagnostic {
  level: number;
  status: "exempt" | "varied" | "repeated" | "legacy-fallback";
  retries: number;
  choices: ProgramChoice[];
  generatedSignature: string;
  rejectedIssues: string[];
}

export interface BuildingPlan {
  programStructure?: import("./planning/templates").ProgramStructure;
  courtyard?: { shape: "O" | "U"; polygon: V2[]; minimum: number; blindWingCells: string[][]; porchCells: string[] };
  daylightDiagnostics?: { level: number; residentialCells: number; windowlessCells: number; ratio: number; serviceArea: number }[];
  innerBoundaries?: { id: string; polygon: V2[] }[];
  circulation?: CirculationMetadata;
  /** Candidate diagnostics are separate from validation issues; signatures describe generation, before edits. */
  programDiagnostics?: FloorProgramDiagnostic[];
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
  voids: { level: number; polygon: V2[]; id?: string; kind?: "elevator" | "shaft" | "lightwell" | "courtyard"; ceiling?: boolean; openBoundary?: boolean }[];
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
export function clipConvex(poly: V2[], clip: V2[]): V2[] {
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

interface FacadeBay {
  facadeId?: string;
  side: number;
  bay: number;
  frame: Matrix4;
  x: number;
  info: BayInfo;
}
interface Grid extends LegacyGrid {
  bays: FacadeBay[];
  bayByKey: Map<string, FacadeBay>;
  windowCells: Map<string, number[]>;
}

/** Geometry comes from the topology; only actual opening variants come from the facade. */
export function buildingGrid(b: Building): Grid {
  const bays: FacadeBay[] = [];
  [...b.sides, ...(b.innerSides ?? [])].forEach((s, side) => {
    if (s.kind === "party") return;
    s.bays.forEach((info, bay) => { if (!info.absent) bays.push({ side, bay, frame: s.frame, x: info.x, info, ...(s.facadeId ? { facadeId: s.facadeId } : {}) }); });
    if (s.diag) bays.push({ side, bay: -1, frame: s.diag.frame, x: 0, info: s.diag });
  });
  const bayByKey = new Map(bays.map(bay => [`${bay.side}|${bay.bay}`, bay]));
  const windowCells = new Map<string, number[]>();
  for (const fb of bays) {
    const at = toWorld(fb.frame, fb.x, T), r = toWorld(fb.frame, fb.x + 1, T);
    const probe: V2 = [at[0] - (r[1] - at[1]) * 0.5, at[1] + (r[0] - at[0]) * 0.5];
    windowCells.set(`${fb.side}|${fb.bay}`, b.topology.grid.cells
      .filter(c => inRect([c.x0, c.y0, c.x1, c.y1], probe)).map(c => c.id));
  }
  return { ...b.topology.grid, bays, bayByKey, windowCells };
}

// ------------------------------------------------------------------ levels

export function planLevels(b: Building): PlanLevel[] {
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
export function facadeWindows(g: Grid, levels: PlanLevel[]): PlanWindow[] {
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
      } else if (lv.cls === "R" && fb.facadeId) {
        if (fb.info.atticWindow === false) continue;
        [kind, width] = ["window", dims.window.width];
      } else if (lv.cls === "R") {
        if (fb.info.dormer) {
          const big = fb.info.dormer === "atelier" ? dims.dormer.atelier : fb.info.dormer === "studio" ? dims.dormer.studio : null;
          [kind, width] = ["dormer", fb.info.dormer === "oeil" ? OEIL : big ? big.front - 2 * big.pier : dims.dormer.width];
        }
      } else [kind, width] = ["window", dims.window.width];
      if (!kind) continue;
      const at = toWorld(fb.frame, fb.x, T);
      const r = toWorld(fb.frame, fb.x + 1, T);
      out.push({ ...(fb.facadeId ? { facadeId: fb.facadeId, openingKey: `${fb.facadeId}|${fb.bay}|${lv.cls === "G" ? "g" : lv.cls === "R" ? "r" : lv.index - 1}` } : {}), level: lv.index, side: fb.side, bay: fb.bay, kind, at, dir: [r[0] - at[0], r[1] - at[1]], width, room: null });
    }
  }
  return out;
}

// ------------------------------------------------------------------ rooms of a floor


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
  choices: ProgramChoice[];
}

interface Ctx {
  g: Grid;
  b: Building;
  p: BuildingParams;
  lv: PlanLevel;
  windows: PlanWindow[];
  units: Unit[];
  variation: boolean;
  retry: number;
  choices: ProgramChoice[];
}

/** fuse units into one (they must make a rectangle) */
export function fuse(ctx: Ctx, us: Unit[], type: RoomType | null): Unit {
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
export function program(ctx: Ctx, groupCells: Set<number>, apt: number) {
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

  // Keep the initial seed and ground/attic program. Other upper floors may
  // place their study in any available windowed room, not a reserved corner.
  const fixedStudyCorner = p.seed === 1 || lv.index === 0 || lv.cls === "R";
  const wantsStudy = lv.cls !== "A" && all.length >= 6;
  const studyCorner = wantsStudy && fixedStudyCorner
    ? mine().filter(u => front(u) && corner(u)).sort((a, b) => a.x0 - b.x0)[0] ?? null
    : null;

  // salon: two bays in the middle of the front on the larger floors
  let salon: Unit | null = null;
  const mid = mine().filter(u => front(u) && (ctx.variation ? u !== studyCorner : !corner(u))).sort((a, b) => a.x0 - b.x0);
  if (large || (ctx.variation && all.length >= 5)) {
    const pairs: [Unit, Unit][] = [];
    for (let k = 0; k + 1 < mid.length; k++) if (xAdjacent(mid[k], mid[k + 1])) pairs.push([mid[k], mid[k + 1]]);
    const off = (q: [Unit, Unit]) => Math.abs((q[0].x0 + q[1].x1) / 2 - centre);
    const best = pairs.filter(q => off(q) < Math.min(...pairs.map(off)) + 0.01);
    const candidates = ctx.variation ? pairs.filter(pair => all.filter(u => u.win.length && !pair.includes(u)).length >= 2) : best;
    if (candidates.length) salon = fuse(ctx, ctx.variation
      ? candidates[Math.floor(programRoll(p.seed, lv.index, apt, PURPOSE.planSalon, ctx.retry) * candidates.length)]
      : pick(candidates, 0), null);
  }
  if (!salon) {
    const fr = mine().filter(u => front(u) && u !== studyCorner);
    const choices = mid.length ? mid : fr;
    salon = ctx.variation && choices.length
      ? choices[Math.floor(programRoll(p.seed, lv.index, apt, PURPOSE.planSalon, ctx.retry, 1) * choices.length)]
      : mid.length ? closest(mid) : fr.length ? closest(fr) : mine().find(u => u.win.length && u !== studyCorner) ?? mine().find(u => u.win.length) ?? null;
  }
  if (salon) set(salon, "salon");
  if (ctx.variation) ctx.choices.push({ apartment: apt, feature: "V1", outcome: salon ? JSON.stringify(rectOf(salon)) : "no windowed room" });
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
    let bk = byDist(backs(), kx);
    if (ctx.variation) {
      const side = programRoll(p.seed, lv.index, apt, PURPOSE.planKitchenSide, ctx.retry) < 0.5 ? -1 : 1;
      const onSide = bk.filter(u => Math.sign(cx(u) - kx) === side);
      if (onSide.length) bk = onSide;
    }
    const near = bk.filter(u => Math.abs(Math.abs(cx(u) - kx) - Math.abs(cx(bk[0]) - kx)) < 0.01);
    kitchen = near.length ? pick(near, 3) : null;
    if (!kitchen) kitchen = mine().find(u => u.win.length && !front(u)) ?? mine().find(u => !u.win.length) ?? (ctx.b.topology.coreLayout ? mine().find(u => u.win.length) : null) ?? null;
    if (kitchen) set(kitchen, "kitchen");
    if (ctx.variation) ctx.choices.push({ apartment: apt, feature: "V2", outcome: kitchen ? JSON.stringify(rectOf(kitchen)) : "no legal kitchen" });
  }
  {
    // the WC: a room without a window first (next to the kitchen), else at the back across the stairs
    const k = kitchen;
    let dry = byDist(mine().filter(u => !u.win.length), k ? cx(k) : mx);
    const wcCore = ctx.variation ? kx : mx;
    if (ctx.variation && k) {
      const opposite = dry.filter(u => Math.sign(cx(u) - wcCore) !== Math.sign(cx(k) - wcCore));
      if (opposite.length) dry = opposite;
    }
    let cand = byDist(backs(), wcCore);
    if (k) {
      const other = cand.filter(u => Math.sign(cx(u) - wcCore) !== Math.sign(cx(k) - wcCore));
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
    const available = mine().filter(u => u.win.length);
    if (!fixedStudyCorner && available.length) set(pick(available, 2), "study");
    else if (studyCorner && studyCorner.type === null) set(studyCorner, "study");
    else if (cs.length) set(pick(cs, 2), "study");
    else if (large && fr.length) set(pick(fr, 2), "study");
  }
  for (const u of mine()) set(u, u.win.length ? "bedroom" : "storage");
}

function layoutFloor(g: Grid, b: Building, p: BuildingParams, lv: PlanLevel, windows: PlanWindow[], windowIndices: number[], ballroomLevel: number | null, variation = false, retry = 0): Floor {
  const voidCells = ballroomLevel !== null && lv.index === ballroomLevel + 1 ? g.ballroom : [];
  const ctx: Ctx = { g, b, p, lv, windows, variation, retry, choices: [], units: g.cells.filter(c => !voidCells.includes(c.id)).map(unitOf) };
  const voids: Rect[] = voidCells.map(id => [g.cells[id].x0, g.cells[id].y0, g.cells[id].x1, g.cells[id].y1]);
  const unitByCell = new Map(ctx.units.map(u => [u.cells[0].id, u]));
  for (const wi of windowIndices) {
    const w = windows[wi], key = `${w.side}|${w.bay}`;
    const id = g.windowCells.get(key)?.find(ci => unitByCell.has(ci));
    const u = id === undefined ? undefined : unitByCell.get(id);
    if (u) {
      u.win.push(wi);
      if (w.kind === "shop") u.shop = g.bayByKey.get(key)!.info.ground;
    }
  }
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
    return { units: ctx.units, voids, choices: ctx.choices };
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
  if (variation) groups.forEach((_, apt) => varyApartment({
    get units() { return ctx.units; }, windows, seed: p.seed, level: lv.index, retry, choices: ctx.choices,
  }, apt, {
    fuse: (us, type) => fuse(ctx, us, type),
    interiorPoint: q => g.inner.every((a, i) => {
      const c = g.inner[(i + 1) % g.inner.length];
      return (c[0] - a[0]) * (q[1] - a[1]) - (c[1] - a[1]) * (q[0] - a[0]) > EPS;
    }),
  }));
  return { units: ctx.units, voids, choices: ctx.choices };
}

// ------------------------------------------------------------------ walls and doors

const CIRCULATION = new Set<RoomType>(["corridor", "stair", "vestibule"]);
const RECEPTION = new Set<RoomType>(["salon", "dining", "study", "ballroom"]);

/** how well a room opens into a neighbour (higher is better) */
function affinity(u: Unit, v: Unit): number {
  const tu = u.type!, tv = v.type!;
  if ((tu === "bathroom" || tu === "closet") && tv === "bedroom") return 7;
  if (tu === "foyer" && RECEPTION.has(tv)) return 8;
  if (tu === "pantry" && (tv === "kitchen" || tv === "dining")) return 8;
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
  const rects = [...units.map(rectOf), ...voids];
  return sharedEdges(rects).filter(e => e.i < units.length).map(e => ({
    u: units[e.i], v: units[e.j] ?? null, a: e.a, b: e.b,
  }));
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
  // Lists retain wall order (including repeated neighbours on split boundaries).
  const byUnit = new Map<Unit, WallBuild[]>();
  const byPair = new Map<string, WallBuild[]>();
  const key = (a: Unit, b: Unit) => [a.id, b.id].sort().join("|");
  for (const w of walls) {
    for (const u of [w.edge.u, w.edge.v]) {
      if (!u) continue;
      const mine = byUnit.get(u) ?? [];
      mine.push(w);
      byUnit.set(u, mine);
    }
    if (w.edge.v) {
      const k = key(w.edge.u, w.edge.v), pair = byPair.get(k) ?? [];
      pair.push(w);
      byPair.set(k, pair);
    }
  }
  const neighbours = (u: Unit) => (byUnit.get(u) ?? [])
    .map(w => w.edge.u === u ? w.edge.v : w.edge.u).filter((v): v is Unit => !!v);
  const linked = new Set<string>();
  const links = new Map<Unit, Unit[]>();
  const seen = new Set(units.filter(u => u.type === "stair" || u.type === "vestibule" || u.type === "shop"));
  const expand = (starts: Unit[]) => {
    const queue = [...starts];
    while (queue.length) {
      const u = queue.pop()!;
      for (const v of links.get(u) ?? []) if (!seen.has(v)) {
        seen.add(v);
        queue.push(v);
      }
    }
  };
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
    if ((a.access && !a.access.includes(b)) || (b.access && !b.access.includes(a))) return false;
    if (linked.has(key(a, b))) return true;
    const cand = byPair.get(key(a, b)) ?? [];
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
    for (const [u, v] of [[a, b], [b, a]]) {
      const ns = links.get(u) ?? [];
      ns.push(v);
      links.set(u, ns);
    }
    // Updating the connected component does not affect candidate/tie ordering.
    expand([a, b].filter(u => seen.has(u)));
    return true;
  };
  for (const u of units) for (const v of u.access ?? []) door(u, v, "single", "middle");
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
  const failed = new Set<string>();
  for (let guard = 0; guard < units.length * 4; guard++) {
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

function buildPlan(b: Building, p: BuildingParams, retries: ReadonlyMap<number, number> = new Map(), fallback: ReadonlySet<number> = new Set(), templateOverrides: ReadonlyMap<string,string> = new Map()): BuildingPlan {
  if (b.topology.coreLayout) return buildCorePlan(b, p, retries, fallback, templateOverrides);
  const g = buildingGrid(b);
  const levels = planLevels(b);
  const windows = facadeWindows(g, levels);
  const windowsByLevel: number[][] = levels.map(() => []);
  windows.forEach((w, wi) => windowsByLevel[w.level].push(wi));
  const ballroomLevel = b.ballroom && g.ballroom.length ? 1 : null;
  const diagnostics: FloorProgramDiagnostic[] = [];
  const rooms: PlanRoom[] = [];
  const walls: PlanWall[] = [];
  const voids: BuildingPlan["voids"] = [];
  let ballroomId: string | null = null;
  let ballroomPoly: V2[] = [];
  let mainPoly: V2[] = [], servicePoly: V2[] = [];
  /** every floor's room of each stair, for the doors on their landings */
  const stairRooms: Record<PlanStair["kind"], PlanRoom[]> = { main: [], service: [] };

  for (const lv of levels) {
    const eligible = lv.cls !== "G" && lv.cls !== "R" && lv.index !== ballroomLevel;
    const variation = !!p.floorVariety && eligible && !fallback.has(lv.index);
    const floor = layoutFloor(g, b, p, lv, windows, windowsByLevel[lv.index], ballroomLevel, variation, retries.get(lv.index) ?? 0);
    diagnostics.push({ level: lv.index, status: !eligible ? "exempt" : fallback.has(lv.index) ? "legacy-fallback" : "varied",
      retries: retries.get(lv.index) ?? 0, choices: floor.choices, generatedSignature: "", rejectedIssues: [] });
    const diningCandidate = lv.index === 1 && !variation ? floor.units.filter(u => u.type === "bedroom")
      .sort((a, c) => c.y1 - a.y1 || c.x1 - a.x1)[0] : undefined;
    // A small apartment must retain its only bedroom when bay counts change.
    const diningPrototype = diningCandidate && floor.units.some(u => u !== diningCandidate && u.type === "bedroom" &&
      u.apartment === diningCandidate.apartment) ? diningCandidate : undefined;
    if (diningPrototype) diningPrototype.type = "dining";
    const units = floor.units.sort((a, c) => a.y0 - c.y0 || a.x0 - c.x0);
    units.forEach((u, k) => (u.id = `${lv.name}-${String(k + 1).padStart(2, "0")}`));
    const cage = units.find(u => u.cells.some(c => c.id === g.cage[0]))!;
    const built = connect(units, floor.voids, lv, cx(cage), s => landingReach(s, s === cage));
    const base = walls.length;
    walls.push(...built.map(w => w.wall));
    const roomWalls = new Map<Unit, { build: WallBuild; index: number }[]>();
    built.forEach((build, index) => {
      for (const u of [build.edge.u, build.edge.v]) {
        if (!u) continue;
        const list = roomWalls.get(u) ?? [];
        list.push({ build, index });
        roomWalls.set(u, list);
      }
    });
    for (const u of units) {
      // clear floor: inside half of each wall, clipped by the outer walls
      const mine = (roomWalls.get(u) ?? []).map(w => w.build);
      const inset = (test: (w: PlanWall) => boolean) => Math.max(0, ...mine.map(w => w.wall).filter(test).map(w => w.thickness)) / 2;
      const l = inset(w => w.a[0] === w.b[0] && Math.abs(w.a[0] - u.x0) < EPS);
      const r = inset(w => w.a[0] === w.b[0] && Math.abs(w.a[0] - u.x1) < EPS);
      const d = inset(w => w.a[1] === w.b[1] && Math.abs(w.a[1] - u.y0) < EPS);
      const t = inset(w => w.a[1] === w.b[1] && Math.abs(w.a[1] - u.y1) < EPS);
      const polygon = clipConvex([[u.x0 + l, u.y0 + d], [u.x1 - r, u.y0 + d], [u.x1 - r, u.y1 - t], [u.x0 + l, u.y1 - t]], g.inner);
      const type = u.type ?? "storage";
      const tall = type === "ballroom";
      const room: PlanRoom = {
        diningPrototype: u === diningPrototype || undefined,
        id: u.id!, type, name: type === "storage" && lv.cls === "R" ? "閣樓儲藏間" : ROOM_INFO[type].name,
        level: lv.index, levels: tall ? 2 : 1, apartment: u.apartment, rect: rectOf(u), polygon,
        area: polygonArea(polygon), floorZ: lv.floorZ, ceilingZ: tall ? levels[lv.index + 1].ceilingZ : lv.ceilingZ,
        windows: [...u.win], doors: [],
      };
      if (p.floorVariety) {
        room.cellIds = [...new Set(u.cells.map(c => b.topology.cells[c.id].id))];
        if (u.part) room.part = u.part;
        if (u.access) room.programTargets = u.access.map(v => v.id!);
      }
      for (const wi of u.win) windows[wi].room = room.id;
      (roomWalls.get(u) ?? []).forEach(({ build: w, index: k }) => {
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
      for (const wi of windowsByLevel[lv.index]) {
        const w = windows[wi];
        if (w.room) continue;
        const probe: V2 = [w.at[0] - w.dir[1] * 0.5, w.at[1] + w.dir[0] * 0.5];
        if (floor.voids.some(r => inRect(r, probe))) {
          w.room = ballroomId;
          rooms.find(r => r.id === ballroomId)!.windows.push(wi);
        }
      }
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
  const plan: BuildingPlan = { width: g.W, length: g.L, inner: g.inner.map(q => [...q]), levels, rooms, walls, windows, stairs, voids, issues: [] };
  if (p.floorVariety) plan.programDiagnostics = diagnostics;
  plan.issues = checkPlan(plan);
  return plan;
}

/** Retry only eligible floors, with independent deterministic draws and a hard eight-redraw cap. */
export function planBuilding(b: Building, p: BuildingParams): BuildingPlan {
  if (!p.floorVariety) return buildPlan(b, p);
  const retries = new Map<number, number>(), fallback = new Set<number>();
  const rejected = new Map<number, string[]>();
  const templateOverrides = new Map<string,string>();
  const max = I.variety.maxRetries;
  // Each retry builds fresh mutable units/windows; the topology is immutable.
  for (let guard = 0; guard <= (max + 2) * (b.rows.length + 2); guard++) {
    const plan = buildPlan(b, p, retries, fallback, templateOverrides), diagnostics = plan.programDiagnostics!;
    let capacityChanged=false;
    for(const t of plan.programStructure?.templates??[]) {
      if(t.resolved!=='A')continue;
      const invalid=t.apartmentIds.some(a=>{
        const rooms=plan.rooms.filter(r=>r.level===t.level&&r.apartment===a);
        return rooms.length>I.planning.templates.maxLargeCells||!rooms.some(r=>r.type==='study')||!rooms.some(r=>r.type==='salon'&&(r.cellIds?.length??0)>=2);
      });
      if(invalid) {
        templateOverrides.set(`${t.segment}:${t.area}:${t.coreId}`,'A 實際房間含服務房超過上限或接待室／書房不足，整段退 B');
        capacityChanged=true;
      }
    }
    if(capacityChanged)continue;
    let again = false;
    for (const d of diagnostics) {
      const lv = plan.levels[d.level], previous = diagnostics[d.level - 1];
      const masked = b.topology.voids.filter(v => v.kind === "ballroom" &&
        (v.fromLevel === d.level || v.fromLevel === d.level - 1)).flatMap(v => v.cellIds);
      const signature = (level: number) => floorSignature(plan.rooms.filter(r => r.level === level), b.topology.cells, masked);
      d.generatedSignature = signature(d.level);
      d.rejectedIssues = rejected.get(d.level) ?? [];
      if (d.status === "exempt" || d.status === "legacy-fallback") continue;
      const invalid = plan.issues.filter(issue => issue.startsWith(`${lv.name}：`));
      const repeat = previous && previous.status !== "exempt" && p.baysX > I.variety.smallFrontCells &&
        d.generatedSignature === signature(d.level - 1);
      if (!invalid.length && !repeat) continue;
      if (invalid.length) { rejected.set(d.level, invalid); d.rejectedIssues = invalid; }
      if (d.retries < max) { retries.set(d.level, d.retries + 1); again = true; }
      else if (invalid.length) { fallback.add(d.level); again = true; }
      else d.status = "repeated";
    }
    if (!again) return plan;
  }
  throw new Error("Floor programming retry limit exceeded");
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
export function layoutStair(kind: PlanStair["kind"], poly: V2[], doorEdge: number, levels: PlanLevel[], from: number, to: number): StairLayout {
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
  if (plan.programDiagnostics || plan.circulation) {
    for (const lv of plan.levels) {
      const rooms = plan.rooms.filter(r => r.level === lv.index).sort((a, b) => a.rect[0] - b.rect[0]);
      for (let i = 0; i < rooms.length; i++) {
        const a = rooms[i];
        if (!(a.area > 0)) issues.push(`${lv.name}：${a.name} ${a.id} 面積必須為正`);
        for (let j = i + 1; j < rooms.length && rooms[j].rect[0] < a.rect[2] - EPS; j++) {
          const b = rooms[j];
          if (Math.min(a.rect[3], b.rect[3]) - Math.max(a.rect[1], b.rect[1]) > EPS && roomsOverlap(a.polygon, b.polygon)) {
            issues.push(`${lv.name}：房間 ${a.id} 與 ${b.id} 重疊`);
          }
        }
        if (checkUses && ["salon", "dining", "study", "bedroom", "maid"].includes(a.type) &&
          !a.windows.some(wi => plan.windows[wi]?.room === a.id && ["window", "dormer"].includes(plan.windows[wi].kind))) {
          issues.push(`${lv.name}：${a.name} ${a.id} 缺少採光窗`);
        }
        if (["bathroom", "closet", "foyer", "pantry", "laundry"].includes(a.type) && a.programTargets &&
          (a.programTargets.some(id => !a.doors.some(d => d.to === id)) || a.doors.some(d => !a.programTargets!.includes(d.to)))) {
          issues.push(`${lv.name}：${a.name} ${a.id} 私用入口不完整`);
        }
      }
    }
  }
  const M = I.minRoom;
  // every window belongs to a room
  for (const w of plan.windows) {
    if (!w.room) issues.push(`${name(w.level)}：第 ${w.side} 面第 ${w.bay} 開間的${KIND_NAME[w.kind]}沒有房間`);
  }
  const boundaries = [plan.inner, ...(plan.innerBoundaries?.map(v => v.polygon) ?? [])];
  const boundaryEdge = (q: V2) => { for (let i = 0; i < boundaries.length; i++) { const e = edgeAt(boundaries[i], q); if (e >= 0) return `${i}:${e}`; } return null; };
  const windowsByEdge = new Map<string, PlanWindow[]>();
  const roomsByLevel = new Map<number, PlanRoom[]>();
  for (const w of plan.windows) {
    const k = `${w.level}|${boundaryEdge(w.at)}`, list = windowsByEdge.get(k) ?? [];
    list.push(w);
    windowsByEdge.set(k, list);
  }
  for (const r of plan.rooms) {
    const list = roomsByLevel.get(r.level) ?? [];
    list.push(r);
    roomsByLevel.set(r.level, list);
  }
  // walls meet the outer walls only between windows
  for (const wall of plan.walls) {
    for (const end of [wall.a, wall.b]) {
      const e = boundaryEdge(end);
      if (e === null) continue;
      for (const w of windowsByEdge.get(`${wall.level}|${e}`) ?? []) {
        const d = Math.abs((end[0] - w.at[0]) * w.dir[0] + (end[1] - w.at[1]) * w.dir[1]);
        if (d < w.width / 2 + wall.thickness / 2 + 0.02) {
          issues.push(`${name(wall.level)}：牆 ${wall.rooms.join("/")} 碰到${KIND_NAME[w.kind]}`);
        }
      }
    }
  }
  // every room reachable from the stairs, the entrance hall or the street
  for (const lv of plan.levels) {
    const rs = roomsByLevel.get(lv.index) ?? [];
    const byId = new Map(rs.map(r => [r.id, r]));
    // A street entrance survives a room's rename or merge. Conversely, naming
    // an internal room "shop" does not create a door through its facade.
    const streetEntry = (r: PlanRoom) => r.level === 0 && r.windows.some(wi => {
      const w = plan.windows[wi];
      return w?.level === 0 && w.room === r.id && (w.kind === "door" || w.kind === "shop");
    });
    const seen = new Set(rs.filter(r => r.type === "stair" || r.type === "vestibule" || streetEntry(r)).map(r => r.id));
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
    for (const r of rs) if (r.type !== "elevator" && r.type !== "shaft" && !seen.has(r.id)) issues.push(`${lv.name}：${r.name} ${r.id} 走不到`);
  }
  // sizes
  for (const r of plan.rooms) {
    const xs = r.polygon.map(q => q[0]), ys = r.polygon.map(q => q[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    const small = Math.min(w, h), big = Math.max(w, h);
    const service = ["bathroom", "closet", "foyer", "pantry", "laundry"].includes(r.type);
    const min = service ? I.variety.minServiceWidth : r.type === "bedroom" || r.type === "maid" ? M.bedroom : r.type === "wc" ? M.wc : r.type === "corridor" ? M.corridor : 0;
    if (small < min - 0.01) issues.push(`${name(r.level)}：${r.name} ${r.id} 太小（${small.toFixed(2)} m）`);
    if (service && r.area < I.variety.minServiceArea - 0.01) issues.push(`${name(r.level)}：${r.name} ${r.id} 面積不足（${r.area.toFixed(2)} m²）`);
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
    if (rooms.length < 4 && !plan.circulation) continue;
    const missing = (["salon", "kitchen", "wc", "bedroom"] as RoomType[]).filter(t => !rooms.some(r => r.type === t));
    if (missing.length) issues.push(`${name(Number(k.split("|")[0]))}：住戶 ${k.split("|")[1]} 缺少${missing.map(t => ROOM_INFO[t].name).join("、")}`);
  }
  if (plan.courtyard) {
    const c = plan.courtyard, xs = c.polygon.map(q=>q[0]), ys = c.polygon.map(q=>q[1]);
    if (Math.min(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)) < c.minimum-EPS) issues.push("中庭短邊不足高度要求");
    for (const lv of plan.levels) {
      const sky = plan.voids.filter(v=>v.level===lv.index && v.kind==='courtyard');
      if (sky.length!==1 || JSON.stringify(sky[0].polygon)!==JSON.stringify(c.polygon) || !!sky[0].openBoundary !== (c.shape==='U')) issues.push(`${lv.name}：中庭孔洞未上下對齊`);
      const pub = plan.rooms.filter(r=>r.level===lv.index && r.circulation==='public'), byId = new Map(pub.map(r=>[r.id,r]));
      const seen = new Set(pub.length ? [pub[0].id] : []), queue = [...seen];
      while(queue.length) for(const d of byId.get(queue.pop()!)!.doors) if(byId.has(d.to) && !seen.has(d.to)){seen.add(d.to);queue.push(d.to);}
      if(seen.size!==pub.length) issues.push(`${lv.name}：中庭公共動線不連通`);
    }
    for(const r of plan.rooms) {
      const porch = r.cellIds?.some(id=>c.porchCells.includes(id));
      if (porch && r.level===0 && (r.type!=='porch' || r.circulation!=='public') || r.type==='porch' && r.level!==0) issues.push(`${name(r.level)}：一樓門廊或上層前翼被改動`);
      if (r.apartment!==null && ['bedroom','maid','salon','study'].includes(r.type) && c.blindWingCells.some(ids=>r.cellIds?.some(id=>ids.includes(id))) && !r.windows.some(i=>plan.windows[i].facadeId)) issues.push(`${name(r.level)}：盲牆翼住宅未朝中庭採光`);
    }
  }
  if (plan.innerBoundaries) {
    for (const d of plan.daylightDiagnostics ?? []) if (d.ratio > I.planning.deep.maxWindowlessRatio) issues.push(`${name(d.level)}：結構住宅格無窗比例 ${(d.ratio * 100).toFixed(1)}% 超過 10%`);
    const keys = plan.windows.filter(w => w.facadeId).map(w => w.openingKey);
    if (new Set(keys).size !== keys.length || keys.some(k => !k)) issues.push("內側立面窗識別不唯一");
    const byId = new Map(plan.rooms.map(r => [r.id, r]));
    for (const r of plan.rooms) {
      for (const v of plan.voids.filter(v => v.level === r.level && (v.kind === "lightwell" || v.kind === "courtyard"))) if (Math.abs(polygonArea(clipConvex(r.polygon, v.polygon))) > EPS) issues.push(`${name(r.level)}：房間 ${r.id} 跨入中庭／採光井`);
      const endColumn = r.rect[0] <= dims.wall + EPS || r.rect[2] >= plan.width - dims.wall - EPS;
      const sharedService = r.apartment === null && r.circulation === "private" && ["bathroom", "closet", "storage", "wc", "laundry"].includes(r.type);
      if (!endColumn && !sharedService) continue;
      // Minimum number of OTHER rooms before a public corridor, staying within
      // one apartment. End-column rooms never require traversing a foreign flat.
      const visited = new Set([r.id]), queue = [{ room: r, depth: 0 }]; let best = Infinity;
      while (queue.length) {
        const { room, depth } = queue.shift()!;
        if (room.circulation === "public") { best = depth; break; }
        for (const door of room.doors) {
          const next = byId.get(door.to);
          if (!next || visited.has(next.id) || next.circulation === "equipment" || next.apartment !== null && next.apartment !== r.apartment) continue;
          visited.add(next.id); queue.push({ room: next, depth: depth + (next.circulation === "public" ? 0 : 1) });
        }
        queue.sort((a, b) => a.depth - b.depth);
      }
      if (sharedService && !Number.isFinite(best)) issues.push(`${name(r.level)}：共享服務空間 ${r.id} 到公共走廊需穿越住戶`);
      if (endColumn && best > 1 && r.type !== "shop") issues.push(`${name(r.level)}：端欄 ${r.id} 到公共走廊需穿越 ${best} 間其他房間`);
    }
  }
  if (plan.circulation) issues.push(...checkCirculation(plan));
  return issues;
}
