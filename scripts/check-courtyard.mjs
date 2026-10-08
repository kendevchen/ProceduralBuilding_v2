/** P5 O/U geometry, actual openings, local cores, entrance and candidate order. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { Mesh, MeshStandardMaterial, DoubleSide, Raycaster, Vector3 } from 'three';
const server=await createServer({server:{middlewareMode:true,ws:false},appType:'custom'});
const json=process.argv.indexOf('--json');
try {
  const load=n=>server.ssrLoadModule(`/src/${n}.ts`);
  const {defaultParams}=await load('params'),{generateBuilding}=await load('generator'),{resolveBuildingTopology}=await load('buildingTopology');
  const {planBuilding,checkPlan,clipConvex,polygonArea}=await load('plan'),{analyseCirculation}=await load('planning/circulation');
  const {buildRooms3d,atticCeiling}=await load('rooms3d'),{buildingRoofCap,courtyardClosure}=await load('roof'),{buildStairs}=await load('stairs');
  const {RoomEdits,editableRoom,mergeReason}=await load('roomEdits'),{roomsOverlap,inRoom}=await load('roomGeometry');
  const manifest=JSON.parse(await readFile('public/assets/kit_manifest.json','utf8'));
  const byKey=new Map(Object.values(manifest.collections).flatMap(c=>c.children??[]).map(e=>[e.name,e]));
  const kit={key:(c,v)=>`${c}.${v}`,info:k=>byKey.get(k)};
  const make=o=>{const p={...defaultParams(),layoutMode:'courtyard',dimensionVersion:'bays-v2',ballroom:false,...o};const b=generateBuilding(p,kit),plan=planBuilding(b,p);return {p,b,plan};};
  const report={cases:[],geometry:[],negativeChecks:[],scope:'P5 structure/geometry; segmented templates P6; full CPU/GPU performance P7; production controls P8'};
  const verify=({p,b,plan})=>{
    assert.deepEqual(plan.issues,[],JSON.stringify(p));assert.deepEqual(checkPlan(plan),[]);
    if(p.floorVariety)assert.ok(plan.programDiagnostics.every(d=>d.status!=='legacy-fallback'),'no illegal variety fallback');
    const c=b.topology.courtyardLayout; assert.equal(b.topology.mode,'courtyard');
    assert.ok(Math.min(c.court[2]-c.court[0],c.court[3]-c.court[1])>=Math.max(6,b.wallTop*.5)-1e-6);
    assert.equal(b.edgeKinds.length,b.footprint.length);assert.equal(b.topology.boundaryLoops[0].facadeIds.length,b.footprint.length);assert.equal(JSON.stringify(JSON.parse(JSON.stringify(b.topology))),JSON.stringify(b.topology));
    assert.ok(b.placements.every(q=>byKey.has(q.key)),'actual kit part exists');
    assert.equal(b.topology.boundaryLoops.filter(l=>l.role==='hole').length,c.shape==='O'?1:0);
    const cells=b.topology.cells;for(let i=0;i<cells.length;i++)for(let j=i+1;j<cells.length;j++){
      const a=cells[i].rect,z=cells[j].rect;assert.ok(Math.min(a[2],z[2])-Math.max(a[0],z[0])<1e-6||Math.min(a[3],z[3])-Math.max(a[1],z[1])<1e-6,'structural cells never overlap');
    }
    for(let i=0;i<c.wings.length;i++)for(let j=i+1;j<c.wings.length;j++)assert.ok(!roomsOverlap(c.wings[i].polygon,c.wings[j].polygon),'wing corner ownership disjoint');
    const floors=plan.levels;for(const lv of floors){
      const sky=plan.voids.filter(v=>v.kind==='courtyard'&&v.level===lv.index);assert.equal(sky.length,1);assert.deepEqual(sky[0].polygon,c.polygon);
      const pub=plan.rooms.filter(r=>r.level===lv.index&&r.circulation==='public'),seen=new Set([pub[0].id]),q=[pub[0]];
      while(q.length){const r=q.pop();for(const d of r.doors){const n=pub.find(v=>v.id===d.to);if(n&&!seen.has(n.id)){seen.add(n.id);q.push(n)}}}assert.equal(seen.size,pub.length,'each public spine/core connected');
      for(const r of plan.rooms.filter(r=>r.level===lv.index)){assert.ok(Math.abs(polygonArea(clipConvex(r.polygon,c.polygon)))<1e-5,'no room inside court');
        assert.ok(r.polygon.every(q=>inRoom(plan.inner,q)),'U rooms remain in concave envelope');}
    }
    assert.ok(plan.rooms.filter(r=>r.type==='porch').length>=2);
    for (const r of plan.rooms.filter(r=>r.type==='porch')) assert.ok(r.doors.some(d=>d.width>=2.2 && plan.rooms.find(q=>q.id===d.to)?.type==='corridor'),'one-bay porch has a wide passage');assert.ok(plan.rooms.filter(r=>r.type==='porch').every(r=>r.level===0&&!editableRoom(r)));
    for(const cell of c.porchCells){assert.ok(plan.rooms.some(r=>r.level===1&&r.cellIds.includes(cells[cell].id)&&r.type!=='porch'),'front wing exists above porch');}
    const porchWindows=plan.windows.filter(w=>w.level===0&&w.kind==='door');assert.ok(porchWindows.some(w=>w.side===0));assert.ok(porchWindows.some(w=>w.facadeId));
    for(const wing of c.wings.filter(w=>w.single))for(const r of plan.rooms.filter(r=>r.apartment!==null&&r.cellIds.some(id=>wing.cellIds.includes(cells.findIndex(c=>c.id===id)))&&['bedroom','salon','study','maid'].includes(r.type)))assert.ok(r.windows.some(i=>plan.windows[i].facadeId),'blind-wing homes face court');
    for(let side=0;side<4;side++)if(b.sides[side].kind==='party')assert.ok(!plan.windows.some(w=>w.side===side),'no blind-wall opening');
    const audit=analyseCirculation(plan);assert.deepEqual(audit.issues,[]);
    assert.ok(b.topology.cores.some(c=>Math.abs(c.orientation-Math.PI/2)<1e-6));assert.ok(b.topology.cores.some(c=>Math.abs(c.orientation+Math.PI/2)<1e-6));
    report.cases.push({size:[p.baysX,p.baysY,p.floors],type:p.type,seed:p.seed,apartments:p.apartments,profile:p.profile,corner:p.cornerStyle,variety:!!p.floorVariety,shape:c.shape,court:c.court,minimum:c.minimum,rooms:plan.rooms.length,cores:b.topology.cores.length,stairs:plan.stairs.length,maxNearest:Math.max(...audit.apartments.map(a=>a.furthestNearestStair)),maxSecond:Math.max(...audit.apartments.map(a=>a.furthestSecondStair??0))});
  };
  const main=[];
  const fixtures=[{baysX:20,baysY:20,floors:20},{type:'row',baysX:12,baysY:16,floors:8},{baysX:20,baysY:10,floors:6},{type:'corner',baysX:20,baysY:20,floors:6}];
  for(const o of fixtures)for(let seed=1;seed<=(process.argv.includes("--quick")?1:10);seed++)for(const apartments of (process.argv.includes('--quick')?['auto']:['auto','one','two'])){const v=make({...o,seed,apartments});verify(v);if(seed===1&&apartments==='auto')main.push(v);}
  for(const o of [{...fixtures[3],floors:20},{...fixtures[0],groundUse:'shops'},{...fixtures[2],groundUse:'residential'},{...fixtures[0],profile:'uniform'},{...fixtures[0],cornerStyle:'panCoupe'},{...fixtures[3],cornerStyle:'panCoupe'},{...fixtures[2],cornerStyle:'panCoupe'},{...fixtures[1],floorVariety:true},{...fixtures[2],floorVariety:true},{...fixtures[0],floorVariety:true,seed:7}])verify(make(o));
  for(const v of main){const {b,plan}=v,c=b.topology.courtyardLayout,cap=buildingRoofCap(b),material=new MeshStandardMaterial({side:DoubleSide});
    const mats=Object.fromEntries(['floor','ceiling','section','wall','iron','wood','carpet','finishFloor','finishWall'].map(k=>[k,material]));
    const model=buildRooms3d(plan,b,kit,mats,'diagram');model.add(buildStairs(plan,mats,material,material,'diagram'),new Mesh(cap.geometry,material),new Mesh(courtyardClosure(b),material));model.updateMatrixWorld(true);
    let skyRays=0,windowRays=0;
    for(let x=c.court[0]+.01;x<c.court[2];x+=3)for(let y=c.court[1]+.01;y<c.court[3];y+=3){assert.equal(new Raycaster(new Vector3(x,y,cap.top+1),new Vector3(0,0,-1)).intersectObject(model,true).length,0,'court stays open through roof/attic/slabs');skyRays++;}
    for(const face of b.topology.facades.slice(4))for(const level of [0,1,plan.levels.length-1])for(const w of plan.windows.filter(w=>w.level===level&&w.facadeId===face.id)){
      assert.equal(new Raycaster(new Vector3(w.at[0]-face.inward[0]*.6,w.at[1]-face.inward[1]*.6,plan.levels[level].floorZ+1.2),new Vector3(...face.inward,0),0,.75).intersectObjects(model.children.filter(m=>m.name==='facade_inner_lining'),true).length,0,'real window/porch opening cuts lining');windowRays++;
    }
    const pos=cap.geometry.getAttribute('position');for(let i=0;i<pos.count;i+=3)assert.ok(Math.abs(polygonArea(clipConvex([0,1,2].map(j=>[pos.getX(i+j),pos.getY(i+j)]),c.polygon)))<1e-4,'roof seam never bridges court');
    const upper=plan.levels[1],at=new Vector3(c.porchX,c.court[1]/2,upper.floorZ+.01);assert.ok(new Raycaster(at,new Vector3(0,0,-1),0,.02).intersectObject(model,true).length,'covered entrance preserves upper floor');
    assert.ok(atticCeiling(b,plan.levels.at(-1).ceilingZ)([c.court[0]-1,c.court[1]+3])>b.wallTop,'other wing planes cannot flatten attic');
    report.geometry.push({size:[v.p.baysX,v.p.baysY,v.p.floors],type:v.p.type,shape:c.shape,skyRays,windowRays,roofTriangles:pos.count/3});model.traverse(o=>{if(o.isMesh)o.geometry.dispose()});material.dispose();
  }
  const sample=main[2],edits=new RoomEdits();edits.apply(sample.plan);const room=sample.plan.rooms.find(r=>r.level===3&&r.type==='bedroom');edits.setType(room.id,'storage');assert.deepEqual(edits.apply(sample.plan).plan.issues,[]);edits.undo();assert.deepEqual(edits.apply(sample.plan).plan,sample.plan);
  const pair=sample.plan.walls.map(w=>w.rooms).find(ids=>ids[1]&&!mergeReason(sample.plan,ids));assert.ok(pair);edits.merge(pair,'salon');assert.deepEqual(edits.apply(sample.plan).plan.issues,[]);edits.undo();assert.deepEqual(edits.apply(sample.plan).plan,sample.plan);
  const slot=sample.b.windows.find(w=>w.facadeId&&w.kind==='upper');
  const override=generateBuilding({...sample.p,facade:{...sample.p.facade,[slot.key]:{shutters:'closed',window:'closed',curtain:'closed'}}},kit);
  assert.ok(override.placements.some(v=>v.tag===slot.key&&v.key.endsWith('_shutter.closed')));
  const oldOuter=sample.b.windows.filter(w=>!w.facadeId).map(w=>w.key);assert.deepEqual(override.windows.filter(w=>!w.facadeId).map(w=>w.key),oldOuter,'outer keys remain stable');
  assert.ok(!main[0].b.windows.some(w=>w.key===slot.key),'inner keys identify geometry');
  const resolve=o=>resolveBuildingTopology({...defaultParams(),dimensionVersion:'bays-v2',...o});
  for(const [o,mode,shape] of [[{baysX:10,baysY:8,floors:6},'legacy'],[{...fixtures[0]},'courtyard','O'],[{...fixtures[2]},'courtyard','U'],[{baysX:10,baysY:10,floors:6},'lightwell']]){const t=resolve({...o,layoutMode:'auto'});assert.equal(t.status,'ready');assert.equal(t.topology.mode,mode);if(shape)assert.equal(t.topology.courtyardLayout.shape,shape);report.negativeChecks.push({auto:o,mode,shape});}
  for(const o of [{baysX:2,baysY:20,floors:20},{baysX:20,baysY:2,floors:20},{baysX:2,baysY:2,floors:20},{type:'corner',baysX:20,baysY:9,floors:20}]){const r=resolve({...o,layoutMode:'courtyard'});assert.equal(r.status,'infeasible');assert.ok(r.diagnostics.length);report.negativeChecks.push({infeasible:o,reasons:r.diagnostics});}
  const reject=(name,fn)=>{const p=structuredClone(sample.plan);fn(p);assert.ok(checkPlan(p).length,name);report.negativeChecks.push(name);};
  reject('court intrusion',p=>p.rooms.find(r=>r.level===1).polygon=structuredClone(p.courtyard.polygon));
  reject('outer exit removed; court door is not a street exit',p=>{for(const w of p.windows)if(w.level===0&&!w.facadeId&&w.kind==='door')w.kind='window';});
  reject('court void drift',p=>p.voids.find(v=>v.kind==='courtyard').polygon[0][0]+=.1);
  reject('porch renamed as a private flat',p=>p.rooms.find(r=>r.type==='porch').type='bedroom');
  reject('one rotated landing disconnected',p=>{const id=p.rooms.find(r=>r.type==='stair'&&r.level===1).id;p.rooms.find(r=>r.id===id).doors=[];});
  if(json>=0)await writeFile(process.argv[json+1],JSON.stringify(report,null,2)+'\n');
  console.log(`Courtyard: ${report.cases.length} ready cases; O/U, blind wings, local cores, public paths, covered porch, sky/windows/roof, editing and negative checks passed.`);
}finally{await server.close();}
