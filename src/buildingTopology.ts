/** Shared, JSON-safe structural data. Resolved once before exterior placements. */
import { Matrix4 } from "three";
import dims from "../blender/kit_dims.json";
import type { BuildingParams, DimensionVersion, LayoutMode } from "./params";
import { PURPOSE, rand } from "./rng";
import { type EdgeKind, type V2, insetEdges } from "./roof";
import { buildLegacyGrid, type GridSide, type LegacyGrid } from "./planning/legacyGrid";
import { resolveCores, coreCellId, type CoreLayout } from "./planning/cores";
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
}
export interface BuildingTopology {
  schemaVersion: 1;
  dimensionVersion: DimensionVersion;
  mode: "legacy" | "cores";
  coreLayout?: CoreLayout;
  width: number;
  length: number;
  rows: Row[];
  wallTop: number;
  roofBase: number;
  footprint: V2[];
  edgeKinds: EdgeKind[];
  boundaryLoops: { id: string; role: "outer"; points: V2[]; facadeIds: string[] }[];
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
  if (requestedMode !== "legacy" && requestedMode !== "auto") {
    return { status: "unsupported", requestedMode, diagnostics: [{ code: "mode-not-implemented", message:
      `${requestedMode} 配置尚待後續階段實作；目前不改選其他模式` }] };
  }
  const rows = upperRows(p), last = rows.at(-1)!;
  const wallTop = last.z + last.height, roofBase = wallTop + dims.cornice.height;
  const n = facades[0].bays.length;
  const door = n % 2 === 1 ? (n - 1) / 2 : n / 2 - (rand(p.seed, PURPOSE.doorBay) < 0.5 ? 1 : 0);
  let ballroom = ballroomBays(p, n, ck[0], ck[1], rows.length, L);
  const useCores = requestedMode === "auto" && !inOldEnvelope;
  const envelope = { width: W, length: L, footprint, sides: facades, door, ballroom };
  const candidate = useCores ? resolveCores(envelope, p) : null;
  if (candidate && candidate.status !== "ready") return { status: candidate.status, requestedMode,
    diagnostics: [{ code: candidate.status === "infeasible" ? "core-capacity" : "mode-not-implemented", message: candidate.message }] };
  const coreCandidate = candidate?.status === "ready" ? candidate : null;
  const grid = coreCandidate?.grid ?? buildLegacyGrid(envelope, p);
  if (coreCandidate) ballroom = coreCandidate.ballroom;
  const cellId = useCores ? coreCellId : (i: number) => `legacy:block:cell:${i}`;
  const cells: TopologyCell[] = grid.cells.map(c => ({
    id: cellId(c.id), legacyIndex: c.id, moduleId: useCores ? "cores:block" : "legacy:block", zone: c.zone,
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
  const topology: BuildingTopology = {
    schemaVersion: 1, dimensionVersion: version, mode: useCores ? "cores" : "legacy", ...(coreCandidate ? { coreLayout: coreCandidate.layout } : {}), width: W, length: L, rows, wallTop, roofBase,
    footprint, edgeKinds, boundaryLoops: [{ id: "outer", role: "outer", points: footprint, facadeIds }], facades,
    modules: [{ id: useCores ? "cores:block" : "legacy:block", frame: new Matrix4().toArray(), polygon: grid.inner, facadeIds }],
    cells, cores, voids, door, ballroom, grid,
    diagnostics: coreCandidate ? ["P3 淺平面核心候選；深平面／中庭候選仍待 P4/P5，未作法規認證"] : inOldEnvelope ? [] : ["舊演算法的大型試算；不代表已通過新版採光、電梯或雙梯需求"],
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
