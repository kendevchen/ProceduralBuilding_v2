/** CPU/geometry scale probe with local kit outlines and bounds; no browser or port. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { cpus, platform, arch } from "node:os";
import { performance } from "node:perf_hooks";
import { Box3, Group, Matrix4 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createServer } from "vite";

const options = { samples: 3, warmup: 1, json: null };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const key = args[i], value = args[++i];
  if (!["--samples", "--warmup", "--json"].includes(key) || !value || value.startsWith("--")) throw new Error(`Invalid option ${key}`);
  if (key === "--json") options.json = value;
  else {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < (key === "--samples" ? 1 : 0)) throw new Error(`Invalid ${key}`);
    options[key.slice(2)] = n;
  }
}
const summary = values => {
  const a = [...values].sort((a, b) => a - b);
  const p = fraction => +a[Math.max(0, Math.ceil(a.length * fraction) - 1)].toFixed(3);
  return { min: a[0], p50: p(0.5), p95: p(0.95), max: a.at(-1) };
};
const geometryStats = group => {
  const geometries = new Set(), buffers = new Set();
  let meshes = 0, triangles = 0;
  group.traverse(o => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    triangles += (g.index?.count ?? g.getAttribute("position").count) / 3 * (o.isInstancedMesh ? o.count : 1);
    geometries.add(g);
  });
  for (const g of geometries) {
    for (const a of Object.values(g.attributes)) buffers.add(a.array.buffer);
    if (g.index) buffers.add(g.index.array.buffer);
  }
  return { meshes, geometries: geometries.size, submittedTriangles: triangles,
    bufferBytes: [...buffers].reduce((sum, b) => sum + b.byteLength, 0) };
};
const buffersOf = group => {
  const buffers = new Set();
  group.traverse(o => {
    if (!o.isMesh) return;
    for (const a of Object.values(o.geometry.attributes)) buffers.add(a.array.buffer);
    if (o.geometry.index) buffers.add(o.geometry.index.array.buffer);
  });
  return buffers;
};

const previousDocument = globalThis.document;
// Canvas drawing and font rasterization are excluded. Geometry and placement use production functions.
const context = new Proxy({ measureText: () => ({ width: 160 }), createLinearGradient: () => ({ addColorStop() {} }) },
  { get: (target, key) => target[key] ?? (() => {}) });
globalThis.document = { createElement: () => ({ getContext: () => context }) };
const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: "custom" });
let gltf;
try {
  const [data, manifestText] = await Promise.all([
    readFile(new URL("../public/assets/kit.glb", import.meta.url)),
    readFile(new URL("../public/assets/kit_manifest.json", import.meta.url), "utf8"),
  ]);
  gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "");
  const nodes = new Map();
  for (const part of gltf.scene.children) {
    const association = gltf.parser.associations.get(part);
    nodes.set(gltf.parser.json.nodes[association.nodes].name, part);
  }
  gltf.scene.updateMatrixWorld(true);
  const infos = new Map(), keys = new Map();
  const manifest = JSON.parse(manifestText);
  for (const [collection, entry] of Object.entries(manifest.collections)) for (const child of entry.children ?? []) {
    const key = `COL[${collection}][${child.index}]`, part = nodes.get(key);
    assert.ok(part, `Local GLB has ${key}`);
    const inv = new Matrix4().copy(part.matrixWorld).invert(), box = new Box3();
    part.traverse(o => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox.clone().applyMatrix4(inv.clone().multiply(o.matrixWorld)));
    });
    keys.set(child.name, key);
    infos.set(key, { collection, variant: child.name.slice(collection.length + 1), key, box,
      openings: child.openings, recess: child.recess, tris: child.tris ?? 0 });
  }
  const kit = {
    key: (c, v) => { const key = keys.get(`${c}.${v}`); assert.ok(key, `${c}.${v}`); return key; },
    info: key => infos.get(key),
  };
  const load = name => server.ssrLoadModule(`/src/${name}.ts`);
  const { defaultParams } = await load("params");
  const { generateBuilding } = await load("generator");
  const { planBuilding } = await load("plan");
  const { Cutaway } = await load("cutaway");
  const { buildRooms3d } = await load("rooms3d");
  const { buildStairs } = await load("stairs");
  const { buildFurniture } = await load("furniture");
  const { RoomLabels } = await load("roomLabels");
  const { UnfoldView } = await load("unfold");
  const report = {
    schemaVersion: 1,
    environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, explicitGC: !!globalThis.gc },
    warmup: options.warmup, samples: options.samples,
    baseParams: defaultParams(),
    scope: "SSR CPU using production topology, plan/checker, real-look interior/stairs/furniture, label objects and interior-only unfold. Local GLB bounds and manifest openings are used. Excludes asset/module loading, actual canvas drawing/font rasterization, exterior mesh instancing, GPU upload/rendering and browser interaction. Out-of-range legacy plans do not satisfy the future high-rise/daylight rules.",
    cases: [],
  };
  for (const fixture of [
    { name: "default", overrides: {} },
    { name: "legacy-maximum", overrides: { baysX: 10, baysY: 8, floors: 6 } },
    { name: "proposed-maximum", overrides: { baysX: 20, baysY: 20, floors: 20 } },
  ]) {
    console.log(`${fixture.name}: building real interior/furniture scale probe...`);
    const timings = {}, memory = [], params = { ...defaultParams(), ...fixture.overrides };
    let entry;
    for (let i = 0; i < options.warmup + options.samples; i++) {
      globalThis.gc?.();
      const stage = (name, fn) => {
        const start = performance.now(), result = fn(), duration = performance.now() - start;
        if (i >= options.warmup) (timings[name] ??= []).push(duration);
        return result;
      };
      const b = stage("generateMs", () => generateBuilding(params, kit));
      const plan = stage("planIncludingCheckMs", () => planBuilding(b, params));
      assert.deepEqual(plan.issues, []);
      const cut = stage("materialsMs", () => new Cutaway());
      const interior = stage("interiorMs", () => buildRooms3d(plan, b, kit, cut.interior, "real"));
      const stairs = stage("stairsMs", () => buildStairs(plan, cut.interior, cut.interior.iron, cut.interior.iron, "real"));
      const furniture = stage("furnitureMs", () => buildFurniture(plan, b, cut.interior, "real"));
      const labels = stage("labelObjectsMs", () => new RoomLabels(plan, false));
      const root = new Group(); root.rotation.x = -Math.PI / 2;
      const source = new Group(); source.position.set(-b.width / 2, -b.length / 2, 0);
      source.add(interior, stairs, furniture); root.add(source); root.updateMatrixWorld(true);
      const unfold = stage("interiorUnfoldMs", () => {
        const view = new UnfoldView(source, plan, cut); root.add(view.group); view.update(0.3, 0, "all"); return view;
      });
      const mem = process.memoryUsage();
      if (i >= options.warmup) {
        const sourceBuffers = buffersOf(source);
        const extraUnfoldBuffers = [...buffersOf(unfold.group)].filter(buffer => !sourceBuffers.has(buffer));
        memory.push({ rss: mem.rss, heapUsed: mem.heapUsed, arrayBuffers: mem.arrayBuffers });
        entry = {
          ...fixture, rooms: plan.rooms.length, levels: plan.levels.length,
          exteriorPlacements: b.placements.length,
          exteriorTrianglesFromManifest: b.placements.reduce((sum, p) => sum + kit.info(p.key).tris, 0),
          interior: geometryStats(interior), stairs: geometryStats(stairs), furniture: geometryStats(furniture),
          source: geometryStats(source), interiorUnfold: geometryStats(unfold.group), labelObjects: labels.group.children.length,
          additionalUnfoldBufferBytes: extraUnfoldBuffers.reduce((sum, buffer) => sum + buffer.byteLength, 0),
          // One uncompressed RGBA base image per label; excludes mipmaps and cached art/noise textures.
          estimatedLabelRGBABytes: plan.rooms.length * 512 * 160 * 4,
        };
      }
      unfold.dispose(); labels.dispose();
      const geometries = new Set(), materials = new Set(Object.values(cut.interior));
      source.traverse(o => {
        if (!o.isMesh) return;
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      });
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      root.clear(); source.clear();
    }
    const total = Array.from({ length: options.samples }, (_, i) => Object.values(timings).reduce((sum, times) => sum + times[i], 0));
    entry.timings = Object.fromEntries(Object.entries(timings).map(([key, values]) => [key, summary(values)]));
    entry.timings.combinedMs = summary(total);
    entry.memoryAfterConstruction = memory;
    report.cases.push(entry);
    if (options.json) await writeFile(options.json, JSON.stringify(report, null, 2) + "\n");
    console.log(`${fixture.name}: interior p50 ${entry.timings.interiorMs.p50} ms, furniture p50 ${entry.timings.furnitureMs.p50} ms, combined p95 ${entry.timings.combinedMs.p95} ms; ${entry.source.submittedTriangles} triangles, ${(entry.source.bufferBytes / 1048576).toFixed(2)} MiB buffers; labels ${(entry.estimatedLabelRGBABytes / 1048576).toFixed(2)} MiB RGBA estimate.`);
  }
  console.log(report.scope);
} finally {
  gltf?.scene.traverse(o => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
  });
  globalThis.document = previousDocument;
  await server.close();
}
