/** Geometry/use signatures, independent of floor IDs, heights, random seed and apartment labels. */
import type { PlanRoom } from "../plan";
import type { TopologyCell } from "../buildingTopology";

export function floorSignature(rooms: readonly PlanRoom[], cells: readonly TopologyCell[], excluded: readonly string[] = []): string {
  const skip = new Set(excluded);
  const byId = new Map(cells.map(c => [c.id, c]));
  const variable = rooms.filter(r => !["stair", "corridor", "vestibule", "ballroom"].includes(r.type));
  const n = (v: number) => Math.round(v * 1e6) / 1e6;
  const pieces = variable.map(r => (r.cellIds ? r.cellIds.flatMap(id => byId.get(id) ? [byId.get(id)!] : []) : cells)
    .filter(c => !skip.has(c.id))
    .flatMap(c => {
      const a = r.rect, b = c.rect;
      const box = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
      return box[2] - box[0] > 1e-6 && box[3] - box[1] > 1e-6 ? [[c.id, ...box.map(n)]] : [];
    }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  const groupKeys = pieces.map(p => JSON.stringify(p));
  const merged = [...new Set(groupKeys.filter((_, i) => pieces[i].length))].sort();
  const mergeGroups = new Map(merged.map((key, i) => [key, i]));
  const apartments = new Map<number, string[]>();
  variable.forEach((r, i) => {
    if (r.apartment === null || !pieces[i].length) return;
    const keys = apartments.get(r.apartment) ?? []; keys.push(groupKeys[i]); apartments.set(r.apartment, keys);
  });
  const aptKeys = [...apartments].map(([id, keys]) => ({ id, key: JSON.stringify(keys.sort()) })).sort((a, b) => a.key.localeCompare(b.key));
  const canonical = new Map(aptKeys.map((a, i) => [a.id, i]));
  const rows = variable.flatMap((r, i) => pieces[i].map(piece => [
    ...piece, r.type, mergeGroups.get(groupKeys[i]), r.apartment === null ? null : canonical.get(r.apartment),
  ])).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify(rows);
}
