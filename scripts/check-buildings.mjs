/** Multi-building placement, material isolation and translated unfold regressions. */
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { Box3, BoxGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, ShaderLib, Vector3 } from 'three';
const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' });
try {
  const load = name => server.ssrLoadModule(`/src/${name}.ts`);
  const { BuildingScene } = await load('buildingScene');
  const { forkKitMaterials } = await load('materials');
  const { UnfoldView } = await load('unfold');
  const { Cutaway } = await load('cutaway');
  const { bindBuildingOrigin, cloneShaderMaterial } = await load('shaderVariant');
  const { defaultParams } = await load('params');
  const { generateBuilding } = await load('generator');
  const { planBuilding } = await load('plan');
  const { RoomEdits } = await load('roomEdits');
  const box = new Box3(new Vector3(-12, 0, -10), new Vector3(12, 24, 10));
  const city = new BuildingScene(0.5);
  const a = city.add('right', { floors: 4 }, box, 12);
  const b = city.add('right', { floors: 2 }, box, 12);
  city.add('left', { floors: 3 }, box, 18);
  city.add('right', { floors: 1 }, box, 8);
  city.activeId = b.id;
  const anchor = b.position.x;
  city.updateFootprint(b.id, new Box3(new Vector3(-18, 0, -12), new Vector3(18, 30, 12)), 16);
  assert.equal(b.position.x, anchor, 'active horizontal anchor does not move');
  for (let i = 1; i < city.buildings.length; i++) {
    const left = city.buildings[i - 1], right = city.buildings[i];
    assert.ok(right.position.x + right.localBounds.min.x >= left.position.x + left.localBounds.max.x + 0.5 - 1e-8);
    assert.equal(left.position.z + left.length / 2, right.position.z + right.length / 2, 'fronts align');
  }
  b.state.floors = 6; assert.equal(a.state.floors, 4);
  assert.equal(new Set(city.buildings.map(b => b.id)).size, 4);
  assert.ok(city.bounds().containsBox(b.localBounds.clone().translate(b.position)));
  for (const direction of ['front', 'back', 'right', 'left', 'front']) {
    const preview = city.candidate(direction, box, 12).position.clone();
    const entry = city.add(direction, null, box, 12);
    assert.ok(entry.position.distanceTo(preview) < 1e-8, 'preview matches packed insertion');
  }
  city.clearance = 8;
  const fixed = city.active.position.clone(); city.layout();
  assert.ok(city.active.position.equals(fixed), 'spacing keeps selected building anchored');
  for (const left of city.buildings) for (const right of city.buildings) {
    if (left === right) continue;
    const a = left.localBounds.clone().translate(left.position), b = right.localBounds.clone().translate(right.position);
    assert.ok(a.max.x + 8 <= b.min.x + 1e-8 || b.max.x + 8 <= a.min.x + 1e-8 || a.max.z + 8 <= b.min.z + 1e-8 || b.max.z + 8 <= a.min.z + 1e-8, '2D grid respects gap');
  }
  const stone = new MeshStandardMaterial(); stone.userData.tint = 'stone';
  stone.onBeforeCompile = s => { s.uniforms.uTexMix = { value: 1 }; };
  const zinc = new MeshStandardMaterial();
  const base = { byName: new Map([['stone', stone], ['zinc', zinc], ['zinc:noao', zinc]]), interior: stone, voile: stone,
    lace: () => stone, laceDepth: () => stone, setNight: () => {}, setLook: () => {} };
  const ma = forkKitMaterials(base), mb = forkKitMaterials(base);
  const sa = { uniforms: {} }, sb = { uniforms: {} };
  ma.byName.get('stone').onBeforeCompile(sa, null); mb.byName.get('stone').onBeforeCompile(sb, null);
  ma.setLook('paris');
  assert.equal(sa.uniforms.uTexMix.value, 0.6); assert.equal(sb.uniforms.uTexMix.value, 1);
  assert.notEqual(ma.byName.get('stone'), mb.byName.get('stone'));
  assert.equal(ma.byName.get('stone').customProgramCacheKey(), mb.byName.get('stone').customProgramCacheKey());
  const originOffset = new Vector3(35, 0, -4), interiorMaterial = new Cutaway().interior.finishFloor;
  bindBuildingOrigin(interiorMaterial, originOffset);
  const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
  cloneShaderMaterial(interiorMaterial).onBeforeCompile(shader, null);
  assert.equal(shader.uniforms.uBuildingOrigin.value, originOffset, 'shader keeps live per-building origin');
  assert.ok(shader.vertexShader.includes('frame[3].xyz -= uBuildingOrigin'));
  const world = new Vector3(2, 1, 3).applyMatrix4(new Matrix4().makeTranslation(...originOffset.toArray()));
  assert.ok(world.sub(shader.uniforms.uBuildingOrigin.value).distanceTo(new Vector3(2, 1, 3)) < 1e-8, 'stamps stay local after world translation');
  const params = defaultParams(), kit = { key: (c, v) => `${c}/${v}`, info: () => undefined };
  const plan = planBuilding(generateBuilding(params, kit), params);
  for (const overrides of [{ baysX: 10 }, { baysY: 8 }, { floors: 6 }, { baysX: 10, baysY: 8, floors: 6 }]) {
    const large = { ...params, ...overrides }, building = generateBuilding(large, kit), planned = planBuilding(building, large);
    assert.equal(planned.levels.length, large.floors + 2);
    assert.equal(planned.issues.length, 0, `large plan: ${JSON.stringify(overrides)}`);
  }
  const editsA = new RoomEdits(), editsB = new RoomEdits();
  editsA.apply(plan); editsB.apply(plan);
  const editable = plan.rooms.find(r => r.type === 'bedroom' && r.level > 0);
  editsA.setType(editable.id, 'study');
  assert.equal(editsA.apply(plan).plan.rooms.find(r => r.id === editable.id).type, 'study');
  assert.equal(editsB.apply(plan).plan.rooms.find(r => r.id === editable.id).type, 'bedroom');
  editsA.undo(); assert.equal(editsA.apply(plan).plan.rooms.find(r => r.id === editable.id).type, 'bedroom');
  editsA.redo(); assert.equal(editsA.apply(plan).plan.rooms.find(r => r.id === editable.id).type, 'study');
  assert.equal(editsB.apply(plan).plan.rooms.find(r => r.id === editable.id).type, 'bedroom');
  function unfolded(offset) {
    const parent = new Group(); parent.rotation.x = -Math.PI / 2; parent.position.copy(offset);
    const source = new Group(); source.position.set(-plan.width / 2, -plan.length / 2, 0);
    const mesh = new Mesh(new BoxGeometry(plan.width, plan.length, 20), new MeshStandardMaterial());
    mesh.position.set(plan.width / 2, plan.length / 2, 10); source.add(mesh); parent.add(source);
    const view = new UnfoldView(source, plan, new Cutaway()); parent.add(view.group);
    view.update(0.3, 0, 'all'); return { view, mesh };
  }
  const origin = unfolded(new Vector3()), shifted = unfolded(new Vector3(35, 0, -4));
  assert.ok(shifted.view.bounds().getCenter(new Vector3()).sub(origin.view.bounds().getCenter(new Vector3())).distanceTo(new Vector3(35, 0, -4)) < 1e-6);
  for (const item of [origin, shifted]) { item.view.dispose(); item.mesh.geometry.dispose(); item.mesh.material.dispose(); }
  console.log('PASS: 2D four-direction placement, gap/reflow, preview agreement, 10x8x6 plans, independent edits/uniforms, building-relative shader stamps, translated unfold');
} finally { await server.close(); }
