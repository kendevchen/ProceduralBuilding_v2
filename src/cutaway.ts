/**
 * Cutting the building open (INTERIOR_SPEC.md §2): one clipping plane, and the
 * materials that go with it.
 *
 * The plane is either horizontal, keeping what is below it, or vertical. A
 * vertical cut runs across the front (keeping the left part) or parallel to it
 * (keeping the back part).
 *
 * While the building is cut, every building material is swapped for a variant
 * that is clipped and double-sided. On the solid ones (stone, plaster, zinc,
 * the interior's white model) a back face means the camera is looking into the
 * solid through the cut, so it is painted the section orange. That way no
 * outline of the cut has to be computed: cornices, slopes and chimneys fill in
 * too. Clipped parts cast no shadows.
 */
import { Color, DoubleSide, type Material, type Mesh, MeshBasicMaterial, MeshStandardMaterial, type Object3D, Plane, Vector3 } from "three";
import type { InteriorMaterials } from "./rooms3d";

export type CutMode = "horizontal" | "vertical";
/** vertical cuts: across the front (the slider runs left to right) or parallel to it (front to back) */
export type CutAxis = "across" | "along";

/** solids: their back faces are the section */
const SOLID = new Set(["stone", "stone_ground", "stone_trim", "plaster", "zinc", "room_wall", "room_floor", "room_ceiling"]);
/** seen only from the front even while cut */
const ONE_SIDED = new Set(["glass"]);

/** white model of the interior (INTERIOR_SPEC.md §4), lifted a little so rooms in shadow stay readable */
function white(name: string, color: string): MeshStandardMaterial {
  return new MeshStandardMaterial({ name, color, roughness: 0.92, emissive: color, emissiveIntensity: 0.22 });
}

export class Cutaway {
  readonly plane = new Plane(new Vector3(0, -1, 0), 0);
  /** the section colour */
  readonly color = { value: new Color("#d9824f") };
  readonly interior: InteriorMaterials;
  private cuts = new Map<Material, Material>();
  private variants = new Set<Material>();

  constructor() {
    // faces inside a solid (the parts of walls within a floor slab) are section on both sides
    const section = new MeshBasicMaterial({ name: "section", side: DoubleSide, clippingPlanes: [this.plane], clipShadows: true });
    section.color = this.color.value;
    this.interior = {
      wall: this.cut(white("room_wall", "#ece6d8")),
      floor: this.cut(white("room_floor", "#ddd8ce")),
      ceiling: this.cut(white("room_ceiling", "#f3f0e9")),
      section,
    };
    this.variants.add(section);
  }

  /** the clipped, double-sided variant of a material (made once; a variant is its own) */
  cut(base: Material): Material {
    let m = this.cuts.get(base);
    if (m) return m;
    if (this.variants.has(base)) return base;
    m = base.clone();
    this.variants.add(m);
    // clone() resets the defines of the standard materials and drops onBeforeCompile
    const defines = (base as Material & { defines?: Record<string, string> }).defines;
    if (defines) (m as Material & { defines?: Record<string, string> }).defines = { ...defines };
    const solid = SOLID.has(base.name);
    if (!ONE_SIDED.has(base.name)) m.side = DoubleSide;
    m.clippingPlanes = [this.plane];
    m.clipShadows = true;
    const color = this.color;
    m.onBeforeCompile = (shader, renderer) => {
      base.onBeforeCompile(shader, renderer);
      if (!solid) return;
      shader.uniforms.uSection = color;
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 uSection;")
        .replace("#include <opaque_fragment>", "#include <opaque_fragment>\nif (!gl_FrontFacing) gl_FragColor = vec4(uSection, 1.0);");
    };
    const key = base.customProgramCacheKey();
    m.customProgramCacheKey = () => `${key}|cut|${solid ? "solid" : "thin"}`;
    this.cuts.set(base, m);
    return m;
  }

  /** swap the materials under `root` for their cut variants, or back */
  apply(root: Object3D, on: boolean): void {
    root.traverse(o => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || mesh.userData.uncut) return;
      const base = (mesh.userData.base ??= mesh.material) as Material;
      mesh.material = on ? this.cut(base) : base;
    });
  }

  /**
   * Place the plane (world space): horizontal at height `at`, keeping what is
   * below; across the front at x = at, keeping the left; parallel to the front
   * at z = at, keeping the back.
   */
  place(mode: CutMode, axis: CutAxis, at: number): void {
    if (mode === "horizontal") this.plane.set(new Vector3(0, -1, 0), at);
    else if (axis === "across") this.plane.set(new Vector3(-1, 0, 0), at);
    else this.plane.set(new Vector3(0, 0, -1), at);
  }
}
