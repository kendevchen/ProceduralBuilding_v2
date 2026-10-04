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
import dims from "../blender/kit_dims.json";

export type Look = "real" | "diagram" | "white";

/** pattern, colour A (rgb), colour B (rgb), floor and ceiling (z) */
export type Stamp = [number, number, number, number, number, number, number, number, number];

const P = {
  plain: 0, herringbone: 1, boards: 2, hexMixed: 3, hexSparse: 4, marble: 5, carpet: 6, salonRug: 7, diningRug: 8, kitchenMarbleTiles: 9,
  paint: 10, wallpaper: 11, boiserie: 12, tiles: 13, books: 14, bedroomPanels: 15, diningPanels: 16, blackMarble: 17, kitchenWorktop: 18,
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

/** Continuous black marble behind the kitchen cabinets and extractor. */
export function kitchenBacksplashStamp(floorZ: number, ceilingZ: number): Stamp {
  return stamp(P.blackMarble, rgb("#191d23"), rgb("#dce0e4"), floorZ, ceilingZ);
}

/** A continuous pale slab, with fine veins and no alternating tile colours. */
export function kitchenWorktopStamp(): Stamp {
  return stamp(P.kitchenWorktop, rgb("#e7e2d7"), rgb("#b9b7b0"));
}

/** the stamp of a carpet: it carries its corner (world x, z) and its size instead of colours */
export function carpetStamp(x: number, z: number, w: number, d: number, floorZ: number, ceilingZ: number): Stamp {
  return [P.carpet, x, z, 0, w, d, 0, floorZ, ceilingZ];
}

/** Rotated salon rug; angle is its Blender local x axis. */
export function salonRugStamp(x: number, z: number, angle: number, w: number, d: number, floorZ: number, ceilingZ: number, handedness = 1): Stamp {
  return [P.salonRug, x, z, angle, w, d, handedness, floorZ, ceilingZ];
}

export function diningRugStamp(x: number, z: number, angle: number, w: number, d: number, floorZ: number, ceilingZ: number): Stamp {
  return [P.diningRug, x, z, angle, w, d, 1, floorZ, ceilingZ];
}

/** the stamp of a bookcase's rows of books: h counts up from the underside of its lowest board (z) */
export function booksStamp(boardZ: number): Stamp {
  return [P.books, 0, 0, 0, 0, 0, 0, boardZ, boardZ + 3];
}

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
  const f = surface === "floor" && room.type === "kitchen"
    ? { pattern: P.kitchenMarbleTiles, a: "#e3e2e8", b: "#242830" }
    : surface === "wall" && room.type === "dining"
    ? { pattern: P.diningPanels, a: "#b4becb", b: "#c79e48" }
    : surface === "wall" && room.type === "bedroom" && room.area >= dims.interior.bedroomFurniture.largeBedroomArea
    ? { pattern: P.bedroomPanels, a: "#a6b2a0", b: "#879781" }
    : (surface === "wall" ? WALLS : FLOORS)[room.type];
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

// Warped, branching mineral veins; shared by the kitchen floor and backsplash.
vec3 finKitchenStone(vec2 uv, vec3 base, vec3 mineral, float strength) {
  float warp = finFbm(uv * 3.1);
  float mainVein = finLine(abs(sin(uv.x * 4.8 + uv.y * 3.6 + warp * 8.0)) * 0.055, 0.0025);
  float branch = finLine(abs(sin(uv.x * 11.0 - uv.y * 5.2 + finFbm(uv * 6.0) * 10.0)) * 0.035, 0.001);
  branch *= smoothstep(0.35, 0.7, warp);
  vec3 col = base * (0.94 + 0.10 * finNoise(uv * 12.0));
  return mix(col, mineral, clamp(mainVein + branch * 0.55, 0.0, 1.0) * strength);
}

// a wool carpet laid on the parquet: a red border with cream lines, a navy field with staggered orange rosettes.
// uv: metres from its corner, size: its length and depth
vec4 finCarpet(vec2 uv, vec2 size) {
  vec3 navy = vec3(0.06, 0.09, 0.15), navy2 = vec3(0.04, 0.06, 0.11);
  vec3 red = vec3(0.26, 0.04, 0.06), cream = vec3(0.70, 0.60, 0.42);
  vec3 orange = vec3(0.66, 0.22, 0.09), ember = vec3(0.36, 0.08, 0.05);
  float e = min(min(uv.x, size.x - uv.x), min(uv.y, size.y - uv.y));
  float wool = 0.9 + 0.2 * finNoise(uv * 70.0);
  vec3 col;
  if (e < 0.30) {
    // border: gold edge, red band with two cream lines
    col = red;
    col = mix(col, cream, finLine(abs(e - 0.012), 0.008));
    col = mix(col, cream, finLine(abs(e - 0.11), 0.006));
    col = mix(col, cream, finLine(abs(e - 0.19), 0.006));
    col = mix(col, ember, finLine(abs(e - 0.15), 0.018) * 0.7);
  } else if (e < 0.50) {
    // inner navy band with a row of small cream diamonds
    col = navy2;
    float along = (uv.x < 0.30 || uv.x > size.x - 0.30) ? uv.y : uv.x;
    vec2 d = vec2(fract(along / 0.16) - 0.5, (e - 0.40) / 0.16);
    col = mix(col, cream, 1.0 - smoothstep(0.17, 0.22, abs(d.x) + abs(d.y)));
    col = mix(col, cream, finLine(abs(e - 0.31), 0.006));
  } else {
    // field: rosettes in staggered rows
    vec2 p = uv - vec2(0.50);
    float row = floor(p.y / 0.7);
    vec2 l = vec2(mod(p.x + mod(row, 2.0) * 0.4, 0.8) - 0.4, mod(p.y, 0.7) - 0.35);
    float r = length(l), a = atan(l.y, l.x);
    float petal = 0.21 * (0.78 + 0.22 * cos(8.0 * a));
    col = navy;
    col = mix(col, ember, 1.0 - smoothstep(petal + 0.015, petal + 0.045, r)); // outline
    col = mix(col, orange, 1.0 - smoothstep(petal - 0.045, petal - 0.015, r));
    col = mix(col, ember, finLine(abs(r - 0.08), 0.011));
    col = mix(col, cream, 1.0 - smoothstep(0.035, 0.052, r));
  }
  return vec4(col * wool, 0.96);
}

// rows of books on shelves 0.34 m apart: runs of spines of varying width, height and leather colour
// (u along the shelf, h up from the lowest board's top)
vec3 finBookColor(float k) {
  k = fract(k) * 8.0;
  if (k < 1.0) return vec3(0.46, 0.25, 0.17);
  if (k < 2.0) return vec3(0.60, 0.38, 0.28);
  if (k < 3.0) return vec3(0.34, 0.18, 0.12);
  if (k < 4.0) return vec3(0.72, 0.55, 0.42);
  if (k < 5.0) return vec3(0.50, 0.14, 0.12);
  if (k < 6.0) return vec3(0.64, 0.44, 0.34);
  if (k < 7.0) return vec3(0.26, 0.19, 0.15);
  return vec3(0.78, 0.68, 0.52);
}
vec4 finBooks(float u, float h) {
  float rowF = h / 0.34, row = floor(rowF);
  float y = (rowF - row) * 0.34 - 0.025;          // above the board
  vec3 back = vec3(0.14, 0.09, 0.06);
  if (y < 0.0) return vec4(back, 0.6);
  float g = floor(u / 0.2), t = fract(u / 0.2);
  float w0 = 0.55 + finHash(vec2(g, row)), w1 = 0.55 + finHash(vec2(g + 7.0, row)),
        w2 = 0.55 + finHash(vec2(g + 13.0, row)), w3 = 0.55 + finHash(vec2(g + 19.0, row)), w4 = 0.55 + finHash(vec2(g + 29.0, row));
  float tot = w0 + w1 + w2 + w3 + w4, c = t * tot, lo = 0.0, hi = w0;
  float id = 0.0;
  if (c >= hi) { lo = hi; hi += w1; id = 1.0; }
  if (c >= hi) { lo = hi; hi += w2; id = 2.0; }
  if (c >= hi) { lo = hi; hi += w3; id = 3.0; }
  if (c >= hi) { lo = hi; hi += w4; id = 4.0; }
  float k = finHash(vec2(g * 5.0 + id, row + 3.0));
  float height = 0.20 + 0.10 * finHash(vec2(g * 5.0 + id, row + 11.0));
  if (finHash(vec2(g, row + 41.0)) < 0.07 && id > 2.5) height = 0.0;   // a gap in the row
  if (y > height) return vec4(back, 0.6);
  vec3 col = finBookColor(k) * 0.72 * (0.85 + 0.3 * finHash(vec2(u * 40.0, 1.0)));
  float edge = min(c - lo, hi - c) * (0.2 / tot);
  col *= 0.55 + 0.45 * smoothstep(0.0, 0.004, edge);
  col = mix(col, vec3(0.72, 0.58, 0.28), finLine(abs(y - (height - 0.035)), 0.004) * 0.8);
  col = mix(col, vec3(0.72, 0.58, 0.28), finLine(abs(y - 0.035), 0.004) * 0.8);
  return vec4(col, 0.7);
}

// Muted wool rug: scrolling stems, eight-petal flowers and a narrow woven border.
vec4 finSalonRug(vec2 uv, vec2 size, bool dining) {
  float e = min(min(uv.x, size.x - uv.x), min(uv.y, size.y - uv.y));
  vec3 base = vec3(0.57, 0.51, 0.41), ink = vec3(0.27, 0.24, 0.19);
  if (dining) { base = vec3(0.79, 0.75, 0.64); ink = vec3(0.53, 0.43, 0.24); }
  vec2 q = mod(uv, 0.34) - 0.17;
  float a = atan(q.y, q.x), r = length(q);
  float flower = finLine(abs(r - (0.09 + 0.027 * cos(a * 8.0))), 0.004);
  float vine = finLine(abs(q.x - 0.09 * sin(q.y * 24.0)), 0.003);
  float motif = max(flower, vine * 0.7);
  if (dining) motif = max(motif, finLine(abs(length((uv - size * 0.5) / vec2(1.3, 0.9)) - 0.65), 0.014));
  if (e < 0.22) {
    base *= 0.88;
    motif = max(motif, max(finLine(abs(e - 0.025), 0.006), finLine(abs(e - 0.20), 0.006)));
  }
  vec3 col = mix(base, ink, motif * 0.65);
  if (dining) col = mix(col, vec3(0.40, 0.48, 0.53), flower * 0.25);
  col *= 0.94 + 0.12 * finNoise(uv * 160.0);
  return vec4(col, 1.0);
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
    else if (pat == 6) r = finCarpet(uv - A.xy, B.xy);
    else if (pat == 9) {
      vec2 tileSize = vec2(${dims.interior.kitchenFurniture.tileWidth.toFixed(3)}, ${dims.interior.kitchenFurniture.tileDepth.toFixed(3)});
      vec2 cell = floor(uv / tileSize), q = fract(uv / tileSize) * tileSize;
      float edge = min(min(q.x, tileSize.x - q.x), min(q.y, tileSize.y - q.y));
      bool dark = mod(cell.x + cell.y, 2.0) > 0.5;
      vec3 stone = finKitchenStone(q + cell * 2.71, dark ? B : A,
        dark ? vec3(0.72, 0.75, 0.80) : vec3(0.48, 0.49, 0.55), dark ? 0.85 : 0.22);
      float grout = 1.0 - smoothstep(0.001, 0.0025, edge);
      r = vec4(mix(stone, vec3(0.38), grout), mix(0.23, 0.8, grout));
    }
    else if (pat == 7 || pat == 8) {
      vec2 delta = uv - A.xy;
      vec2 local = vec2(dot(delta, vec2(cos(A.z), -sin(A.z))), dot(delta, vec2(-sin(A.z), -cos(A.z))) * B.z);
      r = finSalonRug(local, B.xy, pat == 8);
    }
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
    } else if (pat == 16) {
      // French grey-blue upper panels, gilt frame, floral frieze and ivory dado.
      float panel = finPanel(u, h, 1.05, top - 0.28);
      if (panel >= 0.0) {
        float gilt = max(finLine(abs(panel - 0.025), 0.008), finLine(abs(panel - 0.043), 0.004));
        col = mix(col, B, gilt);
        if (panel > 0.07 && panel < 0.18) {
          vec2 q = vec2(fract(u / 0.12) - 0.5, fract(h / 0.12) - 0.5);
          float flower = 1.0 - smoothstep(0.18, 0.28, length(q) + 0.07 * cos(atan(q.y, q.x) * 5.0));
          col = mix(col, vec3(0.77, 0.78, 0.77), flower * 0.5);
        }
      }
      if (h < 0.95 || h > top - 0.22) {
        col = vec3(0.82, 0.80, 0.74);
        float lower = finPanel(u, h, 0.18, 0.80);
        if (lower >= 0.0) col *= 1.0 - 0.15 * finLine(abs(lower - 0.025), 0.008);
      }
      if (h > 0.91 && h < 0.96) col = B;
      finRough = 0.65;
      // boiserie
      float d = max(finPanel(u, h, 0.18, 0.8), finPanel(u, h, 1.1, top - 0.45));
      if (d >= 0.0) col = mix(col, B, 0.75 * finLine(abs(d - 0.025), 0.006)) * (1.0 + 0.1 * finLine(abs(d - 0.04), 0.005));
      if (h > 0.86 && h < 0.94) col = mix(A, B, 0.6);
      if (h > top - 0.22) col = mix(A, B, 0.35 + 0.4 * finLine(abs(h - top + 0.12), 0.012));
      if (pat == 15 && h > top - 0.22) col = vec3(0.86, 0.83, 0.73) * (0.97 + 0.06 * finLine(abs(h - top + 0.12), 0.012));
      finRough = 0.6;
    } else if (pat == 18) {
      vec2 slabUV = abs(N.y) > 0.5 ? vFinPos.xz : vec2(u, vFinPos.y);
      col = finKitchenStone(slabUV * 3.0, A, B, 0.22);
      finRough = 0.28;
    } else if (pat == 17) {
      col = finKitchenStone(vec2(u, h), A, B, 0.85);
      finRough = 0.24;
    } else if (pat == 14) {
      vec4 bk = finBooks(u, h);
      col = bk.rgb;
      finRough = bk.w;
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
    if (h < 0.13 && pat != 13 && pat != 14 && pat != 17 && pat != 18) col = (pat == 12 || pat == 15) ? mix(A, B, 0.5) : B * 0.95;
    if (h < 0.13 && pat == 16) col = vec3(0.82, 0.80, 0.74) * 0.95;
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
