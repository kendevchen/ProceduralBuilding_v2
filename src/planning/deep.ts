/** P4: enumerate aligned room groups and sky-open well rows before programming. */
import { Matrix4 } from 'three';
import dims from '../../blender/kit_dims.json';
import type { BuildingParams } from '../params';
import type { FacadeSegment, TopologyCore } from '../buildingTopology';
import type { Cell, GridEnvelope, LegacyGrid } from './legacyGrid';
import { insetEdges, type V2 } from '../roof';
import { coreCellId, coreWorld, rectLoop, type CoreLayout, type CorePart } from './cores';
import type { Rect } from './edgeIndex';
const I = dims.interior, C = I.planning.cores, D = I.planning.deep, T = dims.wall, B = dims.bay, EPS = 1e-6;
export interface DeepWell { id: string; row: number; polygon: V2[]; rect: Rect; facadeIds: string[] }
export interface DeepLayout {
  wells: DeepWell[]; wellDepth: number;
  groups: { id: string; y0: number; y1: number; corridor: [number, number]; cellIds: number[] }[];
  residentialCells: number[]; serviceCells: number[];
  daylight: { residentialCells: number; windowlessCells: number; ratio: number; serviceArea: number };
}
/** Intersect a convex footprint with a module's two horizontal band limits. */
export function deepModulePolygon(poly: V2[], y0: number, y1: number): V2[] {
  let result = poly;
  for (const side of [(q: V2) => q[1] - y0, (q: V2) => y1 - q[1]]) {
    const input = result; result = [];
    input.forEach((a, i) => {
      const b = input[(i + 1) % input.length], da = side(a), db = side(b);
      if (da >= 0) result.push([...a]);
      if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); result.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); }
    });
  }
  return result;
}
export type DeepCandidate = { status: 'ready'; grid: LegacyGrid; cores: TopologyCore[]; layout: CoreLayout;
  deep: DeepLayout; facades: FacadeSegment[]; ballroom: number[] | null } | { status: 'infeasible'; message: string };
export function resolveDeep(b: GridEnvelope, p: BuildingParams, wallTop: number): DeepCandidate {
  const front = b.sides[0], xs = [T];
  if (front.left === 'pc') xs.push(front.x0);
  for (let j = 1; j < front.bays.length; j++) xs.push(front.x0 + B * j);
  if (front.right === 'pc') xs.push(front.x0 + B * front.bays.length);
  xs.push(b.width - T);
  const cols = xs.slice(0, -1).map((x0, i) => ({ x0, x1: xs[i + 1], end: null }));
  if (cols.length < C.minColumns) return { status: 'infeasible', message: '深平面寬度不足以同時保留採光井、公共連通及有效核心' };
  const wellDepth = Math.ceil(Math.max(D.minWell, D.heightFactor * wallTop) / B) * B;
  const maxGroups = 1 + Math.floor((b.length - 2 * T - D.firstGroup) / (wellDepth + D.nextGroup));
  const side = b.sides.find((s, i) => i % 2 === 1 && s.kind !== 'party');
  const centres = (side ? side.bays.map(q => side.frame[1] * q.x + side.frame[13]) :
    Array.from({ length: p.baysY }, (_, i) => dims.endPier + B * (i + 0.5))).sort((a, c) => a - c);
  // Even on party sides the room bands use the shared three-metre pier lattice.
  const lattice = side ? centres[0] - B / 2 : dims.endPier;
  const low = centres.filter(y => y - D.corridor / 2 - T >= I.bands.minFront && b.length - T - y - D.corridor / 2 >= I.bands.minBack);
  for (let count = maxGroups; count >= 2; count--) {
    if (low.length < count) continue;
    const chosen: number[] = [];
    for (let i = 0; i < count; i++) {
      const target = low[0] + (low.at(-1)! - low[0]) * i / (count - 1);
      const legal = low.filter(y => !chosen.length || y - chosen.at(-1)! >= wellDepth + 2 * (D.minBand + T) + D.corridor - EPS);
      if (!legal.length) break;
      chosen.push(legal.reduce((a, c) => Math.abs(c - target) < Math.abs(a - target) ? c : a));
    }
    if (chosen.length !== count) continue;
    const wellRows = chosen.slice(0, -1).map((y, i) => {
      const min = y + D.corridor / 2 + D.minBand + T;
      const start = lattice + Math.ceil((min - lattice - EPS) / B) * B;
      return [start, start + wellDepth] as [number, number];
    });
    if (wellRows.some((r, i) => chosen[i + 1] - D.corridor / 2 - r[1] - T < D.minBand - EPS)) continue;
    const cells: Cell[] = [], parts: CorePart[] = [], publicCells: number[] = [], serviceCells: number[] = [], residentialCells: number[] = [];
    const wells: DeepWell[] = [], facades: FacadeSegment[] = [], cores: TopologyCore[] = [];
    const groups: DeepLayout['groups'] = chosen.map((y, i) => ({ id: `deep:group:${i}`,
      y0: i ? wellRows[i - 1][1] + T : T, y1: i < count - 1 ? wellRows[i][0] - T : b.length - T,
      corridor: [y - D.corridor / 2, y + D.corridor / 2], cellIds: [] }));
    const add = (col: number, r: Rect, zone: Cell['zone'], kind: 'public' | 'service' | 'residential' | 'part', group?: number) => {
      const id = cells.length; cells.push({ id, col, x0: r[0], y0: r[1], x1: r[2], y1: r[3], zone });
      if (kind === 'public') publicCells.push(id); if (kind === 'service') serviceCells.push(id); if (kind === 'residential') residentialCells.push(id);
      if (group !== undefined) groups[group].cellIds.push(id); return id;
    };
    const coreColumns = p.floors >= C.doubleLiftFrom ? 4 : 2;
    const connectors = [...new Set([1, cols.length - 2, ...(p.floors >= C.doubleStairFrom && cols.length >= D.doubleCoreColumns ? [2 + coreColumns, cols.length - 3 - coreColumns] : [])])], width = wellDepth > D.wideFrom ? 2 : 1;
    const reserved: Map<number, { core: string; role: 'stair' | 'elevator'; num: number }>[] = [];
    let failed = false;
    for (let row = 0; row < wellRows.length; row++) {
      const n = p.floors >= C.doubleLiftFrom ? (cols.length >= D.doubleCoreColumns ? 2 : 1) : p.floors >= C.doubleStairFrom ? 2 : Math.ceil(cols.length / D.serviceColumns);
      const stairs = p.floors >= C.doubleLiftFrom ? 2 : 1, lifts = p.floors >= C.doubleLiftFrom ? 2 : p.floors >= C.doubleStairFrom ? 1 : 0;
      const usable = cols.flatMap((c, i) => i > 1 && i < cols.length - 2 && !connectors.includes(i) && c.x1 - c.x0 >= B - EPS ? [i] : []);
      const used = new Map<number, { core: string; role: 'stair' | 'elevator'; num: number }>();
      for (let core = 0; core < n; core++) {
        const id = `deep:row:${row}:core:${core}`, take = core === 0 ? usable.slice(0, stairs + lifts) : usable.slice(-stairs - lifts);
        if (take.length !== stairs + lifts || take.some(col => used.has(col))) { failed = true; break; }
        take.forEach((col, j) => used.set(col, { core: id, role: j < stairs ? 'stair' : 'elevator', num: j < stairs ? j : j - stairs }));
      }
      reserved.push(used);
      // Pack well widths after reserving the real cores and both public connectors.
      const holeCols: number[] = [];
      for (let col = 2; col + width <= cols.length - 2; col++) {
        if (Array.from({ length: width }, (_, j) => col + j).some(c => used.has(c) || connectors.includes(c) || used.has(c - 1) || used.has(c + 1))) continue;
        holeCols.push(col); col += width; // one structural bay between holes
      }
      if (!holeCols.length) { failed = true; break; }
      for (const col of holeCols) {
        const [y0, y1] = wellRows[row], r: Rect = [cols[col].x0, y0, cols[col + width - 1].x1, y1];
        const id = `deep:well:${r.join(',')}`; // geometry identity prevents overrides moving to a different well
        const loop = rectLoop(r).reverse(), facadeIds: string[] = [];
        loop.forEach((a, i) => {
          const c = loop[(i + 1) % 4], len = Math.hypot(c[0] - a[0], c[1] - a[1]), angle = Math.atan2(c[1] - a[1], c[0] - a[0]);
          const frame = new Matrix4().makeRotationZ(angle).setPosition(a[0], a[1], 0), e = frame.elements;
          const fid = `${id}:face:${i}`; facadeIds.push(fid);
          facades.push({ id: fid, side: 4 + facades.length, kind: 'court', left: 'none', right: 'none', length: len,
            start: a, end: c, along: [e[0], e[1]], inward: [e[4], e[5]], frame: frame.toArray(), x0: 0,
            bays: Array.from({ length: Math.round(len / B) }, (_, bay) => ({ id: `${fid}:bay:${bay}`, bay, x: B * (bay + 0.5) })), diagonal: null });
        });
        wells.push({ id, row, rect: r, polygon: rectLoop(r), facadeIds });
      }
      const [wy0, wy1] = wellRows[row];
      const rowHoles = wells.filter(w => w.row === row);
      for (let col = 0; col < cols.length; col++) {
        const c = cols[col], spec = used.get(col);
        if (rowHoles.some(w => c.x0 >= w.rect[0] - EPS && c.x1 <= w.rect[2] + EPS)) continue;
        if (spec) {
          // Short low wells share the preceding room band with the stair cage.
          const start = wellDepth < C.minStairDepth ? groups[row].corridor[1] : wy0 - T;
          if (wellDepth >= C.minStairDepth) add(col, [c.x0, groups[row].corridor[1], c.x1, wy0 - T], 'back', 'public', row);
          const reverse = wellDepth >= C.minStairDepth && row % 2 === 1;
          const frame = { origin: (reverse ? [c.x1, wy1 + T] : [c.x0, start]) as V2, orientation: reverse ? Math.PI : 0 }, length = wy1 + T - start;
          if (wellDepth >= C.minStairDepth) add(col, [c.x0, wy1 + T, c.x1, groups[row + 1].corridor[0]], "front", "public", row + 1);
          const addPart = (role: CorePart['role'], local: Rect) => {
            const ps = rectLoop(local).map(q => coreWorld(frame, q));
            const cell = add(col, [Math.min(...ps.map(q => q[0])), Math.min(...ps.map(q => q[1])), Math.max(...ps.map(q => q[0])), Math.max(...ps.map(q => q[1]))], 'core', role === 'liftHall' ? 'public' : 'part');
            parts.push({ id: `${spec.core}:${role}:${spec.num}`, coreId: spec.core, role, cell, frame, localRect: local,
              ...(role === 'stair' ? { landingEdge: [coreWorld(frame, [0, 0]), coreWorld(frame, [c.x1 - c.x0, 0])] as [V2, V2] } : {}) });
          };
          if (spec.role === 'stair') addPart('stair', [0, 0, c.x1 - c.x0, length]);
          else {
            const end = C.liftHallDepth + C.liftClearDepth + I.walls.cage;
            addPart('liftHall', [0, 0, c.x1 - c.x0, C.liftHallDepth]);
            addPart('elevator', [0, C.liftHallDepth, c.x1 - c.x0, end]);
            addPart('shaft', [0, end, c.x1 - c.x0, length]);
          }
        } else if (connectors.includes(col)) add(col, [c.x0, wy0 - T, c.x1, wy1 + T], 'core', 'public');
        else {
          const x0 = c.x0 + (rowHoles.some(w => Math.abs(w.rect[2] - c.x0) < EPS) ? T : 0);
          const x1 = c.x1 - (rowHoles.some(w => Math.abs(w.rect[0] - c.x1) < EPS) ? T : 0);
          for (let k = 0; k < wellDepth / B; k++) add(col, [x0, k ? wy0 + B * k : wy0 - T, x1, k + 1 < wellDepth / B ? wy0 + B * (k + 1) : wy1 + T], 'core', 'service');
        }
      }
    }
    if (failed) continue;
    for (let m = 0; m < count; m++) {
      const group = groups[m];
      for (let col = 0; col < cols.length; col++) add(col, [cols[col].x0, group.corridor[0], cols[col].x1, group.corridor[1]], 'corridor', 'public', m);
      for (const band of ['front', 'back'] as const) {
        const y0 = band === 'front' ? group.y0 : group.corridor[1], y1 = band === 'front' ? group.corridor[0] : group.y1;
        const available: number[] = [];
        for (let col = 0; col < cols.length; col++) {
          if (band === 'back' && m < count - 1 && reserved[m].has(col) || band === 'front' && m > 0 && wellDepth >= C.minStairDepth && reserved[m - 1].has(col)) continue;
          if (connectors.includes(col)) add(col, [cols[col].x0, y0, cols[col].x1, y1], band, 'public', m);
          else available.push(col);
        }
        // Divide each contiguous residential run at daylight centres. No blind
        // cell is relabelled after program(); each structural room owns a window.
        const windowed = (col: number) => {
          if (col === 0 && b.sides[3].kind !== 'party' || col === cols.length - 1 && b.sides[1].kind !== 'party') return true;
          if (band === 'front' && m === 0) return b.sides[0].kind !== 'party';
          if (band === 'back' && m === count - 1) return b.sides[2].kind !== 'party';
          const row = band === 'front' ? m - 1 : m;
          return wells.some(w => w.row === row && cols[col].x0 >= w.rect[0] - EPS && cols[col].x1 <= w.rect[2] + EPS);
        };
        while (available.length) {
          const run = [available.shift()!]; while (available.length && available[0] === run.at(-1)! + 1) run.push(available.shift()!);
          const lit = run.filter(windowed);
          if (!lit.length) {
            if (run.length === 1 && (run[0] === 0 || run[0] === cols.length - 1)) {
              add(run[0], [cols[run[0]].x0, y0, cols[run[0]].x1, y1], band, 'service', m); continue;
            }
            failed = true; break;
          }
          let first = 0;
          lit.forEach((light, j) => {
            const end = j + 1 < lit.length ? Math.floor((run.indexOf(light) + run.indexOf(lit[j + 1])) / 2) + 1 : run.length;
            add(run[first], [cols[run[first]].x0, y0, cols[run[end - 1]].x1, y1], band, 'residential', m); first = end;
          });
        }
      }
    }
    if (failed) continue;
    for (const id of [...new Set(parts.map(part => part.coreId))]) {
      const mine = parts.filter(q => q.coreId === id);
      cores.push({ id, kind: cores.length ? 'service' : 'main', stairIds: mine.filter(q => q.role === 'stair').map(q => q.id), cellIds: mine.map(q => coreCellId(q.cell)),
        elevatorIds: mine.filter(q => q.role === 'elevator').map(q => q.id), hallIds: mine.filter(q => q.role === 'liftHall').map(q => q.id), shaftIds: mine.filter(q => q.role === 'shaft').map(q => q.id),
        fromLevel: 0, toLevel: p.floors + 1, position: mine[0].frame.origin, orientation: mine[0].frame.orientation });
    }
    const stairs = parts.filter(q => q.role === 'stair'), doorX = front.x0 + B * (b.door + 0.5);
    const mainCol = cols.findIndex(c => doorX > c.x0 && doorX < c.x1);
    const serviceAreas = groups.flatMap((group, i) => {
      const nearby = cores.filter(core => core.id.startsWith(`deep:row:${Math.min(i, wellRows.length - 1)}:`));
      return nearby.map((core, j) => {
        const lo = Math.floor(j * cols.length / nearby.length), hi = Math.floor((j + 1) * cols.length / nearby.length);
        return { moduleId: group.id, coreId: core.id, columns: Array.from({ length: hi - lo }, (_, k) => lo + k),
          cellIds: group.cellIds.filter(id => { const c = cells[id], mid = (c.x0 + c.x1) / 2; return mid >= cols[lo].x0 - EPS && mid < cols[hi - 1].x1 + EPS; }) };
      });
    });
    const deep: DeepLayout = { wells, groups, wellDepth, residentialCells, serviceCells, daylight: { residentialCells: residentialCells.length, windowlessCells: 0, ratio: 0,
      serviceArea: serviceCells.reduce((a, id) => a + (cells[id].x1 - cells[id].x0) * (cells[id].y1 - cells[id].y0), 0) } };
    return { status: 'ready', ballroom: null, facades, cores, layout: { parts, publicCells, serviceAreas }, deep,
      grid: { W: b.width, L: b.length, cols, cells, inner: insetEdges(b.footprint, b.footprint.map(() => T))!, mainCol, cage: [stairs[0].cell], service: stairs[1] ? [stairs[1].cell] : null, cross: [], ballroom: [] } };
  }
  return { status: 'infeasible', message: `對齊後無法同時容納至少兩組房間、${wellDepth} m 通天井列、公共連通與有效核心；未以無窗住宅替代` };
}
