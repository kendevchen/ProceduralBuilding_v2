/** Reapply explicit user edits to a freshly generated plan without mutating its source. */
import { checkPlan, ROOM_INFO, type BuildingPlan, type PlanRoom, type PlanWall, type RoomType } from "./plan";
import { signedArea, unionRooms } from "./roomGeometry";
import type { V2 } from "./roof";
import dims from "../blender/kit_dims.json";

export const EDITABLE_ROOM_TYPES = ["bedroom", "study", "salon", "dining", "kitchen", "wc", "storage"] as const;
export type EditableRoomType = (typeof EDITABLE_ROOM_TYPES)[number];
export const editableType = (type: RoomType): type is EditableRoomType => (EDITABLE_ROOM_TYPES as readonly string[]).includes(type);
// Attic rooms may be converted, but structural spaces never become editable through a rename.
export const editableRoom = (room: PlanRoom) => room.levels === 1 && (editableType(room.type) || room.type === "maid");
type Members = string[];
type Operation = { id: number; kind: "type"; members: Members; type: EditableRoomType }
  | { id: number; kind: "merge"; groups: [Members, Members]; type: EditableRoomType };
const same = (a: Members, b: Members) => a.length === b.length && a.every((x, i) => x === b[i]);
const coord = (n: number) => Math.round(n * 100000);
const pointKey = (p: V2) => p.map(coord).join(",");

/** A room number is only a display ID. Match its actual footprint and openings on replay. */
function sourceKey(plan: BuildingPlan, r: PlanRoom): string {
  const points = r.polygon.map(pointKey);
  const start = points.indexOf([...points].sort()[0]);
  const polygon = [...points.slice(start), ...points.slice(0, start)];
  const walls = plan.walls.filter(w => w.rooms.includes(r.id)).map(w =>
    [pointKey(w.a), pointKey(w.b), w.kind, coord(w.thickness), w.openings.map(o => [coord(o.at), coord(o.width), coord(o.height)])]).sort();
  const windows = r.windows.map(i => { const w = plan.windows[i]; return [pointKey(w.at), w.kind, coord(w.width)]; }).sort();
  return JSON.stringify([plan.levels[r.level].cls === "R" ? "attic" : r.level, r.levels, r.apartment,
    editableRoom(r) ? "room" : r.type, polygon, walls, windows]);
}

function clonePlan(plan: BuildingPlan): BuildingPlan {
  return { ...plan,
    rooms: plan.rooms.map(r => ({ ...r, polygon: r.polygon.map(p => [...p] as V2), rect: [...r.rect], windows: [...r.windows], doors: r.doors.map(d => ({ ...d })) })),
    walls: plan.walls.map(w => ({ ...w, a: [...w.a], b: [...w.b], rooms: [...w.rooms], openings: w.openings.map(o => ({ ...o })) })),
    windows: plan.windows.map(w => ({ ...w })), issues: [...plan.issues],
  };
}

/** Fill the former wall footprint, trimmed to both rooms' clear edges at its ends. */
function bridges(w: PlanWall, a: PlanRoom, b: PlanRoom): V2[][] {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const d: V2 = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len], n: V2 = [-d[1], d[0]];
  const along = (p: V2) => (p[0] - w.a[0]) * d[0] + (p[1] - w.a[1]) * d[1];
  const off = (p: V2) => (p[0] - w.a[0]) * n[0] + (p[1] - w.a[1]) * n[1];
  // The generator insets an entire side by its thickest wall, even when this
  // particular segment is thinner; bridge the actual clear edges on both sides.
  const maxInset = Math.max(...Object.values(dims.interior.walls)) / 2;
  const ranges = (r: PlanRoom) => r.polygon.flatMap((p, i) => {
    const q = r.polygon[(i + 1) % r.polygon.length];
    if (Math.abs(off(p) - off(q)) > 1e-5 || Math.abs(off(p)) > maxInset + 1e-4) return [];
    return [[Math.max(0, Math.min(along(p), along(q))), Math.min(len, Math.max(along(p), along(q))), off(p)]];
  });
  const poly: V2[][] = [];
  for (const [a0, a1, ao] of ranges(a)) for (const [b0, b1, bo] of ranges(b)) {
    const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
    if (hi - lo < 1e-5) continue;
    if (ao * bo >= 0) continue;
    const p = (s: number, t: number): V2 => [w.a[0] + d[0] * s + n[0] * t, w.a[1] + d[1] * s + n[1] * t];
    const low = Math.min(ao, bo), high = Math.max(ao, bo);
    poly.push([p(lo, low), p(hi, low), p(hi, high), p(lo, high)]);
  }
  return poly;
}

export function mergeReason(plan: BuildingPlan, ids: string[]): string | null {
  if (ids.length !== 2 || ids[0] === ids[1]) return "請選擇兩間房間";
  const [a, b] = ids.map(id => plan.rooms.find(r => r.id === id));
  if (!a || !b) return "房間已改變，請重新選取";
  if (!editableRoom(a) || !editableRoom(b)) return "樓梯、走廊、入口與宴會廳等空間不可合併";
  if (a.level !== b.level || a.floorZ !== b.floorZ || a.ceilingZ !== b.ceilingZ) return "只能合併同樓層、同高度的房間";
  if (a.apartment !== b.apartment) return "只能合併同一戶的房間";
  const shared = plan.walls.filter(w => w.rooms.includes(a.id) && w.rooms.includes(b.id));
  if (!shared.length) return "兩間房間必須共用一段隔間牆";
  if (shared.some(w => w.kind !== "partition")) return "走廊牆、樓梯間牆與主要分隔牆不可拆除";
  return null;
}

function mergePlan(plan: BuildingPlan, ids: [string, string], type: EditableRoomType, id: string): PlanRoom {
  const reason = mergeReason(plan, ids);
  if (reason) throw new Error(reason);
  const [a, b] = ids.map(id => plan.rooms.find(r => r.id === id)!);
  const shared = plan.walls.filter(w => w.rooms.includes(a.id) && w.rooms.includes(b.id));
  const fill = shared.flatMap(w => bridges(w, a, b));
  if (!fill.length) throw new Error("找不到可移除的共用隔間範圍");
  const polygon = unionRooms([a.polygon, b.polygon, ...fill]);
  const merged: PlanRoom = {
    ...a, id, type, name: ROOM_INFO[type].name, polygon, area: signedArea(polygon),
    rect: [Math.min(a.rect[0], b.rect[0]), Math.min(a.rect[1], b.rect[1]), Math.max(a.rect[2], b.rect[2]), Math.max(a.rect[3], b.rect[3])],
    windows: [...new Set([...a.windows, ...b.windows])], doors: [],
  };
  const replaced = (room: string | null) => room && ids.includes(room) ? id : room;
  plan.rooms = plan.rooms.filter(r => !ids.includes(r.id));
  plan.rooms.push(merged);
  plan.walls = plan.walls.filter(w => !shared.includes(w));
  for (const wall of plan.walls) wall.rooms = wall.rooms.map(replaced) as PlanWall["rooms"];
  for (const window of plan.windows) window.room = replaced(window.room);
  // Rebuild every door reference after filtering walls; update both sides symmetrically.
  const byId = new Map(plan.rooms.map(r => [r.id, r]));
  for (const room of plan.rooms) room.doors = [];
  plan.walls.forEach((wall, wi) => {
    for (const side of [0, 1]) {
      const room = byId.get(wall.rooms[side] ?? ""), to = wall.rooms[1 - side];
      if (!room || !to) continue;
      room.doors.push(...wall.openings.map(o => ({ wall: wi, at: o.at, width: o.width, height: o.height, to })));
    }
  });
  return merged;
}

export interface EditedPlan {
  plan: BuildingPlan;
  members: Map<string, Members>;
  suspended: string[];
  warnings: string[];
}

export class RoomEdits {
  private operations: Operation[] = [];
  private undoStates: Operation[][] = [];
  private redoStates: Operation[][] = [];
  private serial = 0;
  current: EditedPlan | null = null;
  get canUndo() { return !!this.undoStates.length; }
  get canRedo() { return !!this.redoStates.length; }
  get count() { return this.operations.length; }

  apply(base: BuildingPlan): EditedPlan {
    const plan = clonePlan(base), members = new Map(plan.rooms.map(r => [r.id, [sourceKey(base, r)]]));
    const suspended: string[] = [];
    const find = (keys: Members) => plan.rooms.find(r => same(members.get(r.id) ?? [], keys));
    for (const op of this.operations) {
      try {
        if (op.kind === "type") {
          const r = find(op.members);
          if (!r || !editableRoom(r)) throw new Error("房間位置或開口已改變");
          r.type = op.type; r.name = ROOM_INFO[op.type].name;
        } else {
          const a = find(op.groups[0]), b = find(op.groups[1]);
          if (!a || !b) throw new Error("原本的兩間房間已改變");
          const keys = [...members.get(a.id)!, ...members.get(b.id)!].sort();
          const room = mergePlan(plan, [a.id, b.id], op.type, `merged-${op.id}`);
          members.delete(a.id); members.delete(b.id); members.set(room.id, keys);
        }
      } catch (error) {
        suspended.push(`編輯 ${op.id} 暫停套用：${(error as Error).message}`);
      }
    }
    plan.issues = this.operations.length ? checkPlan(plan, false) : [...base.issues];
    const warnings = this.operations.length ? checkPlan(plan).filter(s => !plan.issues.includes(s)) : [];
    return this.current = { plan, members, suspended, warnings };
  }

  private save() { this.undoStates.push([...this.operations]); this.redoStates = []; }
  private keys(id: string): Members {
    const keys = this.current?.members.get(id);
    if (!keys) throw new Error("房間已改變，請重新選取");
    return keys;
  }
  setType(id: string, type: EditableRoomType): void {
    const room = this.current?.plan.rooms.find(r => r.id === id);
    if (!room || !editableRoom(room) || !editableType(type)) throw new Error("此房間不能更換房型");
    if (room.type === type) return;
    const members = this.keys(id);
    this.save();
    this.operations.push({ id: ++this.serial, kind: "type", members, type });
  }
  restoreType(id: string): void {
    const keys = this.keys(id);
    this.save();
    this.operations = this.operations.filter(op => op.kind !== "type" || !same(op.members, keys));
  }
  merge(ids: [string, string], type: EditableRoomType): Members {
    if (!this.current || !editableType(type)) throw new Error("請先選擇合併後房型");
    // Validate geometry on a copy before recording an operation that would fail on replay.
    mergePlan(clonePlan(this.current.plan), ids, type, "preview");
    const groups: [Members, Members] = [this.keys(ids[0]), this.keys(ids[1])];
    this.save();
    this.operations.push({ id: ++this.serial, kind: "merge", groups, type });
    return [...groups[0], ...groups[1]].sort();
  }
  undo() {
    const state = this.undoStates.pop();
    if (state) { this.redoStates.push(this.operations); this.operations = state; }
  }
  redo() {
    const state = this.redoStates.pop();
    if (state) { this.undoStates.push(this.operations); this.operations = state; }
  }
  clear() { if (this.operations.length) { this.save(); this.operations = []; } }
}
