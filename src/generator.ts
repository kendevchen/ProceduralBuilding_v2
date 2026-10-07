/**
 * Arrangement rules (KIT_SPEC.md §8): building types, facades, corners, the
 * Haussmann hierarchy of facade details, roof, shops.
 *
 * Blender Z-up space: the footprint is x in [0, W], y in [0, L]. The four sides
 * run counterclockwise round it (front along +x at y = 0, then right, back,
 * left); each is a frame with its plane at y = 0 and the outside towards -Y,
 * and owns the corner at its left end (seen from outside). A side is a street
 * facade, a plainer court facade, or a blind party wall (drawn by roof.ts).
 * Corners between two facades are square piers (1 m) or pan coupés (4 m, one
 * bay of each facade); a facade meeting a party wall ends in a 0.5 m pier.
 */
import { Color, Matrix4 } from "three";
import dims from "../blender/kit_dims.json";
import type { Placement, Style } from "./kit";
import type { BuildingParams, DetailStyle, DormerStyle, PedimentStyle, WindowOverride } from "./params";
import { PURPOSE, rand } from "./rng";
import type { RoomKind, RoomSlot } from "./interiors";
import { type EdgeKind, type V2, roofShape } from "./roof";
import { resolveBuildingTopology, TopologyResolutionError, type BuildingTopology, type Row, type SideKind, type CornerKind } from "./buildingTopology";
export { upperRows, ballroomBays } from "./buildingTopology";
export type { UpperClass, Row, SideKind, CornerKind } from "./buildingTopology";

export interface PartIndex {
  key(collection: string, variant: string): string;
}

type Balcony = "continuous" | "balconnet" | "gardecorps";

/** one bay of a facade, for the floor plans (plan.ts) */
export interface BayInfo {
  /** bay centre, side-local x */
  x: number;
  /** ground-floor module variant: window_*, door_*, shop_* */
  ground: string;
  /** dormer kind on the mansard above, or null */
  dormer: string | null;
}

/** a side of the building: its frame and bays (none on party walls) */
export interface SideInfo {
  kind: SideKind;
  /** facade plane at y = 0, outside -Y (Blender space) */
  frame: Matrix4;
  length: number;
  /** corners at the left and right end (seen from outside) */
  left: CornerKind;
  right: CornerKind;
  /** left edge of the first standard bay, side-local x */
  x0: number;
  bays: BayInfo[];
  /** the pan coupé's diagonal bay at the left end, with its own frame */
  diag: (BayInfo & { frame: Matrix4 }) | null;
}

export interface Building {
  /** Shared immutable structure, created before exterior placements. */
  topology: BuildingTopology;
  placements: Placement[];
  style: Style;
  width: number;
  length: number;
  rows: Row[];
  /** top of the last upper floor: the cornice sits here */
  wallTop: number;
  /** top of the cornice: foot of the mansard slopes */
  roofBase: number;
  /** counterclockwise, Blender xy, pan coupés chamfered */
  footprint: V2[];
  /** kind of each footprint edge (edge i runs from point i to i + 1) */
  edgeKinds: EdgeKind[];
  /** a room behind every window (interiors.ts) */
  rooms: RoomSlot[];
  /** the four sides counterclockwise from the front, with their bays */
  sides: SideInfo[];
  /** front bay with the entrance door */
  door: number;
  /** front bays of the double-height ballroom on the first two upper floors, or null */
  ballroom: number[] | null;
  /** those of its bays with one tall window over both floors */
  tall: number[];
  /** chimney stacks on the roof's flat top */
  chimneys: ChimneyInfo[];
  /** every window and door of the facades, for picking */
  windows: WindowSlot[];
}

/** the key of a window: facade side, bay (-1 the pan coupé's diagonal), and "g" for the ground floor or the upper row */
export const windowKey = (side: number, bay: number, row: number | "g" | "r") => `${side}|${bay}|${row}`;

/** a window that can be picked and set on its own (main.ts): its opening in its module's frame */
export interface WindowSlot {
  key: string;
  /** the module's frame (Blender space) */
  matrix: Matrix4;
  half: number;
  z0: number;
  z1: number;
  /** what can be set: an upper window, a ground-floor window, the entrance door, a shop front, a dormer */
  kind: "upper" | "ground" | "door" | "shop" | "dormer";
}

export interface ChimneyInfo {
  /** Blender xy */
  at: V2;
  /** the kit part, and its turn about z */
  key: string;
  angle: number;
}

/** where a bay stands on its facade, for the room boxes behind its windows */
interface Geo {
  along: number;
  length: number;
  depth: number;
}

const DETAILS: DetailStyle[] = ["refends", "pilasters", "panels"];
const DOORS = ["door_arched", "door_rect", "door_glazed"];
const CHIMNEYS = ["stack2", "stack4", "stack6"];
const SHOPS = ["shop_wood", "shop_stone", "shop_cafe"];
const SHOP_TOP = 3.4;
/** casement hinges (bay-local): x = +-LEAF_X, y = HINGE_Y (parts.py leaf_span, HINGE_Y) */
const LEAF_X = dims.window.width / 2 - 0.06;
const HINGE_Y = 0.195;
/** consoles under a balcony slab, bay-local x */
const CONSOLES: Record<Exclude<Balcony, "gardecorps">, number[]> = {
  continuous: [-1.1, 1.1],
  balconnet: [-0.75, 0.75],
};
/** the building's colours and railing pattern (KIT_SPEC.md §6.6) */
export function buildingStyle(p: BuildingParams): Style {
  return {
    stone: new Color(p.stone), paint: new Color(p.paint), shutter: new Color(p.shutter),
    fabric: new Color(p.awning), lace: p.lace,
  };
}

/** pediment on bay i of n (KIT_SPEC.md §8.5) */
function pediment(style: PedimentStyle, i: number, n: number): string {
  switch (style) {
    case "alternate": return i % 2 === 0 ? "triangle" : "segment";
    case "center": return n % 2 === 1 && i === (n - 1) / 2 ? "triangle" : "segment";
    case "cornice": return "cornice_consoles";
    default: return style;
  }
}

/** dormer kind on bay i of facade si; "mixed": stone pediments alternating on the
 *  front, round windows on the sides, plain zinc at the back */
function dormer(style: DormerStyle, si: number, i: number): string {
  if (style !== "mixed") return style;
  if (si === 0) return i % 2 === 0 ? "triangle" : "segment";
  return si === 2 ? "zinc" : "oeil";
}

export function generateBuilding(p: BuildingParams, kit: PartIndex): Building {
  const resolved = resolveBuildingTopology(p);
  if (resolved.status !== "ready") throw new TopologyResolutionError(resolved);
  const topology = resolved.topology;
  const { bay, corner } = dims;
  const leg = dims.panCoupe.leg;
  const style = buildingStyle(p);
  const kinds = topology.facades.map(s => s.kind);
  const rows = topology.rows.map(r => ({ ...r }));
  const { wallTop, roofBase, width: W, length: L, door: doorBay } = topology;
  const ballroom = topology.ballroom ? [...topology.ballroom] : null;
  const seed = p.seed;
  /** front bays whose two floors are one tall window (INTERIOR_SPEC.md §8) */
  const tallBays = new Set(p.ballroomFacade === "tall" ? ballroom ?? [] : []);

  const placements: Placement[] = [];
  const windows: WindowSlot[] = [];
  /** the window the placements now being made belong to */
  let tag: string | undefined;
  const own = (key: string): WindowOverride => p.facade[key] ?? {};
  /** a dormer as set on its own, else by the rule */
  const dormerOf = (si: number, i: number, rule: string | null): string | null => {
    const d = own(windowKey(si, i, "r")).dormer;
    return d ? (d === "none" ? null : d) : rule;
  };
  const MIRROR = new Matrix4().makeScale(-1, 1, 1);
  type Put = (collection: string, variant: string, x: number, z: number, opts?: { mirror?: boolean; angle?: number; y?: number }) => Matrix4;
  const putter = (frame: Matrix4): Put => (collection, variant, x, z, opts = {}) => {
    const m = frame.clone().multiply(new Matrix4().makeTranslation(x, opts.y ?? 0, z));
    if (opts.angle) m.multiply(new Matrix4().makeRotationZ(opts.angle));
    if (opts.mirror) m.multiply(MIRROR);
    placements.push({ key: kit.key(collection, variant), matrix: m, style, tag });
    return m;
  };
  const rooms: RoomSlot[] = [];
  const groundRoom = (m: Matrix4, variant: string, geo: Geo, seedKey: number[]) => {
    const at = { side: seedKey[1], bay: seedKey[2], level: 0 };
    const key = windowKey(at.side, at.bay, "g");
    const o = own(key);
    const base = { matrix: m, half: 1.45, depth: geo.depth, along: geo.along, length: geo.length, seed: seedKey, at,
      curtainMode: o.curtain, curtainOpen: o.curtainOpen };
    const g = dims.ground;
    if (variant.startsWith("window")) windows.push({ key, matrix: m, half: g.window.width / 2, z0: g.window.sill, z1: g.window.spring + g.window.width / 2, kind: "ground" });
    else if (variant.startsWith("door")) windows.push({ key, matrix: m, half: g.door.width / 2, z0: 0, z1: g.door.spring + g.door.width / 2, kind: "door" });
    else windows.push({ key, matrix: m, half: 1.2, z0: 0, z1: SHOP_TOP, kind: "shop" });
    if (variant.startsWith("window")) {
      rooms.push({ ...base, kind: "ground", y0: 0.25, floor: 0.45, height: 3.55, curtain: { half: 0.82, sill: 0.5, head: 2.6 } });
    } else if (variant.startsWith("shop")) {
      rooms.push({ ...base, kind: variant as RoomKind, y0: variant === "shop_wood" ? -0.2 : 0.27, floor: 0.02, height: 3.95 });
    } else if (variant === "door_glazed") {
      rooms.push({ ...base, kind: "hall", y0: 0.33, floor: 0.05, height: 3.9 });
    }
  };

  // balcony of every (row, bay): continuous rows on street facades, the rule
  // for the others; window heads read the floor above
  const balconyOf = (kind: SideKind, si: number, ri: number, i: number): Balcony => {
    const set = own(windowKey(si, i, ri)).balcony;
    if (set) return set;
    if (kind === "court") return "gardecorps";
    if (rows[ri].continuous) return "continuous";
    switch (p.otherBalcony) {
      case "balconnet": return "balconnet";
      case "alternate": return i % 2 === 0 ? "balconnet" : "gardecorps";
      case "random": return rand(seed, si, i, ri, PURPOSE.balcony) < 0.5 ? "balconnet" : "gardecorps";
      default: return "gardecorps";
    }
  };
  const detailOf = (ri: number): DetailStyle | null => {
    const s = DETAILS.indexOf(p.detailStyle);
    switch (p.detailPattern) {
      case "same": return DETAILS[s];
      case "alternate": return DETAILS[(s + ri) % 3];
      case "random": return DETAILS[Math.floor(rand(seed, ri, PURPOSE.detail) * 3)];
      default: return null;
    }
  };

  /** the upper floors, cornice and mansard of one bay at x (bay-local frame) */
  const upperBay = (put: Put, kind: SideKind, si: number, i: number, n: number, x: number, dormerKind: string | null, geo: Geo) => {
    // the ballroom's bays: one room box over both floors behind them, and on
    // the tall facade one window over both floors
    const hall = si === 0 && (ballroom?.includes(i) ?? false);
    rows.forEach((r, ri) => {
      const tall = hall && tallBays.has(i) && ri < 2;
      if (tall && ri === 1) return;
      const key = windowKey(si, i, ri);
      const o = own(key);
      tag = key;
      const pair = tall ? `${r.cls}${rows[1].cls}_tall` : null;
      const wm = put(pair ?? `${r.cls}_bay`, "window", x, r.z);
      const H = dims.classes[r.cls].height;
      const head = tall ? H + dims.classes[rows[1].cls].head : dims.classes[r.cls].head;
      const both = rows[1] ? H + rows[1].height : H;
      const room: RoomSlot = {
        matrix: wm, kind: hall && ri === 0 ? "ballroom" : "upper", y0: 0.25, floor: 0.2,
        height: hall && ri === 0 ? both - 0.35 : H - 0.35, half: 1.45, noBox: hall && ri === 1,
        depth: geo.depth, along: geo.along, length: geo.length,
        curtain: { half: 0.6, sill: 0.26, head: head - 0.07 }, seed: [seed, si, i, ri],
        at: { side: si, bay: i, level: ri + 1 }, curtainMode: o.curtain, curtainOpen: o.curtainOpen,
      };
      rooms.push(room);
      windows.push({ key, matrix: wm, half: dims.window.width / 2, z0: dims.window.sill, z1: head, kind: "upper" });
      const b = balconyOf(kind, si, ri, i);
      put("balcony", b, x, r.z);
      if ((o.consoles ?? p.consoles) && b !== "gardecorps") for (const cx of CONSOLES[b]) put("console", "scroll", x + cx, r.z);
      const ornament = o.ornament ?? p.ornament;
      if (kind === "street" || o.ornament !== undefined || o.head || o.detail) {
        // the Haussmann hierarchy: the étage noble richest, simpler going up;
        // under a slab (the floor above has a balcony here) only a keystone fits
        if (ornament >= 1) put(pair ?? `${r.cls}_surround`, pair ? "surround" : r.cls === "N" ? "crossette" : "band", x, r.z);
        let h: string | null = null;
        if (o.head) h = o.head === "none" ? null : o.head;
        else if (ornament >= 2) {
          const up = tall ? ri + 2 : ri + 1;
          const above = up < rows.length ? balconyOf(kind, si, up, i) : "gardecorps";
          if (above !== "gardecorps") h = "keystone";
          else if (r.cls === "N") h = pediment(p.pediment, i, n);
          else if (r.cls === "S") h = ornament >= 3 && i % 2 === 0 ? "segment" : "cornice";
        }
        if (h) put("head", h, x, r.z + head);
        const d = o.detail ? (o.detail === "none" ? null : o.detail) : kind === "street" ? detailOf(ri) : null;
        if (d && !tall) put(`${r.cls}_detail`, d, x, r.z);
      }
      // persiennes: open (folded into the reveals), one closed, or both closed
      const u = rand(seed, si, i, ri, PURPOSE.shutter);
      const closed = u < p.shutterClosed;
      const half = !closed && u < p.shutterClosed + p.shutterHalf;
      let leftClosed = closed || (half && rand(seed, si, i, ri, PURPOSE.shutterSide) < 0.5);
      let rightClosed = closed || (half && !leftClosed);
      if (o.shutters) [leftClosed, rightClosed] = [o.shutters === "left" || o.shutters === "closed", o.shutters === "right" || o.shutters === "closed"];
      // casements: open on some windows (not behind closed shutters), turning on
      // their hinges into the room or out; open outwards they cover the folded shutters
      const wanted = o.window ? o.window === "open" : rand(seed, si, i, ri, PURPOSE.window) < p.windowOpen;
      const opened = !leftClosed && !rightClosed && wanted;
      const out = opened && (o.dir ?? p.windowDir) === "out";
      const sgn = out ? -1 : 1;
      // casements open inwards would cut through the curtains: gather them on the
      // wall beside the window, just off its inner face
      if (opened && !out && room.curtain) Object.assign(room.curtain, { gathered: true, y: dims.wall + 0.03 - room.y0 });
      // a window set on its own opens both casements to its angle; the others to a random share of the global one
      const turn = (k: number) => opened ? sgn * (o.angle ?? (0.35 + 0.65 * rand(seed, si, i, ri, PURPOSE.windowAngle + k)) * p.windowAngle) * Math.PI / 180 : 0;
      put(`${r.cls}_leaf`, "left", x - LEAF_X, r.z, { y: HINGE_Y, angle: turn(0) });
      put(`${r.cls}_leaf`, "left", x + LEAF_X, r.z, { y: HINGE_Y, angle: -turn(1), mirror: true });
      if (!(out && !leftClosed)) put(`${r.cls}_shutter`, leftClosed ? "closed" : "folded", x, r.z);
      if (!(out && !rightClosed)) put(`${r.cls}_shutter`, rightClosed ? "closed" : "folded", x, r.z, { mirror: true });
      tag = undefined;
    });
    put("R_cornice", "bay", x, wallTop);
    tag = windowKey(si, i, "r");
    const mm = put("R_mansard", dormerKind ? `dormer_${dormerKind}` : "plain", x, roofBase);
    tag = undefined;
    const dm = dims.dormer;
    const at = dormerKind === "atelier" ? dm.atelier : dormerKind === "studio" ? dm.studio : null;
    // a bay without a dormer can be picked too (to give it one)
    windows.push(at
      ? { key: windowKey(si, i, "r"), matrix: mm, half: at.front / 2 - at.pier, z0: at.sill, z1: at.head, kind: "dormer" }
      : { key: windowKey(si, i, "r"), matrix: mm, half: dm.front / 2, z0: dormerKind ? dm.sill : 0.4, z1: dormerKind ? dm.head : 2.2, kind: "dormer" });
    if (dormerKind) {
      const glass = at !== null;
      rooms.push({
        matrix: mm, kind: "attic", y0: 1.1, floor: 0.1, height: 2.7, half: 1.45, tunnel: true,
        // the round-window dormer is low and narrow: its tunnel follows the window, or it pokes out of the hood
        tunnelSize: glass ? { x: at!.front / 2 - at!.pier, z0: at!.sill - 0.1, z1: at!.head - 0.1 }
          : dormerKind === "oeil" ? { x: 0.3, z0: 0.72, z1: 1.28 } : undefined,
        depth: Math.min(3.2, geo.depth - 1.0), along: geo.along, length: geo.length, seed: [seed, si, i, 77],
        at: { side: si, bay: i, level: rows.length + 1 },
      });
    }
    if (p.cresting && kind === "street") put("R_ridge", "cresting", x, roofBase);
  };

  /** shop bays of a street facade's ground floor, in runs that share a front */
  const shopsOf = (si: number, n: number, door: number): (string | null)[] => {
    const out: (string | null)[] = [];
    let run: string | null = null;
    for (let i = 0; i < n; i++) {
      // mixed use keeps the front's left corner for the study (INTERIOR_SPEC.md §5.4)
      const shop = i !== door && p.groundUse !== "residential" && !(p.groundUse === "mixed" && si === 0 && i === 0) &&
        (p.groundUse === "shops" || rand(seed, si, i, PURPOSE.shop) < 0.5);
      if (!shop) run = null;
      else if (!run) run = SHOPS[Math.floor(rand(seed, si, i, PURPOSE.shopKind) * SHOPS.length)];
      out.push(shop ? run : null);
    }
    return out;
  };
  const awningFor = (shop: string, si: number, i: number) =>
    shop === "shop_cafe" || rand(seed, si, i, PURPOSE.awning) < 0.5 ? "open" : "retracted";

  const sideFrames = topology.facades.map(s => new Matrix4().fromArray(s.frame));
  const ends = (put: Put, kind: SideKind, x: number, mirror: boolean) => {
    put("G_end", "pier", x, 0, { mirror });
    for (const r of rows) {
      put(`${r.cls}_end`, "pier", x, r.z, { mirror });
      if (kind === "street" && r.continuous) put("balcony", "end", x, r.z, { mirror });
    }
    put("R_cornice_end", "end", x, wallTop, { mirror });
    put("R_mansard_end", "end", x, roofBase, { mirror });
  };

  const sides: SideInfo[] = [];
  kinds.forEach((kind, si) => {
    const structural = topology.facades[si];
    const { left, right, length } = structural;
    const side: SideInfo = { kind, frame: sideFrames[si], length, left, right, x0: 0, bays: [], diag: null };
    sides.push(side);
    if (kind === "party") return;
    const put = putter(sideFrames[si]);
    const street = kind === "street";

    // ---- the corner at the left end
    if (left === "pier") {
      put("G_corner", "pier", 0, 0);
      for (const r of rows) {
        put(`${r.cls}_corner`, "pier", 0, r.z);
        if (street && r.continuous) {
          put("balcony", "corner", 0, r.z);
          if (p.consoles) put("console", "scroll", 0, r.z, { angle: -Math.PI / 4 });
        }
      }
      put("R_cornice_corner", "pier", 0, wallTop);
      put("R_mansard_corner", "hip", 0, roofBase);
      if (p.cresting && street) put("R_ridge", "post", 0, roofBase);
    } else if (left === "pc") {
      put("G_pc", "frame", 0, 0);
      for (const r of rows) {
        put(`${r.cls}_pc`, "frame", 0, r.z);
        if (r.continuous) put("balcony", "pc", 0, r.z);
      }
      put("R_cornice_pc", "frame", 0, wallTop);
      put("R_mansard_pc", "frame", 0, roofBase);
      if (p.cresting) {
        const run = dims.mansard.run, t = leg + run * (Math.SQRT2 - 1);
        put("R_ridge", "post", run - run, roofBase, { y: t - run });
        put("R_ridge", "post", t - run, roofBase, { y: 0 });
      }
      // the diagonal's middle bay: standard modules turned -45 degrees
      const dput = putter(new Matrix4().fromArray(structural.diagonal!.frame));
      const ground = p.groundUse !== "residential" ? "shop_cafe" : `window_${own(windowKey(si, -1, "g")).ground ?? p.groundWindow}`;
      const diag: Geo = { along: 500, length: 1000, depth: 1.8 };
      tag = windowKey(si, -1, "g");
      groundRoom(dput("G_bay", ground, 0, 0), ground, diag, [seed, si, -1, -1]);
      if (ground === "shop_cafe") dput("awning", "open", 0, SHOP_TOP);
      tag = undefined;
      const diagDormer = dormerOf(si, -1, p.dormerStyle === "mixed" ? "oeil" : p.dormerStyle);
      upperBay(dput, "street", si, -1, 1, 0, diagDormer, diag);
      side.diag = { x: 0, ground, dormer: diagDormer, frame: new Matrix4().fromArray(structural.diagonal!.frame) };
    } else if (left === "endL") {
      ends(put, kind, 0, false);
    }
    if (right === "endR") ends(put, kind, length, true);

    // ---- the bays
    const n = structural.bays.length;
    const x0 = structural.x0;
    // door on the middle bay of the front; on an even facade left or right of the centre
    const door = si === 0 && street ? doorBay : -1;
    const doorVariant = p.doorStyle === "random"
      ? DOORS[Math.floor(rand(seed, PURPOSE.doorStyle) * DOORS.length)]
      : `door_${p.doorStyle}`;
    const shops = street ? shopsOf(si, n, door) : [];
    const depth = Math.min(4.6, (si % 2 === 0 ? L : W) / 2 - 0.45);
    side.x0 = x0;
    for (let i = 0; i < n; i++) {
      const x = structural.bays[i].x;
      const geo: Geo = { along: x, length, depth };
      const o = own(windowKey(si, i, "g"));
      const variant = i === door ? (o.door ? `door_${o.door}` : doorVariant)
        : shops[i] ?? (street || o.ground ? `window_${o.ground ?? p.groundWindow}` : "window_rect");
      tag = windowKey(si, i, "g");
      groundRoom(put("G_bay", variant, x, 0), variant, geo, [seed, si, i, -1]);
      if (shops[i]) put("awning", awningFor(shops[i]!, si, i), x, SHOP_TOP);
      tag = undefined;
      const withDormer = p.dormerEvery === 1 || i % 2 === 0;
      const dormerKind = dormerOf(si, i, withDormer ? (street ? dormer(p.dormerStyle, si, i) : "zinc") : null);
      upperBay(put, kind, si, i, n, x, dormerKind, geo);
      side.bays.push({ x, ground: variant, dormer: dormerKind });
    }
  });

  const footprint = topology.footprint.map(q => [...q] as V2);
  const edgeKinds = [...topology.edgeKinds];

  // ---- roof top: finials at the flat top's corners between slopes, chimneys
  // along its middle and on the party walls
  const roof = roofShape(footprint, edgeKinds, roofBase);
  const world = (collection: string, variant: string, m: Matrix4) =>
    placements.push({ key: kit.key(collection, variant), matrix: m, style });
  const m = roof.p2.length;
  if (p.cresting) roof.p2.forEach(([x, y], i) => {
    if (edgeKinds[i] === "slope" && edgeKinds[(i + m - 1) % m] === "slope") {
      world("R_ridge", "finial", new Matrix4().makeTranslation(x, y, roof.z2));
    }
  });
  const xs = roof.p2.map(q => q[0]), ys = roof.p2.map(q => q[1]);
  const [rx0, rx1, ry0, ry1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const along = rx1 - rx0 >= ry1 - ry0;
  const chimneys: ChimneyInfo[] = [];
  for (let i = 0; i < (along ? p.baysX : p.baysY); i++) {
    const t = corner + bay * (i + 0.5);
    const cx = along ? t : (rx0 + rx1) / 2, cy = along ? (ry0 + ry1) / 2 : t;
    if (cx < rx0 + 0.8 || cx > rx1 - 0.8 || cy < ry0 + 0.5 || cy > ry1 - 0.5) continue;
    if (rand(seed, i, PURPOSE.chimney) >= p.chimneys) continue;
    const kind = CHIMNEYS[Math.floor(rand(seed, i, PURPOSE.chimneyKind) * CHIMNEYS.length)];
    const mm = new Matrix4().makeTranslation(cx, cy, roof.z2);
    if (!along) mm.multiply(new Matrix4().makeRotationZ(Math.PI / 2));
    world("R_chimney", kind, mm);
    chimneys.push({ at: [cx, cy], key: kit.key("R_chimney", kind), angle: along ? 0 : Math.PI / 2 });
  }
  return {
    topology, placements, style, width: W, length: L, rows, wallTop, roofBase, footprint, edgeKinds, rooms,
    sides, door: doorBay, ballroom, tall: [...tallBays], chimneys, windows,
  };
}

/** chimney stacks along the party walls' tops, where the roof is flat */
export function partyChimneys(p: BuildingParams, kit: PartIndex, style: Style,
  edges: { a: V2; b: V2; flat: [number, number] | null }[], z: number): Placement[] {
  const out: Placement[] = [];
  edges.forEach((e, k) => {
    if (!e.flat || e.flat[1] - e.flat[0] < 2.2) return;
    if (rand(p.seed, k, PURPOSE.partyChimney) >= Math.min(1, p.chimneys * 1.6)) return;
    const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
    const dx = (e.b[0] - e.a[0]) / len, dy = (e.b[1] - e.a[1]) / len;
    const s = (e.flat[0] + e.flat[1]) / 2;
    const m = new Matrix4().makeRotationZ(Math.atan2(dy, dx)).setPosition(e.a[0] + dx * s, e.a[1] + dy * s, z);
    out.push({ key: kit.key("R_chimney", "party"), matrix: m, style });
  });
  return out;
}
