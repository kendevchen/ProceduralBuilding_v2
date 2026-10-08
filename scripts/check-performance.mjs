/** P7 cache validity, recipe geometry equivalence, mirrored transforms and resource ownership. */
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { Matrix3, Matrix4, Vector3 } from 'three';
const context = new Proxy({ measureText: () => ({ width: 160 }), createLinearGradient: () => ({ addColorStop() {} }) }, { get: (o, k) => o[k] ?? (() => {}) });
const previousDocument = globalThis.document;
globalThis.document = { createElement: () => ({ getContext: () => context }) };
const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' });
try {
  const load = n => server.ssrLoadModule(`/src/${n}.ts`);
  const { defaultParams } = await load('params'), { generateBuilding } = await load('generator'), { planBuilding } = await load('plan');
  const { BuildingPipeline, planKey, interiorKey } = await load('buildingPipeline'), { RoomEdits, editableRoom } = await load('roomEdits');
  const { Cutaway } = await load('cutaway'), { buildFurniture } = await load('furniture'), { RoomLabels } = await load('roomLabels');
  const { markCafeShops } = await load('cafes'), { markAtticRooms } = await load('attics');
  const kit = { key: (c, v) => `${c}.${v}`, info: () => null }, pipeline = new BuildingPipeline(), edits = new RoomEdits(), p = defaultParams();
  const first = pipeline.prepare(p, kit, edits), reused = pipeline.prepare(p, kit, edits);
  assert.equal(first.building, reused.building); assert.equal(first.edited, reused.edited);
  const appearances = { ornament: 3, windowAngle: 30, stone: '#eedddd', curtainOpen: .8, shutterHalf: .5, cresting: false };
  for (const [key, value] of Object.entries(appearances)) {
    const q = { ...p, [key]: value }, result = pipeline.prepare(q, kit, edits);
    assert.equal(result.edited, first.edited, `${key}: preserve plan/edits`);
    assert.deepEqual(result.edited.plan, new RoomEdits().apply(planBuilding(generateBuilding(q, kit), q)).plan, `${key}: uncached oracle`);
    assert.equal(interiorKey(q, edits, 'real'), interiorKey(p, edits, 'real'));
  }
  assert.equal(pipeline.counts.plan, 1); assert.equal(pipeline.counts.edits, 1); assert.equal(pipeline.counts.structure, 1);
  assert.equal(pipeline.prepare({ ...p, floorVariety: false }, kit, edits).edited, first.edited, 'restoring a missing variety flag as false keeps the plan cache');
  const mutations = {
    type: 'corner', cornerStyle: 'panCoupe', depth: 20, groundUse: 'shops', baysX: 7, baysY: 5, floors: 6, profile: 'uniform',
    dormerEvery: 2, dormerStyle: 'triangle', seed: 2, ballroom: false, ballroomFacade: 'tall', apartments: 'one', floorVariety: true,
    doorStyle: 'rect', groundWindow: 'rect', dimensionVersion: 'bays-v2', layoutMode: 'auto',
  };
  let oracleCases = 0;
  for (const [key, value] of Object.entries(mutations)) {
    const q = { ...p, [key]: value }, before = pipeline.counts.plan;
    assert.notEqual(planKey(q), planKey(p));
    assert.deepEqual(pipeline.prepare(q, kit, edits).edited.plan, new RoomEdits().apply(planBuilding(generateBuilding(q, kit), q)).plan, `${key}: fresh-plan equivalence`);
    assert.ok(pipeline.counts.plan > before); pipeline.prepare(p, kit, edits); oracleCases++;
  }
  for (const override of [{ angle: 20 }, { head: 'keystone' }, { curtain: 'none' }, { dormer: 'none' }, { dormer: 'atelier' }, { ground: 'rect' }, { door: 'rect' }]) {
    const q = { ...p, facade: { ...p.facade, '0|1|r': override, '0|1|g': override } };
    assert.deepEqual(pipeline.prepare(q, kit, edits).edited.plan, new RoomEdits().apply(planBuilding(generateBuilding(q, kit), q)).plan);
    pipeline.prepare(p, kit, edits); oracleCases++;
  }
  const room = edits.current.plan.rooms.find(r => editableRoom(r) && r.type === 'bedroom');
  const before = edits.version, baseCounts = pipeline.counts.plan;
  edits.setType(room.id, 'storage'); assert.ok(edits.version > before);
  assert.equal(pipeline.prepare(p, kit, edits).edited.plan.rooms.find(r => r.id === room.id).type, 'storage');
  edits.undo(); assert.equal(pipeline.prepare(p, kit, edits).edited.plan.rooms.find(r => r.id === room.id).type, 'bedroom');
  edits.redo(); assert.equal(pipeline.prepare(p, kit, edits).edited.plan.rooms.find(r => r.id === room.id).type, 'storage');
  assert.equal(pipeline.counts.plan, baseCounts, 'editing never reruns generation planning');
  const valid = pipeline.prepare(p, kit, edits);
  assert.throws(() => pipeline.prepare({ ...p, baysX: 21 }, kit, edits));
  assert.equal(pipeline.prepare(p, kit, edits).edited, valid.edited, 'failed preparation retains last entry');
  const other = new BuildingPipeline();
  assert.notEqual(other.prepare(p, kit, new RoomEdits()).edited, valid.edited, 'no cross-building mutable cache');

  // Compare every submitted vertex/stamp moment per material/shadow policy against the original recipes.
  function moments(group) {
    const sums = new Map(), buffers = new Set(); group.updateMatrixWorld(true);
    group.traverse(o => {
      if (!o.isMesh) return;
      for (const attribute of Object.values(o.geometry.attributes)) buffers.add(attribute.array.buffer);
      const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}`, g = o.geometry, pos = g.getAttribute('position');
      const sum = sums.get(key) ?? { count: 0, values: new Array(6).fill(0), normals: new Array(6).fill(0), stamps: {} };
      const indices = g.index?.array ?? Array.from({ length: pos.count }, (_, i) => i), point = new Vector3(), matrix = new Matrix4();
      for (let instance = 0; instance < (o.isInstancedMesh ? o.count : 1); instance++) {
        if (o.isInstancedMesh) { o.getMatrixAt(instance, matrix); assert.ok(matrix.determinant() > 0, 'reflection is baked, never a negative instance'); matrix.premultiply(o.matrixWorld); }
        else matrix.copy(o.matrixWorld);
        const normalMatrix = new Matrix3().getNormalMatrix(matrix), normal = new Vector3(), normals = g.getAttribute('normal');
        for (const i of indices) {
          point.fromBufferAttribute(pos, i).applyMatrix4(matrix); sum.count++;
          point.toArray().forEach((value, axis) => { sum.values[axis] += value; sum.values[axis + 3] += value * value; });
          normal.fromBufferAttribute(normals, i).applyNormalMatrix(normalMatrix);
          normal.toArray().forEach((value, axis) => { sum.normals[axis] += value; sum.normals[axis + 3] += value * value; });
          for (const name of ['finPattern', 'finA', 'finB', 'finZ']) {
            const a = g.getAttribute(name); if (!a) continue;
            assert.equal(a.count, pos.count, `${name}: every vertex has its stamp`);
            const values = sum.stamps[name] ??= new Array(a.itemSize).fill(0);
            for (let j = 0; j < a.itemSize; j++) values[j] += a.array[i * a.itemSize + j];
          }
        }
      }
      sums.set(key, sum);
    });
    return { sums, bytes: [...buffers].reduce((sum, b) => sum + b.byteLength, 0) };
  }
  let triangles = 0;
  for (const overrides of [{}, { seed: 2, baysX: 7, baysY: 5, floorVariety: true }, { type: 'corner', cornerStyle: 'panCoupe', seed: 3 }]) {
    const q = { ...defaultParams(), ...overrides }, b = generateBuilding(q, kit), plan = planBuilding(b, q), mats = new Cutaway().interior;
    markCafeShops(plan, q.seed); markAtticRooms(plan, q.seed);
    const reference = buildFurniture(plan, b, mats, 'real', { instancing: false }), instances = buildFurniture(plan, b, mats, 'real');
    assert.deepEqual(instances.userData, reference.userData, 'all furniture/placement/light metadata unchanged');
    const old = moments(reference), next = moments(instances); assert.deepEqual([...next.sums.keys()].sort(), [...old.sums.keys()].sort());
    for (const [key, actual] of next.sums) {
      const expected = old.sums.get(key); assert.equal(actual.count, expected.count, 'no triangles removed'); triangles += actual.count / 3;
      actual.values.forEach((v, i) => assert.ok(Math.abs(v - expected.values[i]) <= Math.max(1, Math.abs(expected.values[i])) * 2e-6, `${key}: world-space geometry moment ${i}`));
      // Float32 world coordinates and recipe-local coordinates round at different scales.
      actual.normals.forEach((v, i) => assert.ok(Math.abs(v - expected.normals[i]) <= expected.count * 1e-5, `${key}: world-space normal moment ${i}`));
      assert.deepEqual(actual.stamps, expected.stamps, 'byte-identical stamped material totals');
    }
    assert.ok(next.bytes < old.bytes * .8, 'shared geometry materially reduces memory');
    for (const group of [reference, instances]) { const geometries = new Set(); group.traverse(o => { if (o.isMesh) { geometries.add(o.geometry); if (o.isInstancedMesh) o.dispose(); } }); for (const g of geometries) g.dispose(); }
    const labels = new RoomLabels(plan, false), textures = new Set(labels.items.map(i => i.sprite.material.map));
    assert.ok(textures.size < plan.rooms.length / 2, 'same text shares a canvas without lowering resolution');
    let released = 0; textures.forEach(t => t.addEventListener('dispose', () => released++)); labels.dispose(); assert.equal(released, textures.size, 'one release per owned texture');
  }
  console.log(JSON.stringify({ cacheOracles: oracleCases, furnitureFixtures: 3, comparedTriangles: triangles, cacheIsolation: true, mirroredInstances: true, labelOwnership: true }));
} finally { globalThis.document = previousDocument; await server.close(); }
