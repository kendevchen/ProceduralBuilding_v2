/** Geometry-weighted door graph. Elevator shafts and other households are never transit nodes. */
import dims from '../../blender/kit_dims.json';
import { edgeAt, type BuildingPlan, type PlanRoom, type PlanDoor, type PlanStair } from '../plan';
import type { TopologyCore } from '../buildingTopology';
import type { V2 } from '../roof';
import { inRoom, roomContains } from '../roomGeometry';
import { coreWorld, coreLocal, rectLoop } from './cores';

const EPS = 1e-6, C = dims.interior.planning.cores;
export interface CirculationMetadata { requiredStairs: number; cores: TopologyCore[]; apartmentDiagnostics: string[]; apartmentCounts: { moduleId?: string; level: number; coreId: string; requested: number; actual: number; reason: string | null }[] }
const onLandingEdge = (s: PlanStair, at: V2): boolean => {
  if (!s.landingEdge) return false;
  const [a, b] = s.landingEdge, dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  const t = ((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / (len * len);
  return len > EPS && t >= -EPS && t <= 1 + EPS && Math.abs((at[0] - a[0]) * dy - (at[1] - a[1]) * dx) / len <= EPS;
};
const distance = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const publicRoom = (r: PlanRoom) => r.circulation === 'public' && ['corridor', 'vestibule', 'liftHall', 'stair'].includes(r.type);
const equipment = (r: PlanRoom) => r.type === 'elevator' || r.type === 'shaft';
const insideSegment = (poly: V2[], a: V2, b: V2) => roomContains(poly, [a, b]);

/** Exact polygon visibility route for a point pair; samples select origins, not path feasibility. */
export function polygonRoute(poly: V2[], start: V2, end: V2): number {
  if (!inRoom(poly, start) || !inRoom(poly, end)) return Infinity;
  if (insideSegment(poly, start, end)) return distance(start, end);
  const points = [start, end, ...poly], ds = points.map(() => Infinity), visited = new Set<number>();
  ds[0] = 0;
  while (visited.size < points.length) {
    let at = -1;
    ds.forEach((d, i) => { if (!visited.has(i) && (at < 0 || d < ds[at])) at = i; });
    if (at < 0 || !Number.isFinite(ds[at])) return Infinity;
    if (at === 1) return ds[1];
    visited.add(at);
    for (let i = 0; i < points.length; i++) if (!visited.has(i) && insideSegment(poly, points[at], points[i])) ds[i] = Math.min(ds[i], ds[at] + distance(points[at], points[i]));
  }
  return Infinity;
}

function landingPolygon(s: PlanStair): V2[] {
  const r = s.layout.rect;
  const local = rectLoop([r[0], r[1], r[2], r[1] + s.layout.landing]);
  return s.frame ? local.map(q => coreWorld(s.frame!, q)) : local;
}
function threshold(poly: V2[], at: V2): V2 {
  if (inRoom(poly, at)) return at;
  let closest: V2 = at, best = Infinity;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length], len = distance(a, b);
    const t = len ? Math.max(0, Math.min(1, ((at[0] - a[0]) * (b[0] - a[0]) + (at[1] - a[1]) * (b[1] - a[1])) / len ** 2)) : 0;
    const q: V2 = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    if (distance(q, at) < best) { best = distance(q, at); closest = q; }
  });
  return closest;
}
function doorPoint(plan: BuildingPlan, door: PlanDoor): V2 {
  const w = plan.walls[door.wall], len = distance(w.a, w.b);
  return [w.a[0] + (w.b[0] - w.a[0]) * door.at / len, w.a[1] + (w.b[1] - w.a[1]) * door.at / len];
}
interface Node { room: PlanRoom; at: V2; exit?: boolean }
interface Graph { nodes: Node[]; links: { to: number; weight: number }[][]; byRoom: Map<string, number[]>; polygons: Map<string, V2[]> }
function buildGraph(plan: BuildingPlan, issues: string[]): Graph {
  const byId = new Map(plan.rooms.map(r => [r.id, r])), nodes: Node[] = [], links: Graph['links'] = [], byRoom = new Map<string, number[]>();
  const polygons = new Map(plan.rooms.map(r => [r.id, r.type === 'stair' ? landingPolygon(plan.stairs.find(s => s.id === r.structuralId)!) : r.polygon]));
  const add = (room: PlanRoom, at: V2, exit = false) => {
    const i = nodes.length; nodes.push({ room, at: threshold(polygons.get(room.id)!, at), exit }); links.push([]);
    const list = byRoom.get(room.id) ?? []; list.push(i); byRoom.set(room.id, list); return i;
  };
  const link = (a: number, b: number, weight: number) => { links[a].push({ to: b, weight }); links[b].push({ to: a, weight }); };
  const seen = new Set<string>();
  for (const r of plan.rooms) for (const d of r.doors) {
    const other = byId.get(d.to), w = plan.walls[d.wall];
    const reverse = other?.doors.find(o => o.to === r.id && o.wall === d.wall && Math.abs(o.at - d.at) < EPS && o.width === d.width && o.height === d.height);
    if (!w || !other || !reverse || !w.rooms.includes(r.id) || !w.rooms.includes(other.id) ||
      !w.openings.some(o => o.at === d.at && o.width === d.width && o.height === d.height) ||
      d.at - d.width / 2 < -EPS || d.at + d.width / 2 > distance(w.a, w.b) + EPS) {
      issues.push(`${plan.levels[r.level].name}：門 ${r.id}/${d.to} 共牆／雙側參照無效`); continue;
    }
    if (equipment(r) || equipment(other) || w.openings.some(o => o.at === d.at && o.role === "equipment")) { issues.push(`${plan.levels[r.level].name}：設備井不可作通行門`); continue; }
    if (r.level !== other.level) { issues.push('房間門不可跨樓層'); continue; }
    if (r.apartment !== null && other.apartment !== null && r.apartment !== other.apartment) { issues.push(`${plan.levels[r.level].name}：門穿越不同住戶`); continue; }
    const at = doorPoint(plan, d);
    // Both room contours must actually border this wall, within half its thickness.
    if (distance(threshold(r.polygon, at), at) > w.thickness / 2 + C.routeInset || distance(threshold(other.polygon, at), at) > w.thickness / 2 + C.routeInset) {
      issues.push(`${plan.levels[r.level].name}：門未連接實際房間輪廓`); continue;
    }
    const key = [r.id, other.id].sort().join('|') + `|${d.wall}|${d.at}`;
    if (seen.has(key)) continue; seen.add(key);
    const a = add(r, at), b = add(other, at); link(a, b, distance(nodes[a].at, nodes[b].at));
  }
  for (const r of plan.rooms) if (r.level === 0 && publicRoom(r)) {
    for (const wi of r.windows) {
      const w = plan.windows[wi];
      if (w?.room === r.id && w.level === 0 && w.kind === 'door' && !w.openingRole && edgeAt(plan.inner, w.at) >= 0 && distance(threshold(polygons.get(r.id)!, w.at), w.at) <= dims.wall) add(r, w.at, true);
    }
  }
  for (const [id, indices] of byRoom) for (let i = 0; i < indices.length; i++) for (let j = i + 1; j < indices.length; j++) {
    const a = indices[i], b = indices[j], path = polygonRoute(polygons.get(id)!, nodes[a].at, nodes[b].at);
    if (Number.isFinite(path)) link(a, b, path);
  }
  return { nodes, links, byRoom, polygons };
}
function distances(g: Graph, starts: number[], allowed: (r: PlanRoom) => boolean): number[] {
  const ds = g.nodes.map(() => Infinity), heap: { at: number; distance: number }[] = [];
  const push = (value: { at: number; distance: number }) => {
    heap.push(value); let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p].distance <= value.distance) break; heap[i] = heap[p]; i = p; }
    heap[i] = value;
  };
  const pop = () => {
    const first = heap[0], last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].distance < heap[child].distance) child++;
        if (heap[child].distance >= last.distance) break;
        heap[i] = heap[child]; i = child;
      }
      heap[i] = last;
    }
    return first;
  };
  const permitted = g.nodes.map(n => allowed(n.room));
  starts.forEach(at => { if (permitted[at]) { ds[at] = 0; push({ at, distance: 0 }); } });
  while (heap.length) {
    const item = pop(); if (item.distance !== ds[item.at]) continue;
    for (const e of g.links[item.at]) if (permitted[e.to] && item.distance + e.weight < ds[e.to]) {
      ds[e.to] = item.distance + e.weight; push({ at: e.to, distance: ds[e.to] });
    }
  }
  return ds;
}
export interface ApartmentRoute { level: number; apartment: number; effectiveStairIds: string[]; sampledOrigins: number; furthestNearestStair: number; furthestSecondStair: number | null }
export function analyseCirculation(plan: BuildingPlan): { issues: string[]; effectiveStairIds: string[]; apartments: ApartmentRoute[] } {
  if (!plan.circulation) return { issues: [], effectiveStairIds: [], apartments: [] };
  const issues: string[] = [], meta = plan.circulation, effective: string[] = [], apartments: ApartmentRoute[] = [];
  // Missing/duplicate stair identity is reported before graph construction.
  const ids = plan.stairs.map(s => s.id);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) return { issues: ['樓梯 ID 缺少或重複'], effectiveStairIds: [], apartments: [] };
  if (plan.rooms.some(r => r.type === 'stair' && !plan.stairs.some(s => s.id === r.structuralId))) return { issues: ['樓梯間沒有對應的獨立樓梯'], effectiveStairIds: [], apartments: [] };
  const graph = buildGraph(plan, issues);
  const high = plan.levels.length - 2 >= C.doubleStairFrom;
  const required = Math.max(meta.requiredStairs, high ? 2 : 1);
  const maxTravel = high ? C.highMaxTravel : C.maxTravel;
  const doubleCore = plan.levels.length - 2 >= C.doubleLiftFrom;
  for (const core of meta.cores) {
    if (core.stairIds.length < (doubleCore ? 2 : 1) || new Set(core.stairIds).size !== core.stairIds.length ||
      core.stairIds.some(id => !plan.stairs.some(s => s.id === id && s.coreId === core.id)) ||
      (core.elevatorIds ?? []).length < (doubleCore ? 2 : high ? 1 : 0) ||
      (core.hallIds ?? []).length !== (core.elevatorIds ?? []).length) issues.push(`核心 ${core.id}：樓梯／電梯／電梯廳數量或識別不完整`);
  }
  const owners = new Array(plan.windows.length).fill(0);
  for (const r of plan.rooms) for (const wi of r.windows) {
    if (!plan.windows[wi] || plan.windows[wi].room !== r.id) issues.push(`${r.id}：開口參照與房間歸屬不一致`);
    else owners[wi]++;
  }
  if (owners.some(n => n !== 1)) issues.push('每個實際開口必須有唯一房間歸屬');
  for (const s of plan.stairs) {
    const core = meta.cores.find(c => c.id === s.coreId), rs = plan.rooms.filter(r => r.structuralId === s.id);
    let valid = !!core?.stairIds.includes(s.id!) && s.from === 0 && s.to >= core!.toLevel;
    for (let k = s.from; k <= s.to; k++) {
      const r = rs.find(r => r.level === k), nodes = r ? graph.byRoom.get(r.id) ?? [] : [];
      if (!r || r.type !== 'stair' || JSON.stringify(r.polygon) !== JSON.stringify(s.polygon) || !nodes.length) { valid = false; continue; }
      for (const d of r.doors) {
        const at = doorPoint(plan, d), q = s.frame ? coreLocal(s.frame, at) : at;
        if (!onLandingEdge(s, at) || Math.abs(q[1] - s.layout.rect[1]) > dims.interior.walls.cage / 2 + EPS || !inRoom(landingPolygon(s), threshold(r.polygon, at))) valid = false;
      }
      if (k < s.to) {
        const f = s.layout.flights.find(f => f.level === k), K = dims.interior.stair[s.kind];
        if (!f || f.z0 !== plan.levels[k].floorZ || f.z1 !== plan.levels[k + 1].floorZ ||
          f.riser > K.maxRiser + EPS || f.going < K.going[0] - EPS || f.going > K.going[1] + EPS || f.risers < 2 ||
          Math.abs(f.risers * f.riser - (f.z1 - f.z0)) > EPS || f.start < -EPS || f.end > s.layout.walk + EPS) valid = false;
      }
    }
    if (s.layout.flights.length !== s.to - s.from) valid = false;
    const ground = rs.find(r => r.level === 0);
    const ds = distances(graph, ground ? graph.byRoom.get(ground.id) ?? [] : [], r => r.level === 0 && publicRoom(r) && (r.type !== 'stair' || r.structuralId === s.id));
    if (!graph.nodes.some((n, i) => n.exit && Number.isFinite(ds[i]))) valid = false;
    if (valid) effective.push(s.id!); else issues.push(`樓梯 ${s.id}：平台／踏步／服務範圍或一樓對外公共路徑不連續`);
  }
  // Vertical structural reservations cannot drift with floor programming or edits.
  for (const core of meta.cores) for (const id of [...(core.elevatorIds ?? []), ...(core.shaftIds ?? [])]) {
    const rs = plan.rooms.filter(r => r.structuralId === id), first = rs[0];
    for (let k = core.fromLevel; k <= core.toLevel; k++) {
      const r = rs.find(r => r.level === k), hole = plan.voids.find(v => v.id === id && v.level === k);
      if (!first || !r || !equipment(r) || r.doors.length || (!hole || (plan.levels[k].cls !== "R" && !hole.ceiling)) || JSON.stringify(r.polygon) !== JSON.stringify(first.polygon) || JSON.stringify(hole.polygon) !== JSON.stringify(r.polygon)) issues.push(`${plan.levels[k].name}：井道 ${id} 垂直位置／樓板孔洞不一致`);
    }
  }
  for (const lv of plan.levels) {
    const publicStarts = plan.rooms.filter(r => r.level === lv.index && r.type === 'stair' && effective.includes(r.structuralId!)).flatMap(r => graph.byRoom.get(r.id) ?? []);
    const publicDs = distances(graph, publicStarts, r => r.level === lv.index && publicRoom(r));
    for (const core of meta.cores) for (const id of core.hallIds ?? []) {
      const hall = plan.rooms.find(r => r.level === lv.index && r.structuralId === id);
      if (!hall || hall.type !== 'liftHall' || !(graph.byRoom.get(hall.id) ?? []).some(i => Number.isFinite(publicDs[i]))) issues.push(`${lv.name}：電梯廳 ${id} 沒有公共通道`);
    }
    const flats = new Map<number, PlanRoom[]>();
    plan.rooms.filter(r => r.level === lv.index && r.apartment !== null).forEach(r => flats.set(r.apartment!, [...(flats.get(r.apartment!) ?? []), r]));
    for (const [apartment, rs] of flats) {
      const allowed = (r: PlanRoom) => r.level === lv.index && !equipment(r) && (publicRoom(r) || r.apartment === apartment);
      const reachableIds: string[] = [], stairDistances = new Map<string, number[]>();
      for (const id of effective) {
        const r = plan.rooms.find(r => r.level === lv.index && r.structuralId === id);
        const ds = distances(graph, r ? graph.byRoom.get(r.id) ?? [] : [], allowed);
        if (rs.every(r => (graph.byRoom.get(r.id) ?? []).some(i => Number.isFinite(ds[i])))) { reachableIds.push(id); stairDistances.set(id, ds); }
      }
      if (reachableIds.length < required) issues.push(`${lv.name}：住戶 ${apartment} 只能到 ${reachableIds.length} 座有效樓梯，需要 ${required} 座`);
      let nearest = 0, second = 0, sampled = 0;
      for (const r of rs) {
        const xs = r.polygon.map(q => q[0]), ys = r.polygon.map(q => q[1]), points = [...r.polygon];
        for (let x = Math.min(...xs) + C.routeInset; x < Math.max(...xs); x += C.routeSampleStep) for (let y = Math.min(...ys) + C.routeInset; y < Math.max(...ys); y += C.routeSampleStep) if (inRoom(r.polygon, [x, y])) points.push([x, y]);
        for (const q of points) {
          const options = reachableIds.map(id => Math.min(...(graph.byRoom.get(r.id) ?? []).map(i => polygonRoute(r.polygon, q, graph.nodes[i].at) + stairDistances.get(id)![i]))).sort((a, b) => a - b);
          sampled++; nearest = Math.max(nearest, options[0] ?? Infinity); second = Math.max(second, options[1] ?? Infinity);
        }
      }
      if (nearest > maxTravel + EPS || (required > 1 && second > maxTravel + EPS)) issues.push(`${lv.name}：住戶 ${apartment} 取樣動線超過 ${maxTravel} m`);
      apartments.push({ level: lv.index, apartment, effectiveStairIds: reachableIds, sampledOrigins: sampled, furthestNearestStair: nearest,
        furthestSecondStair: reachableIds.length > 1 ? second : null });
    }
  }
  return { issues: [...new Set(issues)], effectiveStairIds: effective, apartments };
}
export const checkCirculation = (plan: BuildingPlan): string[] => analyseCirculation(plan).issues;
