import { type Material, type Vector3 } from "three";

/** Keep procedural stamps in building-relative world coordinates, without moving clipping/light space. */
export function bindBuildingOrigin(material: Material, origin: Vector3): void {
  const extended = material as Material & { defines?: Record<string, unknown> };
  extended.defines = { ...extended.defines, USE_BUILDING_ORIGIN: "" };
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compile(shader, renderer);
    shader.uniforms.uBuildingOrigin = { value: origin };
  };
  material.customProgramCacheKey = () => `${key}|building-origin`;
  material.needsUpdate = true;
}

/** Three's clone resets shader hooks and may reset built-in material defines. */
export function cloneShaderMaterial(base: Material): Material {
  const material = base.clone();
  const defines = (base as Material & { defines?: Record<string, unknown> }).defines;
  if (defines) (material as Material & { defines?: Record<string, unknown> }).defines = { ...defines };
  material.onBeforeCompile = base.onBeforeCompile;
  // Capture before wrapping: the default key derives from onBeforeCompile.
  const key = base.customProgramCacheKey();
  material.customProgramCacheKey = () => key;
  return material;
}

/** Explicit texture-coordinate contract shared by interior and facade shaders.
 * Ordinary/cut views compile to modelMatrix; unfolding supplies the inverse
 * presentation transform. Lighting and clipping remain in actual world space.
 */
export const SOURCE_FRAME_GLSL = /* glsl */ `
#ifdef USE_SOURCE_FRAME
uniform mat4 uSourceFrame;
#define sourceModelMatrix (uSourceFrame * modelMatrix)
#else
#define sourceModelMatrix modelMatrix
#endif
#ifdef USE_BUILDING_ORIGIN
uniform vec3 uBuildingOrigin;
mat4 buildingModelMatrix(mat4 frame) {
  frame[3].xyz -= uBuildingOrigin;
  return frame;
}
#ifdef USE_SOURCE_FRAME
#undef sourceModelMatrix
#define sourceModelMatrix buildingModelMatrix(uSourceFrame * modelMatrix)
#else
#undef sourceModelMatrix
#define sourceModelMatrix buildingModelMatrix(modelMatrix)
#endif
#endif
`;
