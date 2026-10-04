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
import { finishMaterial } from "./finishes";
import type { InteriorMaterials } from "./rooms3d";

export type CutMode = "horizontal" | "vertical";
/** vertical cuts: across the front (the slider runs left to right) or parallel to it (front to back) */
export type CutAxis = "across" | "along";

/** solids: their back faces are the section */
const SOLID = new Set(["stone", "stone_ground", "stone_trim", "plaster", "zinc", "room_wall", "room_floor", "room_ceiling", "room_stair", "room_finish_wall", "furn_wood", "furn_fabric", "furn_linen", "furn_gold", "furn_dark", "furn_brass", "furn_leather"]);
/** seen only from the front even while cut */
const ONE_SIDED = new Set(["glass"]);

/** white model of the interior (INTERIOR_SPEC.md §4), lifted a little so rooms in shadow stay readable */
function white(name: string, color: string, roughness = 0.92, metalness = 0): MeshStandardMaterial {
  return new MeshStandardMaterial({ name, color, roughness, metalness, emissive: color, emissiveIntensity: 0.22 });
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
      // the stairs (INTERIOR_SPEC.md §7.3): white steps, dark railing and handrail, a red runner
      stair: this.cut(white("room_stair", "#efeae0")),
      carpet: this.cut(white("stair_carpet", "#8a2b2b", 0.95)),
      iron: this.cut(white("stair_iron", "#2c2e31", 0.5, 0.4)),
      wood: this.cut(white("stair_wood", "#4a2e1d", 0.45)),
      // furniture (furniture.ts): banquet chairs and table
      furnWood: this.cut(white("furn_wood", "#6a4426", 0.55)),
      furnFabric: this.cut(white("furn_fabric", "#9e9255", 0.9)),
      furnLinen: this.cut(white("furn_linen", "#f4f1ea", 0.95)),
      furnGold: this.cut(white("furn_gold", "#a8944a", 0.9)),
      furnDark: this.cut(white("furn_dark", "#2e2823", 0.5)),
      furnBrass: this.cut(white("furn_brass", "#b8913f", 0.35, 0.6)),
      furnLeather: this.cut(white("furn_leather", "#5b2c1d", 0.6)),
      // a lamp shade glows: warm, lit from inside (the lamp's own point light is lampLights.ts)
      furnShade: this.cut(new MeshStandardMaterial({ name: "furn_shade", color: "#f4e8cf", emissive: "#ffcf8a", emissiveIntensity: 1.1, roughness: 0.9 })),
      furnBulb: this.cut(new MeshStandardMaterial({ name: "banquet_bulb", color: "#fff2d8", emissive: "#ffdca2", emissiveIntensity: 0.45, roughness: 0.55 })),
      furnCrystal: this.cut(white("banquet_crystal", "#e0e8e5", 0.16, 0.12)),
      furnGlass: this.cut(new MeshStandardMaterial({ name: "cabinet_glass", color: "#bfcfc9", transparent: true, opacity: 0.16, depthWrite: false, roughness: 0.2 })),
      finishWall: this.cut(finishMaterial("wall")),
      finishFloor: this.cut(finishMaterial("floor")),
    };
    this.variants.add(section);
  }

  /** Shared original materials for the furniture overview, without clipping or section shading. */
  get galleryInterior(): InteriorMaterials {
    return Object.fromEntries(Object.entries(this.interior).map(([key, material]) => {
      const original = [...this.cuts].find(([, variant]) => variant === material)?.[0] ?? material;
      return [key, original];
    })) as unknown as InteriorMaterials;
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
   * at z = at, keeping the back. `flip` (vertical cuts) keeps the other side:
   * the right, the front.
   */
  place(mode: CutMode, axis: CutAxis, at: number, flip = false): void {
    const side = flip ? -1 : 1;
    if (mode === "horizontal") this.plane.set(new Vector3(0, -1, 0), at);
    else if (axis === "across") this.plane.set(new Vector3(-side, 0, 0), side * at);
    else this.plane.set(new Vector3(0, 0, -side), side * at);
  }
}
