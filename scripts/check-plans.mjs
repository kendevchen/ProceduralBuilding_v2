/** Independent plan checks and CPU baseline; no DOM, assets or listening port. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { cpus, platform, arch } from "node:os";
import { performance } from "node:perf_hooks";
import { createServer } from "vite";

const args = process.argv.slice(2);
const options = { benchmark: false, baselineOnly: false, samples: 30, warmup: 5, json: null };
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--benchmark") options.benchmark = true;
  else if (arg === "--baseline-only") options.baselineOnly = true;
  else if (["--samples", "--warmup", "--json"].includes(arg)) {
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    if (arg === "--json") options.json = value;
    else {
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n < (arg === "--samples" ? 1 : 0)) throw new Error(`Invalid ${arg}: ${value}`);
      options[arg.slice(2)] = n;
    }
  } else throw new Error(`Unknown option: ${arg}`);
}
if (options.benchmark && options.baselineOnly) throw new Error("Choose --benchmark or --baseline-only");
if (!options.benchmark && args.some(a => a === "--samples" || a === "--warmup")) throw new Error("Sample options require --benchmark");

const kit = { key: (collection, variant) => `${collection}/${variant}` };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const countsOf = plan => ({ rooms: plan.rooms.length, walls: plan.walls.length, windows: plan.windows.length, stairs: plan.stairs.length });
const structureOf = (b, plan) => ({
  width: b.width, length: b.length, footprint: b.footprint, edgeKinds: b.edgeKinds,
  rows: b.rows, door: b.door, ballroom: b.ballroom, inner: plan.inner,
  levels: plan.levels, stairs: plan.stairs, voids: plan.voids,
});

const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: "custom" });
try {
  const { defaultParams } = await server.ssrLoadModule("/src/params.ts");
  const { generateBuilding } = await server.ssrLoadModule("/src/generator.ts");
  const { planBuilding } = await server.ssrLoadModule("/src/plan.ts");
  const { runPlanChecks } = await server.ssrLoadModule("/src/planChecks.ts");
  const make = params => planBuilding(generateBuilding(params, kit), params);
  let result;

  if (options.benchmark) {
    const summary = values => {
      const sorted = [...values].sort((a, b) => a - b);
      const percentile = p => +sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)].toFixed(3);
      return { min: sorted[0], p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) };
    };
    result = {
      mode: "benchmark", environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
      warmup: options.warmup, samples: options.samples,
      scope: "Vite SSR CPU: generateBuilding uses a key-only PartIndex; planBuilding includes checkPlan. Excludes kit meshes, interiors, furniture, labels, browser and GPU.",
      baseParams: defaultParams(), cases: [],
    };
    for (const fixture of [
      { name: "default", overrides: {} },
      { name: "legacy-maximum", overrides: { baysX: 10, baysY: 8, floors: 6 } },
      { name: "proposed-maximum", overrides: { baysX: 20, baysY: 20, floors: 20 } },
      { name: "minimal-tall", overrides: { baysX: 2, baysY: 2, floors: 20 } },
      { name: "row-ignored-side-bays", overrides: { type: "row", baysY: 20, floors: 20 } },
      { name: "row-deep-tall", overrides: { type: "row", baysX: 20, depth: 60, floors: 20 } },
    ]) {
      const params = { ...result.baseParams, ...fixture.overrides };
      const generation = [], planning = [], total = [];
      let b, plan, digest;
      for (let i = 0; i < options.warmup + options.samples; i++) {
        const start = performance.now();
        b = generateBuilding(params, kit);
        const generated = performance.now();
        plan = planBuilding(b, params);
        const end = performance.now();
        if (i >= options.warmup) {
          generation.push(generated - start); planning.push(end - generated); total.push(end - start);
          // Determinism is checked outside the measured window.
          const current = hash(plan);
          if (digest) assert.equal(current, digest, `${fixture.name}: repeatable plan`);
          digest = current;
        }
      }
      const entry = {
        ...fixture, width: b.width, length: b.length, wallTop: b.wallTop, levels: plan.levels.length,
        counts: countsOf(plan), legacyIssues: plan.issues.length,
        generateMs: summary(generation), planIncludingCheckMs: summary(planning), combinedMs: summary(total),
      };
      result.cases.push(entry);
      console.log(`${entry.name}: plan p50 ${entry.planIncludingCheckMs.p50} ms, p95 ${entry.planIncludingCheckMs.p95} ms; ${entry.counts.rooms} rooms, ${entry.legacyIssues} legacy issues.`);
    }
    console.log(result.scope);
    console.log("Out-of-range benchmarks do not certify daylight, elevators or high-rise egress; these checks are future stages.");
  } else {
    const baseline = JSON.parse(await readFile(new URL("./baselines/plans-v1.json", import.meta.url), "utf8"));
    assert.equal(baseline.schemaVersion, 1);
    assert.deepEqual(defaultParams(), baseline.baseParams, "legacy default parameters changed; review the baseline explicitly");
    for (const fixture of baseline.cases) {
      const params = { ...baseline.baseParams, ...fixture.overrides };
      const b = generateBuilding(params, kit), plan = planBuilding(b, params);
      assert.deepEqual(plan.issues, [], `${fixture.name}: generated plan issues`);
      assert.deepEqual(structureOf(b, plan), fixture.structure, `${fixture.name}: legacy structure changed`);
      assert.deepEqual(countsOf(plan), fixture.counts, `${fixture.name}: legacy counts changed`);
      assert.equal(hash(plan), fixture.planSha256, `${fixture.name}: legacy plan changed`);
    }
    console.log(`Legacy baselines: ${baseline.cases.length} structures and complete plan hashes match ${baseline.sourceCommit}.`);
    result = { mode: "check", baselines: baseline.cases.length, sourceCommit: baseline.sourceCommit };
    if (!options.baselineOnly) {
      result.matrix = runPlanChecks(defaultParams(), make, [1, 2, 3], ["auto", "two", "one"],
        (total, failed) => console.log(`Plan matrix: ${total} checked, ${failed} failures so far.`));
      for (const [mode, counts] of Object.entries(result.matrix.byMode)) {
        console.log(`Plan matrix ${mode}: ${counts.total} checked, ${counts.failed} failures.`);
      }
      console.log(`Plan matrix total: ${result.matrix.total} checked, ${result.matrix.failed} failures.`);
    }
  }
  // Preserve the report even when a matrix contains failures.
  if (options.json) await writeFile(options.json, JSON.stringify(result, null, 2) + "\n");
  if (result.matrix) assert.equal(result.matrix.failed, 0, JSON.stringify(result.matrix.sample, null, 2));
} finally {
  await server.close();
}
