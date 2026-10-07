/** Opt-in floor programming: legacy oracle, signature invariants, physical access and edit lifecycle. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';
const args = process.argv.slice(2), matrix = args.includes('--matrix'), jsonAt = args.indexOf('--json');
const output = jsonAt >= 0 ? args[jsonAt + 1] : null;
assert.ok(jsonAt < 0 || output, '--json requires a path');
assert.ok(args.every((a, i) => ['--matrix', '--json'].includes(a) || (jsonAt >= 0 && i === jsonAt + 1)), 'unknown argument');
const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' });
const hash = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const serviceTypes = ['bathroom', 'closet', 'foyer', 'pantry'];
try {
  const load = name => server.ssrLoadModule(`/src/${name}.ts`);
  const { defaultParams } = await load('params');
  const { generateBuilding } = await load('generator');
  const { planBuilding, checkPlan } = await load('plan');
  const { legacyPlanCases } = await load('planChecks');
  const { floorSignature } = await load('planning/signature');
  const { varyApartment, programRoll } = await load('planning/program');
  const { PURPOSE } = await load('rng');
  const { roomsOverlap } = await load('roomGeometry');
  const { RoomEdits, roomTypesForLevel, mergeReason } = await load('roomEdits');
  const { stampOf } = await load('finishes');
  const { planRule } = await load('interiors');
  const dims = JSON.parse(await readFile(new URL('../blender/kit_dims.json', import.meta.url), 'utf8'));
  const kit = { key: (c, v) => `${c}/${v}` };
  const make = overrides => {
    const params = { ...defaultParams(), ...overrides };
    const building = generateBuilding(params, kit);
    return { params, building, plan: planBuilding(building, params) };
  };
  const report = { date: new Date().toISOString(), matrix, cases: 0, levels: 0, retries: 0, maxRetries: 0,
    repeated: 0, fallback: 0, newRooms: {}, examples: {}, outcomes: {}, diagnosticExamples: [], benchmarks: [] };
  const golden = JSON.parse(await readFile(new URL('./baselines/plans-v1.json', import.meta.url), 'utf8'));
  for (const fixture of golden.cases) {
    const params = { ...golden.baseParams, ...fixture.overrides };
    const omitted = make(params).plan, disabled = make({ ...params, floorVariety: false }).plan;
    assert.equal(hash(omitted), fixture.planSha256, `${fixture.name}: complete legacy golden`);
    assert.deepEqual(disabled, omitted, `${fixture.name}: explicit false is byte-equivalent`);
  }
  const strictInterior = (inner, q) => inner.every((a, i) => {
    const b = inner[(i + 1) % inner.length];
    return (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]) > 1e-6;
  });
  const inspect = ({ params, building: b, plan }) => {
    assert.deepEqual(plan.issues, [], JSON.stringify(params));
    assert.deepEqual(checkPlan(plan), []);
    const owners = new Array(plan.windows.length).fill(0), byId = new Map(plan.rooms.map(r => [r.id, r]));
    assert.equal(byId.size, plan.rooms.length);
    for (const r of plan.rooms) {
      for (const wi of r.windows) { owners[wi]++; assert.equal(plan.windows[wi].room, r.id); }
      for (const d of r.doors) {
        const w = plan.walls[d.wall];
        assert.ok(w.rooms.includes(r.id) && w.rooms.includes(d.to));
        assert.ok(byId.get(d.to).doors.some(o => o.wall === d.wall && o.to === r.id && o.at === d.at));
        assert.ok(d.at - d.width / 2 >= -1e-6 && d.at + d.width / 2 <= Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) + 1e-6);
      }
      if (!serviceTypes.includes(r.type)) continue;
      assert.equal(r.windows.length, 0, 'generated services leave all facade windows with their owner');
      assert.ok(r.area >= dims.interior.variety.minServiceArea - 0.01);
      assert.ok(r.programTargets?.length);
      assert.deepEqual([...new Set(r.doors.map(d => d.to))].sort(), [...r.programTargets].sort());
      const targets = r.programTargets.map(id => byId.get(id).type).sort();
      if (r.type === 'bathroom' || r.type === 'closet') assert.deepEqual(targets, ['bedroom']);
      if (r.type === 'pantry') assert.deepEqual(targets, ['dining', 'kitchen']);
      if (r.type === 'foyer') assert.ok(targets.includes('corridor') && targets.some(t => ['salon', 'dining'].includes(t)));
      report.newRooms[r.type] = (report.newRooms[r.type] ?? 0) + 1;
      report.examples[r.type] ??= { overrides: { type: params.type, cornerStyle: params.cornerStyle, baysX: params.baysX,
        baysY: params.baysY, depth: params.depth, floors: params.floors, ballroom: params.ballroom,
        groundUse: params.groundUse, seed: params.seed, apartments: params.apartments }, room: r.id, area: r.area };
      assert.ok(roomTypesForLevel(r.level).includes(r.type));
      for (const look of ['real', 'diagram']) for (const surface of ['floor', 'wall']) {
        assert.ok(stampOf(look, r, surface).every(Number.isFinite));
      }
    }
    assert.ok(owners.every(n => n === 1), 'every window has exactly one owner');
    for (const w of plan.walls) {
      if (w.kind !== 'partition') continue;
      const [a, c] = w.rooms.map(id => byId.get(id));
      // A newly inserted cut lies within a shared fixed cell; existing cell edges may meet the facade.
      if (!a || !c || ![a, c].some(r => serviceTypes.includes(r.type)) || !a.cellIds.some(id => c.cellIds.includes(id))) continue;
      assert.ok(strictInterior(plan.inner, w.a) && strictInterior(plan.inner, w.b), 'new cut endpoints avoid the facade');
      assert.equal(w.thickness, dims.interior.walls.partition);
    }
    report.cases++;
    for (const d of plan.programDiagnostics) {
      report.levels++; report.retries += d.retries; report.maxRetries = Math.max(report.maxRetries, d.retries);
      assert.ok(d.retries <= dims.interior.variety.maxRetries);
      assert.ok(d.generatedSignature);
      for (const choice of d.choices) {
        const key = `${choice.feature}:${choice.outcome.startsWith('[') ? 'position' : choice.outcome}`;
        report.outcomes[key] = (report.outcomes[key] ?? 0) + 1;
      }
      if (d.status === 'repeated' || d.status === 'legacy-fallback') {
        report[d.status === 'repeated' ? 'repeated' : 'fallback']++;
        assert.equal(d.retries, dims.interior.variety.maxRetries);
        if (d.status === 'legacy-fallback') assert.ok(d.rejectedIssues.length);
        if (report.diagnosticExamples.length < 6) report.diagnosticExamples.push({ type: params.type, baysX: params.baysX,
          baysY: params.baysY, depth: params.depth, floors: params.floors, seed: params.seed,
          apartments: params.apartments, level: d.level, status: d.status, rejectedIssues: d.rejectedIssues });
      }
    }
  };
  for (let seed = 1; seed <= 10; seed++) {
    const fixture = make({ floorVariety: true, seed }); inspect(fixture);
    const { building: b, plan } = fixture;
    const mask = b.topology.voids.filter(v => v.kind === 'ballroom').flatMap(v => v.cellIds);
    assert.notEqual(floorSignature(plan.rooms.filter(r => r.level === 2), b.topology.cells, mask),
      floorSignature(plan.rooms.filter(r => r.level === 3), b.topology.cells, mask), `seed ${seed}: real 3F/4F difference outside ballroom`);
    assert.ok(plan.programDiagnostics.every(d => !['repeated', 'legacy-fallback'].includes(d.status)));
    assert.equal(hash(make(fixture.params).plan), hash(plan), 'deterministic opt-in result');
    assert.deepEqual(b.topology, make({ seed }).building.topology, 'programming leaves topology unchanged');
    const legacy = planBuilding(b, { ...fixture.params, floorVariety: false });
    for (const type of ['stair', 'corridor']) {
      const structural = p => p.rooms.filter(r => r.type === type).map(r => [r.level, r.rect, r.polygon, r.apartment]);
      assert.deepEqual(structural(plan), structural(legacy), 'fixed core/corridor geometry');
    }
    for (const level of [0, 1, plan.levels.length - 1]) {
      const exempt = p => p.rooms.filter(r => r.level === level).map(r => [r.id, r.type, r.rect, r.polygon, r.windows,
        r.doors.map(d => [p.walls[d.wall].a, p.walls[d.wall].b, d.at, d.width, d.height, d.to])]);
      assert.deepEqual(exempt(plan), exempt(legacy), 'ground, ballroom floor and attic unchanged');
    }
    assert.equal(hash(make({ ...fixture.params, windowAngle: 25 }).plan), hash(plan), 'appearance does not reshuffle program');
  }
  const sample = legacyPlanCases([1, 2, 3], ['auto', 'one', 'two']);
  let index = 0;
  for (const { params } of sample) {
    // Fixed stride plus explicit fixtures below avoids a full Cartesian matrix by default.
    if (matrix || index % 97 === 0) inspect(make({ ...params, floorVariety: true }));
    index++;
    if (matrix && index % 4000 === 0) console.log(`Variety matrix: ${index}/25920 passed`);
  }
  for (const profile of ['haussmann', 'uniform']) for (const ballroomFacade of ['rows', 'tall']) {
    for (const overrides of [{ baysX: 10, baysY: 8, floors: 6 }, { type: 'row', depth: 20, baysX: 7 },
      { baysX: 2, baysY: 2, floors: 6 }, { type: 'corner', cornerStyle: 'panCoupe', baysX: 10, baysY: 8 }]) {
      inspect(make({ ...overrides, profile, ballroomFacade, floorVariety: true, seed: 8 }));
    }
  }
  inspect(make({ baysX: 10, baysY: 3, floors: 6, seed: 7, ballroom: false, apartments: 'one', floorVariety: true }));
  inspect(make({ type: 'corner', baysX: 10, baysY: 2, floors: 4, seed: 3, ballroom: true, groundUse: 'residential', apartments: 'one', floorVariety: true }));
  // A signature changes only when actual visible geometry/use/grouping changes.
  const sigCase = make({ floorVariety: true }), cells = sigCase.building.topology.cells;
  const original = sigCase.plan.rooms.filter(r => r.level === 3), renamed = structuredClone(original);
  for (const r of renamed) { r.id = `9F-${r.id}`; r.level = 9; r.floorZ += 100; r.ceilingZ += 100; if (r.apartment !== null) r.apartment += 40; }
  assert.equal(floorSignature(original, cells), floorSignature(renamed.reverse(), cells), 'IDs/heights/apartment labels/order do not fake variation');
  const exclude = original[0].cellIds;
  const visible = original.filter(r => !r.cellIds.every(id => exclude.includes(id)));
  assert.equal(floorSignature(original, cells, exclude), floorSignature(visible, cells, exclude), 'fully masked rooms do not renumber remaining merge groups');
  const changed = structuredClone(original), room = changed.find(r => r.type === 'bedroom'); room.type = 'study';
  assert.notEqual(floorSignature(original, cells), floorSignature(changed, cells), 'uses matter');
  const split = structuredClone(original), donor = split.find(r => r.type === 'bedroom');
  const part = structuredClone(donor), midpoint = (donor.rect[0] + donor.rect[2]) / 2;
  donor.rect[2] = midpoint; part.rect[0] = midpoint; split.push(part);
  assert.notEqual(floorSignature(original, cells), floorSignature(split, cells), 'subcell partitions matter');

  const concave = [[0,0],[6,0],[6,6],[4,6],[4,2],[2,2],[2,6],[0,6]];
  assert.equal(roomsOverlap(concave, [[2,3],[4,3],[4,5],[2,5]]), false, 'concave bounding box does not fake overlap');
  assert.equal(roomsOverlap(concave, concave), true, 'identical contours overlap');
  assert.equal(roomsOverlap(concave, [[1,3],[3,3],[3,5],[1,5]]), true, 'a real crossing overlaps');
  // Constrained internal geometry exercises service programs that need an intervening room.
  const unit = (type, rect, win = []) => ({ type, apartment: 0, cells: [{ id: 1, col: 1, zone: 'front' }],
    x0: rect[0], y0: rect[1], x1: rect[2], y1: rect[3], win });
  const drawSeed = purpose => { for (let seed = 1; seed < 1000; seed++) {
    if (programRoll(seed, 3, 0, purpose, 0) < 0.3 &&
      [PURPOSE.planReceptionMerge, PURPOSE.planBedroomMerge, PURPOSE.planSuite, PURPOSE.planFoyer, PURPOSE.planPantry]
        .filter(p => p !== purpose).every(p => programRoll(seed, 3, 0, p, 0) >= 0.3)) return seed;
  } throw new Error('No fixture seed'); };
  const runProgram = (units, windows, purpose, interiorPoint = () => true) => {
    const ctx = { units, windows, seed: drawSeed(purpose), level: 3, retry: 0, choices: [] };
    varyApartment(ctx, 0, { fuse: () => { throw new Error('unintended merge'); }, interiorPoint }); return ctx;
  };
  const suiteUnits = () => [unit('bedroom', [3, 3, 9, 9], [0]), unit('corridor', [3, 1.75, 9, 3]),
    unit('salon', [12, 3, 15, 9]), unit('kitchen', [12, 12, 15, 18]), unit('wc', [18, 12, 21, 18])];
  const suite = runProgram(suiteUnits(), [{ at: [6, 9], dir: [-1, 0] }], PURPOSE.planSuite);
  assert.deepEqual(suite.units.filter(u => serviceTypes.includes(u.type)).map(u => u.type), ['bathroom', 'closet']);
  assert.ok(suite.units.filter(u => serviceTypes.includes(u.type)).every(u => u.access[0].type === 'bedroom' && !u.win.length));
  const blockedSuite = runProgram(suiteUnits(), [{ at: [6, 9], dir: [-1, 0] }], PURPOSE.planSuite, () => false);
  assert.ok(!blockedSuite.units.some(u => serviceTypes.includes(u.type)), 'cuts ending at the facade are rejected');
  const shortSuite = suiteUnits(); shortSuite[0].y1 = 7; shortSuite[0].part = "master-bedroom";
  const tooShort = runProgram(shortSuite, [{ at: [6, 7], dir: [-1, 0] }], PURPOSE.planSuite);
  assert.ok(!tooShort.units.some(u => serviceTypes.includes(u.type)), 'retained bedroom cannot become too shallow');
  const pantryUnits = () => [unit('kitchen', [3, 3, 6, 9]), unit('bedroom', [6, 3, 12, 9], [0]),
    unit('dining', [12, 3, 15, 9]), unit('salon', [18, 3, 21, 9]), unit('wc', [18, 12, 21, 18])];
  const pantry = runProgram(pantryUnits(), [{ at: [9, 9], dir: [-1, 0] }], PURPOSE.planPantry);
  const bridge = pantry.units.find(u => u.type === 'pantry');
  assert.ok(bridge); assert.deepEqual(bridge.access.map(u => u.type), ['kitchen', 'dining']); assert.equal(bridge.win.length, 0);
  const disconnected = pantryUnits(); disconnected[2].x0 += 1;
  assert.ok(!runProgram(disconnected, [{ at: [9, 9], dir: [-1, 0] }], PURPOSE.planPantry).units.some(u => u.type === 'pantry'), 'pantry never crosses a gap or corridor');

  // New room types are editable, independent per building, and reversible/replayable.
  const editable = make({ baysX: 10, baysY: 8, floorVariety: true, seed: 8 }).plan;
  const baseHash = hash(editable), originalRoom = editable.rooms.find(r => r.type === 'bedroom');
  for (const type of serviceTypes) {
    const a = new RoomEdits(), b = new RoomEdits(); a.apply(editable); b.apply(editable);
    a.setType(originalRoom.id, type); let result = a.apply(editable);
    assert.equal(result.plan.rooms.find(r => r.id === originalRoom.id).type, type);
    assert.equal(b.apply(editable).plan.rooms.find(r => r.id === originalRoom.id).type, 'bedroom');
    assert.equal(result.suspended.length, 0); assert.equal(hash(editable), baseHash);
    a.undo(); assert.equal(a.apply(editable).plan.rooms.find(r => r.id === originalRoom.id).type, 'bedroom');
    a.redo(); assert.equal(a.apply(editable).plan.rooms.find(r => r.id === originalRoom.id).type, type);
    assert.ok(a.apply(make({ baysX: 2, baysY: 2, floorVariety: true }).plan).suspended.length);
    assert.equal(a.apply(editable).suspended.length, 0, 'returning to the original program replays edits');
    const rule = planRule(result.plan), w = editable.windows[originalRoom.windows[0]];
    assert.ok(rule({ at: { level: w.level, side: w.side, bay: w.bay }, kind: 'upper' }).cells.length);
  }
  for (const newType of serviceTypes) {
    const example = report.examples[newType]; assert.ok(example, `${newType}: actually generated in legacy range`);
    const base = make({ ...example.overrides, floorVariety: true }).plan;
    const service = base.rooms.find(r => r.id === example.room), a = new RoomEdits(); a.apply(base); a.setType(service.id, 'storage');
    assert.equal(a.apply(base).plan.rooms.find(r => r.id === service.id).type, 'storage'); a.undo(); assert.equal(a.apply(base).plan.rooms.find(r => r.id === service.id).type, newType);
    const parent = base.rooms.find(r => r.id === service.programTargets.find(id => base.rooms.find(r => r.id === id).type !== 'corridor'));
    if (parent && !mergeReason(base, [service.id, parent.id])) {
      a.merge([service.id, parent.id], 'bedroom'); const merged = a.apply(base).plan;
      assert.ok(!checkPlan(merged, false).some(s => /走不到|入口|重疊/.test(s)));
      a.undo(); assert.equal(a.apply(base).plan.rooms.length, base.rooms.length);
    }
  }
  for (const overrides of [{}, { baysX: 10, baysY: 8, floors: 6 }]) {
    const fixture = make({ ...overrides, floorVariety: true }); const values = [];
    for (let i = 0; i < 35; i++) {
      const start = performance.now(), result = planBuilding(fixture.building, fixture.params), elapsed = performance.now() - start;
      if (i >= 5) values.push(elapsed); assert.deepEqual(result.issues, []);
    }
    values.sort((a, b) => a - b); report.benchmarks.push({ overrides, warmup: 5, samples: 30,
      scope: 'Node SSR opt-in plan including signatures/retries/checker; excludes generation, meshes, furniture, labels and GPU',
      p50Ms: +values[14].toFixed(3), p95Ms: +values[28].toFixed(3), maxMs: +values.at(-1).toFixed(3) });
  }
  assert.ok(report.outcomes['V3:salon-dining'] && report.outcomes['V3:three-bay-salon'] && report.outcomes['V4:master bedroom']);
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await server.close(); }
