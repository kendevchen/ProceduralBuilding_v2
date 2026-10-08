/** One pipeline per city building. Failed preparation never replaces the last valid entry. */
import type { BuildingParams } from './params';
import { generateBuilding, type Building } from './generator';
import type { Kit } from './kit';
import { resolveBuildingTopology, type TopologyResult } from './buildingTopology';
import { planBuilding, type BuildingPlan } from './plan';
import { RoomEdits, type EditedPlan } from './roomEdits';

const structuralFields = ['dimensionVersion', 'layoutMode', 'type', 'cornerStyle', 'depth', 'baysX', 'baysY', 'floors', 'profile', 'seed', 'ballroom'] as const;
const pick = (p: BuildingParams, fields: readonly (keyof BuildingParams)[]) => fields.map(k => p[k]);
export const structureKey = (p: BuildingParams) => JSON.stringify([1, ...pick(p, structuralFields)]);
export function planKey(p: BuildingParams): string {
  // Availability and opening outlines are significant; leaf angles/paint/curtains are not.
  const openings = Object.entries(p.facade).sort(([a], [b]) => a.localeCompare(b)).flatMap(([id, o]) =>
    o.dormer !== undefined || o.ground !== undefined || o.door !== undefined ? [[id, o.dormer, o.ground, o.door]] : []);
  return JSON.stringify([structureKey(p), !!p.floorVariety, ...pick(p, ['groundUse', 'courtGround', 'apartments', 'ballroomFacade', 'dormerEvery', 'dormerStyle', 'groundWindow', 'doorStyle']), openings]);
}
export const interiorKey = (p: BuildingParams, edits: RoomEdits, look: string) => JSON.stringify([planKey(p), edits.version, p.chimneys, p.lace, look]);

export class PlanFeasibilityError extends Error {
  constructor(readonly issues: string[]) {
    super(`配置檢查未通過：${issues.slice(0, 4).join('；')}`);
    this.name = 'PlanFeasibilityError';
  }
}

export class BuildingPipeline {
  private structure?: { key: string; value: TopologyResult };
  private building?: { key: string; value: Building };
  private plan?: { key: string; value: BuildingPlan };
  private edited?: { base: BuildingPlan; edits: RoomEdits; version: number; value: EditedPlan };
  readonly counts = { structure: 0, building: 0, plan: 0, edits: 0 };

  prepare(p: BuildingParams, kit: Pick<Kit, 'key' | 'info'>, edits: RoomEdits): { building: Building; edited: EditedPlan } {
    const sk = structureKey(p), bk = JSON.stringify(p), pk = planKey(p);
    const structure = this.structure?.key === sk ? this.structure.value : resolveBuildingTopology(p);
    const b = this.building?.key === bk ? this.building.value : generateBuilding(p, kit, () => structure);
    const base = this.plan?.key === pk ? this.plan.value : planBuilding(b, p);
    if (base.issues.length) throw new PlanFeasibilityError(base.issues);
    const cached = this.edited;
    const edited = cached?.base === base && cached.edits === edits && cached.version === edits.version ? cached.value : edits.apply(base);
    if (this.structure?.value !== structure) this.counts.structure++;
    if (this.building?.value !== b) this.counts.building++;
    if (this.plan?.value !== base) this.counts.plan++;
    if (this.edited?.value !== edited) this.counts.edits++;
    this.structure = { key: sk, value: structure }; this.building = { key: bk, value: b }; this.plan = { key: pk, value: base };
    this.edited = { base, edits, version: edits.version, value: edited };
    return { building: b, edited };
  }
}
