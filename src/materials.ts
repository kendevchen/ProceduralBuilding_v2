/**
 * Kit materials, looked up by the Blender material names (KIT_SPEC.md §6).
 *
 * Every surface material is a MeshStandardMaterial with layers injected through
 * onBeforeCompile:
 *   1. texture: world-space triplanar projection of a self-made texture set
 *      (blender/bake.py: <set>_color.jpg, <set>_rh.png = roughness, height);
 *   2. pattern, drawn in UV0 (metres): ashlar joints with a tint per block on
 *      the stone, standing seams on the zinc;
 *   3. AO from UV1 (phase F; 1 until then).
 * Heights (texture + pattern, in metres) bump the normal. Per-building colours
 * arrive as instance colours (kit.ts), by each material's `userData.tint`.
 *
 * The railing lace samples one tile of tex/iron_lace.png (a 2 x 2 atlas of
 * 0.9 m tiles) by pattern number, with alpha-tested coverage; each pattern is
 * its own material variant, with a matching depth material for the shadows.
 */
import {
  ClampToEdgeWrapping, type Material, MeshBasicMaterial, MeshDepthMaterial, MeshStandardMaterial, RGBADepthPacking,
  RepeatWrapping, SRGBColorSpace, type Texture, TextureLoader, Vector2, Vector3, DoubleSide,
} from "three";
import dims from "../blender/kit_dims.json";
import { SOURCE_FRAME_GLSL } from "./shaderVariant";

export type TintKey = "stone" | "paint" | "shutter" | "fabric";
type Pattern = "none" | "ashlar" | "ashlarHeads" | "seams" | "stripes";

interface SurfaceSpec {
  /** texture set (tex/<set>_color.jpg + _rh.png) */
  tex: string;
  /** texture tiles per metre */
  scale: number;
  /** triplanar (world space, default) or UV0 (metres) shifted by a random
   *  offset per instance, for surfaces whose texture must follow them (slopes) */
  mapping?: "triplanar" | "uv";
  /** base colour multiplier (sRGB hex) */
  color: number;
  /** roughness at rh.r = 0 and 1 */
  rough: [number, number];
  /** texture height range, metres */
  height: number;
  metalness?: number;
  pattern?: Pattern;
  /** ashlar: half width of the openings the head joints line up with */
  jamb?: number;
  tint?: TintKey;
}

const SURFACES: Record<string, SurfaceSpec> = {
  stone: { tex: "stone", scale: 0.5, color: 0xffffff, rough: [0.72, 0.95], height: 0.002, pattern: "ashlar", jamb: dims.window.width / 2, tint: "stone" },
  stone_ground: { tex: "stone", scale: 0.5, color: 0xf1ede6, rough: [0.74, 0.96], height: 0.002, pattern: "ashlarHeads", jamb: dims.ground.window.width / 2, tint: "stone" },
  stone_trim: { tex: "stone", scale: 0.8, color: 0xfffbf3, rough: [0.66, 0.9], height: 0.0015, tint: "stone" },
  plaster: { tex: "plaster", scale: 0.5, color: 0xffffff, rough: [0.85, 0.98], height: 0.002, tint: "stone" },
  zinc: { tex: "zinc", scale: 0.667, mapping: "uv", color: 0xffffff, rough: [0.3, 0.62], height: 0.0005, metalness: 0.55, pattern: "seams" },
  iron: { tex: "metal", scale: 2, color: 0xffffff, rough: [0.4, 0.75], height: 0.0004, metalness: 0.5 },
  frame: { tex: "wood", scale: 1.25, color: 0xf4f0e8, rough: [0.38, 0.55], height: 0.0003 },
  paint: { tex: "wood", scale: 1.25, color: 0xffffff, rough: [0.3, 0.5], height: 0.0003, tint: "paint" },
  shutter: { tex: "wood", scale: 1.25, color: 0xffffff, rough: [0.4, 0.6], height: 0.0003, metalness: 0.15, tint: "shutter" },
  terracotta: { tex: "terracotta", scale: 2, color: 0xffffff, rough: [0.8, 0.95], height: 0.002 },
  fabric: { tex: "fabric", scale: 5, color: 0xffffff, rough: [0.88, 1.0], height: 0.0004, pattern: "stripes", tint: "fabric" },
};

export const LACE_PATTERNS = ["欄杆與圓環", "交織圓環", "渦卷", "菱形"];
const LACE_TILE = 0.9; // metres per atlas tile (bake.py)

/**
 * The facade looks (setLook): Haussmann is the kit as it is; "paris" is the
 * pale limestone of a 1900s Paris street front: cream, smooth, fine joints,
 * a darker zinc roof and cream shutters. Only colour and shader values, no parts.
 */
export type FacadeLook = "haussmann" | "paris";

interface LookSpec {
  texMix: number;
  sat: number;
  bright: number;
  joint: number;
  block: number;
  tone: [number, number, number];
  /** multiplier on the zinc roof, and the default shutter paint */
  zinc: number;
  shutter: string;
}

export const FACADE_LOOKS: Record<FacadeLook, LookSpec> = {
  haussmann: { texMix: 1, sat: 1, bright: 1, joint: 1, block: 1, tone: [1, 1, 1], zinc: 1, shutter: "#c9c5ba" },
  paris: { texMix: 0.6, sat: 0.85, bright: 1.1, joint: 0.5, block: 0.6, tone: [1.04, 0.99, 0.86], zinc: 0.68, shutter: "#e8e3d4" },
};

/** the uniforms stone and plaster share: changing a value restyles every building at once */
const look = {
  stone: {
    uTexMix: { value: 1 }, uSat: { value: 1 }, uBright: { value: 1 }, uJointDepth: { value: 1 }, uBlockVar: { value: 1 },
    uTone: { value: new Vector3(1, 1, 1) },
  },
};
const neutral = {
  uTexMix: { value: 1 }, uSat: { value: 1 }, uBright: { value: 1 }, uJointDepth: { value: 1 }, uBlockVar: { value: 1 },
  uTone: { value: new Vector3(1, 1, 1) },
};

// ---------------------------------------------------------------- GLSL

const VERT_PARS = /* glsl */ `
${SOURCE_FRAME_GLSL}
varying vec3 vTriPos;
varying vec3 vTriNrm;
varying vec2 vPatUv;
varying vec2 vUvShift;
`;

const VERT_MAIN = /* glsl */ `
vec4 triWorld = vec4(transformed, 1.0);
vec4 triOrigin = vec4(0.0, 0.0, 0.0, 1.0);
#ifdef USE_INSTANCING
  triWorld = instanceMatrix * triWorld;
  triOrigin = instanceMatrix * triOrigin;
#endif
triWorld = sourceModelMatrix * triWorld;
triOrigin = sourceModelMatrix * triOrigin;
vTriPos = triWorld.xyz;
vec3 triNormal = objectNormal;
#ifdef USE_INSTANCING
  triNormal = mat3(instanceMatrix) * triNormal;
#endif
vTriNrm = normalize(mat3(sourceModelMatrix) * triNormal);
vPatUv = uv;
// random texture offset per instance (UV-mapped surfaces): same for every vertex
vUvShift = fract(sin(vec2(dot(triOrigin.xyz, vec3(12.9898, 78.233, 37.719)),
                          dot(triOrigin.xyz, vec3(39.346, 11.135, 83.155)))) * 43758.5453) * 17.0;
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vTriPos;
varying vec3 vTriNrm;
varying vec2 vPatUv;
varying vec2 vUvShift;
uniform sampler2D uTriColor;
uniform sampler2D uTriRH;
uniform float uTriScale;
uniform vec2 uTriRough;
uniform float uTriHeight;
uniform float uJamb;
// the facade look (setLook): how much of the texture's detail, its saturation and brightness, joint depth, block variation
uniform float uTexMix;
uniform float uSat;
uniform float uBright;
uniform float uJointDepth;
uniform float uBlockVar;
uniform vec3 uTone;

// the texture with less of its detail, less saturated, brighter, toned (identity for the Haussmann look)
vec3 facadeTone(vec3 c) {
  c = mix(vec3(0.8), c, uTexMix);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return mix(vec3(l), c, uSat) * uBright * uTone;
}

float triHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec4 triSample(sampler2D t, vec3 p, vec3 w) {
  return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z;
}

// Ashlar coursing (KIT_SPEC.md 6.4): 0.4 m courses; head joints at the bay
// centre and edges on even courses, at the jambs (+-jamb) on odd ones.
// Returns the joint coverage; blockRnd is a random value per block.
float ashlar(vec2 uv, float jamb, float beds, float heads, out float blockRnd) {
  float course = ${dims.course.toFixed(3)};
  float c = floor(uv.y / course);
  float dz = abs(fract(uv.y / course + 0.5) - 0.5) * course;
  float dx, id;
  if (mod(c, 2.0) < 0.5) {
    dx = abs(fract(uv.x / 1.5 + 0.5) - 0.5) * 1.5;
    id = floor(uv.x / 1.5);
  } else {
    float t = uv.x + jamb;
    float k = floor(t / 3.0);
    float r = t - 3.0 * k;
    dx = min(min(r, abs(r - 2.0 * jamb)), 3.0 - r);
    id = 2.0 * k + step(2.0 * jamb, r);
  }
  blockRnd = triHash(vec2(id, c));
  float d = mix(1e3, dz, beds);
  d = min(d, mix(1e3, dx, heads));
  float w = 0.005;
  float aa = fwidth(d) + 1e-5;
  return 1.0 - smoothstep(w - aa, w + aa, d);
}

// bump from a smooth height field in metres (Mikkelsen, unnormalized surface gradients)
vec3 triPerturb(vec3 surfPos, vec3 surfNorm, float h, float faceDir) {
  vec3 dpdx = dFdx(surfPos);
  vec3 dpdy = dFdy(surfPos);
  vec3 r1 = cross(dpdy, surfNorm);
  vec3 r2 = cross(surfNorm, dpdx);
  float det = dot(dpdx, r1) * faceDir;
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * surfNorm - grad);
}

// unit surface direction of increasing u (cotangent frame from derivatives of
// smooth quantities only, so thin patterns get stable analytic normals)
vec3 patTangentU(vec3 n, vec3 p, vec2 uv) {
  vec3 dp1 = dFdx(p), dp2 = dFdy(p);
  vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
  vec3 t = cross(dp2, n) * duv1.x + cross(n, dp1) * duv2.x;
  return t * inversesqrt(max(dot(t, t), 1e-20));
}
`;

const FRAG_MAP = /* glsl */ `
#ifdef MAP_UV
  vec2 triUv = (vPatUv + vUvShift) * uTriScale;
  diffuseColor.rgb *= facadeTone(texture2D(uTriColor, triUv).rgb);
  vec2 triRH = texture2D(uTriRH, triUv).rg;
#else
  vec3 triW = pow(abs(vTriNrm), vec3(4.0));
  triW /= triW.x + triW.y + triW.z;
  vec3 triP = vTriPos * uTriScale;
  diffuseColor.rgb *= facadeTone(triSample(uTriColor, triP, triW).rgb);
  vec2 triRH = triSample(uTriRH, triP, triW).rg;
#endif
float triRough = mix(uTriRough.x, uTriRough.y, triRH.r);
float triH = (triRH.g - 0.5) * uTriHeight;
#if defined(PAT_ASHLAR) || defined(PAT_ASHLAR_HEADS)
  // joints: colour and roughness only (too thin for a stable bump)
  float blockRnd;
  #ifdef PAT_ASHLAR
    float joint = ashlar(vPatUv, uJamb, 1.0, 1.0, blockRnd);
  #else
    float joint = ashlar(vPatUv, uJamb, 0.0, 1.0, blockRnd);
  #endif
  diffuseColor.rgb *= (1.0 + (blockRnd - 0.5) * 0.09 * uBlockVar) * mix(1.0, 0.78, joint * uJointDepth);
  triRough = mix(triRough, 1.0, joint * 0.5);
#endif
#ifdef PAT_SEAMS
  // standing seams every 0.5 m along u: a 2.4 cm wide ridge; its slope is
  // applied analytically in the normal chunk, faded once below a pixel
  float seamS = (fract(vPatUv.x / 0.5 + 0.5) - 0.5) * 0.5;
  float seamT = clamp(abs(seamS) / 0.012, 0.0, 1.0);
  float seamFade = clamp(1.5 - fwidth(vPatUv.x) / 0.01, 0.0, 1.0);
  float seamSlope = -sign(seamS) * 0.9 * 6.0 * seamT * (1.0 - seamT) * seamFade;
  diffuseColor.rgb *= 1.0 + 0.08 * (1.0 - seamT) * seamFade;
#endif
`;

// after the instance colour (the tint) is applied: awning stripes stay light
const FRAG_COLOR = /* glsl */ `
#include <color_fragment>
#ifdef PAT_STRIPES
  float stripe = step(0.5, fract(vPatUv.x / 0.5));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.84, 0.78), stripe);
#endif
`;

const FRAG_ROUGH = /* glsl */ `
float roughnessFactor = triRough;
`;

const FRAG_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
normal = triPerturb(-vViewPosition, normal, triH, faceDirection);
#ifdef PAT_SEAMS
  normal = normalize(normal - patTangentU(normal, -vViewPosition, vPatUv) * seamSlope);
#endif
`;

// ---- railing lace: one atlas tile per pattern ----
const LACE_PARS = /* glsl */ `
varying vec2 vPatUv;
uniform float uPattern;
`;

const LACE_MAP = /* glsl */ `
{
  vec2 cont = vec2(vPatUv.x / ${LACE_TILE.toFixed(2)}, clamp(vPatUv.y, 0.0, 1.0));
  vec2 tile = vec2(mod(uPattern, 2.0), floor(uPattern / 2.0));
  // stay half a texel inside the tile: its edges wrap onto each other
  vec2 inner = vec2(fract(cont.x), cont.y) * (1.0 - 1.0 / 512.0) + 0.5 / 512.0;
  vec4 lace = textureGrad(map, (tile + inner) * 0.5, dFdx(cont) * 0.5, dFdy(cont) * 0.5);
  // far away a texel is much smaller than a pixel: the mip levels average the thin iron into a faint
  // film that the alpha test throws away. Widen the bars with the distance: how many texels one pixel
  // spans (1 up close) lifts the coverage, so the bars stay as thin lines (see the lace's flat 16% fill).
  float span = max(length(dFdx(cont)), length(dFdy(cont))) * 1024.0;      // texels per pixel
  float lift = clamp(log2(max(span, 1.0)) * 0.2, 0.0, 0.35);               // 0 up close .. 0.35 far
  lace.a = clamp(lace.a * (1.0 + 4.0 * lift) + lift * 0.35, 0.0, 1.0);
  diffuseColor *= lace;
}
`;

// ---- interiors: room boxes painted from the atlas (interiors.ts, rooms.py) ----
const ROOM_VERT = /* glsl */ `
attribute vec3 roomLocal;
attribute vec4 roomInfo;
attribute float roomH;
varying vec3 vRoom;
varying vec4 vRoomInfo;
varying float vRoomH;
`;

const ROOM_FRAG_PARS = /* glsl */ `
varying vec3 vRoom;
varying vec4 vRoomInfo;
varying float vRoomH;
uniform sampler2D uAtlas;
uniform float uNight;
`;

// same pinhole as rooms.py: 16 m in front of the room's open front, framing
// 4H x H there; cell k of the 2 x 9 atlas at column k % 2, row k / 2
const ROOM_FRAG = /* glsl */ `
{
  float H = vRoomH;
  float persp = 16.0 / (vRoom.y + 16.0);
  float u = 0.5 + (vRoom.x - vRoomInfo.y) * persp / (4.0 * H);
  float v = 0.5 + (vRoom.z - 0.5 * H) * persp / H;
  if (vRoomInfo.z > 0.5) u = 1.0 - u;
  u = clamp(u, 0.003, 0.997);
  v = clamp(v, 0.01, 0.99);
  vec2 cell = vec2(mod(vRoomInfo.x, 2.0), floor(vRoomInfo.x / 2.0 + 0.01));
  vec3 photo = texture2D(uAtlas, vec2((cell.x + u) * 0.5, (cell.y + v) / 9.0)).rgb;
  float light = vRoomInfo.w;
  // day: rooms read darker than the street; night: lit rooms glow warm, the others go dark
  float lit = light > 0.75 ? 1.0 : 0.0;
  vec3 warm = mix(vec3(1.0), vec3(1.0, 0.8, 0.58), lit * uNight);
  float gain = mix(0.42 * light, mix(0.06, 1.9 * light, lit), uNight);
  float falloff = mix(1.0, 0.6, clamp(vRoom.y / 5.0, 0.0, 1.0));
  diffuseColor.rgb = photo * warm * gain * falloff;
}
`;

// glass: transparent, more opaque and reflective at grazing angles (Fresnel)
const GLASS_FRAG = /* glsl */ `
float glassF = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);
gl_FragColor = vec4(outgoingLight, clamp(diffuseColor.a + glassF * 0.75, 0.0, 1.0));
`;

// ---------------------------------------------------------------- building

function surface(name: string, spec: SurfaceSpec, color: Texture, rh: Texture, ao: Texture | null): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    name, color: spec.color, roughness: 1, metalness: spec.metalness ?? 0,
    aoMap: ao, aoMapIntensity: 1,
  });
  mat.userData.tint = spec.tint;
  const defines: Record<string, string> = {};
  if (spec.pattern === "ashlar") defines.PAT_ASHLAR = "";
  if (spec.pattern === "ashlarHeads") defines.PAT_ASHLAR_HEADS = "";
  if (spec.pattern === "seams") defines.PAT_SEAMS = "";
  if (spec.pattern === "stripes") defines.PAT_STRIPES = "";
  if (spec.mapping === "uv") defines.MAP_UV = "";
  mat.defines = defines;
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      uTriColor: { value: color },
      uTriRH: { value: rh },
      uTriScale: { value: spec.scale },
      uTriRough: { value: new Vector2(...spec.rough) },
      uTriHeight: { value: spec.height },
      uJamb: { value: spec.jamb ?? 0.65 },
      // stone and plaster follow the facade look; the other surfaces keep the plain values
      ...(spec.tint === "stone" ? look.stone : neutral),
    });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERT_PARS}`)
      .replace("#include <worldpos_vertex>", `#include <worldpos_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAG_PARS}`)
      .replace("#include <map_fragment>", FRAG_MAP)
      .replace("#include <color_fragment>", FRAG_COLOR)
      .replace("#include <roughnessmap_fragment>", FRAG_ROUGH)
      .replace("#include <normal_fragment_maps>", FRAG_NORMAL);
  };
  mat.customProgramCacheKey = () => `kit-surface|${spec.pattern ?? "none"}|${spec.mapping ?? "triplanar"}`;
  return mat;
}

function laceShader(shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, { value: unknown }> }, pattern: number) {
  shader.uniforms.uPattern = { value: pattern };
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${LACE_PARS}`)
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPatUv = uv;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${LACE_PARS}`)
    .replace("#include <map_fragment>", LACE_MAP);
}

export interface KitMaterials {
  byName: Map<string, Material>;
  /** room boxes and curtains (interiors.ts) */
  interior: Material;
  voile: Material;
  /** the stone, plaster and roof colours of a facade look */
  setLook(l: FacadeLook): void;
  /** 0 day .. 1 night: lit rooms glow, the others go dark */
  setNight(v: number): void;
  /** railing lace material and its shadow depth material, per atlas pattern */
  lace(pattern: number): Material;
  laceDepth(pattern: number): Material;
}

export async function createMaterials(base: string): Promise<KitMaterials> {
  const loader = new TextureLoader();
  const load = (file: string, srgb: boolean) => loader.loadAsync(`${base}assets/tex/${file}`).then(t => {
    t.wrapS = t.wrapT = RepeatWrapping;
    if (srgb) t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  });
  const sets = [...new Set(Object.values(SURFACES).map(s => s.tex))];
  const [laceTex, atlas, aoTex, ...setTex] = await Promise.all([
    load("iron_lace.png", true),
    load("interiors.jpg", true),
    load("kit_ao.jpg", false),
    ...sets.flatMap(s => [load(`${s}_color.jpg`, true), load(`${s}_rh.png`, false)]),
  ]);
  const tex = new Map(sets.map((s, i) => [s, { color: setTex[2 * i], rh: setTex[2 * i + 1] }]));

  const byName = new Map<string, Material>();
  for (const [name, spec] of Object.entries(SURFACES)) {
    const t = tex.get(spec.tex)!;
    byName.set(name, surface(name, spec, t.color, t.rh, aoTex));
    // the geometry made in the browser (roof top, party walls) has no UV1
    byName.set(`${name}:noao`, surface(name, spec, t.color, t.rh, null));
  }
  // opaque reflective glass until the interiors arrive (phase F)
  aoTex.channel = 1;
  aoTex.wrapS = aoTex.wrapT = ClampToEdgeWrapping;
  const glass = new MeshStandardMaterial({
    name: "glass", color: 0x1c252c, roughness: 0.02, metalness: 0, envMapIntensity: 1.8,
    transparent: true, opacity: 0.12, depthWrite: false,
  });
  glass.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", GLASS_FRAG);
  };
  glass.customProgramCacheKey = () => "kit-glass";
  byName.set("glass", glass);

  atlas.wrapS = atlas.wrapT = ClampToEdgeWrapping;
  const night = { value: 0 };
  const interior = new MeshBasicMaterial({ name: "interior", side: DoubleSide });
  interior.onBeforeCompile = shader => {
    shader.uniforms.uAtlas = { value: atlas };
    shader.uniforms.uNight = night;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${ROOM_VERT}`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRoom = roomLocal; vRoomInfo = roomInfo; vRoomH = roomH;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${ROOM_FRAG_PARS}`)
      .replace("#include <map_fragment>", ROOM_FRAG);
  };
  interior.customProgramCacheKey = () => "kit-interior";
  const voile = new MeshStandardMaterial({ name: "voile", color: 0xe6ddcc, roughness: 0.92, side: DoubleSide });
  byName.set("debug", new MeshStandardMaterial({ name: "debug", color: 0xff00ff }));

  const laceMats = new Map<number, Material>();
  const laceDepths = new Map<number, Material>();
  const lace = (pattern: number) => {
    let m = laceMats.get(pattern);
    if (!m) {
      const mat = new MeshStandardMaterial({
        name: "iron_lace", color: 0x17181a, roughness: 0.5, metalness: 0.5,
        map: laceTex, alphaTest: 0.45, side: DoubleSide,
      });
      mat.onBeforeCompile = shader => laceShader(shader, pattern);
      mat.customProgramCacheKey = () => "kit-lace";
      laceMats.set(pattern, (m = mat));
    }
    return m;
  };
  const laceDepth = (pattern: number) => {
    let m = laceDepths.get(pattern);
    if (!m) {
      const mat = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map: laceTex, alphaTest: 0.45, side: DoubleSide });
      mat.onBeforeCompile = shader => laceShader(shader, pattern);
      mat.customProgramCacheKey = () => "kit-lace-depth";
      laceDepths.set(pattern, (m = mat));
    }
    return m;
  };
  const laceBase = lace(0);
  laceBase.userData.lace = true;
  byName.set("iron_lace", laceBase);
  const setLook = (l: FacadeLook) => {
    const s = FACADE_LOOKS[l], u = look.stone;
    u.uTexMix.value = s.texMix;
    u.uSat.value = s.sat;
    u.uBright.value = s.bright;
    u.uJointDepth.value = s.joint;
    u.uBlockVar.value = s.block;
    u.uTone.value.set(...s.tone);
    for (const n of ["zinc", "zinc:noao"]) (byName.get(n) as MeshStandardMaterial).color.setScalar(s.zinc);
  };
  return { byName, lace, laceDepth, interior, voile, setLook, setNight: v => { night.value = v; } };
}
