/** Three-section geometry, coordinate, ownership and picking regressions, without a browser/port. */
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { BoxGeometry, BufferGeometry, Color, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Raycaster, ShaderLib, Uint8BufferAttribute, Vector3 } from 'three';

const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' });
try {
  const load = name => server.ssrLoadModule(`/src/${name}.ts`);
  const { defaultParams } = await load('params');
  const { generateBuilding } = await load('generator');
  const { planBuilding } = await load('plan');
  const { buildRooms3d } = await load('rooms3d');
  const { buildStairs } = await load('stairs');
  const { buildFurniture } = await load('furniture');
  const { sectionGeometry } = await load('sectionGeometry');
  const { Cutaway } = await load('cutaway');
  const { UnfoldView, clipUnfoldPolygon } = await load('unfold');
  const { inRoom, roomAnchor, signedArea } = await load('roomGeometry');
  const { RoomLabels } = await load('roomLabels');
  // Labels' coordinate/selection lifecycle can be checked without rendering a canvas.
  const previousDocument = globalThis.document;
  const context = new Proxy({ measureText: () => ({ width: 160 }), createLinearGradient: () => ({ addColorStop() {} }) }, { get: (target, key) => target[key] ?? (() => {}) });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  const kit = { key: (c, v) => `${c}/${v}`, info: () => undefined };
  // Fixed slabs retain ALL crossing triangles (including ones whose centroid
  // is outside); transformed source coordinates and stamps remain byte-exact.
  for (const indexed of [false, true]) {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([
      -4,0,0, -3,1,0, -2,0,0, // outside
      -2,0,0, 2,1,0, -2,2,0, // crosses slab, centroid outside
      0,0,0, 0,1,0, 0,0,1, // touches boundary
      4,0,0, 5,1,0, 6,0,0, // outside
    ], 3));
    g.setAttribute('stamp', new Uint8BufferAttribute(Array.from({ length: 12 }, (_, i) => i), 1, true));
    if (indexed) g.setIndex([0,1,2,3,4,5,6,7,8,9,10,11,3,5,4]);
    const before = [...g.getAttribute('position').array], matrix = new Matrix4().makeTranslation(10, 0, 0);
    const sliced = sectionGeometry(g, matrix, 10, 11);
    assert.notEqual(sliced, g); assert.ok(sliced);
    assert.equal((sliced.index?.count ?? sliced.getAttribute('position').count) / 3, indexed ? 3 : 2);
    assert.equal(sliced.getAttribute('position'), g.getAttribute('position'), 'vertices stay shared without copying');
    const stamp = sliced.getAttribute('stamp');
    assert.equal(stamp.normalized, true);
    assert.equal(stamp, g.getAttribute('stamp'), 'all stamps are byte-identical');
    assert.deepEqual([...sliced.index.array], indexed ? [3,4,5,6,7,8,3,5,4] : [3,4,5,6,7,8]);
    assert.equal(sliced.boundingBox.min.x, -2); assert.equal(sliced.boundingBox.max.x, 2);
    assert.deepEqual([...g.getAttribute('position').array], before, 'source stays immutable');
    assert.equal(sectionGeometry(g, matrix, -100, 100), g, 'unchanged slab shares source');
    assert.equal(sectionGeometry(g, matrix, 20, 30), null, 'empty slab emits no mesh');
    assert.equal(sectionGeometry(g, matrix, 10, 11), sliced, 'same source/slab reuses its index buffer');
    g.addGroup(0, 3, 0);
    assert.equal(sectionGeometry(g, matrix, 10, 11), g, 'grouped geometry retains shader fallback');
    g.clearGroups(); g.setDrawRange(3, 3);
    assert.equal(sectionGeometry(g, matrix, 10, 11), g, 'partial draw ranges retain fallback');
    let freed = 0;
    sliced.addEventListener('dispose', () => freed++);
    g.dispose(); assert.equal(freed, 1, 'source releases index views even if it was never rendered');
    g.setDrawRange(0, Infinity);
    assert.notEqual(sectionGeometry(g, matrix, 10, 11), sliced, 'source disposal also invalidates cache');
    g.dispose();
  }
  const rotated = new BufferGeometry();
  rotated.setAttribute('position', new Float32BufferAttribute([0,2,0, 1,3,0, 0,3,1], 3));
  assert.equal(sectionGeometry(rotated, new Matrix4().makeRotationZ(Math.PI / 2), -4, -1), rotated, 'slabs use transformed coordinates');
  assert.equal(sectionGeometry(rotated, new Matrix4().makeRotationZ(Math.PI / 2), 1, 4), null);
  rotated.dispose();
  let cases = 0, roomsChecked = 0, sharedFinishNoise;
  for (const overrides of [
    {}, { baysX: 2, baysY: 2 }, { baysX: 3, baysY: 2, floors: 1 },
    { baysX: 9, baysY: 5 }, { baysX: 10, baysY: 8, floors: 6 },
    { type: 'corner', cornerStyle: 'panCoupe' }, { type: 'row', depth: 20, baysX: 7 },
    { floorVariety: true, seed: 2 },
    { floorVariety: true, baysX: 10, baysY: 3, floors: 6, seed: 7, ballroom: false, apartments: 'one' },
    { floorVariety: true, type: 'corner', cornerStyle: 'panCoupe', seed: 8 },
    { layoutMode: 'auto', baysX: 14, baysY: 5, floors: 10, floorVariety: true },
    { layoutMode: 'auto', baysX: 14, baysY: 5, floors: 20, ballroom: false },
    { layoutMode: 'courtyard', baysX: 20, baysY: 10, floors: 6, ballroom: false },
    { layoutMode: 'courtyard', baysX: 20, baysY: 20, floors: 20, ballroom: false },
    { layoutMode: 'lightwell', baysX: 10, baysY: 10, floors: 6, ballroom: false },
    { layoutMode: 'lightwell', baysX: 20, baysY: 20, floors: 20, ballroom: false },
  ]) {
    const params = { ...defaultParams(), ...overrides }, building = generateBuilding(params, kit);
    const plan = planBuilding(building, params), cutaway = new Cutaway();
    const snapshot = JSON.stringify(plan);
    const root = new Group(); root.rotation.x = -Math.PI / 2;
    const source = new Group(); source.position.set(-building.width / 2, -building.length / 2, 0); root.add(source);
    source.add(buildRooms3d(plan, building, kit, cutaway.interior, 'real'));
    source.add(buildStairs(plan, cutaway.interior, cutaway.interior.iron, cutaway.interior.iron, 'real'));
    if (cases === 0 || (params.floorVariety && params.seed === 7) || params.layoutMode === 'lightwell' && params.baysX === 10 || params.layoutMode === 'courtyard' && params.floors === 6) {
      const furniture = buildFurniture(plan, building, cutaway.interior, 'real');
      if (building.topology.deepLayout || building.topology.courtyardLayout) {
        furniture.updateMatrixWorld(true);
        const point = new Vector3();
        furniture.traverse(o => {
          if (!o.isMesh) return;
          const pos = o.geometry.getAttribute('position');
          for (let i = 0; i < pos.count; i++) {
            point.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
            assert.ok(!(building.topology.deepLayout?.wells ?? [{rect:building.topology.courtyardLayout.court}]).some(w => point.x > w.rect[0] + .02 && point.x < w.rect[2] - .02 && point.y > w.rect[1] + .02 && point.y < w.rect[3] - .02), 'furniture cannot enter a lightwell');
          }
        });
      }
      source.add(furniture);
    }
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
    assert.equal(cutaway.color.value.getHex(), 0x000000, 'section faces are black');
    for (const amount of [0, 0.01, 0.1, 0.5, 1]) {
      view.update(amount, 0.8, 'all');
      assert.equal(view.front, 0.8, 'opening depth stays fixed throughout unfolding, including 0%');
      for (const part of view.parts) {
        const front = new Vector3(plan.width / 2, 0.8, 1).applyMatrix4(part.group.matrixWorld);
        assert.ok(Math.abs(part.planes[2].distanceToPoint(front)) < 1e-6, 'front plane follows only opening depth');
      }
    }
    for (const amount of [0, 0.1, 0.5, 1]) {
      view.update(amount, 0, 'all');
      for (const part of view.parts) {
        const facade = new Vector3(plan.width / 2, -0.01, 1).applyMatrix4(part.group.matrixWorld);
        assert.ok(part.planes[2].distanceToPoint(facade) > 0, 'zero opening retains projecting front facade');
      }
    }
    assert.equal(view.parts.length, 3);
    assert.ok(view.cuts[0] > 0 && view.cuts[0] < view.cuts[1] && view.cuts[1] < plan.width);
    for (const cut of view.cuts) for (const stair of plan.stairs) {
      assert.ok(cut <= stair.layout.rect[0] - 0.145 + 1e-5 || cut >= stair.layout.rect[2] + 0.145 - 1e-5, 'section opening avoids stair flights');
    }
    const sourceGeometries = new Set(); source.traverse(o => { if (o.isMesh) sourceGeometries.add(o.geometry); });
    const sourceMeshes = new Map(); source.traverse(o => { if (o.isMesh) sourceMeshes.set(o.uuid, o); });
    const owned = new Set();
    let ownedDisposed = 0, submitted = 0, unpruned = 0;
    for (const part of view.parts) for (const mesh of part.group.children) {
      const original = sourceMeshes.get(mesh.userData.unfoldSource); assert.ok(original);
      const triangles = g => (g.index?.count ?? g.getAttribute('position').count) / 3;
      submitted += triangles(mesh.geometry) * (mesh.isInstancedMesh ? mesh.count : 1);
      unpruned += triangles(original.geometry) * (mesh.isInstancedMesh ? mesh.count : 1);
      if (mesh.geometry === original.geometry) continue;
      owned.add(mesh.geometry);
      assert.ok(!sourceGeometries.has(mesh.geometry));
      for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
        assert.equal(attribute, original.geometry.attributes[name], 'view borrows unchanged source attributes');
        assert.equal(attribute.itemSize, original.geometry.attributes[name].itemSize);
      }
      mesh.geometry.addEventListener('dispose', () => ownedDisposed++);
    }
    if (cases === 0) {
      assert.ok(submitted < unpruned * 0.8, 'adjustable envelopes still reduce full three-copy submission');
      console.log(`Adjustable section submission: ${(100 * submitted / unpruned).toFixed(1)}% of unpruned copies`);
    }
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
          assert.ok(sourceGeometries.has(mesh.geometry) || owned.has(mesh.geometry), 'geometry ownership is explicit');
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
      assert.equal(shader.uniforms.uSourceFrame, p.undo);
      assert.ok(Object.hasOwn(material.defines, 'USE_SOURCE_FRAME'));
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
        assert.ok(shader.vertexShader.includes('sourceModelMatrix * vec4(transformed'));
        assert.ok(shader.vertexShader.includes('#define sourceModelMatrix (uSourceFrame * modelMatrix)'));
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
    const initialSpacing = view.spacing, centerX = (view.cuts[0] + view.cuts[1]) / 2;
    const geometriesBeforeSpacing = view.parts.flatMap(p => p.group.children.map(m => m.geometry));
    for (const distance of [view.spacingRange[0], view.spacingRange[1], initialSpacing]) {
      view.setSpacing(distance); view.update(1, 0.8, 'all');
      assert.ok(Math.abs(view.spacing - distance) < 1e-6);
      assert.ok(Math.abs((view.cuts[0] + view.cuts[1]) / 2 - centerX) < 1e-6, 'spacing keeps the original midpoint');
      assert.equal(view.parts[0].hi, view.parts[1].lo);
      assert.equal(view.parts[1].hi, view.parts[2].lo);
      assert.deepEqual(view.parts.flatMap(p => p.group.children.map(m => m.geometry)), geometriesBeforeSpacing, 'slider does not allocate geometries');
      assert.ok(!view.bounds().isEmpty());
    }
    view.dispose(); assert.equal(disposed, 0, 'disposing view must not dispose source geometry');
    assert.equal(ownedDisposed, 0, 'mode changes preserve source-owned index caches and shared GPU buffers');
    assert.ok(!Object.hasOwn(cutaway.interior.finishFloor.defines, 'USE_SOURCE_FRAME'), 'unfold defines never leak back to ordinary cut materials');
    assert.equal(cutaway.cut(cutaway.interior.finishFloor), cutaway.interior.finishFloor, 'cut variants never stack');
    if (cases === 0) for (let cycle = 0; cycle < 3; cycle++) {
      const again = new UnfoldView(source, plan, cutaway); root.add(again.group);
      again.update(1, 0.8, 'all');
      for (const part of again.parts) for (const mesh of part.group.children) {
        assert.ok(sourceGeometries.has(mesh.geometry) || owned.has(mesh.geometry), 'mode switches allocate no new index geometry');
      }
      assert.equal(again.parts.reduce((n, p) => n + p.group.children.length, 0), view.parts.reduce((n, p) => n + p.group.children.length, 0));
      again.dispose();
      assert.equal(disposed, 0, 'repeated enter/leave keeps source buffers alive');
    }
    assert.equal(view.group.parent, null);
    assert.equal(JSON.stringify(plan), snapshot, 'presentation must not mutate plan/edit data');
    for (const g of sourceGeometries) g.dispose();
    assert.equal(ownedDisposed, owned.size, 'source disposal releases every cached index view exactly once');
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
  wall.geometry.clearGroups(); // Exercise indexed section views, not the grouped fallback.
  wall.position.set(plan.width / 2, 0, 1); source.add(wall);
  const back = wall.clone(); back.position.y = 4; source.add(back);
  const view = new UnfoldView(source, plan, cutaway); root.add(view.group); view.update(1, 0.8, 'center');
  assert.ok(view.parts[1].group.children.some(mesh => mesh.geometry !== wall.geometry));
  const ray = new Raycaster(new Vector3(plan.width / 2, -10, 1), new Vector3(0, 1, 0));
  assert.equal(view.pick(ray), 'center');
  view.dispose(); wall.geometry.dispose(); wall.material.dispose();
  console.log(`Unfold checks passed: ${cases} building configurations, ${roomsChecked} retained room labels; clipping, materials, lamps, picking and cleanup.`);
  if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
} finally { await server.close(); }
