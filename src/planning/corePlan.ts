/** Floor programming consumes the reserved P3 topology; it never moves cores or public circulation. */
import dims from '../../blender/kit_dims.json';
import type { Building } from '../generator';
import type { BuildingParams } from '../params';
import type { V2 } from '../roof';
import { buildingGrid, planLevels, facadeWindows, program, fuse, clipConvex, polygonArea, layoutStair, checkPlan,
  ROOM_INFO, type BuildingPlan, type PlanRoom, type PlanWall, type FloorProgramDiagnostic } from '../plan';
import type { CirculationMetadata } from './circulation';
import { sharedEdges, type Rect } from './edgeIndex';
import { varyApartment, type ProgramUnit } from './program';
import { coreLocal, rectLoop } from './cores';

const I = dims.interior, C = I.planning.cores, EPS = 1e-6;
const rect = (u: ProgramUnit): Rect => [u.x0, u.y0, u.x1, u.y1];
const equipment = (u: ProgramUnit) => u.type === 'elevator' || u.type === 'shaft';
const publicType = (u: ProgramUnit) => ['corridor', 'liftHall', 'vestibule', 'stair'].includes(u.type!);

export function buildCorePlan(b: Building, p: BuildingParams, retries: ReadonlyMap<number, number>, fallback: ReadonlySet<number>): BuildingPlan {
  const g = buildingGrid(b), levels = planLevels(b), windows = facadeWindows(g, levels), layout = b.topology.coreLayout!;
  const rooms: PlanRoom[] = [], walls: PlanWall[] = [], voids: BuildingPlan['voids'] = [];
  const diagnostics: FloorProgramDiagnostic[] = [], apartmentDiagnostics: string[] = [];
  const byCell = new Map(layout.parts.map(part => [part.cell, part]));
  const allStairRooms = new Map<string, PlanRoom[]>();
  let ballroomRoom: PlanRoom | null = null;
  const circulation: CirculationMetadata = { apartmentCounts: [], requiredStairs: p.floors >= C.doubleStairFrom ? 2 : 1, cores: structuredClone(b.topology.cores), apartmentDiagnostics };
  for (const lv of levels) {
    const eligible = lv.cls !== 'G' && lv.cls !== 'R' && !(b.ballroom && lv.index === 1);
    const variation = !!p.floorVariety && eligible && !fallback.has(lv.index);
    const ctx = { g, b, p, lv, windows, variation, retry: retries.get(lv.index) ?? 0, choices: [] as FloorProgramDiagnostic['choices'],
      units: g.cells.filter(c => !(b.ballroom && lv.index === 2 && g.ballroom.includes(c.id))).map(c => {
        const part = byCell.get(c.id);
        return { cells: [c], x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, apartment: null, win: [],
          type: part?.role ?? (layout.publicCells.includes(c.id) ? 'corridor' : null), part: part?.id } as ProgramUnit;
      }) };
    const levelWindows = windows.flatMap((w, i) => w.level === lv.index ? [i] : []);
    for (const wi of levelWindows) {
      const w = windows[wi], probe: V2 = [w.at[0] - w.dir[1] * 0.01, w.at[1] + w.dir[0] * 0.01];
      const u = ctx.units.find(u => probe[0] >= u.x0 - EPS && probe[0] <= u.x1 + EPS && probe[1] >= u.y0 - EPS && probe[1] <= u.y1 + EPS);
      if (u) u.win.push(wi);
      else if (ballroomRoom && lv.index === 2) { w.room = ballroomRoom.id; ballroomRoom.windows.push(wi); }
    }
    fuse(ctx, ctx.units.filter(u => u.type === 'corridor'), 'corridor');
    if (lv.cls === 'G') {
      const entry = ctx.units.find(u => u.win.some(i => windows[i].kind === 'door'));
      if (entry && !entry.type) entry.type = 'vestibule';
      for (const u of ctx.units) if (!u.type && u.win.some(i => windows[i].kind === 'shop')) u.type = 'shop';
    }
    if (b.ballroom && lv.index === 1) fuse(ctx, ctx.units.filter(u => u.cells.some(c => g.ballroom.includes(c.id))), 'ballroom');
    let apartment = 0;
    for (const area of layout.serviceAreas) {
      const before = apartment;
      const diagnosticBefore = apartmentDiagnostics.length;
      const belongs = (u: ProgramUnit) => u.cells.every(c => area.columns.includes(c.col));
      const available = ctx.units.filter(u => belongs(u) && u.type === null);
      const count = (us: ProgramUnit[]) => us.filter(u => u.win.length).length;
      const ballroom = ctx.units.find(u => u.type === 'ballroom' && belongs(u));
      const wanted = ballroom ? 1 : p.apartments === 'one' ? 1 : p.apartments === 'two' || area.columns.length >= I.twoFlatsBays ? 2 : 1;
      let groups = [available];
      if (wanted === 2) {
        const splits = area.columns.slice(1).map(col => [available.filter(u => u.cells.every(c => c.col < col)), available.filter(u => u.cells.every(c => c.col >= col))]);
        const legal = splits.filter(gs => gs.every(us => count(us) >= C.minApartmentCells));
        legal.sort((a, c) => Math.abs(a[0].length - a[1].length) - Math.abs(c[0].length - c[1].length));
        if (legal.length) groups = legal[0];
        else apartmentDiagnostics.push(`${lv.name} ${area.coreId}：要求 2 戶，容量不足，採 1 戶`);
      }
      for (const us of groups) {
        if (count(us) < C.minApartmentCells) {
          // Ground-floor actual shops/entrance are preserved; remaining service
          // rooms do not masquerade as a flat missing its essentials.
          for (const u of us) u.type = 'storage';
          apartmentDiagnostics.push(`${lv.name} ${area.coreId}：剩餘 ${count(us)} 間採光格，未配置住宅`);
          continue;
        }
        const ids = new Set(us.flatMap(u => u.cells.map(c => c.id)));
        const localStairs = layout.parts.filter(q => q.coreId === area.coreId && q.role === 'stair').map(q => q.cell);
        ctx.g = { ...g, cage: localStairs.slice(0, 1), service: localStairs.length > 1 ? localStairs.slice(1, 2) : null };
        program(ctx, ids, apartment);
        if (ballroom) ballroom.apartment = apartment;
        if (variation) varyApartment({ get units() { return ctx.units; }, choices: ctx.choices, windows,
          seed: p.seed, level: lv.index, retry: ctx.retry }, apartment, {
          interiorPoint: q => g.inner.every((a, i) => { const c = g.inner[(i + 1) % g.inner.length]; return (c[0] - a[0]) * (q[1] - a[1]) - (c[1] - a[1]) * (q[0] - a[0]) > EPS; }),
          fuse: (us, type) => fuse(ctx, us, type) });
        apartment++;
      }
      circulation.apartmentCounts.push({ level: lv.index, coreId: area.coreId, requested: wanted, actual: apartment - before,
        reason: ballroom ? "宴會廳服務區採一戶；其餘核心獨立分戶" : apartmentDiagnostics.slice(diagnosticBefore).join("；") || null });
    }
    if (lv.cls === 'R') for (const u of ctx.units) if (u.type === 'bedroom') u.type = 'maid';
    const units = ctx.units.sort((a, c) => a.y0 - c.y0 || a.x0 - c.x0);
    units.forEach((u, i) => u.id = `${lv.name}-${String(i + 1).padStart(2, '0')}`);
    const voidRects = b.ballroom && lv.index === 2 ? g.ballroom.map(id => [g.cells[id].x0, g.cells[id].y0, g.cells[id].x1, g.cells[id].y1] as Rect) : [];
    const edges = sharedEdges([...units.map(rect), ...voidRects]);
    const base = walls.length;
    for (const e of edges) {
      const a = units[e.i], v = units[e.j];
      if (!a) continue;
      const kind = a.type === 'stair' || v?.type === 'stair' || equipment(a) || (v && equipment(v)) || !v ? 'cage' :
        publicType(a) || (v && publicType(v)) || a.apartment !== v?.apartment ? 'spine' : 'partition';
      const w: PlanWall = { level: lv.index, a: e.a, b: e.b, kind, thickness: I.walls[kind], rooms: [a.id!, v?.id ?? null], openings: [] };
      walls.push(w);
      if (!v || equipment(a) || equipment(v) || (a.access && !a.access.includes(v)) || (v.access && !v.access.includes(a))) continue;
      if (a.apartment !== null && v.apartment !== null && a.apartment !== v.apartment) continue;
      // Shops cannot form a public bypass or a route through someone else's flat.
      if ((a.type === 'shop' || v.type === 'shop') && a.type !== v.type) continue;
      const stair = a.type === 'stair' ? a : v.type === 'stair' ? v : null;
      if (stair) {
        const other = stair === a ? v : a;
        if (!publicType(other) || other.type === 'stair') continue;
        const part = layout.parts.find(q => q.id === stair.part)!;
        const aa = coreLocal(part.frame, e.a), bb = coreLocal(part.frame, e.b);
        if (Math.abs(aa[1]) > EPS || Math.abs(bb[1]) > EPS) continue;
      }
      const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
      const [width, height] = I.doors[stair ? 'landing' : 'single'];
      if (len >= width + I.walls.spine + EPS) w.openings.push({ at: len / 2, width, height });
    }
    const floorWalls = walls.slice(base);
    for (const u of units) {
      const mine = floorWalls.filter(w => w.rooms.includes(u.id!));
      const inset = (axis: 0 | 1, value: number) => Math.max(0, ...mine.filter(w => Math.abs(w.a[axis] - w.b[axis]) < EPS && Math.abs(w.a[axis] - value) < EPS).map(w => w.thickness)) / 2;
      const polygon = clipConvex(rectLoop([u.x0 + inset(0, u.x0), u.y0 + inset(1, u.y0), u.x1 - inset(0, u.x1), u.y1 - inset(1, u.y1)]), g.inner);
      const part = layout.parts.find(q => q.id === u.part), type = u.type ?? 'storage';
      const r: PlanRoom = { id: u.id!, type, name: ROOM_INFO[type].name, level: lv.index, levels: type === 'ballroom' ? 2 : 1,
        apartment: u.apartment, rect: rect(u), polygon, area: polygonArea(polygon), floorZ: lv.floorZ,
        ceilingZ: type === 'ballroom' ? levels[lv.index + 1].ceilingZ : lv.ceilingZ,
        windows: [...u.win], doors: [], cellIds: [...new Set(u.cells.map(c => b.topology.cells[c.id].id))],
        circulation: equipment(u) ? 'equipment' : publicType(u) ? 'public' : 'private',
        ...(part ? { structuralId: part.id, coreId: part.coreId } : u.apartment !== null ? { coreId: layout.serviceAreas.find(a => u.cells.every(c => a.columns.includes(c.col)))?.coreId } : {}),
        ...(u.part ? { part: u.part } : {}), ...(u.access ? { programTargets: u.access.map(v => v.id!) } : {}) };
      for (const wi of u.win) { windows[wi].room = r.id; if (equipment(u)) windows[wi].openingRole = 'maintenance'; }
      floorWalls.forEach((w, wi) => {
        const other = w.rooms[0] === r.id ? w.rooms[1] : w.rooms[1] === r.id ? w.rooms[0] : null;
        if (other) for (const o of w.openings) r.doors.push({ wall: base + wi, ...o, to: other });
      });
      rooms.push(r);
      if (r.type === 'ballroom') ballroomRoom = r;
      if (r.type === 'stair') { const list = allStairRooms.get(part!.id) ?? []; list.push(r); allStairRooms.set(part!.id, list); }
      if (equipment(u)) voids.push({ level: lv.index, polygon, id: part!.id, kind: r.type as 'elevator' | 'shaft', ceiling: lv.cls !== 'R' });
    }
    if (b.ballroom && lv.index === 2 && ballroomRoom) voids.push({ level: lv.index, polygon: ballroomRoom.polygon });
    diagnostics.push({ level: lv.index, status: !eligible ? 'exempt' : fallback.has(lv.index) ? 'legacy-fallback' : 'varied',
      retries: ctx.retry, choices: ctx.choices, generatedSignature: '', rejectedIssues: [] });
  }
  const stairs = layout.parts.filter(q => q.role === 'stair').map(part => {
    const polygon = allStairRooms.get(part.id)![0].polygon;
    const local = polygon.map(q => coreLocal(part.frame, q));
    return { id: part.id, coreId: part.coreId, kind: 'main' as const, frame: structuredClone(part.frame),
      landingEdge: structuredClone(part.landingEdge!), polygon, from: 0, to: levels.length - 1,
      layout: layoutStair('main', local, -Infinity, levels, 0, levels.length - 1) };
  });
  // Elevator landing doors are rendered but never participate in the egress graph.
  for (const w of walls) {
    const pair = w.rooms.map(id => rooms.find(r => r.id === id));
    if (!pair.some(r => r?.type === 'elevator') || !pair.some(r => r?.type === 'liftHall')) continue;
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    if (len >= I.doors.landing[0] + I.walls.cage) w.openings.push({ at: len / 2, width: I.doors.landing[0], height: I.doors.landing[1], role: "equipment" });
  }
  const plan: BuildingPlan = { width: g.W, length: g.L, inner: g.inner.map(q => [...q]), levels, rooms, walls, windows, stairs, voids, circulation, issues: [] };
  plan.issues = [];
  if (p.floorVariety) plan.programDiagnostics = diagnostics;
  plan.issues = checkPlan(plan);
  return plan;
}
