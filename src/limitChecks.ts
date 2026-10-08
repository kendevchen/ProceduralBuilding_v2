/** P8 cases shared by the independent CLI and the developer console. */
import { defaultInteractiveParams, type BuildingParams } from './params';
import { resolveBuildingTopology } from './buildingTopology';
import { generateBuilding } from './generator';
import { planBuilding } from './plan';
import type { Kit } from './kit';

export interface LimitCase {
  name: string;
  overrides: Partial<BuildingParams>;
  expected: 'ready' | 'infeasible';
  mode?: 'legacy' | 'cores' | 'courtyard' | 'lightwell';
}
export function* limitCases(seeds = [1]): Generator<LimitCase> {
  const supported: [string, Partial<BuildingParams>, LimitCase['mode']][] = [
    ['default', {}, 'legacy'],
    ['old-maximum', { baysX: 10, baysY: 8, floors: 6 }, 'legacy'],
    ['front-11', { baysX: 11, baysY: 5, floors: 6 }, 'cores'],
    ['side-9', { baysX: 10, baysY: 9, floors: 6 }, 'lightwell'],
    ...[6, 7, 14, 15, 20].map(floors => [`core-${floors}`, { baysX: 14, baysY: 5, floors }, 'cores'] as [string, Partial<BuildingParams>, LimitCase['mode']]),
    ['lightwell-10x10', { baysX: 10, baysY: 10, floors: 6, layoutMode: 'lightwell' }, 'lightwell'],
    ['lightwell-10x20', { baysX: 10, baysY: 20, floors: 6, layoutMode: 'lightwell' }, 'lightwell'],
    ['lightwell-maximum', { baysX: 20, baysY: 20, floors: 20, layoutMode: 'lightwell', ballroom: false }, 'lightwell'],
    ['courtyard-maximum', { baysX: 20, baysY: 20, floors: 20, layoutMode: 'courtyard', ballroom: false }, 'courtyard'],
    ['row-bays-courtyard', { type: 'row', baysX: 12, baysY: 16, floors: 8, layoutMode: 'courtyard' }, 'courtyard'],
    ['row-metres-exact', { type: 'row', dimensionVersion: 'legacy', depth: 12.345678, baysY: 20 }, 'legacy'],
  ];
  for (const [baysX, baysY, floors] of [[11, 9, 14], [14, 20, 14]])
    yield { name: 'mixed-wall-door-contour', overrides: { baysX, baysY, floors, seed: 1 }, expected: 'ready', mode: 'lightwell' };
  for (const seed of seeds) {
    for (const [name, overrides, mode] of supported) yield { name, overrides: { ...overrides, seed }, expected: 'ready', mode };
    // These are fixed acceptance promises, not failures reclassified at runtime.
    for (const [baysX, baysY] of [[2, 2], [2, 20], [20, 2]])
      yield { name: `narrow-${baysX}x${baysY}`, overrides: { baysX, baysY, floors: 20, seed }, expected: 'infeasible' };
    for (const layoutMode of ['courtyard', 'lightwell'] as const)
      yield { name: `small-explicit-${layoutMode}`, overrides: { layoutMode, seed }, expected: 'infeasible' };
    for (const type of ['freestanding', 'corner', 'row'] as const)
      for (const cornerStyle of ['pier', 'panCoupe'] as const)
        for (const profile of ['uniform', 'haussmann'] as const)
          yield { name: 'core-types-profiles', overrides: { type, cornerStyle, profile, seed, baysX: 14, baysY: 5, floors: 10, ballroomFacade: profile === 'uniform' ? 'tall' : 'rows' }, expected: 'ready', mode: 'cores' };
    for (const groundUse of ['residential', 'mixed', 'shops'] as const)
      for (const apartments of ['auto', 'one', 'two'] as const)
        yield { name: 'courtyard-households-uses', overrides: { groundUse, apartments, seed, baysX: 20, baysY: 20, floors: 20, layoutMode: 'courtyard', floorVariety: true }, expected: 'ready', mode: 'courtyard' };
  }
}
/** Full dimension survey. Its outcomes are observations, not expected negatives. */
export function* limitSurveyCases(): Generator<Partial<BuildingParams>> {
  for (const baysX of [2, 3, 5, 7, 10, 11, 14, 20])
    for (const baysY of [2, 3, 5, 8, 9, 12, 16, 20])
      for (const floors of [1, 2, 4, 6, 7, 14, 15, 20]) yield { baysX, baysY, floors };
}
export function checkLimitCase(fixture: LimitCase, kit: Pick<Kit, 'key' | 'info'>) {
  const params = { ...defaultInteractiveParams(), ...fixture.overrides };
  const topology = resolveBuildingTopology(params);
  const errors: string[] = [];
  if (topology.status !== fixture.expected) errors.push(`expected ${fixture.expected}, got ${topology.status}`);
  if (topology.status !== 'ready') {
    if (!topology.diagnostics.length || topology.diagnostics.some(d => !d.message)) errors.push('missing rejection reason');
    return { name: fixture.name, params, status: topology.status, errors, diagnostics: topology.diagnostics };
  }
  if (fixture.mode && topology.topology.mode !== fixture.mode) errors.push(`expected mode ${fixture.mode}, got ${topology.topology.mode}`);
  const building = generateBuilding(params, kit, () => topology), plan = planBuilding(building, params);
  errors.push(...plan.issues);
  if (plan.levels.length !== params.floors + 2) errors.push('incorrect physical floor count');
  if (params.type === 'row' && params.dimensionVersion === 'legacy' && building.length !== params.depth) errors.push('metre depth changed');
  return { name: fixture.name, params, status: topology.status, errors, mode: building.topology.mode,
    width: building.width, length: building.length, levels: plan.levels.length, rooms: plan.rooms.length };
}
