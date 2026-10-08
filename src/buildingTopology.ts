/** Shared, JSON-safe structural data. Resolved once before exterior placements. */
import { Matrix4 } from "three";
import dims from "../blender/kit_dims.json";
import type { BuildingParams, DimensionVersion, LayoutMode } from "./params";
import { PURPOSE, rand } from "./rng";
import { type EdgeKind, type V2, insetEdges, roofShape } from "./roof";
import { buildLegacyGrid, type GridSide, type LegacyGrid } from "./planning/legacyGrid";
import { resolveCores, coreCellId, type CoreLayout } from "./planning/cores";
import { resolveDeep, deepModulePolygon, type DeepLayout } from "./planning/deep";
import { resolveCourtyard, type CourtyardLayout } from "./planning/courtyard";
import { sharedEdges, type Rect } from "./planning/edgeIndex";

export type UpperClass = "N" | "S" | "A";
export type SideKind = GridSide["kind"];
export type CornerKind = GridSide["left"];
export interface Row {
  cls: UpperClass;
  /** Structural floor line in Blender Z-up space. */
  z: number;
  height: number;
  /** Continuous balcony on the first/last upper floor. */
  continuous: boolean;
}
export interface FacadeSegment extends GridSide {
  id: string;
  side: number;
  length: number;
  start: V2;
  end: V2;
  along: V2;
  inward: V2;
  bays: { id: string; bay: number; x: number }[];
  diagonal: { id: string; frame: number[] } | null;
}
export interface TopologyCell {
  id: string;
  legacyIndex: number;
  moduleId: string;
  zone: LegacyGrid["cells"][number]["zone"];
  rect: Rect;
  neighbours: string[];
}
export interface TopologyCore {
  id: string;
  kind: "main" | "service";
  stairIds: string[];
  cellIds: string[];
  /** Inclusive served levels, with ground = 0, upper = 1..floors, attic = floors+1. */
  fromLevel: number;
  toLevel: number;
  position?: V2;
  orientation?: number;
  elevatorIds?: string[];
  hallIds?: string[];
  shaftIds?: string[];
}
export interface TopologyVoid {
  id: string;
  kind: "ballroom" | "courtyard" | "lightwell" | "elevator" | "shaft";
  cellIds: string[];
  fromLevel: number;
  toLevel: number;
  z0: number;
  z1: number;
  polygon?: V2[];
}
export interface BuildingTopology {
  schemaVersion: 1;
  dimensionVersion: DimensionVersion;
  mode: "legacy" | "cores" | "lightwell" | "courtyard";
  courtyardLayout?: CourtyardLayout;
  roofEnvelope?: { footprint: V2[]; edgeKinds: EdgeKind[] };
  deepLayout?: DeepLayout;
  coreLayout?: CoreLayout;
  width: number;
  length: number;
  rows: Row[];
  wallTop: number;
  roofBase: number;
  footprint: V2[];
  edgeKinds: EdgeKind[];
  boundaryLoops: { id: string; role: "outer" | "hole"; points: V2[]; facadeIds: string[] }[];
  facades: FacadeSegment[];
  modules: { id: string; frame: number[]; polygon: V2[]; facadeIds: string[] }[];
  cells: TopologyCell[];
  cores: TopologyCore[];
  voids: TopologyVoid[];
  door: number;
  ballroom: number[] | null;
  /** Compatibility grid. Never mutated by floor programming, merges or retries. */
  grid: LegacyGrid;
  diagnostics: string[];
}
export interface TopologyDiagnostic {
  code: "invalid-input" | "invalid-envelope" | "mode-not-implemented" | "core-capacity";
  message: string;
}
/** Unsupported is deliberately distinct from geometrically infeasible. */
export type TopologyResult =
  | { status: "ready"; topology: BuildingTopology }
  | { status: "infeasible" | "unsupported"; requestedMode: LayoutMode; diagnostics: TopologyDiagnostic[] };

const SIDE_KINDS: Record<BuildingParams["type"], SideKind[]> = {
  freestanding: ["street", "street", "street", "street"],
  corner: ["street", "street", "party", "party"],
  row: ["street", "party", "court", "party"],
};

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

export function ballroomBays(p: BuildingParams, n: number, left: CornerKind, right: CornerKind, upperFloors: number, length: number): number[] | null {
  const B = dims.interior;
  if (!p.ballroom || upperFloors < 2 || length - 2 * dims.wall < B.bands.double) return null;
  const first = left === "pc" ? 0 : 1;
  const last = right === "pc" ? n - 1 : n - 2;
  const mid = last - first + 1;
  const w = mid <= B.ballroom.maxBays ? mid : mid % 2 === 1 ? B.ballroom.maxBays - 1 : B.ballroom.maxBays;
  if (w < B.ballroom.minBays) return null;
  const s = first + Math.floor((mid - w) / 2);
  return Array.from({ length: w }, (_, k) => s + k);
}

/** Runtime freezing also catches mutations through legacy adapters in development/tests. */
function freezeData<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
}

export function resolveBuildingTopology(p: BuildingParams): TopologyResult {
  const requestedMode = p.layoutMode ?? "legacy";
  const version = p.dimensionVersion ?? "legacy";
  const diagnostics: TopologyDiagnostic[] = [];
  const invalid = (message: string) => diagnostics.push({ code: "invalid-input", message });
  const limits = dims.interior.planning.inputLimits;
  for (const k of ["baysX", "baysY", "floors"] as const) {
    const lo = k === "floors" ? limits.floorsMin : limits.baysMin;
    const hi = k === "floors" ? limits.floorsMax : limits.baysMax;
    if (!Number.isSafeInteger(p[k]) || p[k] < lo || p[k] > hi) invalid(`${k} 必須為 ${lo}–${hi} 的整數`);
  }
  if (!Object.hasOwn(SIDE_KINDS, p.type)) invalid("未知建築類型");
  if (!Object.hasOwn(dims.heightProfiles, p.profile)) invalid("未知樓高配置");
  if (!["pier", "panCoupe"].includes(p.cornerStyle)) invalid("未知轉角配置");
  if (!["legacy", "bays-v2"].includes(version)) invalid("未知尺寸版本");
  if (!["legacy", "auto", "courtyard", "lightwell"].includes(requestedMode)) invalid("未知平面模式");
  if (!Number.isSafeInteger(p.seed)) invalid("seed 必須為安全整數");
  if (p.type === "row" && version === "legacy" && (!Number.isFinite(p.depth) || p.depth <= 0)) invalid("舊連棟 depth 必須為正公尺值");
  if (diagnostics.length) return { status: "infeasible", requestedMode, diagnostics };

  const kinds = SIDE_KINDS[p.type];
  const cornerKind = (c: number): CornerKind => {
    const prev = kinds[(c + 3) % 4], own = kinds[c];
    if (prev === "party" && own === "party") return "none";
    if (prev === "party") return "endL";
    if (own === "party") return "endR";
    return prev === "street" && own === "street" && p.cornerStyle === "panCoupe" ? "pc" : "pier";
  };
  const ck = [0, 1, 2, 3].map(cornerKind);
  const allowance = (k: CornerKind) => k === "pier" || k === "pc" ? dims.corner : k === "none" ? 0 : dims.endPier;
  const W = allowance(ck[0]) + dims.bay * p.baysX + allowance(ck[1]);
  const L = p.type === "row" && version === "legacy" ? p.depth : allowance(ck[1]) + dims.bay * p.baysY + allowance(ck[2]);
  const frames = [
    new Matrix4().setPosition(0, 0, 0),
    new Matrix4().makeRotationZ(Math.PI / 2).setPosition(W, 0, 0),
    new Matrix4().makeRotationZ(Math.PI).setPosition(W, L, 0),
    new Matrix4().makeRotationZ(-Math.PI / 2).setPosition(0, L, 0),
  ];
  const leg = dims.panCoupe.leg;
  const diagonal = new Matrix4().makeRotationZ(-Math.PI / 4).setPosition(leg / 2, leg / 2, 0);
  const facades: FacadeSegment[] = kinds.map((kind, side) => {
    const left = ck[side], right = ck[(side + 1) % 4];
    const n = (side % 2 === 0 ? p.baysX : p.baysY) - (left === "pc" ? 1 : 0) - (right === "pc" ? 1 : 0);
    const x0 = allowance(left) + (left === "pc" ? dims.bay : 0);
    const id = `outer:${side}`;
    const e = frames[side].elements, length = side % 2 === 0 ? W : L;
    const point = (x: number): V2 => [e[0] * x + e[12], e[1] * x + e[13]];
    return {
      id, side, kind, left, right, length,
      start: point(left === "pc" ? leg : 0), end: point(length - (right === "pc" ? leg : 0)),
      along: [e[0], e[1]], inward: [e[4], e[5]],
      frame: frames[side].toArray(), x0: kind === "party" ? 0 : x0,
      bays: kind === "party" ? [] : Array.from({ length: n }, (_, bay) => ({ id: `${id}:bay:${bay}`, bay, x: x0 + dims.bay * (bay + 0.5) })),
      diagonal: left === "pc" ? { id: `${id}:diag`, frame: frames[side].clone().multiply(diagonal).toArray() } : null,
    };
  });
  const corners: V2[] = [[0, 0], [W, 0], [W, L], [0, L]];
  const dirs: V2[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const footprint: V2[] = [], edgeKinds: EdgeKind[] = [], facadeIds: string[] = [];
  for (let c = 0; c < 4; c++) {
    const [ox, oy] = corners[c];
    if (ck[c] === "pc") {
      const pd = dirs[(c + 3) % 4], td = dirs[c];
      footprint.push([ox - pd[0] * leg, oy - pd[1] * leg]);
      edgeKinds.push("slope"); facadeIds.push(`outer:${c}:diag`);
      footprint.push([ox + td[0] * leg, oy + td[1] * leg]);
    } else footprint.push([ox, oy]);
    edgeKinds.push(kinds[c] === "party" ? "party" : "slope"); facadeIds.push(`outer:${c}`);
  }
  const inner = insetEdges(footprint, footprint.map(() => dims.wall));
  if (!inner || inner.some(q => q.some(x => !Number.isFinite(x)))) {
    return { status: "infeasible", requestedMode, diagnostics: [{ code: "invalid-envelope", message: "基地無法容納有效的外牆內縮輪廓" }] };
  }
  const old = dims.interior.planning.legacyLimits;
  const inOldEnvelope = p.baysX <= old.baysX && p.floors <= old.floors &&
    (p.type === "row" ? L <= old.rowDepth : p.baysY <= old.baysY);
  const rows = upperRows(p), last = rows.at(-1)!;
  const wallTop = last.z + last.height, roofBase = wallTop + dims.cornice.height;
  const n = facades[0].bays.length;
  const door = n % 2 === 1 ? (n - 1) / 2 : n / 2 - (rand(p.seed, PURPOSE.doorBay) < 0.5 ? 1 : 0);
  let ballroom = ballroomBays(p, n, ck[0], ck[1], rows.length, L);
  const envelope = { width: W, length: L, footprint, sides: facades, door, ballroom };
  const useCores = requestedMode === "lightwell" || requestedMode === "courtyard" || requestedMode === "auto" && !inOldEnvelope;
  const reasons: string[] = [];
  let courtResult: ReturnType<typeof resolveCourtyard> | null = null;
  let deepResult: ReturnType<typeof resolveDeep> | null = null;
  let shallow: ReturnType<typeof resolveCores> | null = null;
  if (requestedMode === "courtyard" || requestedMode === "auto" && !inOldEnvelope && L - 2 * dims.wall > dims.interior.planning.cores.maxDepth) {
    for (const shape of ["O", "U"] as const) {
      courtResult = resolveCourtyard(envelope, p, wallTop, shape);
      if (courtResult.status === "ready") break;
      reasons.push(courtResult.message);
    }
  }
  const courtCandidate = courtResult?.status === "ready" ? courtResult : null;
  if (requestedMode === "lightwell" || courtResult && !courtCandidate && requestedMode === "auto") deepResult = resolveDeep(envelope, p, wallTop);
  if (useCores && !courtResult && !deepResult) shallow = resolveCores(envelope, p);
  const deepCandidate = deepResult?.status === "ready" ? deepResult : null;
  const candidate = courtCandidate ?? deepResult ?? courtResult ?? shallow;
  if (candidate && candidate.status !== "ready") return { status: candidate.status, requestedMode,
    diagnostics: [{ code: candidate.status === "infeasible" ? "core-capacity" : "mode-not-implemented", message: [...reasons, candidate.message].join("；") }] };
  const coreCandidate = candidate?.status === "ready" ? candidate : null;
  if (deepCandidate) facades.push(...deepCandidate.facades);
  if (courtCandidate) facades.push(...courtCandidate.facades);
  const grid = coreCandidate?.grid ?? buildLegacyGrid(envelope, p);
  if (coreCandidate) ballroom = coreCandidate.ballroom;
  const cellId = useCores ? coreCellId : (i: number) => `legacy:block:cell:${i}`;
  const cells: TopologyCell[] = grid.cells.map(c => ({
    id: cellId(c.id), legacyIndex: c.id, moduleId: courtCandidate ? courtCandidate.courtyard.wings.find(w => w.cellIds.includes(c.id))?.id ?? "court:public" : deepCandidate ? deepCandidate.deep.groups.find(g => g.cellIds.includes(c.id))?.id ?? "deep:service" : useCores ? "cores:block" : "legacy:block", zone: c.zone,
    rect: [c.x0, c.y0, c.x1, c.y1], neighbours: [],
  }));
  for (const e of sharedEdges(cells.map(c => c.rect))) {
    cells[e.i].neighbours.push(cells[e.j].id);
    cells[e.j].neighbours.push(cells[e.i].id);
  }
  const cores: TopologyCore[] = coreCandidate?.cores ?? [{ id: "legacy:main", kind: "main", stairIds: ["legacy:main:stair"], cellIds: grid.cage.map(cellId), fromLevel: 0, toLevel: grid.service ? p.floors : p.floors + 1 }];
  if (!coreCandidate && grid.service) cores.push({ id: "legacy:service", kind: "service", stairIds: ["legacy:service:stair"], cellIds: grid.service.map(cellId), fromLevel: 0, toLevel: p.floors + 1 });
  const voids: TopologyVoid[] = ballroom && grid.ballroom.length ? [{
    id: useCores ? "cores:ballroom" : "legacy:ballroom", kind: "ballroom", cellIds: grid.ballroom.map(cellId), fromLevel: 2, toLevel: 2,
    z0: rows[1].z + dims.interior.floor, z1: rows[1].z + rows[1].height - dims.interior.ceiling,
  }] : [];
  if (coreCandidate) for (const part of coreCandidate.layout.parts) {
    if (part.role !== "elevator" && part.role !== "shaft") continue;
    voids.push({ id: part.id, kind: part.role, cellIds: [cellId(part.cell)], fromLevel: 0, toLevel: p.floors + 1,
      z0: dims.interior.groundFloor, z1: roofBase + dims.mansard.rise - dims.interior.atticCeiling });
  }
  if (deepCandidate) for (const w of deepCandidate.deep.wells) voids.push({ id: w.id, kind: "lightwell", polygon: w.polygon, cellIds: [], fromLevel: 0, toLevel: p.floors + 1, z0: 0, z1: roofShape(footprint, edgeKinds, roofBase).z2 });
  if (courtCandidate) voids.push({ id: "court:sky", kind: "courtyard", polygon: courtCandidate.courtyard.polygon, cellIds: [], fromLevel: 0, toLevel: p.floors + 1, z0: 0, z1: roofShape(footprint, edgeKinds, roofBase).z2 });
  const resolvedFootprint = courtCandidate?.footprint ?? footprint;
  const originalEdge = (a: V2, z: V2) => footprint.findIndex((q,j) => {
    const r = footprint[(j+1)%footprint.length];
    return Math.abs((a[0]-q[0])*(r[1]-q[1])-(a[1]-q[1])*(r[0]-q[0]))<1e-6 && Math.abs((z[0]-q[0])*(r[1]-q[1])-(z[1]-q[1])*(r[0]-q[0]))<1e-6;
  });
  const resolvedEdges = resolvedFootprint.map((a,i) => originalEdge(a,resolvedFootprint[(i+1)%resolvedFootprint.length]));
  const boundaryFacadeIds = courtCandidate?.courtyard.shape === 'U' ? resolvedEdges.map((e,i) => e>=0 ? facadeIds[e] : facades.slice(4).find(f => {
    const a=resolvedFootprint[i], z=resolvedFootprint[(i+1)%resolvedFootprint.length];
    return Math.hypot(a[0]-f.start[0],a[1]-f.start[1])<1e-6 && Math.hypot(z[0]-f.end[0],z[1]-f.end[1])<1e-6;
  })!.id) : facadeIds;
  const topology: BuildingTopology = {
    schemaVersion: 1, dimensionVersion: version, mode: courtCandidate ? "courtyard" : deepCandidate ? "lightwell" : useCores ? "cores" : "legacy", ...(courtCandidate ? { courtyardLayout: courtCandidate.courtyard, roofEnvelope: { footprint, edgeKinds } } : {}), ...(deepCandidate ? { deepLayout: deepCandidate.deep } : {}), ...(coreCandidate ? { coreLayout: coreCandidate.layout } : {}), width: W, length: L, rows, wallTop, roofBase,
    footprint: resolvedFootprint, edgeKinds: courtCandidate?.courtyard.shape === 'U' ? resolvedEdges.map(e => e>=0 ? edgeKinds[e] : 'party') : edgeKinds, boundaryLoops: [{ id: "outer", role: "outer", points: resolvedFootprint, facadeIds: boundaryFacadeIds }, ...(courtCandidate?.courtyard.shape === "O" ? [{ id: "court:sky", role: "hole" as const, points: courtCandidate.courtyard.polygon.slice().reverse(), facadeIds: courtCandidate.courtyard.facadeIds }] : []), ...(deepCandidate?.deep.wells.map(w => ({ id: w.id, role: "hole" as const, points: w.polygon.slice().reverse(), facadeIds: w.facadeIds })) ?? [])], facades,
    modules: courtCandidate ? courtCandidate.courtyard.wings.map(w => ({ id: w.id, frame: w.frame, polygon: w.polygon, facadeIds: facades.filter(f => w.polygon.some((a,i) => {
      const z=w.polygon[(i+1)%w.polygon.length];
      const normal=(q:V2)=>(q[0]-f.start[0])*f.inward[0]+(q[1]-f.start[1])*f.inward[1];
      const along=(q:V2)=>(q[0]-f.start[0])*f.along[0]+(q[1]-f.start[1])*f.along[1];
      return Math.abs(normal(a)-dims.wall)<1e-6 && Math.abs(normal(z)-dims.wall)<1e-6 && Math.min(f.length,Math.max(along(a),along(z)))-Math.max(0,Math.min(along(a),along(z)))>1e-6;
    })).map(f=>f.id) })) : deepCandidate ? deepCandidate.deep.groups.map(g => ({ id: g.id, frame: new Matrix4().toArray(), polygon: deepModulePolygon(grid.inner, g.y0, g.y1), facadeIds: facades.filter(f => f.side === 1 || f.side === 3 || f.side === 0 && g.y0 === dims.wall || f.side === 2 && g.y1 === L - dims.wall || f.side >= 4 && (Math.abs(f.start[1] - f.end[1]) < 1e-6 && (Math.abs(f.start[1] - g.y0 + dims.wall) < 1e-6 || Math.abs(f.start[1] - g.y1 - dims.wall) < 1e-6))).map(f => f.id) })) : [{ id: useCores ? "cores:block" : "legacy:block", frame: new Matrix4().toArray(), polygon: grid.inner, facadeIds }],
    cells, cores, voids, door, ballroom, grid,
    diagnostics: courtCandidate ? [...reasons, `${courtCandidate.courtyard.shape} 形中庭；門廊限一樓；戶型分段待 P6`, ...(p.ballroom ? ["中庭首版保留各翼住宅與公共動線，不設宴會廳挑空"] : [])] : deepCandidate ? [...reasons, "採光井配置", ...(p.ballroom ? ["深平面首版不設宴會廳挑空，保留完整採光與核心"] : [])] : coreCandidate ? ["淺平面核心配置，未作法規認證"] : inOldEnvelope ? [] : ["舊演算法的大型試算；不代表已通過新版採光、電梯或雙梯需求"],
  };
  return { status: "ready", topology: freezeData(topology) };
}

/** The caller may keep its previous valid model when resolution is not ready. */
export class TopologyResolutionError extends Error {
  constructor(public readonly result: Exclude<TopologyResult, { status: "ready" }>) {
    super(result.diagnostics.map(d => d.message).join("；"));
    this.name = "TopologyResolutionError";
  }
}
