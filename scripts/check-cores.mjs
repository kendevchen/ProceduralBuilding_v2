/** P3 actual public egress, rotated local geometry, structural voids and legacy oracles. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';
import { MeshStandardMaterial, Vector3 } from 'three';
const args = process.argv.slice(2), json = args.indexOf('--json');
assert.ok(json < 0 || args[json + 1], "--json requires a path");
assert.ok(args.every((a, i) => a === "--json" || (json >= 0 && i === json + 1)), "unknown argument");
const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' });
try {
  const load = name => server.ssrLoadModule(`/src/${name}.ts`);
  const { defaultParams } = await load('params'), { generateBuilding } = await load('generator');
  const { resolveBuildingTopology } = await load('buildingTopology'), { planBuilding, checkPlan } = await load('plan');
  const { analyseCirculation, polygonRoute } = await load('planning/circulation');
  const { coreWorld, coreLocal, rectLoop } = await load('planning/cores');
  const { buildStairs } = await load('stairs'), { buildRooms3d } = await load('rooms3d'), { Cutaway } = await load('cutaway');
  const { RoomEdits, editableRoom, mergeReason } = await load('roomEdits');
  const kit = { key: (c, v) => `${c}/${v}`, info: () => undefined }, cases = [], report = { date: new Date().toISOString(), cases, negativeChecks: [], legacyGoldens: 0, geometryVertices: 0, timings: [] };
  const make = overrides => { const params = { ...defaultParams(), layoutMode: 'auto', baysX: 14, baysY: 5, floors: 10, ...overrides }; const building = generateBuilding(params, kit); return { params, building, plan: planBuilding(building, params) }; };
  const golden = JSON.parse(await readFile(new URL('./baselines/plans-v1.json', import.meta.url), 'utf8'));
  for (const f of golden.cases) {
    const p = { ...golden.baseParams, ...f.overrides }; const b = generateBuilding(p, kit), plan = planBuilding(b, p);
    assert.equal(createHash('sha256').update(JSON.stringify(plan)).digest('hex'), f.planSha256); report.legacyGoldens++;
  }
  const fixtures = [];
  for (let seed = 1; seed <= 10; seed++) fixtures.push({ seed, floorVariety: true });
  for (const floors of [6, 7, 14, 15, 20]) for (const type of ['freestanding', 'corner', 'row']) for (const cornerStyle of ['pier', 'panCoupe']) for (const apartments of ['auto', 'one', 'two']) fixtures.push({ floors, type, cornerStyle, apartments, depth: 17, ballroom: true });
  for (const groundUse of ['mixed', 'shops', 'residential']) for (const profile of ['uniform', 'haussmann']) fixtures.push({ floors: 20, baysX: 20, profile, groundUse, floorVariety: true });
  fixtures.push({ baysX: 8, ballroom: false, floors: 7 }, { baysX: 10, baysY: 6, floors: 20, ballroom: false, apartments: 'two' });
  let sample;
  for (const fixture of fixtures) {
    const started = performance.now(), value = make(fixture), { plan, building, params } = value;
    assert.deepEqual(plan.issues, [], JSON.stringify(fixture)); assert.deepEqual(checkPlan(plan), []);
    assert.equal(building.topology.mode, 'cores');
    const audit = analyseCirculation(plan); assert.deepEqual(audit.issues, []);
    assert.ok(audit.apartments.length);
    assert.ok(audit.apartments.every(a => a.effectiveStairIds.length >= (params.floors >= 7 ? 2 : 1) && Number.isFinite(a.furthestNearestStair) && (params.floors < 7 || Number.isFinite(a.furthestSecondStair))));
    const owners = new Array(plan.windows.length).fill(0);
    for (const r of plan.rooms) {
      r.windows.forEach(i => { owners[i]++; assert.equal(plan.windows[i].room, r.id); });
      if (['stair', 'corridor', 'vestibule', 'liftHall', 'elevator', 'shaft'].includes(r.type)) assert.equal(editableRoom(r), false);
      for (const d of r.doors) assert.ok(plan.rooms.find(o => o.id === d.to).doors.some(o => o.wall === d.wall && o.to === r.id));
      if (r.apartment !== null && plan.levels[r.level].cls !== 'R') {
        const flat = plan.rooms.filter(o => o.level === r.level && o.apartment === r.apartment);
        for (const type of ['salon', 'kitchen', 'wc', 'bedroom']) assert.ok(flat.some(o => o.type === type), `incomplete flat ${r.id}`);
      }
    }
    assert.ok(owners.every(n => n === 1));
    for (const core of building.topology.cores) {
      assert.ok(core.stairIds.length >= (params.floors >= 15 ? 2 : 1));
      assert.equal(core.elevatorIds.length, params.floors >= 15 ? 2 : params.floors >= 7 ? 1 : 0);
    }
    if (fixture.floorVariety && params.seed <= 10 && params.baysX === 14) {
      const eligible = plan.programDiagnostics.filter(d => d.status !== 'exempt');
      assert.ok(eligible.length >= 3); assert.ok(eligible.every(d => d.status !== 'legacy-fallback'));
      assert.ok(eligible.every((d, i) => i === 0 || d.generatedSignature !== eligible[i - 1].generatedSignature));
    }
    const edits = new RoomEdits(); const edited = edits.apply(plan); assert.deepEqual(edited.plan.issues, []);
    cases.push({ fixture, rooms: plan.rooms.length, cores: building.topology.cores.length, stairs: audit.effectiveStairIds,
      apartments: audit.apartments.length, maxNearest: Math.max(...audit.apartments.map(a => a.furthestNearestStair)), maxSecond: Math.max(...audit.apartments.map(a => a.furthestSecondStair ?? 0)), diagnostics: plan.circulation.apartmentDiagnostics.length, ms: performance.now() - started });
    sample ??= value;
  }
  for (const [baysX, baysY] of [[2, 2], [2, 20], [20, 2]]) {
    const r = resolveBuildingTopology({ ...defaultParams(), layoutMode: 'auto', dimensionVersion: 'bays-v2', baysX, baysY, floors: 20 });
    assert.equal(r.status, 'infeasible'); assert.ok(r.diagnostics[0].message); cases.push({ narrow: [baysX, baysY, 20], reason: r.diagnostics });
  }
  assert.equal(resolveBuildingTopology({ ...defaultParams(), layoutMode: 'auto', baysX: 10, baysY: 8, floors: 6 }).topology.mode, 'legacy');
  assert.equal(resolveBuildingTopology({ ...defaultParams(), layoutMode: 'auto', baysX: 20, baysY: 20, floors: 20 }).status, 'unsupported');
  // Visibility route goes around the re-entrant wall rather than cutting through the L.
  const l = [[0,0], [6,0], [6,2], [2,2], [2,6], [0,6]];
  assert.ok(polygonRoute(l, [5,1], [1,5]) > Math.hypot(4,4) + 0.6);
  assert.equal(polygonRoute(l, [5,1], [5,5]), Infinity); report.negativeChecks.push('concave visibility path excludes exterior shortcuts');
  const reject = (name, edit) => { const p = structuredClone(sample.plan); edit(p); const found = checkPlan(p); assert.ok(found.length, name); report.negativeChecks.push({ name, issues: found.slice(0,4) }); };
  reject('ceremonial 1F→2F cannot be second high-rise stair', p => { p.stairs[1].to = 1; p.stairs[1].layout.flights = p.stairs[1].layout.flights.slice(0, 1); });
  reject('elevators cannot replace both stairs', p => { p.stairs = []; });
  reject('same stair identity cannot count twice', p => p.stairs[1].id = p.stairs[0].id);
  reject('missing elevator in core metadata', p => p.circulation.cores[0].elevatorIds = []);
  reject('actual ground exit removed', p => { p.windows.filter(w => w.kind === 'door').forEach(w => w.kind = 'window'); });
  reject('public corridor relabelled as foreign apartment', p => { p.rooms.filter(r => r.type === 'corridor').forEach(r => { r.circulation = 'private'; r.apartment = 999; }); });
  reject('broken intermediate flight', p => p.stairs[0].layout.flights.splice(4, 1));
  reject('landing moved to rear of cage', p => { const r = p.rooms.find(r => r.type === 'stair' && r.level === 4); const d = r.doors[0], w = p.walls[d.wall]; w.a[1] += 4; w.b[1] += 4; });
  reject('shaft drift despite positive rectangle', p => { const r = p.rooms.find(r => r.type === 'shaft' && r.level === 4); r.polygon.forEach(q => q[0] += 0.2); });
  reject('asymmetric door', p => { const r = p.rooms.find(r => r.doors.length); r.doors[0].to = 'missing'; });
  const edits = new RoomEdits(); edits.apply(sample.plan);
  const bedroom = sample.plan.rooms.find(r => r.type === 'bedroom' && r.level === 3);
  edits.setType(bedroom.id, 'storage'); assert.deepEqual(edits.apply(sample.plan).plan.issues, []);
  edits.undo(); assert.deepEqual(edits.apply(sample.plan).plan, sample.plan);
  const pair = sample.plan.walls.map(w => w.rooms).find(ids => ids[1] && !mergeReason(sample.plan, ids));
  assert.ok(pair); edits.merge(pair, 'salon'); assert.deepEqual(edits.apply(sample.plan).plan.issues, []);
  edits.undo(); assert.deepEqual(edits.apply(sample.plan).plan, sample.plan);
  const stairsBefore = JSON.stringify(sample.plan.stairs), voidsBefore = JSON.stringify(sample.plan.voids);
  assert.throws(() => edits.setType(sample.plan.rooms.find(r => r.type === 'elevator').id, 'bedroom'));
  assert.equal(JSON.stringify(sample.plan.stairs), stairsBefore); assert.equal(JSON.stringify(sample.plan.voids), voidsBefore);
  report.editLifecycle = 'rename, undo, actual merge, replay and protected shaft/stair geometry passed';
  // All four rotations use the same local solid/steps, with world-space geometry confined to the cage.
  const cutaway = new Cutaway(), material = new MeshStandardMaterial();
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const s = structuredClone(sample.plan.stairs[0]); s.frame = { origin: [20,20], orientation: angle };
    s.polygon = rectLoop(s.layout.rect).map(q => coreWorld(s.frame, q));
    const mini = { ...sample.plan, stairs: [s] }, group = buildStairs(mini, cutaway.interior, material, material, 'real');
    group.traverse(o => { if (!o.isMesh) return; const pos = o.geometry.getAttribute('position'); report.geometryVertices += pos.count;
      for (let i = 0; i < pos.count; i++) { const q = coreLocal(s.frame, [pos.getX(i), pos.getY(i)]), r = s.layout.rect; assert.ok(q[0] >= r[0] - 0.2 && q[0] <= r[2] + 0.2 && q[1] >= r[1] - 0.2 && q[1] <= r[3] + 0.2); assert.ok(Number.isFinite(pos.getZ(i))); }
      o.geometry.dispose(); });
    group.clear();
  }
  report.rotatedGraphChecks = [];
  for (const orientation of [Math.PI/2, Math.PI, -Math.PI/2]) {
    const rotated = structuredClone(sample.plan), c = Math.cos(orientation), sn = Math.sin(orientation);
    const point = ([x,y]) => [c*x-sn*y, sn*x+c*y];
    rotated.inner = rotated.inner.map(point);
    for (const r of rotated.rooms) { r.polygon = r.polygon.map(point); const points = rectLoop(r.rect).map(point); r.rect = [Math.min(...points.map(q=>q[0])), Math.min(...points.map(q=>q[1])), Math.max(...points.map(q=>q[0])), Math.max(...points.map(q=>q[1]))]; }
    rotated.walls.forEach(w => { w.a = point(w.a); w.b = point(w.b); });
    rotated.windows.forEach(w => { w.at = point(w.at); w.dir = point(w.dir); });
    rotated.voids.forEach(v => v.polygon = v.polygon.map(point));
    rotated.stairs.forEach(s => { s.polygon = s.polygon.map(point); s.landingEdge = s.landingEdge.map(point); s.frame.origin = point(s.frame.origin); s.frame.orientation += orientation; });
    rotated.circulation.cores.forEach(core => { core.position = point(core.position); core.orientation += orientation; });
    assert.deepEqual(checkPlan(rotated), [], 'rotation retains landing/ground-exit/household routes');
    const audit = analyseCirculation(rotated);
    assert.deepEqual(audit.effectiveStairIds, analyseCirculation(sample.plan).effectiveStairIds);
    report.rotatedGraphChecks.push(orientation);
  }
  // Ray tests prove shafts remove horizontal floor/ceiling triangles at their centres.
  const { Raycaster } = await import('three');
  const interior = buildRooms3d(sample.plan, sample.building, kit, cutaway.interior, 'real'); interior.updateMatrixWorld(true);
  const shaft = sample.plan.rooms.find(r => r.type === 'elevator' && r.level === 4), centre = shaft.polygon.reduce((a, q) => [a[0]+q[0]/shaft.polygon.length, a[1]+q[1]/shaft.polygon.length], [0,0]);
  const ray = new Raycaster(new Vector3(...centre, shaft.floorZ+0.03), new Vector3(0,0,-1), 0, 0.08);
  assert.equal(ray.intersectObject(interior, true).length, 0, 'elevator shaft floor is physically open');
  ray.set(new Vector3(...centre, shaft.ceilingZ-0.03), new Vector3(0,0,1));
  assert.equal(ray.intersectObject(interior, true).length, 0, 'elevator shaft ceiling is physically open');
  interior.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); material.dispose();
  for (const floors of [10, 20]) {
    const v = make({ floors, floorVariety: true });
    for (let i = 0; i < 3; i++) planBuilding(v.building, v.params);
    const ms = [];
    for (let i = 0; i < 10; i++) { const start = performance.now(); planBuilding(v.building, v.params); ms.push(performance.now() - start); }
    ms.sort((a,b) => a-b);
    report.timings.push({ fixture: [14,5,floors], warmup: 3, samples: 10, p50Ms: ms[4], p95Ms: ms[9],
      scope: 'Node SSR pure opt-in plan/signatures/retries/weighted route checker; excludes topology/generation/3D/furniture/labels/GPU' });
  }
  if (json >= 0) await writeFile(args[json+1], JSON.stringify(report, null, 2)+'\n');
  console.log(JSON.stringify({ cases: cases.length, legacyGoldens: report.legacyGoldens, negativeChecks: report.negativeChecks.length, geometryVertices: report.geometryVertices, maxCaseMs: Math.max(...cases.map(c => c.ms ?? 0)) }));
} finally { await server.close(); }
