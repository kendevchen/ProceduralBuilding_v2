/** Legacy structural grid, resolved before facade placements and shared across floors. */
import dims from "../../blender/kit_dims.json";
import type { BuildingParams } from "../params";
import { PURPOSE, rand } from "../rng";
import { type V2, insetEdges } from "../roof";

const I = dims.interior, T = dims.wall, BAY = dims.bay, EPS = 1e-6;
export interface GridSide {
  kind: "street" | "court" | "party";
  left: "pier" | "pc" | "endL" | "endR" | "none";
  right: GridSide["left"];
  frame: number[];
  x0: number;
  bays: { x: number }[];
}
export interface GridEnvelope {
  width: number;
  length: number;
  footprint: V2[];
  sides: GridSide[];
  door: number;
  ballroom: number[] | null;
}
function toWorld(e: number[], x: number, y: number): V2 {
  return [e[0] * x + e[4] * y + e[12], e[1] * x + e[5] * y + e[13]];
}

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

export interface Cell {
  id: number;
  col: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  zone: Zone;
}

export interface LegacyGrid {
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
}

/** a side facade's bay boundaries (Blender y) where walls may meet it, far
 *  enough from the corners to leave a room on either side */
function pierLines(b: GridEnvelope, si: number): number[] {
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

export function buildLegacyGrid(b: GridEnvelope, p: BuildingParams): LegacyGrid {
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

  const inner = insetEdges(b.footprint, b.footprint.map(() => T))!;
  return { W, L, cols, cells, inner, mainCol, cage: cage.map(c => c.id), service, cross, ballroom };
}
