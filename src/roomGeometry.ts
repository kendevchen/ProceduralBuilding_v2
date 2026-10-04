/** Geometry shared by room editing, labels and furniture; supports concave rooms. */
import { ShapeUtils, Vector2 } from "three";
import type { V2 } from "./roof";

const EPS = 1e-6;
const cross = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const at = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const key = (p: V2) => `${Math.round(p[0] / EPS)},${Math.round(p[1] / EPS)}`;

export function signedArea(poly: V2[]): number {
  return poly.reduce((a, p, i) => a + cross(p, poly[(i + 1) % poly.length]), 0) / 2;
}

export function inRoom(poly: V2[], p: V2): boolean {
  let inside = false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], d = sub(b, a), q = sub(p, a);
    const len = Math.hypot(...d);
    if (len < EPS) continue;
    if (Math.abs(cross(d, q)) <= EPS * len && q[0] * d[0] + q[1] * d[1] >= -EPS &&
        q[0] * d[0] + q[1] * d[1] <= len * len + EPS) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1])) inside = !inside;
  }
  return inside;
}

/** Places on AB where CD crosses it or shares a collinear endpoint. */
function splits(a: V2, b: V2, c: V2, d: V2): number[] {
  const u = sub(b, a), v = sub(d, c), q = sub(c, a), den = cross(u, v);
  if (Math.abs(den) > EPS) {
    const t = cross(q, v) / den, s = cross(q, u) / den;
    return t >= -EPS && t <= 1 + EPS && s >= -EPS && s <= 1 + EPS ? [Math.max(0, Math.min(1, t))] : [];
  }
  const len2 = u[0] ** 2 + u[1] ** 2;
  if (len2 < EPS * EPS || Math.abs(cross(q, u)) > EPS * Math.sqrt(len2)) return [];
  return [c, d].map(p => ((p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1]) / len2)
    .filter(t => t >= -EPS && t <= 1 + EPS).map(t => Math.max(0, Math.min(1, t)));
}

export function roomContains(poly: V2[], footprint: V2[]): boolean {
  if (!footprint.every(p => inRoom(poly, p))) return false;
  return footprint.every((a, i) => {
    const b = footprint[(i + 1) % footprint.length], ts = [0, 1];
    poly.forEach((c, j) => ts.push(...splits(a, b, c, poly[(j + 1) % poly.length])));
    ts.sort((x, y) => x - y);
    return ts.slice(1).every((t, j) => inRoom(poly, at(a, b, (ts[j] + t) / 2)));
  });
}

/** Exact union boundary: split intersections, discard interior edges, trace one loop.
 * Multiple loops (holes or disconnected selections) are rejected explicitly. */
export function unionRooms(polys: V2[][]): V2[] {
  const edges = polys.flatMap(poly => poly.map((a, i) => ({ a, b: poly[(i + 1) % poly.length] })));
  const boundary = new Map<string, { a: V2; b: V2 }>();
  const inside = (p: V2) => polys.some(poly => inRoom(poly, p));
  for (const { a, b } of edges) {
    const ts = [0, 1];
    for (const e of edges) ts.push(...splits(a, b, e.a, e.b));
    ts.sort((x, y) => x - y);
    for (let i = 1; i < ts.length; i++) {
      if (ts[i] - ts[i - 1] < EPS) continue;
      let p = at(a, b, ts[i - 1]), q = at(a, b, ts[i]);
      const d = sub(q, p), len = Math.hypot(...d), m = at(p, q, 0.5), off = EPS * 8;
      const l = inside([m[0] - d[1] / len * off, m[1] + d[0] / len * off]);
      const r = inside([m[0] + d[1] / len * off, m[1] - d[0] / len * off]);
      if (l === r) continue;
      if (!l) [p, q] = [q, p];
      boundary.set(`${key(p)}>${key(q)}`, { a: p, b: q });
    }
  }
  if (!boundary.size) throw new Error("無法建立合併後的房間輪廓");
  const outgoing = new Map<string, { a: V2; b: V2 }>();
  for (const e of boundary.values()) {
    if (outgoing.has(key(e.a))) throw new Error("房間僅在角落相接，無法合併");
    outgoing.set(key(e.a), e);
  }
  const first = boundary.values().next().value!, poly: V2[] = [];
  let edge = first;
  do {
    poly.push(edge.a);
    outgoing.delete(key(edge.a));
    if (key(edge.b) === key(first.a)) break;
    const next = outgoing.get(key(edge.b));
    if (!next) throw new Error("合併輪廓未閉合");
    edge = next;
  } while (poly.length <= boundary.size);
  if (outgoing.size) throw new Error("合併後不能形成孔洞或分離的房間");
  // Remove collinear vertices so old partition endpoints do not split a usable wall.
  const simple = poly.filter((p, i) => {
    const a = poly[(i + poly.length - 1) % poly.length], b = poly[(i + 1) % poly.length];
    return Math.abs(cross(sub(p, a), sub(b, p))) > EPS;
  });
  if (simple.length < 3 || signedArea(simple) <= EPS) throw new Error("合併房間面積無效");
  return simple;
}

export interface RoomSlice { axis: 0 | 1; at: number; greater: boolean }

/** Separate spans prevent painting across another room in a U-shaped merged outline. */
export function roomEdgeSpans(poly: V2[], a: V2, d: V2, length: number): [number, number][] {
  const off = (p: V2) => Math.abs((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]);
  const along = (p: V2) => (p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1];
  const spans: [number, number][] = [];
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length];
    if (off(p) > 0.02 || off(q) > 0.02) return;
    const lo = Math.max(0, Math.min(along(p), along(q))), hi = Math.min(length, Math.max(along(p), along(q)));
    if (hi - lo > EPS) spans.push([lo, hi]);
  });
  return spans.sort((p, q) => p[0] - q[0]).reduce((out, span) => {
    const last = out[out.length - 1];
    if (last && span[0] <= last[1] + EPS) last[1] = Math.max(last[1], span[1]); else out.push(span);
    return out;
  }, [] as [number, number][]);
}

/** Anchor inside the largest retained triangle, even for an L-shaped cut room. */
export function roomAnchor(poly: V2[], slice?: RoomSlice): V2 | null {
  const faces = ShapeUtils.triangulateShape(poly.map(p => new Vector2(...p)), []);
  let best: V2[] | null = null, size = 0;
  const average = (p: V2[]): V2 => p.reduce((s, q) => [s[0] + q[0] / p.length, s[1] + q[1] / p.length], [0, 0] as V2);
  const centre = average(poly);
  const onBoundary = poly.some((p, i) => {
    const q = poly[(i + 1) % poly.length], d = sub(q, p), c = sub(centre, p), len = Math.hypot(...d);
    const along = c[0] * d[0] + c[1] * d[1];
    return len > EPS && Math.abs(cross(d, c)) < EPS * len && along >= -EPS && along <= len * len + EPS;
  });
  if (!slice && !onBoundary && inRoom(poly, centre)) return centre;
  for (const face of faces) {
    let points = face.map(i => poly[i]);
    if (slice) {
      const { axis, at: limit, greater } = slice;
      const side = (p: V2) => (p[axis] - limit) * (greater ? 1 : -1);
      const clipped: V2[] = [];
      points.forEach((a, i) => {
        const b = points[(i + 1) % points.length], sa = side(a), sb = side(b);
        if (sa >= 0) clipped.push(a);
        if ((sa >= 0) !== (sb >= 0)) clipped.push(at(a, b, sa / (sa - sb)));
      });
      points = clipped;
    }
    const area = Math.abs(signedArea(points));
    if (area > size) { best = points; size = area; }
  }
  return best ? average(best) : null;
}
