/** Rectangle boundary index. Keeps the old pair/axis order for deterministic doors. */
export type Rect = [number, number, number, number];
export interface SharedEdge {
  i: number;
  j: number;
  a: [number, number];
  b: [number, number];
}

export function sharedEdges(rects: readonly Rect[], epsilon = 1e-6, minSpan = 0.05): SharedEdge[] {
  if (!Number.isFinite(epsilon) || epsilon <= 0 || !Number.isFinite(minSpan) || minSpan < 0) {
    throw new RangeError("Edge tolerances must be finite, with epsilon > 0 and minSpan >= 0");
  }
  // A bucket is wider than the tolerance. Adjacent buckets are checked too;
  // exact coordinates and spans, rather than rounded coordinates, decide adjacency.
  const bucketSize = epsilon * 4;
  const bins = [new Map<number, number[]>(), new Map<number, number[]>(),
    new Map<number, number[]>(), new Map<number, number[]>()];
  const pairs = new Map<number, Set<number>>();
  rects.forEach((r, i) => {
    if (r.some(x => !Number.isFinite(x))) throw new RangeError("Rectangle coordinates must be finite");
    for (let side = 0; side < 4; side++) {
      const bin = Math.floor(r[side] / bucketSize);
      const opposite = (side + 2) % 4;
      // Fixed offsets also terminate when very large finite coordinates overflow a bucket.
      for (const offset of [-1, 0, 1]) {
        const k = bin + offset;
        for (const j of bins[opposite].get(k) ?? []) {
          if (j === i) continue;
          const q = rects[j];
          const axis = (side + 1) % 2;
          if (Math.abs(r[side] - q[opposite]) > epsilon ||
            Math.min(r[axis + 2], q[axis + 2]) - Math.max(r[axis], q[axis]) <= minSpan) continue;
          const js = pairs.get(j) ?? new Set<number>();
          js.add(i);
          pairs.set(j, js);
        }
      }
      const own = bins[side].get(bin) ?? [];
      own.push(i);
      bins[side].set(bin, own);
    }
  });
  const out: SharedEdge[] = [];
  for (const i of [...pairs.keys()].sort((a, b) => a - b)) {
    const ra = rects[i];
    for (const j of [...pairs.get(i)!].sort((a, b) => a - b)) {
      const rb = rects[j];
      for (const [xa, xb] of [[ra[2], rb[0]], [ra[0], rb[2]]]) {
        if (Math.abs(xa - xb) > epsilon) continue;
        const lo = Math.max(ra[1], rb[1]), hi = Math.min(ra[3], rb[3]);
        if (hi - lo > minSpan) out.push({ i, j, a: [xa, lo], b: [xa, hi] });
      }
      for (const [ya, yb] of [[ra[3], rb[1]], [ra[1], rb[3]]]) {
        if (Math.abs(ya - yb) > epsilon) continue;
        const lo = Math.max(ra[0], rb[0]), hi = Math.min(ra[2], rb[2]);
        if (hi - lo > minSpan) out.push({ i, j, a: [lo, ya], b: [hi, ya] });
      }
    }
  }
  return out;
}
