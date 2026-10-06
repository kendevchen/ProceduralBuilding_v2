import { Box3, BufferAttribute, BufferGeometry, type Matrix4, Sphere, Vector3 } from "three";

// The original geometry owns all of its index views. Keep them between mode
// switches; release them together on source.dispose(), even when the original
// was never rendered (and Three registered GPU buffers only through a view).
// Disposing views independently would invalidate shared vertex buffers/VAOs.
const cache = new WeakMap<BufferGeometry, Map<string, BufferGeometry | null>>();

/** Conservative fixed-slab selection for static triangle batches, not a mesh
 * simplifier. Crossing triangles stay whole; the GPU clips their exact edges.
 * Returns the source when unchanged, null when empty, otherwise a source-owned
 * cached index view. Callers must NOT dispose the returned geometry separately.
 * Unsupported geometry stays on the original shader-only path.
 */
export function sectionGeometry(source: BufferGeometry, local: Matrix4, lo: number, hi: number): BufferGeometry | null {
  const position = source.getAttribute("position"), index = source.index;
  const count = index?.count ?? position?.count ?? 0;
  if (!position || count % 3 || source.groups.length || source.drawRange.start !== 0
    || source.drawRange.count < count || Object.keys(source.morphAttributes).length
    || Object.values(source.attributes).some(a => !(a instanceof BufferAttribute) || a.count !== position.count)) return source;
  let views = cache.get(source);
  if (!views) {
    views = new Map(); cache.set(source, views);
    const owned = views;
    const release = () => {
      source.removeEventListener("dispose", release);
      for (const geometry of owned.values()) if (geometry && geometry !== source) geometry.dispose();
      owned.clear(); cache.delete(source);
    };
    source.addEventListener("dispose", release);
  }
  const key = `${lo},${hi}|${local.elements.join(",")}`;
  if (views.has(key)) return views.get(key)!;
  const e = local.elements;
  const xs = new Float64Array(position.count);
  for (let i = 0; i < xs.length; i++) xs[i] = e[0] * position.getX(i) + e[4] * position.getY(i) + e[8] * position.getZ(i) + e[12];
  const selected: number[] = [];
  for (let i = 0; i < count; i += 3) {
    const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2;
    if (Math.max(xs[a], xs[b], xs[c]) < lo - 1e-5 || Math.min(xs[a], xs[b], xs[c]) > hi + 1e-5) continue;
    selected.push(a, b, c);
  }
  if (selected.length === count) { views.set(key, source); return source; }
  if (!selected.length) { views.set(key, null); return null; }
  const result = new BufferGeometry(); result.name = source.name;
  result.setIndex(selected);
  for (const [name, attribute] of Object.entries(source.attributes)) {
    result.setAttribute(name, attribute);
  }
  // Three's computeBoundingBox/Sphere read every position, not just the index.
  const box = new Box3(), point = new Vector3();
  for (const vertex of selected) box.expandByPoint(point.fromBufferAttribute(position, vertex));
  result.boundingBox = box; result.boundingSphere = box.getBoundingSphere(new Sphere());
  views.set(key, result);
  return result;
}
