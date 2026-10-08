/** P6: segment decisions are independent of floor retries; only private cells are regrouped. */
import dims from '../../blender/kit_dims.json';
import type { Building } from '../generator';
import type { BuildingParams } from '../params';
import type { PlanWindow, PlanLevel } from '../plan';
import { PURPOSE, rand } from '../rng';
import type { ProgramUnit } from './program';
import { sharedEdges } from './edgeIndex';

const K = dims.interior.planning.templates, I = dims.interior, EPS = 1e-6;
export type ApartmentTemplate = 'A' | 'B' | 'C' | 'compact';
export interface VerticalSegment { id: string; first: number; last: number }
export interface TemplateDecision {
  level: number; segment: string; area: string; coreId: string;
  requested: ApartmentTemplate; resolved: ApartmentTemplate; count: number; baseCount: number; apartmentIds: number[]; reason: string | null;
}
export interface SegmentPolicy { segment: string; largeWing: string | null; symmetric: boolean; crossGroup: boolean; crossWing: boolean }
export interface ProgramStructure {
  segments: VerticalSegment[]; policies: SegmentPolicy[]; templates: TemplateDecision[];
  links: { level: number; feature: 'D3' | 'W2'; outcome: string; cells: number[] }[];
}
export interface ApartmentGroup { units: ProgramUnit[]; area: number; template: ApartmentTemplate; randomKey: number; internal: boolean; corner?: ProgramUnit }
export function verticalSegments(floors: number): VerticalSegment[] {
  const out: VerticalSegment[] = [{ id: 'base', first: 0, last: 0 }, { id: 'principal', first: 1, last: 1 }];
  if (floors > 6) {
    const split = Math.ceil(floors / 2);
    out.push({ id: 'lower', first: 2, last: split }, { id: 'upper', first: split + 1, last: floors - 1 });
  } else out.push({ id: 'ordinary', first: 2, last: floors - 1 });
  if (floors > 1) out.push({ id: 'top', first: floors, last: floors });
  out.push({ id: 'attic', first: floors + 1, last: floors + 1 });
  return out.filter(s => s.first <= s.last && s.first <= floors + 1);
}
export function createProgramStructure(b: Building, p: BuildingParams): ProgramStructure {
  const segments = verticalSegments(p.floors), wings = b.topology.courtyardLayout?.wings ?? [];
  const layout=b.topology.coreLayout!;
  const candidatesForLarge=wings.filter(w=>layout.serviceAreas.filter(a=>a.moduleId===w.id).some(a=>{
    const cells=b.topology.grid.cells.filter(c=>a.cellIds?.includes(c.id)&&!layout.parts.some(q=>q.cell===c.id)&&!layout.publicCells.includes(c.id)&&!b.topology.courtyardLayout!.serviceCells.includes(c.id));
    return cells.length>=K.minLargeCells&&cells.length<=2*K.maxLargeCells-K.minLargeCells;
  }));
  const rotation = Math.floor(rand(p.seed, PURPOSE.planWing) * Math.max(1, wings.length));
  const policies = segments.map((s, i) => {
    const symmetric = wings.length === 4 && rand(p.seed, i, PURPOSE.planSymmetry) < K.symmetryChance;
    // A symmetric segment selects the front/back wing; side wings share their policy.
    const candidates = symmetric ? candidatesForLarge.filter(w => w.side % 2 === 0) : candidatesForLarge;
    const large = candidates.length ? candidates[(rotation + i) % candidates.length].id : null;
    return { segment: s.id, largeWing: s.id === 'principal' ? wings.find(w => w.side === 0)?.id ?? large : large,
      symmetric, crossGroup: rand(p.seed, i, PURPOSE.planCrossGroup) < K.crossGroupChance,
      crossWing: !symmetric && rand(p.seed, i, PURPOSE.planCrossWing) < K.crossWingChance };
  });
  return { segments, policies, templates: [], links: [] };
}
export const hasDaylight = (u: ProgramUnit, windows: PlanWindow[]) => u.win.some(i => ['window', 'dormer'].includes(windows[i].kind));
export const contact = (a: ProgramUnit, b: ProgramUnit) => sharedEdges([ [a.x0,a.y0,a.x1,a.y1], [b.x0,b.y0,b.x1,b.y1] ])
  .some(e => e.i === 0 && e.j === 1 && Math.hypot(e.b[0]-e.a[0],e.b[1]-e.a[1]) >= I.doors.single[0] + I.walls.spine + EPS);
/** Ownership may span the existing public spine; the spine remains public, as in a normal two-band flat. */
export function publicConnection(a:ProgramUnit[], b:ProgramUnit[], units:ProgramUnit[]): boolean {
  const publicUnits=units.filter(u=>['corridor','liftHall','vestibule','porch'].includes(u.type!));
  const allowed=[...new Set([...a,...b,...publicUnits])],seen=new Set(a),queue=[...a];
  while(queue.length){const u=queue.pop()!;for(const v of allowed)if(!seen.has(v)&&contact(u,v)){seen.add(v);queue.push(v);}}
  return b.every(u=>seen.has(u));
}
/** Split only on existing column boundaries, retain enough real windows for four essential rooms. */
export function splitTemplate(units: ProgramUnit[], windows: PlanWindow[], requested: ApartmentTemplate): { groups: ProgramUnit[][]; resolved: ApartmentTemplate; reason: string | null } {
  const count = (us: ProgramUnit[]) => us.filter(u => hasDaylight(u,windows)).length;
  const cols = [...new Set(units.flatMap(u => u.cells.map(c => c.col)))].sort((a,b)=>a-b);
  const partitions = (n: number) => {
    const result: ProgramUnit[][][] = [];
    const choose = (cuts: number[], start: number) => {
      if (cuts.length === n-1) {
        const groups = Array.from({length:n},(_,i)=>units.filter(u=>u.cells.every(c=>c.col >= (i ? cuts[i-1] : -Infinity) && c.col < (i<n-1 ? cuts[i] : Infinity))));
        if (groups.flat().length === units.length && groups.every(us=>count(us)>=I.planning.cores.minApartmentCells)) result.push(groups);
        return;
      }
      for(let i=start;i<cols.length;i++) choose([...cuts,cols[i]],i+1);
    };
    choose([],1);
    result.sort((a,b)=>Math.max(...a.map(count))-Math.min(...a.map(count)) - (Math.max(...b.map(count))-Math.min(...b.map(count))));
    return result[0];
  };
  const failures: string[] = [];
  if(requested==='A') {
    const paired = units.some(a=>hasDaylight(a,windows)&&units.some(b=>b!==a&&hasDaylight(b,windows)&&contact(a,b)&&
      (Math.abs(a.y0-b.y0)<EPS&&Math.abs(a.y1-b.y1)<EPS || Math.abs(a.x0-b.x0)<EPS&&Math.abs(a.x1-b.x1)<EPS)));
    if(units.length<=2*K.maxLargeCells-K.minLargeCells && count(units)>=K.minLargeCells && paired) return {groups:[units],resolved:'A',reason:null};
    failures.push('A 不符合房間上限、接待室相鄰格或完整住宅容量');
  }
  if(requested==='C') {
    const groups=partitions(3);
    if(groups) return {groups,resolved:'C',reason:null};
    failures.push('C 無法分出三戶完整住宅');
  }
  const standard=partitions(2);
  if(standard) return {groups:standard,resolved:'B',reason:failures.join('；')||null};
  failures.push('B 無法分出兩戶完整住宅');
  return {groups:count(units)>=I.planning.cores.minApartmentCells?[units]:[],resolved:'compact',reason:failures.join('；')};
}
export function planTemplateGroups(b: Building, p: BuildingParams, lv: PlanLevel, units: ProgramUnit[], windows: PlanWindow[], structure: ProgramStructure, overrides: ReadonlyMap<string,string> = new Map()): ApartmentGroup[] {
  const layout=b.topology.coreLayout!, deep=b.topology.deepLayout, court=b.topology.courtyardLayout;
  const si=structure.segments.findIndex(s=>lv.index>=s.first&&lv.index<=s.last), segment=structure.segments[si], policy=structure.policies[si];
  const groups: ApartmentGroup[]=[];
  layout.serviceAreas.forEach((area,ai)=>{
    const available=units.filter(u=>u.type===null&&u.cells.every(c=>area.cellIds?area.cellIds.includes(c.id):area.columns.includes(c.col)));
    const gi=deep?.groups.findIndex(g=>g.id===area.moduleId) ?? -1;
    const internal=!!deep&&gi>0&&gi<deep.groups.length-1;
    const wing=court?.wings.find(w=>w.id===area.moduleId);
    let key=ai;
    if(policy.symmetric&&wing?.side===3) {
      const opposite=layout.serviceAreas.filter(a=>a.moduleId===court!.wings.find(w=>w.side===1)!.id);
      const mine=layout.serviceAreas.filter(a=>a.moduleId===wing.id);
      key=layout.serviceAreas.indexOf(opposite[mine.indexOf(area)]??area);
    }
    const roll=rand(p.seed,si,key,PURPOSE.planTemplate);
    let requested: ApartmentTemplate=segment.id==='principal'&&!internal?'A':segment.id==='top'?'C':
      internal||segment.id==='upper'?(roll<0.5?'B':'C'):(roll<0.5?'A':'B');
    if(court) requested=wing?.id===policy.largeWing?'A':roll<0.5?'B':'C';
    if(internal&&requested==='A')requested='B';
    if(p.apartments==='one')requested='compact';
    if(p.apartments==='two')requested='B';
    // Forced one keeps one complete flat; it is not an A claim.
    const maskBallroom=!!b.ballroom&&segment.first<=2&&segment.last>=2;
    const partitionCells=maskBallroom?available.filter(u=>!u.cells.some(c=>b.topology.grid.ballroom.includes(c.id))):available;
    const capacityReason=overrides.get(`${segment.id}:${area.moduleId??area.coreId}:${area.coreId}`);
    const result=p.apartments==='one'?{groups:partitionCells.filter(u=>hasDaylight(u,windows)).length>=I.planning.cores.minApartmentCells?[partitionCells]:[],resolved:'compact' as const,reason:'固定每核心一戶'}:splitTemplate(partitionCells,windows,capacityReason?'B':requested);
    for(const extra of available.filter(u=>!partitionCells.includes(u))) {
      const nearest=result.groups.map(us=>({us,distance:Math.min(...us.flatMap(u=>u.cells.map(c=>Math.abs(c.col-extra.cells[0].col))))})).sort((a,b)=>a.distance-b.distance)[0];
      if(nearest)nearest.us.push(extra);else extra.type='storage';
    }
    if(capacityReason)result.reason=[capacityReason,result.reason].filter(Boolean).join('；');
    structure.templates.push({level:lv.index,segment:segment.id,area:area.moduleId??area.coreId,coreId:area.coreId,requested,resolved:result.resolved,count:result.groups.length,baseCount:result.groups.length,apartmentIds:[],reason:result.reason});
    result.groups.forEach((us,j)=>groups.push({units:us,area:ai,template:result.resolved,randomKey:key*4+j,internal}));
    if(!result.groups.length)for(const u of available)u.type='storage';
  });
  if(p.apartments!=='auto')return groups;
  // Cross-group ownership uses existing public connectors, never captures a corridor.
  // Donors retain four real daylight cells; selected cells must themselves have a public/private route.
  if(deep&&policy.crossGroup&&deep.groups.length>2) {
    const street=groups.find(g=>layout.serviceAreas[g.area].moduleId===deep.groups[0].id);
    const donor=groups.find(g=>g.internal&&g.units.filter(u=>hasDaylight(u,windows)).length>=I.planning.cores.minApartmentCells+2);
    const extras=donor?.units.filter(u=>u.win.some(i=>windows[i].facadeId)&&hasDaylight(u,windows)).slice(0,2)??[];
    const legal=!!street&&!!donor&&extras.length===2&&publicConnection(street.units,extras,units);
    if(legal) {street.units.push(...extras);donor.units=donor.units.filter(u=>!extras.includes(u));}
    structure.links.push({level:lv.index,feature:'D3',outcome:legal?'兩個井窗格併入臨街戶，公共連通廊保留':'沒有能保留完整住宅及公共路徑的兩格井窗供體',cells:legal?extras.flatMap(u=>u.cells.map(c=>c.id)):[]});
  }
  if(court&&policy.crossWing) {
    // An actual two-faced outer corner salon is required; an inner-court corner is not substituted.
    const front=groups.find(g=>layout.serviceAreas[g.area].moduleId===court.wings.find(w=>w.side===0)!.id&&g.units.some(u=>new Set(u.win.filter(i=>!windows[i].facadeId).map(i=>windows[i].side)).size>=2));
    const corner=front?.units.find(u=>new Set(u.win.filter(i=>!windows[i].facadeId).map(i=>windows[i].side)).size>=2);
    const sides=new Set(corner?.win.filter(i=>!windows[i].facadeId).map(i=>windows[i].side));
    const possible=front?groups.filter(g=>g!==front&&sides.has(court.wings.find(w=>w.id===layout.serviceAreas[g.area].moduleId)!.side)&&layout.serviceAreas[g.area].moduleId!==layout.serviceAreas[front.area].moduleId&&publicConnection(front.units,g.units,units)&&front.units.length+g.units.length<=(front.template==='A'?2*K.maxLargeCells-K.minLargeCells:K.maxCrossWingCells)):[];
    possible.sort((a,b)=>Math.min(...a.units.map(u=>Math.hypot(u.x0-corner!.x0,u.y0-corner!.y0)))-Math.min(...b.units.map(u=>Math.hypot(u.x0-corner!.x0,u.y0-corner!.y0))));
    const neighbour=possible[0],legal=!!front&&!!neighbour;
    if(legal){front.corner=corner;front.units.push(...neighbour.units);groups.splice(groups.indexOf(neighbour),1);}
    structure.links.push({level:lv.index,feature:'W2',outcome:legal?'轉角戶跨兩翼，保留公共廊及核心':'外角兩面窗、完整容量或既有公共連通不足',cells:legal?front.units.flatMap(u=>u.cells.map(c=>c.id)):[]});
  }
  for(const [ai,area] of layout.serviceAreas.entries()) {
    const decision=structure.templates.find(t=>t.level===lv.index&&t.coreId===area.coreId&&t.area===(area.moduleId??area.coreId))!;
    decision.count=groups.filter(g=>g.area===ai).length;
    if(decision.count!==decision.baseCount)decision.reason=[decision.reason,'W2 一戶合入相鄰翼，戶號記於主服務區'].filter(Boolean).join('；');
  }
  return groups;
}
