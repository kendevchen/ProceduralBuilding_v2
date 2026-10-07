/** P3 candidate: two room bands, a reserved public spine and independently identified cores. */
import dims from '../../blender/kit_dims.json';
import type { BuildingParams } from '../params';
import type { V2 } from '../roof';
import { insetEdges } from '../roof';
import type { TopologyCore } from '../buildingTopology';
import type { Cell, GridEnvelope, LegacyGrid } from './legacyGrid';
import type { Rect } from './edgeIndex';

const C = dims.interior.planning.cores, I = dims.interior, T = dims.wall, EPS = 1e-6;
export interface CoreFrame { origin: V2; orientation: number }
export interface CorePart {
  id: string; coreId: string; role: 'stair' | 'liftHall' | 'elevator' | 'shaft';
  cell: number; frame: CoreFrame; localRect: Rect; landingEdge?: [V2, V2];
}
export interface CoreLayout {
  parts: CorePart[];
  publicCells: number[];
  serviceAreas: { coreId: string; columns: number[] }[];
}
export const coreCellId = (id: number) => `cores:block:cell:${id}`;
export const coreWorld = (f: CoreFrame, q: V2): V2 => [
  f.origin[0] + Math.cos(f.orientation) * q[0] - Math.sin(f.orientation) * q[1],
  f.origin[1] + Math.sin(f.orientation) * q[0] + Math.cos(f.orientation) * q[1],
];
export const coreLocal = (f: CoreFrame, q: V2): V2 => {
  const x = q[0] - f.origin[0], y = q[1] - f.origin[1];
  return [Math.cos(f.orientation) * x + Math.sin(f.orientation) * y,
    -Math.sin(f.orientation) * x + Math.cos(f.orientation) * y];
};
export const rectLoop = (r: Rect): V2[] => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];

export type CoreCandidate = { status: 'ready'; grid: LegacyGrid; cores: TopologyCore[]; layout: CoreLayout; ballroom: number[] | null }
  | { status: 'infeasible' | 'unsupported'; message: string };

export function resolveCores(b: GridEnvelope, p: BuildingParams): CoreCandidate {
  const front = b.sides[0], xs = [T];
  if (front.left === 'pc') xs.push(front.x0);
  for (let j = 1; j < front.bays.length; j++) xs.push(front.x0 + dims.bay * j);
  if (front.right === 'pc') xs.push(front.x0 + dims.bay * front.bays.length);
  xs.push(b.width - T);
  const cols = xs.slice(0, -1).map((x0, i) => ({ x0, x1: xs[i + 1], end: null }));
  if (cols.length < C.minColumns) return { status: 'infeasible', message: `核心配置至少需要 ${C.minColumns} 個結構欄，現有 ${cols.length}；無法同時保留雙梯、公共走廊與完整住戶` };
  const depth = b.length - 2 * T;
  if (depth < 2 * C.minStairDepth + C.corridor - EPS) return { status: 'infeasible', message: '兩側房間帶無法容納實際樓梯踏步、平台與公共走廊' };
  if (depth > C.maxDepth + EPS) return { status: 'unsupported', message: '深平面需 P4/P5 的採光井／中庭候選；P3 不以無窗住宅替代' };
  // Centre the public corridor on a side opening: both end partitions stay clear
  // even of the wider ground shopfronts. Party-wall sides need no opening alignment.
  const side = b.sides.find((s, i) => i % 2 === 1 && s.kind !== 'party');
  const sideCentres = side?.bays.map(q => side.frame[1] * q.x + side.frame[13]) ?? [];
  const candidates = sideCentres.length ? sideCentres : [b.length / 2];
  const mids = candidates.filter(y => y - C.corridor / 2 - T >= C.minStairDepth && b.length - T - y - C.corridor / 2 >= C.minStairDepth);
  if (!mids.length) return { status: 'infeasible', message: '側面窗間壁對齊後，兩側樓梯深度不足；不能將平台／走廊切穿窗洞' };
  const mid = mids.reduce((a, v) => Math.abs(v - b.length / 2) < Math.abs(a - b.length / 2) ? v : a);
  const y0 = mid - C.corridor / 2, y1 = mid + C.corridor / 2;
  const cells: Cell[] = [], parts: CorePart[] = [], publicCells: number[] = [];
  const add = (col: number, rect: Rect, zone: Cell['zone']) => {
    const cell: Cell = { id: cells.length, col, x0: rect[0], y0: rect[1], x1: rect[2], y1: rect[3], zone };
    cells.push(cell); return cell.id;
  };
  const count = Math.max(p.floors >= C.doubleStairFrom ? 2 : 1, Math.ceil(cols.length / C.serviceBays));
  const stairsPerCore = p.floors >= C.doubleLiftFrom ? 2 : 1;
  const liftsPerCore = p.floors >= C.doubleLiftFrom ? 2 : p.floors >= C.doubleStairFrom ? 1 : 0;
  const used = stairsPerCore + liftsPerCore;
  const areas = Array.from({ length: count }, (_, i) => ({ coreId: `cores:${i}`, columns:
    Array.from({ length: Math.floor((i + 1) * cols.length / count) - Math.floor(i * cols.length / count) }, (_, j) => Math.floor(i * cols.length / count) + j) }));
  const reserved = new Map<string, { coreId: string; role: 'stair' | 'elevator'; number: number }>();
  for (let i = 0; i < count; i++) {
    const area = areas[i];
    let band: 'back' | 'front' = b.sides[2].kind === 'party' || i % 2 === 0 ? 'back' : 'front';
    const candidates = () => area.columns.filter(col => cols[col].x1 - cols[col].x0 >= dims.bay - EPS &&
      col > 0 && col < cols.length - 1 && !(band === 'front' && front.x0 + dims.bay * (b.door + 0.5) > cols[col].x0 && front.x0 + dims.bay * (b.door + 0.5) < cols[col].x1));
    let possible = candidates();
    if (possible.length < used) { band = band === "front" ? "back" : "front"; possible = candidates(); }
    if (possible.length < used) return { status: 'infeasible', message: `${area.coreId}：服務區放不下 ${stairsPerCore} 座實際樓梯與 ${liftsPerCore} 座電梯；不縮小核心換取住戶` };
    const selected = i % 2 === 0 ? possible.slice(0, used) : possible.slice(-used);
    selected.forEach((col, j) => reserved.set(`${col}|${band}`, { coreId: area.coreId, role: j < stairsPerCore ? 'stair' : 'elevator', number: j < stairsPerCore ? j : j - stairsPerCore }));
  }
  for (let col = 0; col < cols.length; col++) {
    const { x0, x1 } = cols[col];
    for (const band of ['front', 'back'] as const) {
      const r: Rect = [x0, band === 'front' ? T : y1, x1, band === 'front' ? y0 : b.length - T];
      const spec = reserved.get(`${col}|${band}`);
      if (!spec) { add(col, r, band); continue; }
      const orientation = band === 'front' ? Math.PI : 0;
      const frame: CoreFrame = { origin: band === 'front' ? [x1, y0] : [x0, y1], orientation };
      const width = x1 - x0, length = r[3] - r[1];
      const addPart = (role: CorePart['role'], local: Rect) => {
        const points = rectLoop(local).map(q => coreWorld(frame, q));
        const world: Rect = [Math.min(...points.map(q => q[0])), Math.min(...points.map(q => q[1])), Math.max(...points.map(q => q[0])), Math.max(...points.map(q => q[1]))];
        const cell = add(col, world, band);
        const id = `${spec.coreId}:${role}:${spec.number}`;
        parts.push({ id, coreId: spec.coreId, role, cell, frame, localRect: local,
          ...(role === 'stair' ? { landingEdge: [coreWorld(frame, [0, 0]), coreWorld(frame, [width, 0])] as [V2, V2] } : {}) });
        if (role === 'liftHall') publicCells.push(cell);
      };
      if (spec.role === 'stair') addPart('stair', [0, 0, width, length]);
      else {
        const liftDepth = C.liftClearDepth + I.walls.cage;
        if (width - I.walls.cage < C.liftClearWidth || length - C.liftHallDepth - liftDepth - I.walls.cage < C.shaftClearWidth) return { status: 'infeasible', message: '電梯淨尺寸與管道井無法同時容納' };
        // Service partitions stay internal: a narrow shaft split may not hit a
        // wide ground shopfront. The equipment end band owns that facade opening.
        addPart('liftHall', [0, 0, width, C.liftHallDepth]);
        addPart('elevator', [0, C.liftHallDepth, width, C.liftHallDepth + liftDepth]);
        addPart('shaft', [0, C.liftHallDepth + liftDepth, width, length]);
      }
    }
    publicCells.push(add(col, [x0, y0, x1, y1], 'corridor'));
  }
  const idOf = (col: number, band: 'front' | 'back') => cells.find(c => c.col === col && c.zone === band && !parts.some(part => part.cell === c.id))?.id;
  // A ballroom belongs to ONE service area, and never consumes a core.
  let ballroom: number[] | null = null, ballroomCells: number[] = [];
  if (p.ballroom && p.floors >= 2) {
    for (const area of areas) {
      const free = area.columns.filter(col => idOf(col, 'front') !== undefined);
      const available = cells.filter(c => area.columns.includes(c.col) && c.zone !== 'corridor' && !parts.some(part => part.cell === c.id) && (c.zone === 'front' || b.sides[2].kind !== 'party')).length;
      const maxBallroom = Math.min(I.ballroom.maxBays, available - C.minApartmentCells);
      let run: number[] = [];
      for (const col of free) {
        run = run.length && run.at(-1)! + 1 !== col ? [col] : [...run, col];
        if (run.length >= I.ballroom.minBays && run.length <= maxBallroom) {
          ballroomCells = run.map(j => idOf(j, 'front')!);
        }
      }
      if (ballroomCells.length) break;
    }
    if (ballroomCells.length) ballroom = front.bays.flatMap((bay, j) => ballroomCells.some(id => bay.x > cells[id].x0 && bay.x < cells[id].x1) ? [j] : []);
  }
  // Minimum windowed capacity is checked structurally before exterior generation.
  for (const area of areas) {
    const daylight = cells.filter(c => area.columns.includes(c.col) && c.zone !== 'corridor' && !parts.some(part => part.cell === c.id) &&
      ((c.zone === 'front' && b.sides[0].kind !== 'party') || (c.zone === 'back' && b.sides[2].kind !== 'party')));
    const voidCount = daylight.filter(c => ballroomCells.includes(c.id)).length;
    if (daylight.length - voidCount < C.minApartmentCells) return { status: 'infeasible', message: `${area.coreId}：扣除核心／宴會廳挑空後，採光房間不足以配置客廳、廚房、廁所及臥室` };
  }
  const cores: TopologyCore[] = areas.map((a, i) => ({ id: a.coreId, kind: i === 0 ? 'main' : 'service',
    stairIds: parts.filter(q => q.coreId === a.coreId && q.role === 'stair').map(q => q.id),
    cellIds: parts.filter(q => q.coreId === a.coreId).map(q => coreCellId(q.cell)), fromLevel: 0, toLevel: p.floors + 1,
    position: parts.find(q => q.coreId === a.coreId)!.frame.origin, orientation: parts.find(q => q.coreId === a.coreId)!.frame.orientation,
    elevatorIds: parts.filter(q => q.coreId === a.coreId && q.role === 'elevator').map(q => q.id),
    hallIds: parts.filter(q => q.coreId === a.coreId && q.role === 'liftHall').map(q => q.id),
    shaftIds: parts.filter(q => q.coreId === a.coreId && q.role === 'shaft').map(q => q.id),
  }));
  const staircase = parts.filter(q => q.role === 'stair');
  const doorX = front.x0 + dims.bay * (b.door + 0.5);
  const mainCol = cols.findIndex(col => doorX > col.x0 && doorX < col.x1);
  return { status: 'ready', cores, layout: { parts, publicCells, serviceAreas: areas }, ballroom,
    grid: { W: b.width, L: b.length, cols, cells, inner: insetEdges(b.footprint, b.footprint.map(() => T))!,
      mainCol, cage: [staircase[0].cell], service: staircase[1] ? [staircase[1].cell] : null, cross: [], ballroom: ballroomCells } };
}
