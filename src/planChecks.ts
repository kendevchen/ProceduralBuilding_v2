/** Shared legacy plan matrix for the dev console and the independent SSR CLI. */
import type { BuildingParams } from "./params";
import type { BuildingPlan } from "./plan";

export interface PlanCase {
  params: Partial<BuildingParams>;
  /** Bays for non-row buildings; metres for legacy row buildings. */
  side: number;
}

export function* legacyPlanCases(seeds: number[], apartments: BuildingParams["apartments"][]): Generator<PlanCase> {
  for (const apt of apartments) {
    for (const type of ["freestanding", "corner", "row"] as const) {
      for (const cornerStyle of ["pier", "panCoupe"] as const) {
        for (const baysX of [2, 3, 5, 7, 10]) {
          for (const side of type === "row" ? [8, 12, 16, 20] : [2, 3, 5, 8]) {
            for (const floors of [1, 2, 4, 6]) {
              for (const ballroom of [true, false]) {
                for (const groundUse of ["residential", "mixed", "shops"] as const) {
                  for (const seed of seeds) {
                    yield { side, params: {
                      type, cornerStyle, baysX, floors, ballroom, groundUse, seed, apartments: apt,
                      ...(type === "row" ? { depth: side } : { baysY: side }),
                    } };
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

interface PlanFailure {
  type: BuildingParams["type"];
  cornerStyle: BuildingParams["cornerStyle"];
  baysX: number;
  side: number;
  floors: number;
  ballroom: boolean;
  groundUse: BuildingParams["groundUse"];
  seed: number;
  apt: BuildingParams["apartments"];
  issues: string[];
}

export interface PlanCheckReport {
  total: number;
  failed: number;
  kinds: Record<string, { count: number; example: PlanFailure }>;
  sample: PlanFailure[];
  byMode: Partial<Record<BuildingParams["apartments"], { total: number; failed: number }>>;
}

export function runPlanChecks(
  base: BuildingParams,
  make: (params: BuildingParams) => BuildingPlan,
  seeds = [1, 2],
  apartments: BuildingParams["apartments"][] = ["auto"],
  progress?: (total: number, failed: number) => void,
): PlanCheckReport {
  const report: PlanCheckReport = { total: 0, failed: 0, kinds: {}, sample: [], byMode: {} };
  for (const { params, side } of legacyPlanCases(seeds, apartments)) {
    const q = { ...base, ...params, dimensionVersion: "legacy" as const, layoutMode: "legacy" as const };
    const plan = make(q);
    report.total++;
    const mode = report.byMode[q.apartments] ??= { total: 0, failed: 0 };
    mode.total++;
    if (plan.issues.length) {
      report.failed++; mode.failed++;
      const f: PlanFailure = {
        type: q.type, cornerStyle: q.cornerStyle, baysX: q.baysX, side, floors: q.floors,
        ballroom: q.ballroom, groundUse: q.groundUse, seed: q.seed, apt: q.apartments, issues: plan.issues.slice(0, 4),
      };
      if (report.sample.length < 30) report.sample.push(f);
      for (const issue of plan.issues) {
        const key = issue.replace(/\d+F-\d+|閣樓-\d+|[\d.]+/g, "#");
        report.kinds[key] ??= { count: 0, example: f };
        report.kinds[key].count++;
      }
    }
    if (report.total % 1024 === 0) progress?.(report.total, report.failed);
  }
  return report;
}
