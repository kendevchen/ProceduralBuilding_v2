/**
 * Room names for the cut-open building (INTERIOR_SPEC.md §2.3): a label over
 * every room the cut reveals. A horizontal cut shows the rooms of the floor it
 * runs through (and the ballroom below its void); a vertical cut shows the
 * rooms it passes through, on every floor. The sprites are made once per
 * building and only moved and shown as the cut moves. Blender Z-up space,
 * inside the building's group.
 */
import { BufferGeometry, type CanvasTexture, Group, LineBasicMaterial, LineLoop, type Plane, type Raycaster, type Sprite, Vector3 } from "three";
import type { CutAxis, CutMode } from "./cutaway";
import { textSprite } from "./labels";
import type { BuildingPlan, PlanRoom } from "./plan";
import { roomAnchor } from "./roomGeometry";
import type { UnfoldPlacement } from "./unfold";

interface Item {
  room: PlanRoom;
  sprite: Sprite;
  cx: number;
  cy: number;
  group: Group;
  scale: Vector3;
  placement?: UnfoldPlacement | null;
  outline?: LineLoop;
}

export class RoomLabels {
  readonly group = new Group();
  private items: Item[] = [];
  private selected = new Set<string>();
  private textures = new Map<string, CanvasTexture>();
  private outlineMaterial = new LineBasicMaterial({ color: 0xffb44f, depthTest: false });

  constructor(private plan: BuildingPlan, area: boolean) {
    for (const r of plan.rooms) {
      const xs = r.polygon.map(p => p[0]), ys = r.polygon.map(p => p[1]);
      const size = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      const text = area && r.type !== "corridor" && r.type !== "stair" ? `${r.name}\n${r.area.toFixed(1)} m²` : r.name;
      const sprite = textSprite(text, Math.min(3.0, Math.max(2.0, size * 0.85)), true, "tag", this.textures);
      sprite.visible = false;
      const group = new Group();
      group.add(sprite); this.group.add(group);
      const anchor = roomAnchor(r.polygon)!;
      this.items.push({
        room: r, sprite, group, scale: sprite.scale.clone(),
        cx: anchor[0], cy: anchor[1],
      });
    }
  }

  pick(ray: Raycaster): string | null {
    this.group.updateWorldMatrix(true, true);
    const visible = this.items.filter(it => it.sprite.visible && this.group.visible);
    const hit = ray.intersectObjects(visible.map(it => it.sprite), false)[0];
    return hit ? visible.find(it => it.sprite === hit.object)?.room.id ?? null : null;
  }

  select(ids: string[]): void {
    this.selected = new Set(ids);
    for (const it of this.items) {
      const selected = this.selected.has(it.room.id);
      it.sprite.material.color.set(selected ? "#ffc875" : "#ffffff");
      if (selected && !it.outline) {
        it.outline = new LineLoop(new BufferGeometry().setFromPoints(it.room.polygon.map(p => new Vector3(p[0], p[1], it.room.floorZ + 0.025))), this.outlineMaterial.clone());
        it.outline.renderOrder = 999;
        it.group.add(it.outline);
      }
      if (it.outline) {
        it.outline.visible = selected && it.sprite.visible;
        (it.outline.material as LineBasicMaterial).clippingPlanes = it.placement?.planes ?? this.outlineMaterial.clippingPlanes;
      }
    }
  }

  setClip(plane: Plane | null): void {
    this.outlineMaterial.clippingPlanes = plane ? [plane] : [];
    for (const it of this.items) if (it.outline) (it.outline.material as LineBasicMaterial).clippingPlanes = this.outlineMaterial.clippingPlanes;
  }
  dispose(): void {
    this.group.removeFromParent();
    for (const it of this.items) {
      it.outline?.geometry.dispose();
      if (it.outline) (it.outline.material as LineBasicMaterial).dispose();
      it.sprite.material.dispose();
    }
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
    this.outlineMaterial.dispose();
  }

  /** One label per room, assigned to its largest retained piece; selection follows the same transform. */
  updateUnfold(on: boolean, placement: (room: PlanRoom) => UnfoldPlacement | null): void {
    for (const it of this.items) {
      const p = on ? placement(it.room) : null;
      it.placement = p;
      it.sprite.scale.copy(it.scale).multiplyScalar(0.72);
      it.group.matrixAutoUpdate = false;
      if (p) {
        it.group.matrix.copy(p.matrix); it.group.matrixWorldNeedsUpdate = true;
        it.sprite.position.copy(p.anchor);
      }
      it.sprite.visible = !!p;
      if (it.outline) {
        it.outline.visible = !!p && this.selected.has(it.room.id);
        (it.outline.material as LineBasicMaterial).clippingPlanes = p?.planes ?? [];
      }
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
      it.placement = null;
      it.sprite.scale.copy(it.scale);
      it.group.matrix.identity(); it.group.matrixWorldNeedsUpdate = true;
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
        const anchor = roomAnchor(r.polygon, { axis: 0, at, greater: flip });
        show = show && !!anchor;
        if (anchor) it.sprite.position.set(anchor[0], anchor[1], mid);
      } else if (on) {
        // the plane at y = at keeps y > at (flipped: y < at)
        show = y0 < at && y1 > at;
        const anchor = roomAnchor(r.polygon, { axis: 1, at, greater: !flip });
        show = show && !!anchor;
        if (anchor) it.sprite.position.set(anchor[0], anchor[1], mid);
      }
      it.sprite.visible = show;
      if (it.outline) it.outline.visible = show && this.selected.has(r.id);
    }
  }
}
