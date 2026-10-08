/** Floor programming consumes the reserved P3 topology; it never moves cores or public circulation. */
import dims from '../../blender/kit_dims.json';
import type { Building } from '../generator';
import type { BuildingParams } from '../params';
import type { V2 } from '../roof';
import { buildingGrid, planLevels, facadeWindows, program, fuse, clipConvex, polygonArea, layoutStair, checkPlan,
  ROOM_INFO, type BuildingPlan, type PlanRoom, type PlanWall, type FloorProgramDiagnostic } from '../plan';
import type { CirculationMetadata } from './circulation';
import { sharedEdges, type Rect } from './edgeIndex';
import { varyApartment, assignTemplateProgram, compactLargeApartment, type ProgramUnit } from './program';
import { createProgramStructure, planTemplateGroups, contact } from './templates';
import { PURPOSE, rand } from '../rng';
import { coreLocal, coreWorld, rectLoop } from './cores';

const I = dims.interior, C = I.planning.cores, EPS = 1e-6;
const rect = (u: ProgramUnit): Rect => [u.x0, u.y0, u.x1, u.y1];
const equipment = (u: ProgramUnit) => u.type === 'elevator' || u.type === 'shaft';
const publicType = (u: ProgramUnit) => ['corridor', 'liftHall', 'vestibule', 'porch', 'stair'].includes(u.type!);

/** Each wall segment offsets its own edge; a thin private wall beside a public wall must retain a real doorway. */
function insetProgramRoom(u:ProgramUnit, walls:PlanWall[]): V2[] {
  const loop=rectLoop(rect(u));
  const edges=loop.map((a,i)=>{
    const b=loop[(i+1)%4],length=Math.hypot(b[0]-a[0],b[1]-a[1]),dir:V2=[(b[0]-a[0])/length,(b[1]-a[1])/length],normal:V2=[-dir[1],dir[0]];
    const along=(q:V2)=>(q[0]-a[0])*dir[0]+(q[1]-a[1])*dir[1];
    const mine=walls.filter(w=>Math.abs((w.a[0]-a[0])*normal[0]+(w.a[1]-a[1])*normal[1])<EPS&&Math.abs((w.b[0]-a[0])*normal[0]+(w.b[1]-a[1])*normal[1])<EPS);
    const cuts=[...new Set([0,length,...mine.flatMap(w=>[along(w.a),along(w.b)]).filter(v=>v>EPS&&v<length-EPS)])].sort((a,b)=>a-b);
    const pieces=cuts.slice(0,-1).map((start,k)=>({start,end:cuts[k+1],offset:Math.max(0,...mine.filter(w=>{const mid=(start+cuts[k+1])/2;return mid>Math.min(along(w.a),along(w.b))-EPS&&mid<Math.max(along(w.a),along(w.b))+EPS;}).map(w=>w.thickness/2))}));
    return {a,dir,normal,pieces};
  });
  const polygon:V2[]=[];
  edges.forEach((e,i)=>e.pieces.forEach((p,k)=>{
    const previous=edges[(i+3)%4],next=edges[(i+1)%4];
    const start=k===0?previous.pieces.at(-1)!.offset:0,end=k===e.pieces.length-1?next.pieces[0].offset:0;
    polygon.push([e.a[0]+e.dir[0]*(p.start+start)+e.normal[0]*p.offset,e.a[1]+e.dir[1]*(p.start+start)+e.normal[1]*p.offset],
      [e.a[0]+e.dir[0]*(p.end-end)+e.normal[0]*p.offset,e.a[1]+e.dir[1]*(p.end-end)+e.normal[1]*p.offset]);
  }));
  const clean=polygon.filter((p,i)=>Math.hypot(p[0]-polygon[(i+1)%polygon.length][0],p[1]-polygon[(i+1)%polygon.length][1])>EPS);
  return clean.filter((p,i)=>{
    const previous=clean[(i+clean.length-1)%clean.length],next=clean[(i+1)%clean.length];
    return Math.abs((p[0]-previous[0])*(next[1]-p[1])-(p[1]-previous[1])*(next[0]-p[0]))>EPS;
  });
}

export function buildCorePlan(b: Building, p: BuildingParams, retries: ReadonlyMap<number, number>, fallback: ReadonlySet<number>, templateOverrides: ReadonlyMap<string,string> = new Map()): BuildingPlan {
  const g = buildingGrid(b), levels = planLevels(b), windows = facadeWindows(g, levels), layout = b.topology.coreLayout!;
  const structure = p.floorVariety ? createProgramStructure(b,p) : undefined;
  const rooms: PlanRoom[] = [], walls: PlanWall[] = [], voids: BuildingPlan['voids'] = [];
  const daylightDiagnostics: NonNullable<BuildingPlan["daylightDiagnostics"]> = [];
  const diagnostics: FloorProgramDiagnostic[] = [], apartmentDiagnostics: string[] = [];
  const deep = b.topology.deepLayout, court = b.topology.courtyardLayout;
  const serviceCells = deep?.serviceCells ?? court?.serviceCells;
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
          type: part?.role ?? (court?.porchCells.includes(c.id) && lv.cls === 'G' ? 'porch' : layout.publicCells.includes(c.id) ? 'corridor' : serviceCells?.includes(c.id) ? (c.id % 3 === 0 ? 'bathroom' : c.id % 3 === 1 ? 'closet' : 'storage') : null), part: part?.id } as ProgramUnit;
      }) };
    const levelWindows = windows.flatMap((w, i) => w.level === lv.index ? [i] : []);
    for (const wi of levelWindows) {
      const w = windows[wi], probe: V2 = [w.at[0] - w.dir[1] * 0.01, w.at[1] + w.dir[0] * 0.01];
      const u = ctx.units.find(u => probe[0] >= u.x0 - EPS && probe[0] <= u.x1 + EPS && probe[1] >= u.y0 - EPS && probe[1] <= u.y1 + EPS);
      if (u) u.win.push(wi);
      else if (ballroomRoom && lv.index === 2) { w.room = ballroomRoom.id; ballroomRoom.windows.push(wi); }
    }
    if (deep) {
      const residential = ctx.units.filter(u => u.cells.some(c => deep.residentialCells.includes(c.id)));
      const blind = residential.filter(u => !u.win.length).length;
      daylightDiagnostics.push({ level: lv.index, residentialCells: residential.length, windowlessCells: blind, ratio: blind / residential.length, serviceArea: deep.daylight.serviceArea });
      for (const group of deep.groups) fuse(ctx, ctx.units.filter(u => u.type === 'corridor' && Math.abs(u.y0 - group.corridor[0]) < EPS && Math.abs(u.y1 - group.corridor[1]) < EPS), 'corridor');
    } else if (!court) fuse(ctx, ctx.units.filter(u => u.type === 'corridor'), 'corridor');
    if (lv.cls === 'G') {
      const entry = ctx.units.find(u => u.win.some(i => windows[i].kind === 'door'));
      if (entry && !entry.type) entry.type = 'vestibule';
      for (const u of ctx.units) if (!u.type && u.win.some(i => windows[i].kind === 'shop')) u.type = 'shop';
    }
    if (b.ballroom && lv.index === 1) fuse(ctx, ctx.units.filter(u => u.cells.some(c => g.ballroom.includes(c.id))), 'ballroom');
    const p6 = structure && eligible;
    if (p6 && deep) {
      const mode = Math.floor(rand(p.seed,lv.index,PURPOSE.planWellService,ctx.retry)*3);
      const palette = mode===0 ? ['bathroom','closet'] as const : mode===1 ? ['laundry','storage'] as const : ['storage'] as const;
      const services=ctx.units.filter(u=>u.cells.some(c=>deep.serviceCells.includes(c.id)));
      services.forEach((u,i)=>u.type=palette[i%palette.length]);
      ctx.choices.push({apartment:-1,feature:'D2',outcome:palette.join('+')});
    }
    const planned = p6 ? planTemplateGroups(b,p,lv,ctx.units,windows,structure,templateOverrides) : undefined;
    const templateByUnit = new Map(planned?.flatMap(group=>group.units.map(u=>[u,group] as const)));
    const pending: { apartment: number; choice: NonNullable<ReturnType<typeof templateByUnit.get>> }[] = [];
    const apartmentCore = new Map<number, string>();
    let apartment = 0;
    for (const [areaIndex,area] of layout.serviceAreas.entries()) {
      const before = apartment;
      const diagnosticBefore = apartmentDiagnostics.length;
      const belongs = (u: ProgramUnit) => u.cells.every(c => area.cellIds ? area.cellIds.includes(c.id) : area.columns.includes(c.col));
      const available = ctx.units.filter(u => belongs(u) && u.type === null);
      const count = (us: ProgramUnit[]) => us.filter(u => u.win.length).length;
      const ballroom = ctx.units.find(u => u.type === 'ballroom' && belongs(u));
      const templateDecision = planned ? structure!.templates.find(t=>t.level===lv.index&&t.coreId===area.coreId&&t.area===(area.moduleId??area.coreId))! : undefined;
      const wanted = templateDecision ? templateDecision.requested==='C'?3:templateDecision.requested==='B'?2:1 : ballroom ? 1 : p.apartments === 'one' ? 1 : p.apartments === 'two' || area.columns.length >= I.twoFlatsBays ? 2 : 1;
      let groups = planned ? planned.filter(g=>g.area===areaIndex).map(g=>g.units) : [available];
      if (!planned && wanted === 2) {
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
        apartmentCore.set(apartment, area.coreId);
        const choice=templateByUnit.get(us[0]);
        const serviceCourt=!!court&&rand(p.seed,lv.index,choice?.randomKey??apartment,PURPOSE.planCourtPreference,ctx.retry)<0.5;
        if(choice) {
          templateDecision!.apartmentIds.push(apartment);
          pending.push({apartment,choice});
          assignTemplateProgram({...ctx, get units(){return ctx.units;}, seed:p.seed,level:lv.index},us,apartment,choice.template,
            {randomKey:choice.randomKey,internal:choice.internal,serviceCourt,corner:choice.corner},(us,t)=>fuse(ctx,us,t));
          if(court)ctx.choices.push({apartment,feature:'W3',outcome:court.wings.find(w=>w.id===area.moduleId)?.single?'盲翼朝中庭，不參加 W3':serviceCourt?'中庭側廚房／服務優先':'中庭側臥室優先'});
        } else program(ctx, ids, apartment);
        if (ballroom) ballroom.apartment = apartment;
        if (variation && !planned) varyApartment({ get units() { return ctx.units; }, choices: ctx.choices, windows,
          seed: p.seed, level: lv.index, retry: ctx.retry, randomKey: choice?.randomKey, allowReceptionMerge: choice?.template !== "C", roomLimit: choice?.template === "A" ? I.planning.templates.maxLargeCells : undefined }, apartment, {
          interiorPoint: q => g.inner.every((a, i) => { const c = g.inner[(i + 1) % g.inner.length]; return (c[0] - a[0]) * (q[1] - a[1]) - (c[1] - a[1]) * (q[0] - a[0]) > EPS; }),
          fuse: (us, type) => fuse(ctx, us, type) });
        apartment++;
      }
      circulation.apartmentCounts.push({ ...(area.moduleId ? { moduleId: area.moduleId } : {}), level: lv.index, coreId: area.coreId, requested: wanted, actual: apartment - before,
        reason: planned ? structure!.templates.find(t=>t.level===lv.index&&t.coreId===area.coreId&&t.area===(area.moduleId??area.coreId))!.reason : ballroom ? "宴會廳服務區採一戶；其餘核心獨立分戶" : apartmentDiagnostics.slice(diagnosticBefore).join("；") || null });
    }
    if (deep || court) {
      // A service component either opens to public circulation or belongs to
      // one adjacent flat. A shared wet room must never require entering a flat.
      const edges = sharedEdges(ctx.units.map(rect)), service = new Set(ctx.units.flatMap((u, i) => u.cells.some(c => serviceCells!.includes(c.id)) ? [i] : []));
      const neighbours = (i: number) => edges.filter(e => (e.i === i || e.j === i) && Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) >= I.doors.single[0] + I.walls.spine + EPS).map(e => e.i === i ? e.j : e.i);
      while (service.size) {
        const component = [service.values().next().value!]; service.delete(component[0]);
        for (let k = 0; k < component.length; k++) for (const j of neighbours(component[k])) if (service.delete(j)) component.push(j);
        const adjacent = [...new Set(component.flatMap(neighbours))].filter(i => !component.includes(i));
        if (adjacent.some(i => publicType(ctx.units[i]) && ctx.units[i].type !== 'stair')) continue;
        const landings = layout.parts.filter(part => part.role === 'stair').map(part => coreWorld(part.frame, [(part.localRect[2] - part.localRect[0]) / 2, 0]));
        const owners = adjacent.map(i => ctx.units[i]).filter(u => u.apartment !== null && !equipment(u) && !u.access);
        const nearLanding = (u: ProgramUnit) => Math.min(...landings.map(q => Math.hypot((u.x0 + u.x1) / 2 - q[0], (u.y0 + u.y1) / 2 - q[1])));
        const fixedDistance = (u:ProgramUnit) => {
          const original=pending.find(q=>q.apartment===u.apartment)?.choice.units.filter(v=>component.some(i=>contact(v,ctx.units[i])))??[];
          return Math.min(...original.map(nearLanding));
        };
        owners.sort((a,c)=>planned ? fixedDistance(a)-fixedDistance(c)||a.apartment!-c.apartment! : nearLanding(a)-nearLanding(c));
        const owner = owners[0];
        if (owner) for (const i of component) ctx.units[i].apartment = owner.apartment;
      }
    }
    for(const {apartment:apt,choice} of pending) {
      if(choice.template==='A')compactLargeApartment(ctx,apt,(us,t)=>fuse(ctx,us,t));
      if(variation)varyApartment({get units(){return ctx.units;},choices:ctx.choices,windows,seed:p.seed,level:lv.index,retry:ctx.retry,
        randomKey:choice.randomKey,allowReceptionMerge:choice.template!=='C',roomLimit:choice.template==='A'?I.planning.templates.maxLargeCells:undefined},apt,{
        interiorPoint:q=>g.inner.every((a,i)=>{const c=g.inner[(i+1)%g.inner.length];return (c[0]-a[0])*(q[1]-a[1])-(c[1]-a[1])*(q[0]-a[0])>EPS;}),
        fuse:(us,t)=>fuse(ctx,us,t)
      });
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
      const porchPass = lv.cls === 'G' && (a.type === 'porch' && v.type === 'corridor' || v.type === 'porch' && a.type === 'corridor');
      const [width, height] = porchPass ? [dims.ground.door.width, dims.ground.door.spring] : I.doors[stair ? 'landing' : 'single'];
      if (len >= width + I.walls.spine + EPS) w.openings.push({ at: len / 2, width, height });
    }
    const floorWalls = walls.slice(base);
    for (const u of units) {
      const mine = floorWalls.filter(w => w.rooms.includes(u.id!));
      const inset = (axis: 0 | 1, value: number) => Math.max(0, ...mine.filter(w => Math.abs(w.a[axis] - w.b[axis]) < EPS && Math.abs(w.a[axis] - value) < EPS).map(w => w.thickness)) / 2;
      const polygon = clipConvex(planned && !publicType(u) && !equipment(u) ? insetProgramRoom(u,mine) : rectLoop([u.x0 + inset(0, u.x0), u.y0 + inset(1, u.y0), u.x1 - inset(0, u.x1), u.y1 - inset(1, u.y1)]), g.inner);
      const part = layout.parts.find(q => q.id === u.part), type = u.type ?? 'storage';
      const r: PlanRoom = { id: u.id!, type, name: ROOM_INFO[type].name, level: lv.index, levels: type === 'ballroom' ? 2 : 1,
        apartment: u.apartment, rect: rect(u), polygon, area: polygonArea(polygon), floorZ: lv.floorZ,
        ceilingZ: type === 'ballroom' ? levels[lv.index + 1].ceilingZ : lv.ceilingZ,
        windows: [...u.win], doors: [], cellIds: [...new Set(u.cells.map(c => b.topology.cells[c.id].id))],
        circulation: equipment(u) ? 'equipment' : publicType(u) ? 'public' : 'private',
        ...(type === "porch" ? { structuralId: `court:porch:${u.cells[0].id}` } : {}),
        ...(part ? { structuralId: part.id, coreId: part.coreId } : u.apartment !== null ? { coreId: apartmentCore.get(u.apartment) } : {}),
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
    if (court) voids.push({ level: lv.index, id: 'court:sky', kind: 'courtyard', polygon: court.polygon.map(q => [...q]), ceiling: true, openBoundary: court.shape === 'U' });
    if (deep) for (const well of deep.wells) voids.push({ level: lv.index, id: well.id, kind: 'lightwell', polygon: well.polygon.map(q => [...q]), ceiling: true });
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
  const plan: BuildingPlan = { ...(court ? { courtyard: { shape: court.shape, polygon: court.polygon, minimum: court.minimum, blindWingCells: court.wings.filter(w => w.single).map(w => w.cellIds.map(id => b.topology.cells[id].id)), porchCells: court.porchCells.map(id => b.topology.cells[id].id) }, innerBoundaries: court.shape === "O" ? [{ id: "court:sky", polygon: court.innerBoundary }] : [] } : {}), ...(deep ? { daylightDiagnostics, innerBoundaries: deep.wells.map(w => ({ id: w.id, polygon: [[w.rect[0] - dims.wall, w.rect[3] + dims.wall], [w.rect[2] + dims.wall, w.rect[3] + dims.wall], [w.rect[2] + dims.wall, w.rect[1] - dims.wall], [w.rect[0] - dims.wall, w.rect[1] - dims.wall]] as V2[] })) } : {}), width: g.W, length: g.L, inner: (court?.inner ?? g.inner).map(q => [...q]), levels, rooms, walls, windows, stairs, voids, circulation, issues: [] };
  plan.issues = [];
  if (p.floorVariety) plan.programDiagnostics = diagnostics;
  if (structure) plan.programStructure = structure;
  plan.issues = checkPlan(plan);
  return plan;
}
