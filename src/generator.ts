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
import type { BuildingParams, DetailStyle, DormerStyle, PedimentStyle } from "./params";
import { PURPOSE, rand } from "./rng";
import { type EdgeKind, type V2, roofShape } from "./roof";

export interface PartIndex {
  key(collection: string, variant: string): string;
}

export type UpperClass = "N" | "S" | "A";
type Balcony = "continuous" | "balconnet" | "gardecorps";
export type SideKind = "street" | "court" | "party";
type CornerKind = "pier" | "pc" | "endL" | "endR" | "none";

export interface Row {
  cls: UpperClass;
  /** floor level */
  z: number;
  height: number;
  /** continuous balcony along the street facades */
  continuous: boolean;
}

export interface Building {
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
}

const DETAILS: DetailStyle[] = ["refends", "pilasters", "panels"];
const DOORS = ["door_arched", "door_rect", "door_glazed"];
const CHIMNEYS = ["stack2", "stack4", "stack6"];
const SHOPS = ["shop_wood", "shop_stone", "shop_cafe"];
const SHOP_TOP = 3.4;
/** consoles under a balcony slab, bay-local x */
const CONSOLES: Record<Exclude<Balcony, "gardecorps">, number[]> = {
  continuous: [-1.1, 1.1],
  balconnet: [-0.75, 0.75],
};
const SIDE_KINDS: Record<BuildingParams["type"], SideKind[]> = {
  freestanding: ["street", "street", "street", "street"],
  corner: ["street", "street", "party", "party"],
  row: ["street", "party", "court", "party"],
};

/** upper floors with their height classes (KIT_SPEC.md §3.2): the first and the
 *  last floor carry the continuous balconies */
export function upperRows(p: BuildingParams): Row[] {
  const profile = dims.heightProfiles[p.profile];
  const rows: Row[] = [];
  let z = dims.classes.G.height;
  for (let i = 0; i < p.floors; i++) {
    const cls = (i === 0 ? profile.first : i === p.floors - 1 ? profile.last : profile.middle) as UpperClass;
    const height = dims.classes[cls].height;
    rows.push({ cls, z, height, continuous: i === 0 || i === p.floors - 1 });
    z += height;
  }
  return rows;
}

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
  const { bay, corner, endPier } = dims;
  const leg = dims.panCoupe.leg;
  const style = buildingStyle(p);
  const kinds = SIDE_KINDS[p.type];
  const rows = upperRows(p);
  const last = rows[rows.length - 1];
  const wallTop = last ? last.z + last.height : dims.classes.G.height;
  const roofBase = wallTop + dims.cornice.height;
  const seed = p.seed;

  // corner c joins side c - 1 and side c; side c owns it (its left end)
  const cornerKind = (c: number): CornerKind => {
    const prev = kinds[(c + 3) % 4], own = kinds[c];
    if (prev === "party" && own === "party") return "none";
    if (prev === "party") return "endL";
    if (own === "party") return "endR";
    return prev === "street" && own === "street" && p.cornerStyle === "panCoupe" ? "pc" : "pier";
  };
  const ck = [0, 1, 2, 3].map(cornerKind);
  const allowance = (k: CornerKind) => (k === "pier" || k === "pc" ? corner : k === "none" ? 0 : endPier);
  const W = allowance(ck[0]) + bay * p.baysX + allowance(ck[1]);
  const L = p.type === "row" ? p.depth : allowance(ck[1]) + bay * p.baysY + allowance(ck[2]);

  const placements: Placement[] = [];
  const MIRROR = new Matrix4().makeScale(-1, 1, 1);
  const DIAG = new Matrix4().makeRotationZ(-Math.PI / 4).setPosition(leg / 2, leg / 2, 0);
  type Put = (collection: string, variant: string, x: number, z: number, opts?: { mirror?: boolean; angle?: number; y?: number }) => void;
  const putter = (frame: Matrix4): Put => (collection, variant, x, z, opts = {}) => {
    const m = frame.clone().multiply(new Matrix4().makeTranslation(x, opts.y ?? 0, z));
    if (opts.angle) m.multiply(new Matrix4().makeRotationZ(opts.angle));
    if (opts.mirror) m.multiply(MIRROR);
    placements.push({ key: kit.key(collection, variant), matrix: m, style });
  };

  // balcony of every (row, bay): continuous rows on street facades, the rule
  // for the others; window heads read the floor above
  const balconyOf = (kind: SideKind, si: number, ri: number, i: number): Balcony => {
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
  const upperBay = (put: Put, kind: SideKind, si: number, i: number, n: number, x: number, dormerKind: string | null) => {
    rows.forEach((r, ri) => {
      put(`${r.cls}_bay`, "window", x, r.z);
      const b = balconyOf(kind, si, ri, i);
      put("balcony", b, x, r.z);
      if (p.consoles && b !== "gardecorps") for (const cx of CONSOLES[b]) put("console", "scroll", x + cx, r.z);
      if (kind === "street") {
        // the Haussmann hierarchy: the étage noble richest, simpler going up;
        // under a slab (the floor above has a balcony here) only a keystone fits
        if (p.ornament >= 1) put(`${r.cls}_surround`, r.cls === "N" ? "crossette" : "band", x, r.z);
        if (p.ornament >= 2) {
          const above = ri + 1 < rows.length ? balconyOf(kind, si, ri + 1, i) : "gardecorps";
          let h: string | null = null;
          if (above !== "gardecorps") h = "keystone";
          else if (r.cls === "N") h = pediment(p.pediment, i, n);
          else if (r.cls === "S") h = p.ornament >= 3 && i % 2 === 0 ? "segment" : "cornice";
          if (h) put("head", h, x, r.z + dims.classes[r.cls].head);
        }
        const d = detailOf(ri);
        if (d) put(`${r.cls}_detail`, d, x, r.z);
      }
      // persiennes: open (folded into the reveals), one closed, or both closed
      const u = rand(seed, si, i, ri, PURPOSE.shutter);
      const closed = u < p.shutterClosed;
      const half = !closed && u < p.shutterClosed + p.shutterHalf;
      const leftClosed = closed || (half && rand(seed, si, i, ri, PURPOSE.shutterSide) < 0.5);
      const rightClosed = closed || (half && !leftClosed);
      put(`${r.cls}_shutter`, leftClosed ? "closed" : "folded", x, r.z);
      put(`${r.cls}_shutter`, rightClosed ? "closed" : "folded", x, r.z, { mirror: true });
    });
    put("R_cornice", "bay", x, wallTop);
    put("R_mansard", dormerKind ? `dormer_${dormerKind}` : "plain", x, roofBase);
    if (p.cresting && kind === "street") put("R_ridge", "cresting", x, roofBase);
  };

  /** shop bays of a street facade's ground floor, in runs that share a front */
  const shopsOf = (si: number, n: number, door: number): (string | null)[] => {
    const out: (string | null)[] = [];
    let run: string | null = null;
    for (let i = 0; i < n; i++) {
      const shop = i !== door && p.groundUse !== "residential" &&
        (p.groundUse === "shops" || rand(seed, si, i, PURPOSE.shop) < 0.5);
      if (!shop) run = null;
      else if (!run) run = SHOPS[Math.floor(rand(seed, si, i, PURPOSE.shopKind) * SHOPS.length)];
      out.push(shop ? run : null);
    }
    return out;
  };
  const awningFor = (shop: string, si: number, i: number) =>
    shop === "shop_cafe" || rand(seed, si, i, PURPOSE.awning) < 0.5 ? "open" : "retracted";

  const sideFrames = [
    new Matrix4().setPosition(0, 0, 0),
    new Matrix4().makeRotationZ(Math.PI / 2).setPosition(W, 0, 0),
    new Matrix4().makeRotationZ(Math.PI).setPosition(W, L, 0),
    new Matrix4().makeRotationZ(-Math.PI / 2).setPosition(0, L, 0),
  ];
  const ends = (put: Put, kind: SideKind, x: number, mirror: boolean) => {
    put("G_end", "pier", x, 0, { mirror });
    for (const r of rows) {
      put(`${r.cls}_end`, "pier", x, r.z, { mirror });
      if (kind === "street" && r.continuous) put("balcony", "end", x, r.z, { mirror });
    }
    put("R_cornice_end", "end", x, wallTop, { mirror });
    put("R_mansard_end", "end", x, roofBase, { mirror });
  };

  kinds.forEach((kind, si) => {
    if (kind === "party") return;
    const put = putter(sideFrames[si]);
    const left = ck[si], right = ck[(si + 1) % 4];
    const length = si % 2 === 0 ? W : L;
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
      const dput = putter(sideFrames[si].clone().multiply(DIAG));
      const ground = p.groundUse !== "residential" ? "shop_cafe" : `window_${p.groundWindow}`;
      dput("G_bay", ground, 0, 0);
      if (ground === "shop_cafe") dput("awning", "open", 0, SHOP_TOP);
      upperBay(dput, "street", si, -1, 1, 0, p.dormerStyle === "mixed" ? "oeil" : p.dormerStyle);
    } else if (left === "endL") {
      ends(put, kind, 0, false);
    }
    if (right === "endR") ends(put, kind, length, true);

    // ---- the bays
    const n = (si % 2 === 0 ? p.baysX : p.baysY) - (left === "pc" ? 1 : 0) - (right === "pc" ? 1 : 0);
    const x0 = allowance(left) + (left === "pc" ? bay : 0);
    // door on the middle bay of the front; on an even facade left or right of the centre
    const door = si !== 0 || !street ? -1 : n % 2 === 1 ? (n - 1) / 2 : n / 2 - (rand(seed, PURPOSE.doorBay) < 0.5 ? 1 : 0);
    const doorVariant = p.doorStyle === "random"
      ? DOORS[Math.floor(rand(seed, PURPOSE.doorStyle) * DOORS.length)]
      : `door_${p.doorStyle}`;
    const shops = street ? shopsOf(si, n, door) : [];
    for (let i = 0; i < n; i++) {
      const x = x0 + bay * (i + 0.5);
      if (i === door) put("G_bay", doorVariant, x, 0);
      else if (shops[i]) {
        put("G_bay", shops[i]!, x, 0);
        put("awning", awningFor(shops[i]!, si, i), x, SHOP_TOP);
      } else put("G_bay", street ? `window_${p.groundWindow}` : "window_rect", x, 0);
      const withDormer = p.dormerEvery === 1 || i % 2 === 0;
      upperBay(put, kind, si, i, n, x, withDormer ? (street ? dormer(p.dormerStyle, si, i) : "zinc") : null);
    }
  });

  // ---- footprint (pan coupés chamfered) and its edge kinds, for the roof
  const corners: V2[] = [[0, 0], [W, 0], [W, L], [0, L]];
  const dirs: V2[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const footprint: V2[] = [];
  const edgeKinds: EdgeKind[] = [];
  for (let c = 0; c < 4; c++) {
    const [ox, oy] = corners[c];
    if (ck[c] === "pc") {
      const pd = dirs[(c + 3) % 4], td = dirs[c];
      footprint.push([ox - pd[0] * leg, oy - pd[1] * leg]);
      edgeKinds.push("slope");
      footprint.push([ox + td[0] * leg, oy + td[1] * leg]);
    } else footprint.push([ox, oy]);
    edgeKinds.push(kinds[c] === "party" ? "party" : "slope");
  }

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
  for (let i = 0; i < (along ? p.baysX : p.baysY); i++) {
    const t = corner + bay * (i + 0.5);
    const cx = along ? t : (rx0 + rx1) / 2, cy = along ? (ry0 + ry1) / 2 : t;
    if (cx < rx0 + 0.8 || cx > rx1 - 0.8 || cy < ry0 + 0.5 || cy > ry1 - 0.5) continue;
    if (rand(seed, i, PURPOSE.chimney) >= p.chimneys) continue;
    const kind = CHIMNEYS[Math.floor(rand(seed, i, PURPOSE.chimneyKind) * CHIMNEYS.length)];
    const mm = new Matrix4().makeTranslation(cx, cy, roof.z2);
    if (!along) mm.multiply(new Matrix4().makeRotationZ(Math.PI / 2));
    world("R_chimney", kind, mm);
  }
  return { placements, style, width: W, length: L, rows, wallTop, roofBase, footprint, edgeKinds };
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
