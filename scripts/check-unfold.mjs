/** Three-section geometry, coordinate, ownership and picking regressions, without a browser/port. */
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { BoxGeometry, Color, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Raycaster, ShaderLib, Vector3 } from 'three';

const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' });
try {
  const load = name => server.ssrLoadModule(`/src/${name}.ts`);
  const { defaultParams } = await load('params');
  const { generateBuilding } = await load('generator');
  const { planBuilding } = await load('plan');
  const { buildRooms3d } = await load('rooms3d');
  const { buildStairs } = await load('stairs');
  const { Cutaway } = await load('cutaway');
  const { UnfoldView, clipUnfoldPolygon } = await load('unfold');
  const { inRoom, roomAnchor, signedArea } = await load('roomGeometry');
  const { RoomLabels } = await load('roomLabels');
  // Labels' coordinate/selection lifecycle can be checked without rendering a canvas.
  const previousDocument = globalThis.document;
  const context = new Proxy({ measureText: () => ({ width: 160 }) }, { get: (target, key) => target[key] ?? (() => {}) });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  const kit = { key: (c, v) => `${c}/${v}`, info: () => undefined };
  let cases = 0, roomsChecked = 0, sharedFinishNoise;
  for (const overrides of [
    {}, { baysX: 2, baysY: 2 }, { baysX: 3, baysY: 2, floors: 1 },
    { baysX: 9, baysY: 5 }, { baysX: 10, baysY: 8, floors: 6 },
    { type: 'corner', cornerStyle: 'panCoupe' }, { type: 'row', depth: 20, baysX: 7 },
  ]) {
    const params = { ...defaultParams(), ...overrides }, building = generateBuilding(params, kit);
    const plan = planBuilding(building, params), cutaway = new Cutaway();
    const snapshot = JSON.stringify(plan);
    const root = new Group(); root.rotation.x = -Math.PI / 2;
    const source = new Group(); source.position.set(-building.width / 2, -building.length / 2, 0); root.add(source);
    source.add(buildRooms3d(plan, building, kit, cutaway.interior, 'real'));
    source.add(buildStairs(plan, cutaway.interior, cutaway.interior.iron, cutaway.interior.iron, 'real'));
    const geometry = new BoxGeometry(0.3, 0.3, 0.3), base = new MeshStandardMaterial();
    const instances = new InstancedMesh(geometry, base, 3);
    for (let i = 0; i < 3; i++) {
      instances.setMatrixAt(i, new Matrix4().makeTranslation(building.width * (i + 0.5) / 3, building.length / 2, 1));
      instances.setColorAt(i, new Color().setRGB(i / 2, 1, 0));
    }
    source.add(instances);
    const hidden = new Mesh(geometry, base); hidden.userData.uncut = true; source.add(hidden);
    const terrace = new Group(); terrace.userData.unfoldSkip = true; terrace.add(new Mesh(geometry, base)); source.add(terrace);
    const view = new UnfoldView(source, plan, cutaway); root.add(view.group);
    assert.equal(view.parts.length, 3);
    assert.ok(view.cuts[0] > 0 && view.cuts[0] < view.cuts[1] && view.cuts[1] < plan.width);
    for (const cut of view.cuts) for (const stair of plan.stairs) {
      assert.ok(cut <= stair.layout.rect[0] - 0.145 + 1e-5 || cut >= stair.layout.rect[2] + 0.145 - 1e-5, 'section opening avoids stair flights');
    }
    const sourceGeometries = new Set(); source.traverse(o => { if (o.isMesh) sourceGeometries.add(o.geometry); });
    let disposed = 0;
    for (const g of sourceGeometries) g.addEventListener('dispose', () => disposed++);
    for (const amount of [0, 0.1, 0.5, 1]) for (const depth of [0.8, building.length * 0.6]) {
      view.update(amount, depth, 'all');
      assert.ok(!view.bounds().isEmpty());
      const partBounds = view.parts.map(part => {
        const box = part.localBounds.clone(), [lo, hi] = view.range(part);
        box.min.x = Math.max(box.min.x, lo); box.max.x = Math.min(box.max.x, hi); box.min.y = Math.max(box.min.y, view.front);
        return box.applyMatrix4(part.group.matrixWorld);
      });
      assert.ok(partBounds[0].max.x <= partBounds[1].min.x + 1e-5 && partBounds[1].max.x <= partBounds[2].min.x + 1e-5, 'rotating wings cannot overlap the centre');
      for (const part of view.parts) {
        if (amount === 0) assert.deepEqual(part.transform.elements, new Matrix4().elements, 'zero is the exact original pose');
        const [lo, hi] = view.range(part);
        const local = new Vector3((lo + hi) / 2, (view.front + plan.length) / 2, 1);
        const world = local.clone().applyMatrix4(part.group.matrixWorld);
        assert.ok(part.planes.every(p => p.distanceToPoint(world) >= -1e-5), 'retained point follows transformed planes');
        assert.ok(world.clone().applyMatrix4(part.undo.value).distanceTo(local.clone().applyMatrix4(source.matrixWorld)) < 1e-6, 'procedural texture remains anchored');
        const frontRemoved = new Vector3(local.x, view.front - 0.1, 1).applyMatrix4(part.group.matrixWorld);
        assert.ok(part.planes[2].distanceToPoint(frontRemoved) < 0, 'front opening clips in each rotated local frame');
        for (const mesh of part.group.children) {
          assert.ok(sourceGeometries.has(mesh.geometry), 'geometry is shared');
          assert.notEqual(mesh.material, base, 'clipping uses owned material variants');
        }
      }
      for (const room of plan.rooms) {
        const p = view.placement(room); if (!p) continue;
        assert.ok(inRoom(room.polygon, [p.anchor.x, p.anchor.y]), `label remains in ${room.id}`);
        const world = p.anchor.clone().applyMatrix4(p.matrix).applyMatrix4(source.matrixWorld);
        assert.ok(p.planes.every(plane => plane.distanceToPoint(world) >= -1e-5), `${room.id}: label must follow its section planes`);
        roomsChecked++;
      }
    }
    view.update(1, 0.8, 'center');
    assert.deepEqual(view.parts.map(p => p.group.visible), [false, true, false]);
    const center = view.parts[1], point = new Vector3((view.cuts[0] + view.cuts[1]) / 2, building.length / 2, 1);
    const sourceLamp = { position: point.clone().applyMatrix4(source.matrixWorld), intensity: 9, distance: 4 };
    const lamps = view.lamps([sourceLamp]);
    assert.equal(lamps.length, 1);
    assert.ok(lamps[0].position.distanceTo(point.clone().applyMatrix4(center.group.matrixWorld)) < 1e-6);
    assert.equal(view.lamps([{ ...sourceLamp, position: new Vector3(point.x, -1, 1).applyMatrix4(source.matrixWorld) }]).length, 0);
    view.update(1, 0.8, 'all');
    const labels = new RoomLabels(plan, false); view.group.add(labels.group);
    labels.updateUnfold(true, r => view.placement(r));
    const exposed = plan.rooms.find(r => view.placement(r)); assert.ok(exposed);
    labels.select([exposed.id]);
    labels.group.updateWorldMatrix(true, true);
    const index = plan.rooms.indexOf(exposed), itemGroup = labels.group.children[index];
    const placement = view.placement(exposed), sprite = itemGroup.children[0];
    assert.ok(sprite.getWorldPosition(new Vector3()).distanceTo(placement.anchor.clone().applyMatrix4(placement.matrix).applyMatrix4(source.matrixWorld)) < 1e-6);
    assert.equal(itemGroup.children[1].material.clippingPlanes, placement.planes, 'selected outline shares its piece planes');
    source.add(labels.group); labels.update(true, 'horizontal', 'across', plan.levels[0].floorZ + 1.5); labels.setClip(cutaway.plane);
    assert.deepEqual(itemGroup.matrix.elements, new Matrix4().elements, 'returning to ordinary sections restores label pose');
    assert.deepEqual(itemGroup.children[1].material.clippingPlanes, [cutaway.plane]);
    labels.dispose(); assert.equal(labels.group.parent, null);
    for (const p of view.parts) for (const material of p.materials.values()) {
      const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
      material.onBeforeCompile(shader, {});
      assert.equal(shader.uniforms.uUnfoldUndo, p.undo);
      assert.equal(material.clippingPlanes, p.planes);
      if (shader.uniforms.uFinNoise) {
        const noise = shader.uniforms.uFinNoise.value;
        assert.ok(noise.isDataTexture && noise.generateMipmaps, 'finish noise supports filtered overview rendering');
        sharedFinishNoise ??= noise;
        assert.equal(noise, sharedFinishNoise, 'all section material clones share one noise texture');
      }
      if (material.name === 'finish_floor') {
        assert.ok(Object.hasOwn(material.defines, 'FIN_FLOOR_ONLY'), 'floor specialization survives clipping and unfold clones');
      }
      if (material.name === 'room_finish_wall') {
        assert.ok(shader.vertexShader.includes('uUnfoldUndo * modelMatrix * vec4(transformed'));
        assert.ok(shader.fragmentShader.includes('!gl_FrontFacing'), 'solid sections stay orange');
      }
    }
    for (const part of view.parts) for (const mesh of part.group.children) {
      if (mesh.material.name !== 'finish_floor') continue;
      const patterns = mesh.geometry.getAttribute('finPattern');
      assert.ok(patterns, 'specialized floor shader receives finish stamps');
      for (const pattern of new Set(patterns.array)) {
        assert.ok(pattern < 10 || pattern === 19 || pattern === 32, `floor shader supports stamp ${pattern}`);
      }
    }
    view.dispose(); assert.equal(disposed, 0, 'disposing view must not dispose source geometry');
    assert.equal(view.group.parent, null);
    assert.equal(JSON.stringify(plan), snapshot, 'presentation must not mutate plan/edit data');
    for (const g of sourceGeometries) g.dispose();
    instances.dispose(); base.dispose();
    cases++;
    console.log(`PASS ${params.type} ${params.baysX}x${params.baysY}, floors=${params.floors}, cuts=${view.cuts.map(x => x.toFixed(2))}`);
  }

  // A concave merged room clipped across a missing middle must not put its label in the void.
  const concave = [[0,0],[6,0],[6,6],[4,6],[4,2],[2,2],[2,6],[0,6]];
  const clipped = clipUnfoldPolygon(concave, 0, 6, 3), anchor = roomAnchor(clipped);
  assert.ok(anchor && inRoom(concave, anchor));
  assert.equal(Math.abs(signedArea(clipped)), 12);

  // Raycasting must reject the invisible front surface and continue to the retained back surface.
  const { defaultParams: defaults } = await load('params');
  const params = defaults(), plan = planBuilding(generateBuilding(params, kit), params), cutaway = new Cutaway();
  const source = new Group(), root = new Group(); root.add(source);
  const wall = new Mesh(new BoxGeometry(plan.width, 0.2, 2), new MeshStandardMaterial());
  wall.position.set(plan.width / 2, 0, 1); source.add(wall);
  const back = wall.clone(); back.position.y = 4; source.add(back);
  const view = new UnfoldView(source, plan, cutaway); root.add(view.group); view.update(1, 0.8, 'center');
  const ray = new Raycaster(new Vector3(plan.width / 2, -10, 1), new Vector3(0, 1, 0));
  assert.equal(view.pick(ray), 'center');
  view.dispose(); wall.geometry.dispose(); wall.material.dispose();
  console.log(`Unfold checks passed: ${cases} building configurations, ${roomsChecked} retained room labels; clipping, materials, lamps, picking and cleanup.`);
  if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
} finally { await server.close(); }
