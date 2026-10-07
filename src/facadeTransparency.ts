import { Material, Mesh, type Object3D } from "three";
import { cloneShaderMaterial } from "./shaderVariant";

/** Active-view-only variants: never mutate shared kit or interior materials. */
export class FacadeTransparency {
  private variants = new Map<Material, { material: Material; fade: { value: number } }>();
  private originals = new Map<Mesh, { material: Mesh["material"]; castShadow: boolean; visible: boolean }>();

  restore(): void {
    for (const [mesh, state] of this.originals) {
      mesh.material = state.material; mesh.castShadow = state.castShadow; mesh.visible = state.visible;
    }
    this.originals.clear();
  }

  apply(root: Object3D, transparency: number): void {
    this.restore();
    const opacity = 1 - Math.max(0, Math.min(1, transparency));
    if (opacity === 1) return;
    const variant = (base: Material) => {
      let entry = this.variants.get(base);
      if (!entry) {
        const material = cloneShaderMaterial(base), fade = { value: opacity };
        material.transparent = true; material.depthWrite = false;
        const compile = material.onBeforeCompile, key = material.customProgramCacheKey();
        material.onBeforeCompile = (shader, renderer) => {
          compile(shader, renderer);
          shader.uniforms.uFacadeFade = fade;
          shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", "#include <common>\nuniform float uFacadeFade;")
            // Apply after section shading, which deliberately sets black faces' alpha to 1.
            .replace("#include <dithering_fragment>", "gl_FragColor.a *= uFacadeFade;\n#include <dithering_fragment>");
        };
        material.customProgramCacheKey = () => `${key}|facade-fade`;
        entry = { material, fade }; this.variants.set(base, entry);
      }
      entry.fade.value = opacity;
      return entry.material;
    };
    root.traverse(object => {
      if (!(object instanceof Mesh) || !object.userData.facadeShell) return;
      this.originals.set(object, { material: object.material, castShadow: object.castShadow, visible: object.visible });
      object.material = Array.isArray(object.material) ? object.material.map(variant) : variant(object.material);
      object.castShadow = false;
      if (opacity === 0) object.visible = false;
    });
  }

  dispose(): void {
    this.restore();
    for (const { material } of this.variants.values()) material.dispose();
    this.variants.clear();
  }
}
