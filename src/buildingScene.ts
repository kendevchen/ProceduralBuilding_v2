import { Box3, Group, Vector3 } from "three";
export type AddDirection = "left" | "right" | "front" | "back";

/** Stable identities and world placement; UI/editor state lives in each record. */
export interface BuildingInstance<T> {
  id: string;
  name: string;
  position: Vector3;
  length: number;
  localBounds: Box3;
  root: Group;
  state: T | null;
  column: number;
  row: number;
}

export class BuildingScene<T> {
  readonly buildings: BuildingInstance<T>[] = [];
  activeId = "";
  private nextId = 1;
  private candidates = new Map<AddDirection, { anchor: string; bounds: Box3; length: number; column: number; row: number; position: Vector3 }>();
  constructor(public clearance: number) {}

  get active(): BuildingInstance<T> { return this.buildings.find(b => b.id === this.activeId)!; }

  candidate(side: AddDirection, bounds: Box3, length: number): { column: number; row: number; position: Vector3 } {
    const cached = this.candidates.get(side);
    if (cached && cached.anchor === this.activeId && cached.bounds.equals(bounds) && cached.length === length) return cached;
    const active = this.active;
    let column = active.column, row = active.row;
    const dx = side === "left" ? -1 : side === "right" ? 1 : 0;
    const dz = side === "back" ? -1 : side === "front" ? 1 : 0;
    do { column += dx; row += dz; } while (this.buildings.some(b => b.column === column && b.row === row));
    const edge = this.buildings.filter(b => dx ? b.row === row : b.column === column)
      .sort((a, b) => dx ? dx * (b.column - a.column) : dz * (b.row - a.row))[0] ?? active;
    const position = edge.position.clone();
    if (dx) position.x += dx < 0 ? edge.localBounds.min.x - this.clearance - bounds.max.x
      : edge.localBounds.max.x + this.clearance - bounds.min.x;
    else position.z += dz < 0 ? edge.localBounds.min.z - this.clearance - bounds.max.z
      : edge.localBounds.max.z + this.clearance - bounds.min.z;
    if (dx) position.z += (edge.length - length) / 2;
    const scratch = new BuildingScene<T>(this.clearance);
    scratch.activeId = this.activeId;
    scratch.buildings.push(...this.buildings.map(b => ({ ...b, position: b.position.clone(), root: new Group() })));
    const preview = { ...active, id: "preview", column, row, position, localBounds: bounds, length, root: new Group() };
    scratch.buildings.push(preview); scratch.layout();
    const result = { anchor: this.activeId, bounds: bounds.clone(), length, column, row, position: preview.position.clone() };
    this.candidates.set(side, result); return result;
  }

  add(side: AddDirection, state: T | null, initialBounds: Box3, length: number): BuildingInstance<T> {
    const id = String(this.nextId++), root = new Group(); root.rotation.x = -Math.PI / 2;
    const entry = { id, name: `建築 ${id}`, root, position: new Vector3(), length, localBounds: initialBounds.clone(), state, column: 0, row: 0 };
    if (!this.buildings.length) { this.buildings.push(entry); this.activeId = id; }
    else {
      Object.assign(entry, this.candidate(side, initialBounds, length));
      this.buildings.push(entry);
      this.buildings.sort((a, b) => a.row - b.row || a.column - b.column);
    }
    this.layout(this.activeId);
    return entry;
  }

  layout(anchorId = this.activeId): void {
    this.candidates.clear();
    const anchor = this.buildings.find(b => b.id === anchorId); if (!anchor) return;
    const pack = (axis: "column" | "row", key: "x" | "z", start: number) => {
      const indices = [...new Set(this.buildings.map(b => b[axis]))].sort((a, b) => a - b);
      const ranges = indices.map(index => {
        const members = this.buildings.filter(b => b[axis] === index);
        return { min: Math.min(...members.map(b => b.localBounds.min[key] - (key === "z" ? b.length / 2 : 0))),
          max: Math.max(...members.map(b => b.localBounds.max[key] - (key === "z" ? b.length / 2 : 0))) };
      });
      const at = indices.indexOf(anchor[axis]), positions = new Map([[indices[at], start]]);
      for (let i = at - 1; i >= 0; i--) positions.set(indices[i], positions.get(indices[i + 1])! + ranges[i + 1].min - this.clearance - ranges[i].max);
      for (let i = at + 1; i < indices.length; i++) positions.set(indices[i], positions.get(indices[i - 1])! + ranges[i - 1].max + this.clearance - ranges[i].min);
      return positions;
    };
    const x = pack("column", "x", anchor.position.x), z = pack("row", "z", anchor.position.z + anchor.length / 2);
    for (const b of this.buildings) { b.position.set(x.get(b.column)!, 0, z.get(b.row)! - b.length / 2); b.root.position.copy(b.position); }
  }

  updateFootprint(id: string, bounds: Box3, length: number): void {
    const b = this.buildings.find(b => b.id === id)!;
    b.localBounds.copy(bounds); b.length = length;
    this.layout(id);
  }

  bounds(): Box3 {
    const box = new Box3();
    for (const b of this.buildings) box.union(b.localBounds.clone().translate(b.position));
    return box;
  }
}
