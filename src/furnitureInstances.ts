/** Identical recipes retain their original triangles and stamps, with one instance matrix per copy. */
import { type BufferGeometry, Group, InstancedMesh, type Material, Matrix4 } from 'three';
import { Tris } from './rooms3d';
import type { Stamp } from './finishes';

interface Recipe { parts: { target: Tris; geometry: BufferGeometry }[]; stamps: (Stamp | null)[]; matrices: Matrix4[]; value: unknown }
const owners = new WeakMap<Tris, FurnitureInstances>();
export class FurnitureInstances {
  private recipes = new Map<string, Recipe>();
  register(parts: Tris[]): void { for (const part of parts) owners.set(part, this); }
  record<T>(name: string, targets: Tris[], matrix: Matrix4, args: unknown[], build: (parts: Tris[], identity: Matrix4) => T): { value: T } {
    const mirrored = matrix.determinant() < 0;
    const key = JSON.stringify([name, args, targets.map(t => t.stamp), mirrored]);
    let recipe = this.recipes.get(key);
    if (!recipe) {
      const parts = targets.map(t => { const p = new Tris(); p.stamp = t.stamp; return p; });
      // Three does not support negative instance scales. Bake only the reflection
      // into this recipe, including winding, and retain a positive instance matrix.
      const value = build(parts, mirrored ? new Matrix4().makeScale(-1, 1, 1) : new Matrix4());
      recipe = { parts: parts.flatMap((p, i) => p.pos.length ? [{ target: targets[i], geometry: p.geometry() }] : []),
        stamps: parts.map(p => p.stamp), matrices: [], value };
      this.recipes.set(key, recipe);
    }
    recipe.matrices.push(mirrored ? matrix.clone().multiply(new Matrix4().makeScale(-1, 1, 1)) : matrix.clone());
    // Recipes can change the current colour. Subsequent ordinary triangles keep the same state.
    targets.forEach((target, i) => { target.stamp = recipe!.stamps[i]; });
    return { value: recipe.value as T };
  }
  append(group: Group, materials: Map<Tris, { material: Material; castShadow: boolean }>): void {
    for (const recipe of this.recipes.values()) for (const part of recipe.parts) {
      const entry = materials.get(part.target)!;
      const mesh = new InstancedMesh(part.geometry, entry.material, recipe.matrices.length);
      recipe.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = entry.castShadow; mesh.receiveShadow = true;
      mesh.userData.ownsGeometry = true;
      group.add(mesh);
    }
  }
}
export function instanceRecipe<T>(name: string, parts: Tris[], matrix: Matrix4, args: unknown[], build: (parts: Tris[], identity: Matrix4) => T): { value: T } | null {
  const owner = owners.get(parts[0]);
  return owner && parts.every(p => owners.get(p) === owner) ? owner.record(name, parts, matrix, args, build) : null;
}
