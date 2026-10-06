import { Box3, Group, Vector3 } from "three";

/** Stable identities and world placement; UI/editor state lives in each record. */
export interface BuildingInstance<T> {
  id: string;
  name: string;
  position: Vector3;
  length: number;
  localBounds: Box3;
  root: Group;
  state: T | null;
}

export class BuildingScene<T> {
  readonly buildings: BuildingInstance<T>[] = [];
  activeId = "";
  private nextId = 1;
  private front = 0;
  constructor(readonly clearance: number) {}

  get active(): BuildingInstance<T> { return this.buildings.find(b => b.id === this.activeId)!; }

  add(side: "left" | "right", state: T | null, initialBounds: Box3, length: number): BuildingInstance<T> {
    const id = String(this.nextId++), root = new Group(); root.rotation.x = -Math.PI / 2;
    const entry = { id, name: `建築 ${id}`, root, position: new Vector3(), length, localBounds: initialBounds.clone(), state };
    if (!this.buildings.length) { this.front = length / 2; this.buildings.push(entry); this.activeId = id; }
    else {
      const neighbour = side === "left" ? this.buildings[0] : this.buildings.at(-1)!;
      entry.position.x = side === "left"
        ? neighbour.position.x + neighbour.localBounds.min.x - this.clearance - entry.localBounds.max.x
        : neighbour.position.x + neighbour.localBounds.max.x + this.clearance - entry.localBounds.min.x;
      if (side === "left") this.buildings.unshift(entry); else this.buildings.push(entry);
    }
    this.layout(this.activeId);
    return entry;
  }

  layout(anchorId = this.activeId): void {
    const anchor = this.buildings.findIndex(b => b.id === anchorId);
    if (anchor < 0) return;
    for (let i = anchor - 1; i >= 0; i--) {
      const b = this.buildings[i], next = this.buildings[i + 1];
      b.position.x = next.position.x + next.localBounds.min.x - this.clearance - b.localBounds.max.x;
    }
    for (let i = anchor + 1; i < this.buildings.length; i++) {
      const b = this.buildings[i], previous = this.buildings[i - 1];
      b.position.x = previous.position.x + previous.localBounds.max.x + this.clearance - b.localBounds.min.x;
    }
    for (const b of this.buildings) { b.position.z = this.front - b.length / 2; b.root.position.copy(b.position); }
  }

  updateFootprint(id: string, bounds: Box3, length: number): void {
    const b = this.buildings.find(b => b.id === id)!;
    b.localBounds.copy(bounds); b.length = length;
    if (this.buildings.length === 1) this.front = length / 2;
    this.layout(id);
  }

  bounds(): Box3 {
    const box = new Box3();
    for (const b of this.buildings) box.union(b.localBounds.clone().translate(b.position));
    return box;
  }
}
