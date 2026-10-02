/**
 * The study lamps' light (INTERIOR_SPEC.md §6.8). A point light costs every lit
 * pixel of every material, and the number of lights changes the shaders, so a
 * building with many studies cannot give each lamp one. A small fixed pool of
 * lights is moved each frame to the lamps nearest to where the camera looks, and
 * the rest of the lamps only glow (their shades are emissive). Fixed count: no
 * shader is recompiled when the pool is switched on or off (intensity 0).
 */
import { type Object3D, PointLight, Vector3 } from "three";

export const LAMP_POOL = 4;

export class LampLights {
  private lights: PointLight[] = [];
  /** the lamps' places in world space */
  private lamps: Vector3[] = [];
  /** the lamps are lit only while the building is cut open */
  on = false;

  constructor(scene: Object3D) {
    for (let i = 0; i < LAMP_POOL; i++) {
      const l = new PointLight(0xffc880, 0, 4.2, 2);
      l.castShadow = false;
      scene.add(l);
      this.lights.push(l);
    }
  }

  setLamps(world: Vector3[]): void {
    this.lamps = world;
  }

  /** point the pool at the lamps nearest to `focus` */
  update(focus: Vector3): void {
    const near = this.on
      ? [...this.lamps].sort((a, b) => a.distanceToSquared(focus) - b.distanceToSquared(focus)).slice(0, LAMP_POOL)
      : [];
    this.lights.forEach((l, i) => {
      if (near[i]) l.position.copy(near[i]);
      l.intensity = near[i] ? 9 : 0;
    });
  }
}
