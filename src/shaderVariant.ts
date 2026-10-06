import { type Material } from "three";

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
`;
