/** Named P8 contracts, camera projection and an optional exhaustive size survey. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import dims from '../blender/kit_dims.json' with { type: 'json' };
const args = process.argv.slice(2), full = args.includes('--full'), jsonAt = args.indexOf('--json');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--json') { assert.ok(args[++i], '--json requires a path'); }
  else assert.ok(args[i] === '--full', `Unknown option: ${args[i]}`);
}
const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' });
try {
  const load = name => server.ssrLoadModule(`/src/${name}.ts`);
  const { limitCases, limitSurveyCases, checkLimitCase } = await load('limitChecks');
  const { defaultParams, defaultInteractiveParams, copyBuildingParams } = await load('params');
  const { generateBuilding } = await load('generator'), { planBuilding } = await load('plan');
  const { resolveBuildingTopology } = await load('buildingTopology');
  const { fitPerspectiveBox, perspectiveBoxFits } = await load('cameraFrame');
  const { BuildingPipeline, PlanFeasibilityError } = await load('buildingPipeline'), { RoomEdits, editableRoom } = await load('roomEdits');
  const kit = { key: (c, v) => `${c}/${v}`, info: () => undefined };
  for (const overrides of [{}, { baysX:10, baysY:8, floors:6 }]) {
    const old = { ...defaultParams(), ...overrides }, now = { ...defaultInteractiveParams(), ...overrides };
    assert.deepEqual(planBuilding(generateBuilding(now,kit),now), planBuilding(generateBuilding(old,kit),old), 'new interactive Auto keeps the complete old-range plan');
  }
  assert.equal(defaultParams().layoutMode, undefined); assert.equal(defaultParams().dimensionVersion, undefined);
  assert.equal(defaultInteractiveParams().layoutMode, 'auto'); assert.equal(defaultInteractiveParams().dimensionVersion, 'bays-v2');
  const source = { ...defaultInteractiveParams(), type: 'row', dimensionVersion: 'legacy', depth: 12.345678, floorVariety: true, layoutMode: 'lightwell' };
  const clone = copyBuildingParams(source, 9);
  assert.deepEqual(clone, { ...source, seed: 9, facade: {} });
  assert.notEqual(clone.facade, source.facade); assert.equal(source.seed, 1);
  const report = { date: new Date().toISOString(), scope: 'Named ready/infeasible contracts plus independent Three.js camera projection. Full survey separately records topology outcomes; ready plans must pass every checker or be rejected by the configured hard route-distance limit. Other checker violations fail; named ready promises cannot be reclassified.', full, cases: [], survey: [], failures: [], cameraChecks: 0 };
  for (const fixture of limitCases(full ? [1,2,3,4,5,6,7,8,9,10] : [1])) {
    const start = performance.now(), result = checkLimitCase(fixture, kit); result.ms = performance.now() - start;
    report.cases.push(result); if (result.errors.length) report.failures.push(result);
  }
  if (full) for (const overrides of limitSurveyCases()) {
    const params = { ...defaultInteractiveParams(), ...overrides }, r = resolveBuildingTopology(params);
    assert.ok(r.status !== 'unsupported', 'all public modes must resolve or explain infeasibility');
    const start = performance.now();
    const result = checkLimitCase({ name: 'dimension-survey', overrides, expected: r.status }, kit);
    const routeLimit = params.floors >= dims.interior.planning.cores.doubleStairFrom ? dims.interior.planning.cores.highMaxTravel : dims.interior.planning.cores.maxTravel;
    const distanceOnly = result.errors.length && result.errors.every(issue => {
      const match = issue.match(/^[^：]+：住戶 \d+ 取樣動線超過 ([\d.]+) m$/);
      return match && Number(match[1]) === routeLimit;
    });
    if (distanceOnly) {
      // This is observed final-plan infeasibility, kept distinct from topology
      // rejection. Never relabel an arbitrary geometry/checker failure.
      const guarded = new BuildingPipeline(), edits = new RoomEdits(), acceptedParams = defaultInteractiveParams();
      const accepted = guarded.prepare(acceptedParams, kit, edits), counts = { ...guarded.counts };
      assert.throws(() => guarded.prepare(params, kit, edits), error => error instanceof PlanFeasibilityError && JSON.stringify(error.issues) === JSON.stringify(result.errors));
      assert.equal(edits.current, accepted.edited); assert.deepEqual(guarded.counts, counts);
      assert.equal(guarded.prepare(acceptedParams, kit, edits).edited, accepted.edited);
      result.status = 'plan-infeasible'; result.diagnostics = result.errors; result.errors = [];
    }
    result.ms = performance.now() - start; report.survey.push(result);
    if (result.errors.length) report.failures.push(result);
    if (report.survey.length % 64 === 0) console.log(`survey ${report.survey.length}/512; plan failures ${report.failures.length}`);
  }
  for (const aspect of [.6, 1, 16/9, 2.4]) for (const size of [[18,24,18], [80,90,130], [200,90,100]]) {
    const box = new Box3(new Vector3(100,0,-50), new Vector3(100+size[0],size[1],-50+size[2]));
    const camera = new PerspectiveCamera(45, aspect, .1, 2000), fit = fitPerspectiveBox(box, new Vector3(.2,.3,1), camera.fov, aspect);
    camera.position.copy(fit.position); camera.lookAt(fit.target); camera.updateMatrixWorld();
    assert.ok(perspectiveBoxFits(box, camera.position, fit.target, camera.fov, aspect));
    for (const x of [box.min.x,box.max.x]) for (const y of [box.min.y,box.max.y]) for (const z of [box.min.z,box.max.z]) {
      const projected = new Vector3(x,y,z).project(camera);
      assert.ok(Math.abs(projected.x) <= .831 && Math.abs(projected.y) <= .831 && projected.z < 1 && projected.z > -1);
      report.cameraChecks++;
    }
    assert.equal(perspectiveBoxFits(box, fit.target.clone().add(new Vector3(0,0,1)), fit.target, 45, aspect), false);
  }
  // A rejection must preserve edit history, current plan and all cached entries.
  const pipeline = new BuildingPipeline(), edits = new RoomEdits(), p = defaultInteractiveParams();
  const first = pipeline.prepare(p, kit, edits), room = first.edited.plan.rooms.find(r => editableRoom(r) && r.type === 'bedroom');
  edits.setType(room.id, 'storage'); const accepted = pipeline.prepare(p, kit, edits), counts = { ...pipeline.counts }, version = edits.version;
  assert.throws(() => pipeline.prepare({ ...p, baysX:2, baysY:20, floors:20 }, kit, edits), /中庭|深平面|核心/);
  assert.equal(edits.version, version); assert.equal(edits.current, accepted.edited); assert.deepEqual(pipeline.counts, counts);
  assert.equal(pipeline.prepare(p, kit, edits).edited, accepted.edited); edits.undo();
  assert.equal(pipeline.prepare(p, kit, edits).edited.plan.rooms.find(r => r.id === room.id).type, 'bedroom');
  const count = values => values.reduce((out, r) => { out[r.status] = (out[r.status] ?? 0) + 1; return out; }, {});
  if (jsonAt >= 0) {
    const baseParams = defaultInteractiveParams();
    const record = ({ params, ...entry }) => ({ ...entry, overrides: Object.fromEntries(Object.entries(params).filter(([key,value]) => JSON.stringify(value) !== JSON.stringify(baseParams[key]))) });
    await writeFile(args[jsonAt+1], JSON.stringify({ ...report, baseParams, cases: report.cases.map(record), survey: report.survey.map(record) },null,2)+'\n');
  }
  console.log(JSON.stringify({ named: count(report.cases), survey: count(report.survey), cameraCorners: report.cameraChecks, failures: report.failures.length }, null,2));
  assert.equal(report.failures.length, 0, JSON.stringify(report.failures.map(r => ({ size:[r.params.baysX,r.params.baysY,r.params.floors], errors:r.errors.slice(0,3) }))));
} finally { await server.close(); }
