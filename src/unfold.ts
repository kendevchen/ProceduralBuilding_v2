/** Three complementary slices, animated in Blender space. */
import { Box3, Color, Group, InstancedMesh, Material, Matrix4, Mesh, type Object3D, Plane, Raycaster, Vector3 } from "three";
import dims from "../blender/kit_dims.json";
import type { BuildingPlan, PlanRoom } from "./plan";
import type { Cutaway } from "./cutaway";
import type { V2 } from "./roof";
import { roomAnchor, signedArea } from "./roomGeometry";
import type { LampSource } from "./lampLights";
import { sectionGeometry } from "./sectionGeometry";
import { cloneShaderMaterial } from "./shaderVariant";

const U = dims.interior.unfold;
const REVEAL = Math.max(...Object.values(dims.interior.walls)) / 2 + U.revealClearance;
export type UnfoldFocus = "all" | "left" | "center" | "right";
const IDS = ["left", "center", "right"] as const;
export interface UnfoldPlacement { matrix: Matrix4; planes: Plane[]; anchor: Vector3 }

/** Prefer partition axes near the outside bays; never split a stair cage along x. */
export function unfoldCuts(plan: BuildingPlan): [number, number] {
  const w = plan.width, min = w * U.minimumPartRatio;
  const candidates = new Set([w * U.edgeRatio, w * (1 - U.edgeRatio)]);
  const wallAxes = new Set<number>();
  for (const wall of plan.walls) if (Math.abs(wall.a[0] - wall.b[0]) < 1e-5) { candidates.add(wall.a[0]); wallAxes.add(wall.a[0]); }
  const stairBounds = plan.stairs.map(stair => [Math.min(...stair.polygon.map(q => q[0])), Math.max(...stair.polygon.map(q => q[0]))]);
  for (const bound of stairBounds) { candidates.add(bound[0] - REVEAL); candidates.add(bound[1] + REVEAL); }
  const safe = [...candidates].filter(x => x >= min && x <= w - min && !stairBounds.some(bound =>
    x > bound[0] - REVEAL + 1e-5 && x < bound[1] + REVEAL - 1e-5));
  let result: [number, number] | null = null, best = Infinity;
  for (const a of safe) for (const b of safe) {
    if (b - a < min) continue;
    const ballroom = plan.rooms.find(r => r.type === "ballroom");
    const penalty = ballroom ? [a, b].filter(x => x > ballroom.rect[0] + 0.01 && x < ballroom.rect[2] - 0.01).length * w : 0;
    const score = Math.abs(a - w * U.edgeRatio) + Math.abs(b - w * (1 - U.edgeRatio)) + penalty
      + [a, b].filter(x => !wallAxes.has(x)).length * w * 0.04;
    if (score < best) { best = score; result = [a, b]; }
  }
  // Very narrow buildings may have no two safe axes: three proportional sections remain usable.
  return result ?? [w / 3, w * 2 / 3];
}

export function clipUnfoldPolygon(poly: V2[], lo: number, hi: number, front: number): V2[] {
  let points = poly;
  for (const [axis, edge, sign] of [[0, lo, 1], [0, hi, -1], [1, front, 1]]) {
    const next: V2[] = [];
    points.forEach((a, i) => {
      const b = points[(i + 1) % points.length];
      const da = (a[axis] - edge) * sign, db = (b[axis] - edge) * sign;
      if (da >= 0) next.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    });
    points = next;
  }
  return points;
}

interface Part {
  id: typeof IDS[number]; lo: number; hi: number; pivot: number;
  group: Group; transform: Matrix4; undo: { value: Matrix4 }; planes: Plane[];
  materials: Map<Material, Material>; localBounds: Box3;
}

export class UnfoldView {
  readonly group = new Group();
  readonly cuts: [number, number];
  readonly parts: Part[] = [];
  amount = 0;
  depth = U.frontDepth;
  focus: UnfoldFocus = "all";
  private sourceWorld = new Matrix4();
  private sourceBounds: Box3;
  private cutCenter: number;
  readonly spacingRange: [number, number];

  constructor(source: Group, readonly plan: BuildingPlan, private cutaway: Cutaway) {
    this.group.name = "unfold_view";
    source.updateWorldMatrix(true, true);
    this.sourceWorld.copy(source.matrixWorld);
    const inverse = source.matrixWorld.clone().invert();
    this.sourceBounds = new Box3().setFromObject(source).applyMatrix4(inverse);
    this.cuts = unfoldCuts(plan);
    this.cutCenter = (this.cuts[0] + this.cuts[1]) / 2;
    const side = plan.width * U.minimumPartRatio;
    this.spacingRange = [side, Math.max(side, 2 * Math.min(this.cutCenter - side, plan.width - side - this.cutCenter))];
    const edges = [this.sourceBounds.min.x - 1, ...this.cuts, this.sourceBounds.max.x + 1];
    for (let i = 0; i < 3; i++) {
      const group = new Group(); group.name = `unfold_${IDS[i]}`; group.matrixAutoUpdate = false;
      const part: Part = {
        id: IDS[i], lo: edges[i], hi: edges[i + 1], pivot: i === 0 ? this.cuts[0] : i === 2 ? this.cuts[1] : plan.width / 2,
        group, transform: new Matrix4(), undo: { value: new Matrix4() }, planes: [new Plane(), new Plane(), new Plane()],
        materials: new Map(), localBounds: new Box3(),
      };
      this.parts.push(part); this.group.add(group);
      // Fixed envelopes cover all slider positions without rebuilding buffers.
      const selectionLo = i === 0 ? edges[0] : this.cutCenter + (i === 1 ? -this.spacingRange[1] : this.spacingRange[0]) / 2;
      const selectionHi = i === 2 ? edges[3] : this.cutCenter + (i === 0 ? -this.spacingRange[0] : this.spacingRange[1]) / 2;
      source.traverse(object => {
        if (!(object instanceof Mesh) || object.userData.uncut) return;
        for (let parent: Object3D | null = object; parent && parent !== source; parent = parent.parent) if (parent.userData.unfoldSkip) return;
        const local = inverse.clone().multiply(object.matrixWorld);
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        const bounds = object.geometry.boundingBox!;
        const intersects = (box: Box3) => box.max.x >= selectionLo && box.min.x <= selectionHi;
        let mesh: Mesh;
        const material = Array.isArray(object.material) ? object.material.map(m => this.material(part, m)) : this.material(part, object.material);
        if (object instanceof InstancedMesh) {
          const indices: number[] = [], matrix = new Matrix4();
          for (let k = 0; k < object.count; k++) {
            object.getMatrixAt(k, matrix);
            const box = bounds.clone().applyMatrix4(local.clone().multiply(matrix));
            if (intersects(box)) { indices.push(k); part.localBounds.union(box); }
          }
          if (!indices.length) return;
          const instanced = new InstancedMesh(object.geometry, material, indices.length);
          const color = new Color();
          indices.forEach((index, k) => {
            object.getMatrixAt(index, matrix); instanced.setMatrixAt(k, matrix);
            if (object.instanceColor) { object.getColorAt(index, color); instanced.setColorAt(k, color); }
          });
          mesh = instanced;
        } else {
          const box = bounds.clone().applyMatrix4(local);
          if (!intersects(box)) return;
          // Keep the original volume for framing/swing: triangle pruning must
          // not move the camera or alter the presentation's animation.
          part.localBounds.union(box);
          const geometry = box.min.x >= selectionLo && box.max.x <= selectionHi
            ? object.geometry : sectionGeometry(object.geometry, local, selectionLo, selectionHi);
          if (!geometry) return;
          mesh = new Mesh(geometry, material);
        }
        mesh.name = object.name;
        // Retain source identity even when geometry is an index view.
        mesh.userData.unfoldSource = object.uuid;
        if (object.userData.facadeShell) mesh.userData.facadeShell = true;
        mesh.matrixAutoUpdate = false; mesh.matrix.copy(local);
        mesh.castShadow = object.castShadow; mesh.receiveShadow = object.receiveShadow;
        mesh.renderOrder = object.renderOrder;
        if (object.customDepthMaterial) mesh.customDepthMaterial = this.material(part, object.customDepthMaterial, true);
        if (object.customDistanceMaterial) mesh.customDistanceMaterial = this.material(part, object.customDistanceMaterial, true);
        group.add(mesh);
      });
    }
    this.group.matrixAutoUpdate = false; this.group.matrix.copy(source.matrix); this.group.matrixWorldNeedsUpdate = true;
  }

  get spacing(): number { return this.cuts[1] - this.cuts[0]; }

  setSpacing(distance: number): void {
    const span = Math.max(this.spacingRange[0], Math.min(this.spacingRange[1], distance));
    this.cuts[0] = this.cutCenter - span / 2; this.cuts[1] = this.cutCenter + span / 2;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      p.lo = i === 0 ? this.sourceBounds.min.x - 1 : this.cuts[i - 1];
      p.hi = i === 2 ? this.sourceBounds.max.x + 1 : this.cuts[i];
      p.pivot = i === 0 ? this.cuts[0] : i === 2 ? this.cuts[1] : this.plan.width / 2;
    }
  }

  private material(part: Part, original: Material, depth = false): Material {
    const cached = part.materials.get(original); if (cached) return cached;
    const base = depth ? original : this.cutaway.cut(original), material = cloneShaderMaterial(base);
    const variant = material as Material & { defines: Record<string, unknown> };
    variant.defines = { ...variant.defines, USE_SOURCE_FRAME: "" };
    material.clippingPlanes = part.planes; material.clipShadows = true;
    material.onBeforeCompile = (shader, renderer) => {
      base.onBeforeCompile(shader, renderer);
      shader.uniforms.uSourceFrame = part.undo;
    };
    material.customProgramCacheKey = () => `${base.customProgramCacheKey()}|unfold`;
    part.materials.set(original, material); return material;
  }

  get front(): number {
    const outside = this.sourceBounds.min.y - 0.1;
    // Zero means no front cut, including projecting facade ornaments/balconies.
    // Opening depth is independent of unfolding, including the closed pose.
    return this.depth <= 0 ? outside : this.depth;
  }

  /** Remove the half-walls along the two section seams while open; restore them at zero. */
  range(p: Part): [number, number] {
    const reveal = REVEAL * Math.min(1, this.amount * 5);
    return [p.lo + (p.id === "left" ? 0 : reveal), p.hi - (p.id === "right" ? 0 : reveal)];
  }

  update(amount: number, depth: number, focus: UnfoldFocus): void {
    this.amount = Math.max(0, Math.min(1, amount)); this.depth = depth; this.focus = focus;
    this.parts.forEach((p, i) => {
      const side = i - 1;
      // Front is -Y in Blender space. Outer segments turn their inner cut faces toward the viewer.
      const angle = side * U.angle * Math.PI / 180 * this.amount;
      // Rotation moves the rear inner corner inward. Reserve its sweep as well as the visible gap,
      // so deep row buildings cannot swing through the centre segment.
      const swing = Math.max(0, p.localBounds.max.y - this.plan.length / 2) * Math.abs(Math.sin(angle));
      const gap = this.plan.width * U.gapRatio * this.amount + swing;
      p.transform.makeTranslation(p.pivot + side * gap, this.plan.length / 2, 0)
        .multiply(new Matrix4().makeRotationZ(angle))
        .multiply(new Matrix4().makeTranslation(-p.pivot, -this.plan.length / 2, 0));
      p.group.matrix.copy(p.transform); p.group.matrixWorldNeedsUpdate = true;
      p.group.visible = focus === "all" || focus === p.id;
    });
    this.group.updateWorldMatrix(true, true);
    for (const p of this.parts) {
      const world = p.group.matrixWorld;
      const [lo, hi] = this.range(p);
      p.undo.value.copy(this.sourceWorld).multiply(world.clone().invert());
      p.planes[0].set(new Vector3(1, 0, 0), -lo).applyMatrix4(world);
      p.planes[1].set(new Vector3(-1, 0, 0), hi).applyMatrix4(world);
      p.planes[2].set(new Vector3(0, 1, 0), -this.front).applyMatrix4(world);
    }
  }

  /** Bounds of retained volumes, rather than the unclipped copies used for rendering. */
  bounds(): Box3 {
    const result = new Box3();
    for (const p of this.parts) {
      if (!p.group.visible) continue;
      const box = p.localBounds.clone();
      const [lo, hi] = this.range(p);
      box.min.x = Math.max(box.min.x, lo); box.max.x = Math.min(box.max.x, hi);
      box.min.y = Math.max(box.min.y, this.front);
      if (!box.isEmpty()) result.union(box.applyMatrix4(p.group.matrixWorld));
    }
    return result;
  }

  placement(room: PlanRoom): UnfoldPlacement | null {
    if (this.amount < 0.05) return null;
    let best: { part: Part; poly: V2[]; area: number } | null = null;
    for (const part of this.parts) {
      if (!part.group.visible) continue;
      const [lo, hi] = this.range(part);
      const poly = clipUnfoldPolygon(room.polygon, lo, hi, this.front);
      const area = Math.abs(signedArea(poly));
      if (area < 0.05) continue;
      const exposed = room.rect[1] <= this.front || (room.rect[0] < lo && room.rect[2] > lo)
        || (room.rect[0] < hi && room.rect[2] > hi);
      if (this.focus === "all" && !exposed) continue;
      if (!best || area > best.area) best = { part, poly, area };
    }
    if (!best) return null;
    const anchor = roomAnchor(best.poly); if (!anchor) return null;
    return { matrix: best.part.transform, planes: best.part.planes,
      anchor: new Vector3(anchor[0], anchor[1], room.floorZ + Math.min(1.3, (room.ceilingZ - room.floorZ) / 2)) };
  }

  lamps(sources: LampSource[]): LampSource[] {
    const inv = this.sourceWorld.clone().invert(), out: LampSource[] = [];
    for (const source of sources) {
      const local = source.position.clone().applyMatrix4(inv);
      const part = this.parts.find((p, i) => local.x >= p.lo && (local.x < p.hi || i === 2));
      if (part?.group.visible && local.y >= this.front) {
        const [lo, hi] = this.range(part);
        if (local.x >= lo && local.x <= hi) out.push({ ...source, position: local.applyMatrix4(part.group.matrixWorld) });
      }
    }
    return out;
  }

  pick(ray: Raycaster): UnfoldFocus | null {
    this.group.updateWorldMatrix(true, true);
    let nearest = Infinity, selected: UnfoldFocus | null = null;
    for (const p of this.parts) {
      if (!p.group.visible) continue;
      for (const hit of ray.intersectObjects(p.group.children, false)) {
        if (p.planes.every(plane => plane.distanceToPoint(hit.point) >= -1e-5)) {
          if (hit.distance < nearest) { nearest = hit.distance; selected = p.id; }
          break;
        }
      }
    }
    return selected;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const p of this.parts) {
      for (const material of p.materials.values()) material.dispose();
      for (const mesh of p.group.children) if (mesh instanceof InstancedMesh) mesh.dispose();
    }
    // The source owns vertex buffers AND cached index views; they are released
    // together when the building is replaced, never during a mode switch.
  }
}
