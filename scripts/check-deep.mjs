/** P4 real openings/holes, pre-program daylight and public routes; no regenerated golden data. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { Mesh, MeshStandardMaterial, Raycaster, Vector3, DoubleSide } from 'three';
const json = process.argv.indexOf('--json'), output = json < 0 ? null : process.argv[json + 1];
assert.ok(json < 0 || output, '--json requires a file');
const server = await createServer({server:{middlewareMode:true,ws:false},appType:'custom'});
try {
  const load = n => server.ssrLoadModule(`/src/${n}.ts`);
  const {defaultParams} = await load('params'), {generateBuilding, buildingFacade} = await load('generator');
  const {resolveBuildingTopology} = await load('buildingTopology'), {planBuilding, checkPlan, clipConvex, polygonArea} = await load('plan');
  const {analyseCirculation} = await load('planning/circulation'), {buildRooms3d} = await load('rooms3d');
  const {roofCap, roofShape} = await load('roof'), {buildStairs} = await load('stairs'), {Cutaway} = await load('cutaway');
  const {RoomEdits, mergeReason} = await load('roomEdits');
  const manifest = JSON.parse(await readFile('public/assets/kit_manifest.json','utf8'));
  const entries = Object.values(manifest.collections).flatMap(c=>c.children??[]), byKey = new Map(entries.map(e=>[e.name,e]));
  const kit = {key:(c,v)=>`${c}.${v}`,info:k=>byKey.get(k)};
  const cases=[], report={cases,negativeChecks:[],geometry:[],scope:'P4 explicit lightwell; auto courtyard selection P5, D/V6 diversity P6, full CPU/GPU performance P7'};
  const make = o => { const p={...defaultParams(),layoutMode:'lightwell',dimensionVersion:'bays-v2',ballroom:false,...o}; const b=generateBuilding(p,kit), plan=planBuilding(b,p); return {p,b,plan}; };
  const verify = ({p,b,plan}) => {
    assert.deepEqual(plan.issues,[],JSON.stringify(p)); if(p.floorVariety)assert.ok(plan.programDiagnostics.every(d=>d.status!=='legacy-fallback')); assert.deepEqual(checkPlan(plan),[]);
    const d=b.topology.deepLayout;
    assert.equal(b.topology.mode,'lightwell'); assert.ok(d.wells.length>0);
    assert.ok(d.wellDepth>=Math.max(3,.1*b.wallTop)); assert.equal(d.wellDepth%3,0);
    assert.ok(JSON.stringify(JSON.parse(JSON.stringify(b.topology))) === JSON.stringify(b.topology));
    assert.ok(plan.daylightDiagnostics.every(v=>v.ratio<=.1 && v.residentialCells>0 && v.serviceArea>0));
    assert.ok(plan.rooms.some(r=>r.type==='bathroom'&&r.apartment===null)); assert.ok(plan.rooms.some(r=>r.type==='closet'&&r.apartment===null));
    assert.ok(b.placements.every(v=>byKey.has(v.key)), 'every reused kit part actually exists');
    for(const lv of plan.levels) {
      assert.equal(plan.voids.filter(v=>v.kind==='lightwell'&&v.level===lv.index).length,d.wells.length);
      const pub=plan.rooms.filter(r=>r.level===lv.index&&r.circulation==='public'),seen=new Set([pub[0].id]),queue=[pub[0]];
      while(queue.length){const r=queue.pop();for(const door of r.doors){const n=pub.find(v=>v.id===door.to);if(n&&!seen.has(n.id)){seen.add(n.id);queue.push(n)}}}
      assert.equal(seen.size,pub.length,'all public corridors/halls/stairs are connected');
    }
    for(const well of d.wells){ assert.ok(well.rect[2]-well.rect[0]>=3); assert.equal(well.facadeIds.length,4);
      for(const fid of well.facadeIds){const ws=plan.windows.filter(w=>w.facadeId===fid);assert.ok(ws.length>=plan.levels.length); assert.equal(new Set(ws.map(w=>w.openingKey)).size,ws.length);
        ws.forEach(w=>{assert.ok(w.room);assert.equal(plan.rooms.filter(r=>r.windows.includes(plan.windows.indexOf(w))).length,1);assert.ok(buildingFacade(b,w.side,w.facadeId));});}
    }
    for(const w of plan.windows){assert.ok(w.room);if(w.side<4)assert.equal(w.facadeId,undefined);}
    assert.deepEqual(new RoomEdits().apply(plan).plan.issues,[]);
    const audit=analyseCirculation(plan);assert.deepEqual(audit.issues,[]);
    for(const side of [1,3])if(p.type==='row'){assert.equal(b.sides[side].kind,'party');assert.ok(!plan.windows.some(w=>w.side===side));}
    cases.push({size:[p.baysX,p.baysY,p.floors],seed:p.seed,type:p.type,corner:p.cornerStyle,profile:p.profile,variety:!!p.floorVariety,groups:d.groups.length,wellDepth:d.wellDepth,wells:d.wells.length,cores:b.topology.cores.length,stairs:plan.stairs.length,rooms:plan.rooms.length,windowlessRatio:Math.max(...plan.daylightDiagnostics.map(d=>d.ratio)),serviceArea:d.daylight.serviceArea,maxNearest:Math.max(...audit.apartments.map(a=>a.furthestNearestStair)),maxSecond:Math.max(...audit.apartments.map(a=>a.furthestSecondStair??0))});
  };
  const main=[];
  for(const [baysX,baysY,floors] of [[10,10,6],[10,20,6],[20,20,20]])for(let seed=1;seed<=10;seed++){
    const value=make({baysX,baysY,floors,seed}); verify(value);
    if(baysY===20&&baysX===10)assert.ok(value.b.topology.modules.length>=4,'two internal groups plus front/back');
    if(seed===1)main.push(value);
  }
  for(const fixture of [{type:'row',baysX:10,baysY:20,floors:6},{baysX:10,baysY:10,floors:6,cornerStyle:'panCoupe'}, {baysX:10,baysY:20,floors:6,cornerStyle:'panCoupe'}, {baysX:20,baysY:20,floors:20,profile:'uniform'},{baysX:10,baysY:10,floors:6,floorVariety:true,seed:7},{baysX:10,baysY:20,floors:6,floorVariety:true,seed:3}])verify(make(fixture));
  for(const [baysX,baysY] of [[2,2],[2,20],[20,2]]){const r=resolveBuildingTopology({...defaultParams(),dimensionVersion:'bays-v2',layoutMode:'lightwell',baysX,baysY,floors:20});assert.equal(r.status,'infeasible');report.negativeChecks.push({narrow:[baysX,baysY,20],reason:r.diagnostics});}
  assert.equal(resolveBuildingTopology({...defaultParams(),layoutMode:'auto',baysX:10,baysY:8,floors:6}).topology.mode,'legacy');
  for(const value of main){const {b,plan}=value, cap=roofCap(b.footprint,b.edgeKinds,b.roofBase,b.topology.deepLayout.wells.map(w=>w.polygon));
    const material=new MeshStandardMaterial({side:DoubleSide}), mats=Object.fromEntries(['floor','ceiling','section','wall','iron','wood','carpet','finishFloor','finishWall'].map(k=>[k,material]));
    const model=buildRooms3d(plan,b,kit,mats,'diagram');model.add(buildStairs(plan,mats,material,material,'diagram'));model.add(new Mesh(cap.geometry,material));model.updateMatrixWorld(true);
    for(const well of b.topology.deepLayout.wells){const x=(well.rect[0]+well.rect[2])/2,y=(well.rect[1]+well.rect[3])/2;
      for(const [px,py] of [[x,y],...well.polygon.map(q=>[q[0]+Math.sign(x-q[0])*.01,q[1]+Math.sign(y-q[1])*.01])]){const ray=new Raycaster(new Vector3(px,py,cap.top+1),new Vector3(0,0,-1));assert.equal(ray.intersectObject(model,true).length,0,'open sky ray passes all slabs, attic ceiling and roof, including corners');}
      for(const fid of well.facadeIds){const face=b.topology.facades.find(f=>f.id===fid);for(const lv of [plan.levels[0],plan.levels[1],plan.levels.at(-1)]){
        const w=plan.windows.find(w=>w.facadeId===fid&&w.level===lv.index), source=new Vector3(w.at[0]-face.inward[0]*.6,w.at[1]-face.inward[1]*.6,lv.floorZ+1.2);
        const ray=new Raycaster(source,new Vector3(...face.inward,0),0,.75);const shell=model.children.filter(m=>m.name==='facade_inner_lining');assert.equal(ray.intersectObjects(shell,true).length,0,'actual kit opening cuts inner lining, including attic');
      }}
    }
    const pos=cap.geometry.getAttribute('position');for(let i=0;i<pos.count;i+=3){const tri=[0,1,2].map(j=>[pos.getX(i+j),pos.getY(i+j)]);for(const well of b.topology.deepLayout.wells)assert.ok(Math.abs(polygonArea(clipConvex(tri,well.polygon)))<1e-4,'no roof triangle bridges a well');}
    report.geometry.push({size:[value.p.baysX,value.p.baysY,value.p.floors],roofTriangles:pos.count/3,skyRays:b.topology.deepLayout.wells.length*5,realLiningOpeningRays:b.topology.deepLayout.wells.length*4*3});
    model.traverse(o=>{if(o.isMesh)o.geometry.dispose()});material.dispose();
  }
  const sample=main[0], edits=new RoomEdits();edits.apply(sample.plan);const room=sample.plan.rooms.find(r=>r.type==='bedroom'&&r.level===3);edits.setType(room.id,'storage');assert.deepEqual(edits.apply(sample.plan).plan.issues,[]);edits.undo();assert.deepEqual(edits.apply(sample.plan).plan,sample.plan);
  const pair=sample.plan.walls.map(w=>w.rooms).find(ids=>ids[1]&&!mergeReason(sample.plan,ids));assert.ok(pair);edits.merge(pair,'salon');assert.deepEqual(edits.apply(sample.plan).plan.issues,[]);edits.undo();assert.deepEqual(edits.apply(sample.plan).plan,sample.plan);
  const reject=(name,edit)=>{const plan=structuredClone(sample.plan);edit(plan);assert.ok(checkPlan(plan).length,name);report.negativeChecks.push(name)};
  reject('room enters sky well',p=>{const r=p.rooms.find(r=>r.level===1),v=p.voids.find(v=>v.kind==='lightwell'&&v.level===1);r.polygon=structuredClone(v.polygon);});
  reject('shared service cannot require a private flat',p=>{const ids=new Set(sample.b.topology.deepLayout.serviceCells.map(id=>sample.b.topology.cells[id].id));const r=p.rooms.find(r=>r.apartment!==null&&r.cellIds.some(id=>ids.has(id))&&!r.doors.some(d=>p.rooms.find(o=>o.id===d.to)?.circulation==='public'));assert.ok(r);r.apartment=null;});
  reject('duplicate inner opening key',p=>{const ws=p.windows.filter(w=>w.facadeId);ws[1].openingKey=ws[0].openingKey;});
  reject('pre-program blind residential ratio cannot be hidden as storage',p=>p.daylightDiagnostics[1].ratio=.2);
  const seamHole=[[2,7],[7,7],[7,10],[2,10]], seam=roofCap(sample.b.footprint,sample.b.edgeKinds,sample.b.roofBase,[seamHole]);
  const seamPos=seam.geometry.getAttribute('position');for(let i=0;i<seamPos.count;i+=3){const tri=[0,1,2].map(j=>[seamPos.getX(i+j),seamPos.getY(i+j)]);assert.ok(Math.abs(polygonArea(clipConvex(tri,seamHole)))<1e-4,'well crossing a roof-patch seam stays open');}seam.geometry.dispose();report.negativeChecks.push('roof-patch seam clipping leaves no bridge');
  const oldSlot=sample.b.windows.find(w=>w.facadeId&&w.kind==='upper');const oldOwner=sample.plan.windows.find(w=>w.openingKey===oldSlot.key);
  const overridden=generateBuilding({...sample.p,facade:{...sample.p.facade,[oldSlot.key]:{shutters:'closed',window:'closed',curtain:'closed'}}},kit);
  assert.ok(overridden.placements.some(v=>v.tag===oldSlot.key&&v.key.endsWith('_shutter.closed')));
  assert.ok(overridden.rooms.some(v=>v.at?.facadeId===oldSlot.facadeId&&v.at.level===oldOwner.level&&v.curtainMode==='closed'));
  const changed=make({baysX:20,baysY:20,floors:20,facade:{[oldSlot.key]:{shutters:'closed',curtain:'closed'}}});assert.ok(!changed.b.windows.some(w=>w.key===oldSlot.key),'disappeared well override stays inactive');assert.ok(oldOwner);
  if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(`Deep: ${cases.length} ready cases; real four-sided openings, public graph, >= 2 internal groups, daylight, sky/roof rays, editor/undo and negative checks passed.`);
} finally {await server.close();}
