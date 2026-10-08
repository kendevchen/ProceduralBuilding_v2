/** Courtyard candidates reserve wings, public paths and rotated cores before floor programming. */
import { Matrix4 } from 'three';
import dims from '../../blender/kit_dims.json';
import type { BuildingParams } from '../params';
import type { FacadeSegment, TopologyCore } from '../buildingTopology';
import { insetEdges, type V2 } from '../roof';
import type { Cell, GridEnvelope, LegacyGrid } from './legacyGrid';
import { coreWorld, coreCellId, rectLoop, type CorePart, type CoreLayout } from './cores';
import { unionRooms } from '../roomGeometry';
import type { Rect } from './edgeIndex';
const T = dims.wall, B = dims.bay, I = dims.interior, K = I.planning.courtyard, C = I.planning.cores, EPS = 1e-6;
export interface CourtyardLayout {
  shape: 'O' | 'U'; court: Rect; minimum: number; polygon: V2[]; inner: V2[];
  wings: { id: string; side: number; frame: number[]; polygon: V2[]; cellIds: number[]; single: boolean }[];
  porchCells: number[]; porchX: number; serviceCells: number[]; residentialCells: number[];
  innerBoundary: V2[]; facadeIds: string[];
}
export type CourtyardCandidate = { status: 'ready'; grid: LegacyGrid; cores: TopologyCore[]; layout: CoreLayout;
  courtyard: CourtyardLayout; facades: FacadeSegment[]; ballroom: null; footprint: V2[] }
  | { status: 'infeasible'; message: string };
/** A rear opening belongs to the concave outer boundary, never to a touching hole. */
export function rearNotch(poly: V2[], r: Rect): V2[] {
  const top = Math.max(...poly.map(q => q[1])), out: V2[] = [];
  poly.forEach((a, i) => { const b = poly[(i + 1) % poly.length]; out.push([...a]);
    if (Math.abs(a[1] - top) < EPS && Math.abs(b[1] - top) < EPS && a[0] >= r[2] && b[0] <= r[0])
      out.push([r[2], top], [r[2], r[1]], [r[0], r[1]], [r[0], top]);
  }); return out;
}
function clipEnvelope(poly: V2[], envelope: V2[]): V2[] {
  let result = poly;
  for (let i = 0; i < envelope.length; i++) {
    const a = envelope[i], b = envelope[(i+1)%envelope.length], input = result; result = [];
    const side = (q: V2) => (b[0]-a[0])*(q[1]-a[1])-(b[1]-a[1])*(q[0]-a[0]);
    input.forEach((p,j) => { const q = input[(j+1)%input.length], dp = side(p), dq = side(q);
      if (dp>=0) result.push(p);
      if ((dp>=0)!==(dq>=0)) { const t = dp/(dp-dq); result.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]); }
    });
  }
  return result;
}
export function resolveCourtyard(b: GridEnvelope, p: BuildingParams, wallTop: number, shape: 'O' | 'U'): CourtyardCandidate {
  const fail = (message: string): CourtyardCandidate => ({ status: 'infeasible', message: `${shape} 形：${message}` });
  if (shape === 'U' && b.sides[2].kind === 'party') return fail('背面是盲牆，不能作 U 形對外開口');
  const W = b.width, L = b.length, minimum = Math.max(K.minCourt, K.heightFactor * wallTop);
  const xBase = b.sides[0].x0, yBase = b.sides[1].kind === 'party' ? dims.endPier : b.sides[1].x0;
  const snap = (v: number, base: number) => base + Math.round((v - base) / B) * B;
  const blind = b.sides.map(s => s.kind === 'party');
  const wing = blind.map(v => v ? K.blindWingTarget : K.wingTarget);
  const court: Rect = [snap(wing[3], xBase), snap(wing[0], yBase), snap(W - wing[1], xBase), shape === 'U' ? L : snap(L - wing[2], yBase)];
  if (Math.min(court[2] - court[0], court[3] - court[1]) < minimum - EPS) return fail(`中庭短邊 ${(Math.min(court[2] - court[0], court[3] - court[1])).toFixed(2)} m，小於高度所需 ${minimum.toFixed(2)} m`);
  const corr = blind.map((v, side) => v ? [T, T + K.corridor] : (() => { const base = side % 2 ? xBase : yBase;
    const centre = snap(K.streetCorridorCentre - B / 2, base) + B / 2;
    return [centre - K.corridor / 2, centre + K.corridor / 2]; })());
  if (blind[2]) corr[2][1] = L - snap(L - T - K.corridor, yBase);
  const [f0,f1] = corr[0], [r0,r1] = corr[1].map(v => W - v).reverse(), [b0,b1] = corr[2].map(v => L - v).reverse(), [l0,l1] = corr[3];
  const bottom = shape === 'U' ? L - T : b0;
  const cells: Cell[] = [], parts: CorePart[] = [], publicCells: number[] = [], serviceCells: number[] = [], residentialCells: number[] = [], porchCells: number[] = [];
  const wings: CourtyardLayout['wings'] = [], serviceAreas: CoreLayout['serviceAreas'] = [], cores: TopologyCore[] = [];
  const cols: LegacyGrid['cols'] = [];
  const add = (r: Rect, col: number, zone: Cell['zone'], kind: 'public'|'service'|'home'|'part', ids?: number[]) => {
    const id = cells.length; cells.push({ id, col, zone, x0:r[0], y0:r[1], x1:r[2], y1:r[3] }); ids?.push(id);
    if (kind === 'public') publicCells.push(id); if (kind === 'service') serviceCells.push(id); if (kind === 'home') residentialCells.push(id); return id;
  };
  const toRect = (ps: V2[]): Rect => [Math.min(...ps.map(q=>q[0])),Math.min(...ps.map(q=>q[1])),Math.max(...ps.map(q=>q[0])),Math.max(...ps.map(q=>q[1]))];
  const porchX = b.sides[0].bays[b.door].x;
  // Corridors are four disjoint rectangles; the two side spines meet the front/back spines.
  const corridors = new Map<number, number>();
  corridors.set(0, add([T,f0,W-T,f1],0,'corridor','public'));
  if (shape === 'O') corridors.set(2, add([T,b0,W-T,b1],0,'corridor','public'));
  corridors.set(3, add([l0,f1,l1,bottom],0,'corridor','public')); corridors.set(1, add([r0,f1,r1,bottom],0,'corridor','public'));
  const specs = [
    { side:0, outer: [T,T,W-T,f0] as Rect, inside:[l1,f1,r0,court[1]-T] as Rect, angle:0 },
    { side:1, outer: [r1,f1,W-T,bottom] as Rect, inside:[court[2]+T,court[1]-T,r0,shape==='U'?L-T:court[3]+T] as Rect, angle:Math.PI/2 },
    ...(shape === 'O' ? [{ side:2, outer:[T,b1,W-T,L-T] as Rect, inside:[l1,court[3]+T,r0,b0] as Rect, angle:Math.PI }] : []),
    { side:3, outer: [T,f1,l0,bottom] as Rect, inside:[l1,court[1]-T,court[0]-T,shape==='U'?L-T:court[3]+T] as Rect, angle:-Math.PI/2 },
  ];
  for (const spec of specs) {
    const side=spec.side, horizontal=side%2===0, axis=horizontal?0:1, id=`court:wing:${side}`, ids:number[]=[];
    const inner=spec.inside, depth=inner[horizontal?3:2]-inner[horizontal?1:0];
    if (depth < C.minStairDepth-EPS) return fail(`第 ${side} 翼核心深度 ${depth.toFixed(2)} m 不足 ${C.minStairDepth} m`);
    const lo=Math.min(spec.outer[axis],inner[axis]), hi=Math.max(spec.outer[axis+2],inner[axis+2]);
    const base=horizontal?xBase:yBase, lines=[lo];
    for(let v=base;v<hi-B*.5;v+=B)if(v>lo+B*.5)lines.push(v); lines.push(hi);
    const localCols=lines.slice(0,-1).map((a,i)=>{const col=cols.length;cols.push({x0:a,x1:lines[i+1],end:null});return {col,a,b:lines[i+1]};});
    const usable=localCols.filter(c=>c.b>inner[axis]+EPS&&c.a<inner[axis+2]-EPS).map(c=>({...c,a:Math.max(c.a,inner[axis]),b:Math.min(c.b,inner[axis+2])})).filter(c=>c.b-c.a>=B-I.walls.cage-EPS);
    if (usable.length) { usable[0].a = inner[axis]; usable[usable.length - 1].b = inner[axis + 2]; }
    const count=horizontal?2:Math.max(1,Math.floor((inner[axis+2]-inner[axis])/(K.coreSpacingBays*B)));
    const stairs=p.floors>=C.doubleLiftFrom?2:1,lifts=p.floors>=C.doubleLiftFrom?2:p.floors>=C.doubleStairFrom?1:0,used=stairs+lifts;
    if(usable.length<count*used+(!blind[side]?0:C.minApartmentCells))return fail(`第 ${side} 翼放不下必要核心與住宅`);
    const reserved=new Map<number,{core:string; role:'stair'|'elevator';num:number}>();
    for(let k=0;k<count;k++){
      const start=horizontal?(k===0?0:usable.length-used):Math.floor((k+.5)*usable.length/count-used/2);
      for(let j=0;j<used;j++){const col=usable[start+j].col;if(reserved.has(col))return fail('核心重疊');reserved.set(col,{core:`${id}:core:${k}`,role:j<stairs?'stair':'elevator',num:j<stairs?j:j-stairs});}
    }
    const makeBand=(r:Rect,inside:boolean)=>{
      if(r[2]-r[0]<EPS||r[3]-r[1]<EPS)return;
      for(const c of inside ? usable : localCols){const a=Math.max(c.a,r[axis]),z=Math.min(c.b,r[axis+2]);if(z-a<EPS)continue;
        const rect:Rect=[...r];rect[axis]=a;rect[axis+2]=z;
        const reservedPart=inside?reserved.get(c.col):undefined;
        if(reservedPart){
          const origin:V2=side===0?[rect[0],rect[1]]:side===1?[rect[2],rect[1]]:side===2?[rect[2],rect[3]]:[rect[0],rect[3]];
          const frame={origin,orientation:spec.angle}, width=z-a;
          const part=(role:CorePart['role'],local:Rect)=>{const cell=add(toRect(rectLoop(local).map(q=>coreWorld(frame,q))),c.col,'core',role==='liftHall'?'public':'part',ids);
            parts.push({id:`${reservedPart.core}:${role}:${reservedPart.num}`,coreId:reservedPart.core,role,cell,frame,localRect:local,...(role==='stair'?{landingEdge:[coreWorld(frame,[0,0]),coreWorld(frame,[width,0])] as [V2,V2]}:{})});};
          if(reservedPart.role==='stair')part('stair',[0,0,width,depth]);
          else{const end=C.liftHallDepth+C.liftClearDepth+I.walls.cage;part('liftHall',[0,0,width,C.liftHallDepth]);part('elevator',[0,C.liftHallDepth,width,end]);part('shaft',[0,end,width,depth]);}
        }else{
          const mid=(a+z)/2;
          const lit=!inside?!blind[side]:horizontal?mid>court[0]&&mid<court[2]:mid>court[1]&&mid<court[3];
          const cell=add(rect,c.col,inside?'back':'front',lit?'home':'service',ids);
          if(side===0&&porchX>a&&porchX<z)porchCells.push(cell);
        }
      }
    };
    if(!blind[side])makeBand(spec.outer,false); makeBand(inner,true);
    const mine=parts.filter(q=>q.coreId.startsWith(id+':'));
    const coreIds=[...new Set(mine.map(q=>q.coreId))];
    for(const [k,coreId] of coreIds.entries()){
      const ps=mine.filter(q=>q.coreId===coreId);
      cores.push({id:coreId,kind:cores.length?'service':'main',stairIds:ps.filter(q=>q.role==='stair').map(q=>q.id),cellIds:ps.map(q=>coreCellId(q.cell)),fromLevel:0,toLevel:p.floors+1,position:ps[0].frame.origin,orientation:ps[0].frame.orientation,elevatorIds:ps.filter(q=>q.role==='elevator').map(q=>q.id),hallIds:ps.filter(q=>q.role==='liftHall').map(q=>q.id),shaftIds:ps.filter(q=>q.role==='shaft').map(q=>q.id)});
      const selected=localCols.slice(Math.floor(k*localCols.length/coreIds.length),Math.floor((k+1)*localCols.length/coreIds.length)).map(c=>c.col);
      serviceAreas.push({coreId,moduleId:id,columns:selected,cellIds:ids.filter(i=>selected.includes(cells[i].col))});
    }
    ids.push(corridors.get(side)!);
    const frame=new Matrix4().makeRotationZ(spec.angle).setPosition(side===1||side===2?W:0,side===2||side===3?L:0,0).toArray();
    const wingPolygon=unionRooms(ids.map(id=>{const c=cells[id];return rectLoop([c.x0,c.y0,c.x1,c.y1]);}));
    wings.push({id,side,frame,polygon:clipEnvelope(wingPolygon,insetEdges(b.footprint,b.footprint.map(()=>T))!),cellIds:ids,single:blind[side]});
  }
  if (porchCells.length !== 2) return fail('正面入口開間無法穿過前翼至中庭，核心不得佔用門廊');
  for (const area of serviceAreas) if (area.cellIds!.filter(id=>residentialCells.includes(id)).length < C.minApartmentCells) return fail(`${area.coreId} 住宅採光格不足以保留完整住戶`);
  const polygon=rectLoop(court), loop=polygon.slice().reverse(), facades:FacadeSegment[]=[], facadeIds:string[]=[];
  const fidBase=`court:${shape}:${court.join(',')}`;
  loop.forEach((a,i)=>{const z=loop[(i+1)%4];if(shape==='U'&&i===0)return;
    const length=Math.hypot(z[0]-a[0],z[1]-a[1]),angle=Math.atan2(z[1]-a[1],z[0]-a[0]);
    const frame=new Matrix4().makeRotationZ(angle).setPosition(a[0],a[1],0),e=frame.elements,id=`${fidBase}:face:${i}`;
    const horizontal=Math.abs(a[1]-z[1])<EPS,axis=horizontal?0:1,base=horizontal?xBase:yBase;
    const points:number[]=[];
    for(let v=base+B/2;v<Math.max(a[axis],z[axis])-B/2+EPS;v+=B)if(v>Math.min(a[axis],z[axis])+B/2-EPS)points.push((v-a[axis])/(horizontal?e[0]:e[1]));
    points.sort((a,b)=>a-b);
    facadeIds.push(id);facades.push({id,side:4+facades.length,kind:'court',left:'none',right:'none',length,start:a,end:z,along:[e[0],e[1]],inward:[e[4],e[5]],frame:frame.toArray(),x0:points[0]-B/2,bays:points.map((x,bay)=>({id:`${id}:bay:${bay}`,bay,x})),diagonal:null});
  });
  const envelopeInner=insetEdges(b.footprint,b.footprint.map(()=>T))!;
  const innerRect:Rect=[court[0]-T,court[1]-T,court[2]+T,court[3]+T];
  const inner=shape==='U'?rearNotch(envelopeInner,innerRect):envelopeInner;
  const innerBoundary=rectLoop(innerRect).reverse();
  const ss=parts.filter(q=>q.role==='stair');
  const courtyard:CourtyardLayout={shape,court,minimum,polygon,inner,wings,porchCells,porchX,serviceCells,residentialCells,innerBoundary,facadeIds};
  return {status:'ready',ballroom:null,facades,cores,layout:{parts,publicCells,serviceAreas},courtyard,footprint:shape==='U'?rearNotch(b.footprint,court):b.footprint,
    grid:{W,L,cols,cells,inner:envelopeInner,mainCol:cells[porchCells[0]].col,cage:[ss[0].cell],service:[ss[1].cell],cross:[],ballroom:[]}};
}
