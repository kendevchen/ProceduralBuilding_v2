/** Regression checks for destructive plan edits, without opening a port or touching assets. */
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: "custom" });
try {
  const { defaultParams } = await server.ssrLoadModule("/src/params.ts");
  const { generateBuilding } = await server.ssrLoadModule("/src/generator.ts");
  const { planBuilding, checkPlan } = await server.ssrLoadModule("/src/plan.ts");
  const { RoomEdits, editableRoom, mergeReason } = await server.ssrLoadModule("/src/roomEdits.ts");
  const { inRoom, roomContains, roomAnchor, unionRooms, signedArea } = await server.ssrLoadModule("/src/roomGeometry.ts");
  const { stampOf } = await server.ssrLoadModule("/src/finishes.ts");
  const { buildFurniture } = await server.ssrLoadModule("/src/furniture.ts");
  const { MeshStandardMaterial } = await import("three");
  const kit = { key: (collection, variant) => `${collection}/${variant}` };
  const make = (overrides = {}) => {
    const params = { ...defaultParams(), ...overrides };
    return planBuilding(generateBuilding(params, kit), params);
  };
  const wallShape = w => JSON.stringify([w.a, w.b, w.thickness, w.kind, w.openings]);
  const checkReferences = plan => {
    const byId = new Map(plan.rooms.map(r => [r.id, r]));
    assert.equal(byId.size, plan.rooms.length);
    for (const [i, window] of plan.windows.entries()) {
      const owners = plan.rooms.filter(r => r.windows.includes(i));
      assert.equal(owners.length, 1, `window ${i} has exactly one room`);
      assert.equal(owners[0].id, window.room);
    }
    for (const r of plan.rooms) for (const d of r.doors) {
      assert.ok(plan.walls[d.wall]?.rooms.includes(r.id));
      assert.ok(plan.walls[d.wall].rooms.includes(d.to));
      assert.ok(byId.get(d.to)?.doors.some(o => o.to === r.id && o.wall === d.wall && o.at === d.at));
    }
  };

  const base = make(), baseline = JSON.stringify(base);
  const bedroom = base.rooms.find(r => r.type === "bedroom");
  const edits = new RoomEdits();
  edits.apply(base);
  edits.setType(bedroom.id, "study");
  let changed = edits.apply(base).plan.rooms.find(r => r.id === bedroom.id);
  assert.equal(changed.type, "study");
  assert.notDeepEqual(stampOf("real", changed, "wall"), stampOf("real", bedroom, "wall"));
  assert.notDeepEqual(stampOf("real", changed, "floor"), stampOf("real", bedroom, "floor"));
  assert.equal(JSON.stringify(base), baseline, "source plan stays immutable");
  edits.undo(); assert.equal(edits.apply(base).plan.rooms.find(r => r.id === bedroom.id).type, "bedroom");
  edits.redo(); assert.equal(edits.apply(base).plan.rooms.find(r => r.id === bedroom.id).type, "study");
  edits.restoreType(bedroom.id); assert.equal(edits.apply(base).plan.rooms.find(r => r.id === bedroom.id).type, "bedroom");
  const stair = base.rooms.find(r => r.type === "stair");
  assert.throws(() => edits.setType(stair.id, "bedroom"), /不能/);
  assert.ok(mergeReason(base, [stair.id, bedroom.id]));
  assert.throws(() => edits.merge([stair.id, bedroom.id], "study"));

  // Renumbering rooms cannot redirect overrides; geometric changes suspend them, reversibly.
  const retained = new RoomEdits(); retained.apply(base); retained.setType(bedroom.id, "study");
  const renumbered = structuredClone(base), map = new Map(base.rooms.map((r, i) => [r.id, `renumbered-${i}`]));
  renumbered.rooms.forEach(r => { r.id = map.get(r.id); r.doors.forEach(d => d.to = map.get(d.to)); });
  renumbered.walls.forEach(w => w.rooms = w.rooms.map(id => map.get(id) ?? null));
  renumbered.windows.forEach(w => w.room = map.get(w.room));
  assert.equal(retained.apply(renumbered).plan.rooms.find(r => r.id === map.get(bedroom.id)).type, "study");
  const moved = structuredClone(base); moved.rooms.find(r => r.id === bedroom.id).polygon[0][0] += 0.25;
  assert.equal(retained.apply(moved).suspended.length, 1);
  assert.equal(retained.apply(base).suspended.length, 0);
  assert.equal(retained.apply(make({ floors: 6 })).plan.rooms.find(r => r.id === bedroom.id).type, "study");

  // Concave union: no bounding-box fill across the notch; labels and furniture stay inside.
  const l = unionRooms([[[0, 0], [2, 0], [2, 4], [0, 4]], [[2, 0], [4, 0], [4, 2], [2, 2]]]);
  assert.equal(signedArea(l), 12);
  assert.ok(!inRoom(l, [3, 3]));
  assert.ok(!roomContains(l, [[1, 1], [3, 1], [3, 3], [1, 3]]));
  assert.ok(inRoom(l, roomAnchor(l)));
  const cutAnchor = roomAnchor(l, { axis: 0, at: 2.5, greater: true });
  assert.ok(cutAnchor[0] >= 2.5 && inRoom(l, cutAnchor));
  assert.throws(() => unionRooms([[[0, 0], [1, 0], [1, 1], [0, 1]], [[2, 0], [3, 0], [3, 1], [2, 1]]]));

  let mergedCount = 0, concaveCount = 0;
  for (const overrides of [
    {}, { baysX: 9, baysY: 5 }, { baysX: 10, baysY: 8 },
    { baysX: 9, baysY: 5, floors: 2 }, { baysX: 9, baysY: 5, floors: 6 },
    { baysX: 9, baysY: 5, cornerStyle: "panCoupe" },
    { type: "row", baysX: 7, depth: 16 }, { type: "corner", baysX: 7, baysY: 5 },
  ]) {
    const plan = make(overrides), before = JSON.stringify(plan);
    const eligible = plan.walls.filter(w => w.rooms[1] && !mergeReason(plan, w.rooms));
    assert.ok(eligible.length, "fixture has mergeable pairs");
    const pairs = new Map(eligible.map(w => [[...w.rooms].sort().join("|"), w.rooms]));
    for (const ids of pairs.values()) {
      const edit = new RoomEdits(); edit.apply(plan);
      const members = edit.merge(ids, "bedroom");
      const result = edit.apply(plan), merged = result.plan.rooms.find(r => r.id.startsWith("merged-"));
      assert.equal(result.suspended.length, 0);
      assert.ok(merged);
      assert.equal(result.plan.rooms.length, plan.rooms.length - 1);
      assert.ok(merged.area > plan.rooms.filter(r => ids.includes(r.id)).reduce((a, r) => a + r.area, 0));
      assert.deepEqual(result.members.get(merged.id), members);
      assert.deepEqual(result.plan.walls.filter(w => w.kind !== "partition").map(wallShape), plan.walls.filter(w => w.kind !== "partition").map(wallShape));
      checkReferences(result.plan);
      assert.ok(!checkPlan(result.plan).some(s => s.includes("走不到")), "reachability survives a merge");
      assert.ok(inRoom(merged.polygon, roomAnchor(merged.polygon)));
      if (merged.polygon.length > 4) concaveCount++;
      edit.undo(); assert.equal(JSON.stringify(edit.apply(plan).plan.rooms), JSON.stringify(plan.rooms));
      edit.redo(); assert.equal(edit.apply(plan).plan.rooms.length, plan.rooms.length - 1);
      mergedCount++;
    }
    assert.equal(JSON.stringify(plan), before);
    const protectedWall = plan.walls.find(w => w.kind !== "partition" && w.rooms[1]);
    assert.ok(mergeReason(plan, protectedWall.rooms));
    const otherLevel = plan.rooms.find(r => editableRoom(r) && r.level !== bedroom.level);
    if (otherLevel && plan.rooms.some(r => r.id === bedroom.id)) assert.ok(mergeReason(plan, [bedroom.id, otherLevel.id]));
  }

  // A merged room can merge again, undo back to the two-room merge, then restore fully.
  const chainPlan = make({ baysX: 9, baysY: 5 }), chain = new RoomEdits();
  let current = chain.apply(chainPlan).plan, chainCount = 0;
  for (let i = 0; i < 4; i++) {
    const eligible = current.walls.filter(w => w.rooms[1] && !mergeReason(current, w.rooms));
    const wall = eligible.find(w => i === 0
      ? eligible.some(other => other !== w && other.rooms.some(id => w.rooms.includes(id)) && other.rooms.some(id => !w.rooms.includes(id)))
      : w.rooms.some(id => id?.startsWith("merged-")));
    if (!wall) break;
    chain.merge(wall.rooms, "study");
    current = chain.apply(chainPlan).plan;
    checkReferences(current); chainCount++;
  }
  assert.ok(chainCount >= 2);
  const material = new MeshStandardMaterial(), mats = new Proxy({}, { get: () => material });
  const building = generateBuilding({ ...defaultParams(), baysX: 9, baysY: 5 }, kit);
  for (const look of ["real", "diagram", "white"]) {
    const furniture = buildFurniture(current, building, mats, look);
    assert.ok(furniture.children.length);
    assert.ok(furniture.userData.furniture.lamps.every(p => Number.isFinite(p.x + p.y + p.z)));
    furniture.children.forEach(m => m.geometry.dispose());
  }
  material.dispose();
  for (let i = 0; i < chainCount; i++) { chain.undo(); current = chain.apply(chainPlan).plan; }
  assert.equal(JSON.stringify(current.rooms), JSON.stringify(chainPlan.rooms));
  console.log(`Room editor: type/restore/undo/replay, concave geometry and ${mergedCount} merges passed (${concaveCount} non-rectangular outlines).`);

  // Exercise the real pointer/GUI callbacks against a minimal DOM host. This is
  // an event regression, not a substitute for an actual browser visual check.
  const { RoomEditor } = await server.ssrLoadModule("/src/roomEditor.ts");
  const { PerspectiveCamera } = await import("three");
  const previousDocument = globalThis.document, previousListener = globalThis.addEventListener;
  globalThis.document = { createElement: () => ({ style: {}, setAttribute() {} }) };
  globalThis.addEventListener = () => {};
  class FakeGUI {
    _closed = true; controls = [];
    domElement = { appendChild() {}, scrollIntoView() {} };
    addFolder() { return this.last = new FakeGUI(); }
    add(state, field) {
      const control = {
        label: field, disabled: false,
        name(label) { this.label = label; return this; },
        onChange(fn) { this.change = fn; return this; },
        disable() { this.disabled = true; return this; }, enable() { this.disabled = false; return this; },
        set(value) { state[field] = value; this.change?.(value); }, run() { if (!this.disabled) state[field](); },
      };
      this.controls.push(control); return control;
    }
    open() { this._closed = false; } close() { this._closed = true; } destroy() {}
  }
  try {
    const gui = new FakeGUI(), canvas = new EventTarget(), uiEdits = new RoomEdits();
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
    let picked = null, highlighted = [], ui;
    const labels = { pick: () => picked, select: ids => { highlighted = [...ids]; } };
    const rebuild = () => ui.update(uiEdits.apply(base));
    ui = new RoomEditor({ canvas, camera: new PerspectiveCamera(), gui, edits: uiEdits, labels: () => labels, rebuild });
    rebuild();
    const control = label => { const c = gui.last.controls.find(c => c.label === label); assert.ok(c, label); return c; };
    const fire = (type, props = {}) => {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { pointerId: 1, clientX: 50, clientY: 50, button: 0, pointerType: "mouse", shiftKey: false, ...props });
      canvas.dispatchEvent(event); return event;
    };
    const pair = base.walls.find(w => w.rooms[1] && !mergeReason(base, w.rooms)).rooms;
    picked = pair[0]; fire("pointerdown"); const up = fire("pointerup");
    assert.ok(ui.consumedEvent(up), "label click must not select a window too");
    assert.deepEqual(highlighted, [pair[0]]);
    control("房間種類").set("bedroom");
    assert.equal(uiEdits.current.plan.rooms.find(r => r.id === pair[0]).type, "bedroom");
    picked = pair[1]; fire("pointerdown", { shiftKey: true }); fire("pointerup", { shiftKey: true });
    assert.equal(highlighted.length, 2);
    assert.ok(control("合併兩間房間").disabled, "a target type is mandatory");
    control("合併後房型").set("study"); control("合併兩間房間").run();
    assert.equal(uiEdits.current.plan.rooms.length, base.rooms.length - 1);
    control("復原上一步").run();
    assert.equal(uiEdits.current.plan.rooms.length, base.rooms.length);
    picked = pair[0]; fire("pointerdown", { pointerType: "touch" });
    await new Promise(resolve => setTimeout(resolve, 550));
    fire("pointerup", { pointerType: "touch" });
    picked = pair[1]; fire("pointerdown", { pointerType: "touch" }); fire("pointerup", { pointerType: "touch" });
    assert.equal(highlighted.length, 2, "long press enables subsequent touch selection");
    ui.clearSelection();
    picked = pair[0]; fire("pointerdown", { pointerType: "touch" });
    fire("pointermove", { pointerType: "touch", clientX: 70 }); fire("pointerup", { pointerType: "touch", clientX: 70 });
    assert.equal(highlighted.length, 0, "dragging cancels selection");
    fire("pointerdown", { pointerType: "touch" }); fire("pointerdown", { pointerType: "touch", pointerId: 2 });
    fire("pointerup", { pointerType: "touch", pointerId: 2 }); fire("pointerup", { pointerType: "touch" });
    assert.equal(highlighted.length, 0, "pinching cancels long press");
    console.log("Room editor: click, Shift selection, target-type confirmation, undo, long press, drag and multitouch callbacks passed.");
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousListener === undefined) delete globalThis.addEventListener; else globalThis.addEventListener = previousListener;
  }

  // Same matrix as window.__app.planCheckAll([1,2,3], ["auto","two","one"]).
  if (process.argv.includes("--plans")) {
    let total = 0, failures = 0;
    const examples = [];
    for (const apartments of ["auto", "two", "one"]) {
      for (const type of ["freestanding", "corner", "row"]) for (const cornerStyle of ["pier", "panCoupe"]) {
        for (const baysX of [2, 3, 5, 7, 10]) for (const side of type === "row" ? [8, 12, 16, 20] : [2, 3, 5, 8])
          for (const floors of [1, 2, 4, 6]) for (const ballroom of [true, false]) for (const groundUse of ["residential", "mixed", "shops"])
            for (const seed of [1, 2, 3]) {
              const config = { apartments, type, cornerStyle, baysX, floors, ballroom, groundUse, seed,
                ...(type === "row" ? { depth: side } : { baysY: side }) };
              const plan = make(config); total++;
              if (plan.issues.length) { failures++; if (examples.length < 5) examples.push({ config, issues: plan.issues }); }
            }
      }
      console.log(`Plan matrix ${apartments}: ${total} checked, ${failures} failures so far.`);
    }
    assert.equal(failures, 0, JSON.stringify(examples));
  }
} finally { await server.close(); }
