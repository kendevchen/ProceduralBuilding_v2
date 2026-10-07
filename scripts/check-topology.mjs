/** P1 topology contracts and indexed adjacency against the old quadratic oracle. */
import assert from "node:assert/strict";
import { createServer } from "vite";

function oldEdges(rects, epsilon = 1e-6, minSpan = 0.05) {
  const out = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const ra = rects[i], rb = rects[j];
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
  return out;
}

const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: "custom" });
try {
  const load = name => server.ssrLoadModule(`/src/${name}.ts`);
  const { defaultParams } = await load("params");
  const { resolveBuildingTopology, TopologyResolutionError } = await load("buildingTopology");
  const { sharedEdges } = await load("planning/edgeIndex");
  const { generateBuilding, windowKey } = await load("generator");
  const { planBuilding } = await load("plan");
  const { legacyPlanCases } = await load("planChecks");
  const { rand } = await load("rng");
  const base = defaultParams(), kit = { key: (c, v) => `${c}/${v}` };
  const resolve = overrides => resolveBuildingTopology({ ...base, ...overrides });
  const ready = overrides => { const r = resolve(overrides); assert.equal(r.status, "ready"); return r.topology; };
  let adjacencyCases = 0, envelopes = 0;
  const equivalent = rects => { assert.deepEqual(sharedEdges(rects), oldEdges(rects)); adjacencyCases++; };
  assert.throws(() => sharedEdges([[0, 0, Infinity, 1]]), RangeError);
  assert.throws(() => sharedEdges([], 0), RangeError);
  assert.throws(() => sharedEdges([], 1e-6, -1), RangeError);
  equivalent([[0, 0, 1, 1e308], [1, 0, 2, 1e308]]);
  // Partial shared walls, overlaps, points, short spans and tolerance/bucket boundaries.
  for (const origin of [-60, -0.000001, 0, 0.0000079, 60]) {
    for (const gap of [-1.01e-6, -1e-6, -0.99e-6, 0, 0.99e-6, 1e-6, 1.01e-6]) {
      for (const span of [0, 0.049, 0.05, 0.051, 0.5, 2]) equivalent([
        [origin, 0, origin + 1, 2], [origin + 1 + gap, 2 - span, origin + 3, 4],
        [origin, 2 + gap, origin + 0.5, 3], [origin + 4, 0, origin + 5, 1],
      ]);
    }
  }
  for (let seed = 1; seed <= 100; seed++) {
    const rects = Array.from({ length: 80 }, (_, i) => {
      const x = Math.floor(rand(seed, i, 1) * 12) * 0.5, y = Math.floor(rand(seed, i, 2) * 12) * 0.5;
      return [x, y, x + (1 + Math.floor(rand(seed, i, 3) * 4)) * 0.5, y + (1 + Math.floor(rand(seed, i, 4) * 4)) * 0.5];
    });
    equivalent(rects);
  }
  // Every old envelope/seed, independently of apartment programming.
  for (const fixture of legacyPlanCases([1, 2, 3], ["auto"])) {
    const p = { ...base, ...fixture.params }, t = ready(fixture.params);
    equivalent(t.cells.map(c => c.rect));
    assert.equal(t.cells.length, t.grid.cells.length);
    assert.equal(new Set(t.cells.map(c => c.id)).size, t.cells.length);
    const byId = new Map(t.cells.map(c => [c.id, c]));
    const expectedNeighbours = t.cells.map(() => []);
    for (const e of oldEdges(t.cells.map(c => c.rect))) {
      expectedNeighbours[e.i].push(t.cells[e.j].id);
      expectedNeighbours[e.j].push(t.cells[e.i].id);
    }
    t.cells.forEach((c, i) => assert.deepEqual(c.neighbours, expectedNeighbours[i]));
    for (const core of t.cores) for (const id of core.cellIds) assert.ok(byId.has(id));
    const auto = resolveBuildingTopology({ ...p, layoutMode: "auto" });
    assert.equal(auto.status, "ready", "auto preserves every legacy envelope");
    assert.deepEqual(auto.topology, t);
    envelopes++;
  }
  for (const overrides of [
    {}, { baysX: 2, baysY: 2, cornerStyle: "panCoupe" },
    { baysX: 10, baysY: 8, floors: 6 }, { baysX: 20, baysY: 20, floors: 20 },
    { type: "corner", cornerStyle: "panCoupe", baysX: 20, baysY: 20, floors: 20 },
    { type: "row", dimensionVersion: "bays-v2", baysX: 20, baysY: 20, floors: 20 },
  ]) {
    const p = { ...base, ...overrides }, b = generateBuilding(p, kit), t = b.topology;
    const before = JSON.stringify(t), plan = planBuilding(b, p);
    assert.deepEqual(plan.issues, []);
    for (const lv of plan.levels) equivalent([
      ...plan.rooms.filter(r => r.level === lv.index).map(r => r.rect),
      ...plan.voids.filter(v => v.level === lv.index).map(v => {
        const xs = v.polygon.map(q => q[0]), ys = v.polygon.map(q => q[1]);
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      }),
    ]);
    assert.equal(JSON.stringify(t), before, "floor programming never mutates structure");
    assert.equal(JSON.stringify(planBuilding(b, p)), JSON.stringify(plan), "repeated programming is isolated");
    assert.deepEqual(JSON.parse(JSON.stringify(t)), t, "topology is plain JSON data");
    assert.throws(() => { t.grid.cells[0].x0 = -999; }, TypeError);
    assert.throws(() => { t.cores[0].cellIds.push("foreign"); }, TypeError);
    b.sides.forEach((s, side) => {
      assert.deepEqual(s.frame.elements, t.facades[side].frame);
      assert.deepEqual(s.bays.map(bay => bay.x), t.facades[side].bays.map(bay => bay.x));
      s.bays.forEach((_, bay) => assert.equal(windowKey(side, bay, "g"), `${side}|${bay}|g`));
    });
    for (const volume of t.voids) {
      assert.equal(volume.kind, "ballroom");
      assert.deepEqual(plan.voids.map(v => v.level), [volume.fromLevel]);
      assert.equal(volume.z0, plan.levels[volume.fromLevel].floorZ);
      assert.equal(volume.z1, plan.levels[volume.toLevel].ceilingZ);
    }
  }
  assert.equal(ready({ baysX: 20, baysY: 20, floors: 20 }).rows.length + 2, 22);
  const rowLegacy = ready({ type: "row", baysY: 20, depth: 12.345 });
  assert.equal(rowLegacy.length, 12.345, "legacy metre depth is never rounded");
  assert.equal(ready({ type: "row", baysY: 2, depth: 12.345 }).length, rowLegacy.length);
  assert.equal(ready({ type: "row", dimensionVersion: "legacy", depth: 12.345 }).length, rowLegacy.length);
  assert.equal(ready({ type: "row", dimensionVersion: "bays-v2", baysY: 20, depth: NaN }).length, 61);
  assert.equal(ready({ type: "row", dimensionVersion: "bays-v2", baysY: 3, depth: -1 }).length, 10);
  assert.equal(resolve({ type: "row", dimensionVersion: "bays-v2", baysY: 8, layoutMode: "auto" }).status, "infeasible");
  for (const overrides of [
    { layoutMode: "courtyard" }, { layoutMode: "lightwell" },
    { layoutMode: "auto", baysX: 20 }, { layoutMode: "auto", floors: 20 },
  ]) {
    const r = resolve(overrides);
    assert.equal(r.status, overrides.layoutMode === "auto" ? "infeasible" : "unsupported");
    assert.equal(r.requestedMode, overrides.layoutMode);
    assert.throws(() => generateBuilding({ ...base, ...overrides }, kit), TopologyResolutionError);
  }
  for (const overrides of [
    { baysX: 1 }, { baysY: 21 }, { floors: 0 }, { floors: 21 }, { floors: 2.5 },
    { baysX: NaN }, { baysY: Infinity }, { seed: NaN }, { type: "unknown" },
    { profile: "unknown" }, { dimensionVersion: "unknown" }, { layoutMode: "unknown" },
    { type: "row", depth: NaN }, { type: "row", depth: -1 }, { type: "row", depth: 0.5 },
  ]) assert.equal(resolve(overrides).status, "infeasible", JSON.stringify(overrides));
  console.log(`Topology: ${envelopes} legacy envelopes; ${adjacencyCases} indexed/oracle adjacency cases; JSON, immutability, dimensions, IDs and failure contracts passed.`);
} finally { await server.close(); }
