/**
 * Room finishes (INTERIOR_SPEC.md §6.7): how the cut-open interior is shown.
 *   - real: a floor and a wall finish per room type, drawn procedurally in the
 *     shader (self-made, no textures): herringbone parquet, boards, hexagonal
 *     tiles (tomettes), a marble chequerboard; paint, wallpaper, boiserie
 *     panels, wall tiles;
 *   - diagram: one colour per room type (plan.ts ROOM_INFO), the walls paler;
 *   - white: the white model (cutaway.ts), no finishes.
 * The finish travels with every vertex (a "stamp": pattern, two colours, the
 * room's floor and ceiling heights), so all the rooms' walls are one mesh and
 * all their floors another. Patterns run in metres in Blender space (z up =
 * three's y); wall patterns are measured up from the room's own floor.
 */
import { type BufferGeometry, Color, Float32BufferAttribute, MeshStandardMaterial } from "three";
import { type PlanRoom, ROOM_INFO, type RoomType } from "./plan";

export type Look = "real" | "diagram" | "white";

/** pattern, colour A (rgb), colour B (rgb), floor and ceiling (z) */
export type Stamp = [number, number, number, number, number, number, number, number, number];

const P = {
  plain: 0, herringbone: 1, boards: 2, hexMixed: 3, hexSparse: 4, marble: 5,
  paint: 10, wallpaper: 11, boiserie: 12, tiles: 13,
} as const;
type Pattern = (typeof P)[keyof typeof P];

interface Finish { pattern: Pattern; a: string; b: string }

const FLOORS: Record<RoomType, Finish> = {
  salon: { pattern: P.herringbone, a: "#a57447", b: "#7a5130" },
  dining: { pattern: P.herringbone, a: "#9c6a40", b: "#74492a" },
  study: { pattern: P.herringbone, a: "#8a5a36", b: "#5e3a22" },
  ballroom: { pattern: P.herringbone, a: "#b88550", b: "#8a5a33" },
  bedroom: { pattern: P.herringbone, a: "#b0835a", b: "#8b6343" },
  concierge: { pattern: P.boards, a: "#9a7550", b: "#6f5136" },
  corridor: { pattern: P.boards, a: "#a07a52", b: "#755638" },
  maid: { pattern: P.boards, a: "#b39268", b: "#8d6f4b" },
  storage: { pattern: P.boards, a: "#8f7a63", b: "#6b5a48" },
  shopBack: { pattern: P.boards, a: "#8f7a63", b: "#6b5a48" },
  kitchen: { pattern: P.hexMixed, a: "#a8553a", b: "#924630" },
  wc: { pattern: P.hexSparse, a: "#e9e6df", b: "#2f2f33" },
  vestibule: { pattern: P.marble, a: "#e6e1d6", b: "#33302d" },
  stair: { pattern: P.marble, a: "#e6e1d6", b: "#33302d" },
  shop: { pattern: P.marble, a: "#ddd5c4", b: "#8c3c2e" },
};

const WALLS: Record<RoomType, Finish> = {
  salon: { pattern: P.boiserie, a: "#ebe3d1", b: "#c9bea6" },
  dining: { pattern: P.boiserie, a: "#dde2d4", b: "#b9c0ad" },
  ballroom: { pattern: P.boiserie, a: "#f0e8d6", b: "#c49a45" },
  vestibule: { pattern: P.boiserie, a: "#e2d6be", b: "#bfae8c" },
  study: { pattern: P.boiserie, a: "#5d6e57", b: "#3f4c3b" },
  bedroom: { pattern: P.wallpaper, a: "#dcc9c1", b: "#b08f86" },
  concierge: { pattern: P.wallpaper, a: "#d6d0b8", b: "#a3997a" },
  kitchen: { pattern: P.tiles, a: "#f2f0ea", b: "#e7e1d0" },
  wc: { pattern: P.tiles, a: "#eef2f2", b: "#cfdde0" },
  corridor: { pattern: P.paint, a: "#e6dece", b: "#d8ccb3" },
  stair: { pattern: P.paint, a: "#e2d7c2", b: "#c9b99b" },
  shop: { pattern: P.paint, a: "#ece6d8", b: "#cfc4ac" },
  shopBack: { pattern: P.paint, a: "#d9d3c7", b: "#b8b0a2" },
  storage: { pattern: P.paint, a: "#d9d3c7", b: "#b8b0a2" },
  maid: { pattern: P.paint, a: "#ebe5d6", b: "#cfc6b2" },
};

/** reveals, door jambs, the attic's outer walls: plain paint */
const PLAIN_COLOR = "#ece6d8";
const rgb = (hex: string) => new Color(hex).toArray() as [number, number, number];

function stamp(pattern: Pattern, a: [number, number, number], b: [number, number, number], z0 = 0, z1 = 3): Stamp {
  return [pattern, ...a, ...b, z0, z1];
}

export const PLAIN: Stamp = stamp(P.plain, rgb(PLAIN_COLOR), rgb(PLAIN_COLOR));

/** the stamp for a room's walls or floor in a look; null: the white model draws it (no finish) */
export function stampOf(look: Look, room: PlanRoom | null, surface: "wall" | "floor"): Stamp | null {
  if (look === "white") return null;
  if (!room) return PLAIN;
  if (look === "diagram") {
    const c = new Color(ROOM_INFO[room.type].color);
    if (surface === "wall") c.lerp(new Color("#ffffff"), 0.72);
    const v = c.toArray() as [number, number, number];
    return stamp(surface === "wall" ? P.paint : P.plain, v, v, room.floorZ, room.ceilingZ);
  }
  const f = (surface === "wall" ? WALLS : FLOORS)[room.type];
  return stamp(f.pattern, rgb(f.a), rgb(f.b), room.floorZ, room.ceilingZ);
}

/** the stamps of a mesh's vertices as the attributes the finish shader reads */
export function stampAttributes(g: BufferGeometry, stamps: number[]) {
  const n = stamps.length / 9;
  const pat = new Float32Array(n), a = new Float32Array(3 * n), b = new Float32Array(3 * n), z = new Float32Array(2 * n);
  for (let i = 0; i < n; i++) {
    const s = 9 * i;
    pat[i] = stamps[s];
    a.set(stamps.slice(s + 1, s + 4), 3 * i);
    b.set(stamps.slice(s + 4, s + 7), 3 * i);
    z.set(stamps.slice(s + 7, s + 9), 2 * i);
  }
  g.setAttribute("finPattern", new Float32BufferAttribute(pat, 1));
  g.setAttribute("finA", new Float32BufferAttribute(a, 3));
  g.setAttribute("finB", new Float32BufferAttribute(b, 3));
  g.setAttribute("finZ", new Float32BufferAttribute(z, 2));
}

// ---------------------------------------------------------------- shader

const VERT_PARS = /* glsl */ `
attribute float finPattern;
attribute vec3 finA;
attribute vec3 finB;
attribute vec2 finZ;
varying float vFinPattern;
varying vec3 vFinA;
varying vec3 vFinB;
varying vec2 vFinZ;
varying vec3 vFinPos;
varying vec3 vFinN;
`;

const VERT_MAIN = /* glsl */ `
vFinPattern = finPattern;
vFinA = finA;
vFinB = finB;
vFinZ = finZ;
vFinPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vFinN = normalize(mat3(modelMatrix) * objectNormal);
`;

const FRAG_PARS = /* glsl */ `
varying float vFinPattern;
varying vec3 vFinA;
varying vec3 vFinB;
varying vec2 vFinZ;
varying vec3 vFinPos;
varying vec3 vFinN;

float finHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float finNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(finHash(i), finHash(i + vec2(1, 0)), f.x), mix(finHash(i + vec2(0, 1)), finHash(i + vec2(1, 1)), f.x), f.y);
}
float finFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * finNoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
// 1 on a line where d (metres from it) is within w, antialiased
float finLine(float d, float w) {
  float aa = fwidth(d) + 1e-5;
  return 1.0 - smoothstep(w - aa, w + aa, d);
}

// herringbone parquet: planks n x 1 (width w) at 45 degrees; returns colour, roughness in .w
vec4 finHerringbone(vec2 uv, vec3 A, vec3 B) {
  float w = 0.085, n = 6.0;
  vec2 q = mat2(0.7071, -0.7071, 0.7071, 0.7071) * uv / w;
  vec2 c = floor(q), f = fract(q);
  float d = c.x - c.y, r = mod(d, 2.0 * n);
  float m, k, along, across;
  bool h = r < n;
  if (h) { m = floor(d / (2.0 * n)); k = c.y + m * n; along = c.x - k - m * n + f.x; across = f.y; }
  else { m = floor(d / (2.0 * n)) + 1.0; k = c.x - m * n; along = c.y - (k + 1.0 - m * n) + f.y; across = f.x; }
  float id = finHash(vec2(k, m + (h ? 0.5 : 0.0)));
  float grain = finNoise(vec2(along * 1.5 + id * 17.0, across * 9.0 + id * 5.0));
  vec3 col = mix(A, B, 0.15 + 0.6 * id) * (0.86 + 0.28 * grain);
  float joint = max(finLine(min(across, 1.0 - across) * w, 0.0012), finLine(min(along, n - along) * w, 0.0012));
  return vec4(col * (1.0 - 0.5 * joint), 0.42 + 0.2 * grain);
}

// straight boards, rows staggered
vec4 finBoards(vec2 uv, vec3 A, vec3 B) {
  float w = 0.14, len = 1.6;
  float row = floor(uv.y / w);
  float u = uv.x + finHash(vec2(row, 3.0)) * len;
  float seg = floor(u / len);
  float across = fract(uv.y / w), along = fract(u / len);
  float id = finHash(vec2(row, seg));
  float grain = finNoise(vec2(u * 2.0, uv.y * 30.0 + id * 9.0));
  vec3 col = mix(A, B, 0.2 + 0.5 * id) * (0.85 + 0.3 * grain);
  float joint = max(finLine(min(across, 1.0 - across) * w, 0.0012), finLine(min(along, 1.0 - along) * len, 0.0012));
  return vec4(col * (1.0 - 0.5 * joint), 0.5 + 0.2 * grain);
}

// hexagonal tiles; a share (rare) of them in colour B
vec4 finHex(vec2 uv, vec3 A, vec3 B, float rare) {
  float s = 0.18;
  vec2 p = uv / s, R = vec2(1.0, 1.7320508), H = R * 0.5;
  vec2 a = mod(p, R) - H, b = mod(p - H, R) - H;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 cell = floor((p - g) * 2.0 + 0.5);
  float edge = 0.5 - max(dot(abs(g), normalize(R)), abs(g.x));
  float id = finHash(cell);
  vec3 col = (id < rare ? B : A) * (0.88 + 0.22 * finHash(cell + 3.1)) * (0.95 + 0.1 * finNoise(uv * 20.0));
  float grout = finLine(edge * s, 0.0025);
  return vec4(mix(col, vec3(0.62, 0.6, 0.56) * dot(A, vec3(0.33)) * 1.2, grout), mix(0.35, 0.9, grout));
}

// marble chequerboard
vec4 finMarble(vec2 uv, vec3 A, vec3 B) {
  float s = 0.4;
  vec2 c = floor(uv / s), f = fract(uv / s);
  bool dark = mod(c.x + c.y, 2.0) > 0.5;
  vec3 base = dark ? B : A;
  float v = finFbm(uv * 2.2 + c * 3.1);
  float vein = finLine(abs(sin((uv.x * 1.3 + uv.y) * 3.5 + v * 7.0)) * 0.06, 0.004);
  vec3 col = base * (0.95 + 0.08 * finNoise(uv * 9.0 + c));
  col = mix(col, dark ? base * 2.2 : base * 0.72, vein * 0.55);
  float joint = finLine(min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * s, 0.001);
  return vec4(col * (1.0 - 0.3 * joint), 0.12);
}

// boiserie: panels of moulding below the dado rail and up to the cornice
float finPanel(float u, float h, float z0, float z1) {
  float px = fract(u / 0.9) * 0.9;
  if (px < 0.08 || px > 0.82 || h < z0 || h > z1) return -1.0;
  return min(min(px - 0.08, 0.82 - px), min(h - z0, z1 - h));
}
`;

const FRAG_MAP = /* glsl */ `
float finRough = 0.85;
{
  int pat = int(vFinPattern + 0.5);
  vec3 A = vFinA, B = vFinB;
  vec3 col = A;
  vec3 N = normalize(vFinN);
  if (pat < 10) {
    // floors (and plain faces): Blender xy is three's xz
    vec2 uv = vFinPos.xz;
    vec4 r = vec4(A * (0.97 + 0.06 * finNoise(uv * 3.0 + vFinPos.y * 1.7)), 0.85);
    if (pat == 1) r = finHerringbone(uv, A, B);
    else if (pat == 2) r = finBoards(uv, A, B);
    else if (pat == 3) r = finHex(uv, A, B, 0.5);
    else if (pat == 4) r = finHex(uv, A, B, 0.1);
    else if (pat == 5) r = finMarble(uv, A, B);
    col = r.rgb;
    finRough = r.w;
  } else {
    // walls: along the face, and up from the room's floor
    float u = abs(N.x) > abs(N.z) ? vFinPos.z : vFinPos.x;
    float h = vFinPos.y - vFinZ.x, top = vFinZ.y - vFinZ.x;
    col = A * (0.97 + 0.05 * finNoise(vec2(u, h) * 4.0));
    if (pat == 11) {
      // wallpaper: two-tone stripes with a small diamond motif
      float stripe = step(0.5, fract(u / 0.18));
      col *= mix(1.0, 0.94, stripe);
      vec2 q = vec2(fract(u / 0.18) - 0.5, fract(h / 0.24 + 0.5 * mod(floor(u / 0.18), 2.0)) - 0.5);
      float dm = abs(q.x) * 1.6 + abs(q.y);
      col = mix(col, B, (1.0 - smoothstep(0.1, 0.12, dm)) * 0.75);
      if (h > top - 0.3) col = A * 0.96;
    } else if (pat == 12) {
      // boiserie
      float d = max(finPanel(u, h, 0.18, 0.8), finPanel(u, h, 1.1, top - 0.45));
      if (d >= 0.0) col = mix(col, B, 0.75 * finLine(abs(d - 0.025), 0.006)) * (1.0 + 0.1 * finLine(abs(d - 0.04), 0.005));
      if (h > 0.86 && h < 0.94) col = mix(A, B, 0.6);
      if (h > top - 0.22) col = mix(A, B, 0.35 + 0.4 * finLine(abs(h - top + 0.12), 0.012));
      finRough = 0.6;
    } else if (pat == 13) {
      // white wall tiles to 1.5 m, paint above
      if (h < 1.5) {
        float row = floor(h / 0.075);
        float x = u + mod(row, 2.0) * 0.075;
        float g = max(finLine(min(fract(x / 0.15), 1.0 - fract(x / 0.15)) * 0.15, 0.0012),
                      finLine(min(fract(h / 0.075), 1.0 - fract(h / 0.075)) * 0.075, 0.0012));
        col = mix(A * (0.97 + 0.04 * finHash(vec2(floor(x / 0.15), row))), vec3(0.72), g);
        finRough = mix(0.18, 0.9, g);
      } else col = B * (0.97 + 0.05 * finNoise(vec2(u, h) * 4.0));
    }
    // skirting board
    if (h < 0.13 && pat != 13) col = pat == 12 ? mix(A, B, 0.5) : B * 0.95;
  }
  diffuseColor.rgb = col;
}
`;

/** the shader for the finishes; `wall` names it as a solid for the cut (cutaway.ts) */
export function finishMaterial(surface: "wall" | "floor"): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ name: surface === "wall" ? "room_finish_wall" : "finish_floor", roughness: 1 });
  mat.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERT_PARS}`)
      .replace("#include <worldpos_vertex>", `#include <worldpos_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAG_PARS}`)
      .replace("#include <map_fragment>", FRAG_MAP)
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = finRough;")
      // lifted a little like the white model, so rooms in shadow stay readable
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.22;");
  };
  mat.customProgramCacheKey = () => "room-finish";
  return mat;
}
