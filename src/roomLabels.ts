/**
 * Room names for the cut-open building (INTERIOR_SPEC.md §2.3): a label over
 * every room the cut reveals. A horizontal cut shows the rooms of the floor it
 * runs through (and the ballroom below its void); a vertical cut shows the
 * rooms it passes through, on every floor. The sprites are made once per
 * building and only moved and shown as the cut moves. Blender Z-up space,
 * inside the building's group.
 */
import { Group, type Sprite } from "three";
import type { CutAxis, CutMode } from "./cutaway";
import { textSprite } from "./labels";
import type { BuildingPlan, PlanRoom } from "./plan";

interface Item {
  room: PlanRoom;
  sprite: Sprite;
  cx: number;
  cy: number;
}

export class RoomLabels {
  readonly group = new Group();
  private items: Item[] = [];

  constructor(private plan: BuildingPlan, area: boolean) {
    for (const r of plan.rooms) {
      const xs = r.polygon.map(p => p[0]), ys = r.polygon.map(p => p[1]);
      const size = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      const text = area && r.type !== "corridor" && r.type !== "stair" ? `${r.name}\n${r.area.toFixed(1)} m²` : r.name;
      const sprite = textSprite(text, Math.min(3.0, Math.max(2.0, size * 0.85)), true, "tag");
      sprite.visible = false;
      this.group.add(sprite);
      this.items.push({
        room: r, sprite,
        cx: xs.reduce((s, x) => s + x, 0) / xs.length, cy: ys.reduce((s, y) => s + y, 0) / ys.length,
      });
    }
  }

  /** show the labels for a cut at `at` (Blender z, x or y by mode and axis), or none when not cut */
  update(on: boolean, mode: CutMode, axis: CutAxis, at: number, flip = false): void {
    const levels = this.plan.levels;
    let level = -1;
    if (on && mode === "horizontal") {
      for (let i = levels.length - 1; i >= 0; i--) if (at >= levels[i].floorZ) { level = i; break; }
    }
    for (const it of this.items) {
      const r = it.room;
      const [x0, y0, x1, y1] = r.rect;
      const mid = r.floorZ + Math.min(1.6, (r.ceilingZ - r.floorZ) / 2);
      let show = false;
      if (on && mode === "horizontal") {
        // the cut's floor, and the ballroom seen through its void from the floor above
        show = r.level === level || (r.levels === 2 && r.level === level - 1);
        it.sprite.position.set(it.cx, it.cy, Math.min(at - 0.25, r.floorZ + 1.0));
        if (show && at - r.floorZ < 0.5) show = false;
      } else if (on && axis === "across") {
        // the plane at x = at keeps x < at (flipped: x > at): label the rooms it
        // runs through, in the part that is kept, close to the cut
        show = x0 < at && x1 > at;
        it.sprite.position.set(flip ? Math.min((x1 + at) / 2, at + 1.5) : Math.max((x0 + at) / 2, at - 1.5), it.cy, mid);
      } else if (on) {
        // the plane at y = at keeps y > at (flipped: y < at)
        show = y0 < at && y1 > at;
        it.sprite.position.set(it.cx, flip ? Math.max((y0 + at) / 2, at - 1.5) : Math.min((at + y1) / 2, at + 1.5), mid);
      }
      it.sprite.visible = show;
    }
  }
}
