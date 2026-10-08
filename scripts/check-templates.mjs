/** P6 integration: actual programs, stable segment partitions, fallbacks and immutable public geometry. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {createHash} from 'node:crypto';
const server=await createServer({server:{middlewareMode:true,ws:false},appType:'custom'});
const json=process.argv.indexOf('--json'),quick=process.argv.includes('--quick');
try {
 const load=n=>server.ssrLoadModule(`/src/${n}.ts`);
 const {defaultParams}=await load('params'),{generateBuilding}=await load('generator'),{planBuilding,checkPlan}=await load('plan');
 const {splitTemplate,verticalSegments,createProgramStructure,planTemplateGroups}=await load('planning/templates'),{floorSignature}=await load('planning/signature');
 const {RoomEdits}=await load('roomEdits'),{stampOf}=await load('finishes');
 const kit={key:(c,v)=>`${c}.${v}`,info:()=>null};
 const make=o=>{const p={...defaultParams(),layoutMode:'auto',dimensionVersion:'bays-v2',ballroom:false,floorVariety:true,...o},b=generateBuilding(p,kit);return{p,b,plan:planBuilding(b,p)}};
 const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
 const report={cases:[],outcomes:{},links:{},retries:0,negativeChecks:[],scope:'P6 program/segment correctness; full CPU/GPU performance P7; production controls P8'};
 const inspect=({p,b,plan})=>{
  assert.deepEqual(plan.issues,[],JSON.stringify(p));assert.deepEqual(checkPlan(plan),[]);
  const structure=plan.programStructure;assert.ok(structure);
  assert.ok(plan.programDiagnostics.every(d=>!['legacy-fallback','repeated'].includes(d.status)),JSON.stringify({p,diagnostics:plan.programDiagnostics.filter(d=>['legacy-fallback','repeated'].includes(d.status))}));
  const partitions=new Map();
  for(const t of structure.templates){
    report.outcomes[t.resolved]=(report.outcomes[t.resolved]??0)+1;
    assert.equal(t.apartmentIds.length,t.count);
    const signature=t.apartmentIds.map(a=>plan.rooms.filter(r=>r.level===t.level&&r.apartment===a).flatMap(r=>r.cellIds).filter(v=>!b.topology.voids.filter(q=>q.kind==='ballroom').some(q=>q.cellIds.includes(v))).filter((v,i,arr)=>arr.indexOf(v)===i).sort()).sort((a,b)=>a.join().localeCompare(b.join()));
    const k=`${t.segment}:${t.area}:${t.coreId}`;
    if(partitions.has(k))assert.deepEqual(signature,partitions.get(k),'fixed cells/ownership per segment despite retries and V1–V5');else partitions.set(k,signature);
    for(const a of t.apartmentIds){
      const rooms=plan.rooms.filter(r=>r.level===t.level&&r.apartment===a);
      for(const type of ['salon','kitchen','wc','bedroom'])assert.ok(rooms.some(r=>r.type===type),JSON.stringify({p,t,a,missing:type}));
      if(t.resolved==='A'){
        assert.equal(t.count,1);assert.ok(rooms.length<=12,JSON.stringify({p,t,roomCount:rooms.length}));
        assert.ok(rooms.some(r=>r.type==='study'),'A has a study');
        assert.ok(rooms.some(r=>r.type==='salon'&&r.cellIds.length>=2),'A reception has at least two actual cells');
      }
      if(t.resolved==='C'){
        assert.equal(t.baseCount,3);assert.ok(!rooms.some(r=>r.type==='study'));
        assert.ok(rooms.filter(r=>r.type==='salon').every(r=>r.cellIds.length===1),'C retains a single-cell salon');
      }
      if(b.topology.deepLayout){const group=b.topology.deepLayout.groups.findIndex(g=>g.id===t.area);if(group>0&&group<b.topology.deepLayout.groups.length-1)assert.ok(!rooms.some(r=>r.type==='study'),'internal group has no study');}
    }
  }
  for(const l of structure.links){
    report.links[l.outcome]=(report.links[l.outcome]??0)+1;
    if(l.feature==='W2'&&l.cells.length)assert.ok(plan.rooms.some(r=>r.level===l.level&&r.type==='salon'&&r.cellIds.some(id=>l.cells.some(c=>b.topology.cells[c].id===id))&&new Set(r.windows.filter(i=>!plan.windows[i].facadeId).map(i=>plan.windows[i].side)).size>=2),'cross-wing flat has an actual two-faced corner salon');
  }
  for(const d of plan.programDiagnostics){report.retries+=d.retries;if(d.status==='exempt')continue;
    const prev=plan.programDiagnostics[d.level-1];if(prev&&prev.status!=='exempt')assert.notEqual(d.generatedSignature,prev.generatedSignature,'adjacent actual floors vary');
  }
  for(const r of plan.rooms)for(const look of ['real','diagram'])for(const surface of ['floor','wall'])assert.ok(stampOf(look,r,surface).every(Number.isFinite));
  if(p.apartments==='auto'&&b.topology.courtyardLayout?.shape==='O'&&p.floors===20){
    const wings=new Set(structure.templates.filter(t=>t.resolved==='A'&&['lower','upper','top'].includes(t.segment)).map(t=>t.area));
    assert.ok(wings.size>=2,JSON.stringify({p,wings:[...wings]}));
  }
  const fixed=plan=>plan.rooms.filter(r=>r.circulation==='public'||r.circulation==='equipment').map(r=>[r.level,r.rect,r.polygon,r.type,r.structuralId]);
  const legacy=planBuilding(b,{...p,floorVariety:false});assert.deepEqual(fixed(plan),fixed(legacy),'no public corridor/core/equipment captured');
  const bounds=plan=>plan.voids.map(v=>[v.level,v.kind,v.polygon]);assert.deepEqual(bounds(plan),bounds(legacy));
  report.cases.push({size:[p.baysX,p.baysY,p.floors],type:p.type,mode:b.topology.mode,seed:p.seed,apartments:p.apartments,templates:structure.templates.map(t=>({level:t.level,area:t.area,coreId:t.coreId,requested:t.requested,resolved:t.resolved,count:t.count,reason:t.reason})),policies:structure.policies,links:structure.links});
 };
 const fixtures=[{baysX:14,baysY:5,floors:10},{baysX:10,baysY:10,floors:6,layoutMode:'lightwell'},{baysX:10,baysY:20,floors:6,layoutMode:'lightwell'},{baysX:20,baysY:20,floors:20,layoutMode:'lightwell'},{baysX:20,baysY:20,floors:20},{type:'row',baysX:12,baysY:16,floors:8},{baysX:20,baysY:10,floors:6}];
 for(let seed=1;seed<=(quick?1:10);seed++)for(const f of fixtures){inspect(make({...f,seed}));console.log(`Templates: ${report.cases.length} cases passed`);}
 for(const apartments of ['one','two'])for(const f of fixtures)inspect(make({...f,apartments,seed:7}));
 for(const f of [{baysX:14,baysY:5,floors:10,ballroom:true},{baysX:20,baysY:20,floors:20,type:'corner',cornerStyle:'panCoupe'},{baysX:20,baysY:20,floors:20,profile:'uniform'}])inspect(make({...f,seed:8}));
 // Standalone capacity checks use actual daylight kinds, not maintenance/shop/door openings.
 const windows=Array.from({length:24},(_,i)=>({kind:'window',at:[i*3,0],dir:[1,0]}));
 const units=n=>Array.from({length:n},(_,i)=>({cells:[{id:i,col:i,zone:'front'}],x0:i*3,y0:0,x1:i*3+3,y1:4,win:[i],type:null,apartment:null}));
 assert.equal(splitTemplate(units(4),windows,'C').resolved,'compact');
 assert.equal(splitTemplate(units(8),windows,'C').resolved,'B');
 assert.equal(splitTemplate(units(12),windows,'C').resolved,'C');
 assert.equal(splitTemplate(units(3),windows,'B').groups.length,0);
 assert.equal(splitTemplate(units(7),windows.map(w=>({...w,kind:'door'})),'A').groups.length,0);
 // A constrained L-shaped private-cell fixture exercises W2 acceptance and its public-gap rejection.
 const cornerWindows=[...windows,{kind:'window',side:1,at:[0,2],dir:[0,-1]}];
 cornerWindows.forEach((w,i)=>w.side??=0);
 const front=units(8),side=units(8).map((u,i)=>({...u,cells:[{id:i+8,col:i+8,zone:'front'}],y0:4,y1:8,win:[i+8]}));
 front[0].win.push(24);
 const synthetic={topology:{grid:{cells:[...front,...side].map(u=>({...u.cells[0],x0:u.x0,y0:u.y0,x1:u.x1,y1:u.y1})),ballroom:[]},coreLayout:{parts:[],publicCells:[],serviceAreas:[{coreId:'front',moduleId:'wing0',cellIds:front.map(u=>u.cells[0].id),columns:front.map(u=>u.cells[0].col)},{coreId:'side',moduleId:'wing1',cellIds:side.map(u=>u.cells[0].id),columns:side.map(u=>u.cells[0].col)}]},courtyardLayout:{wings:[{id:'wing0',side:0},{id:'wing1',side:1}],serviceCells:[]}}};
 const params={...defaultParams(),floors:6,apartments:'auto',seed:3};
 const cross=(gap)=>{
  const us=structuredClone([...front,...side]);if(gap)for(const u of us.slice(8)){u.y0+=2;u.y1+=2;}
  const structure=createProgramStructure(synthetic,params);const policy=structure.policies.find(p=>p.segment==='ordinary');policy.largeWing='wing0';policy.crossWing=true;policy.symmetric=false;
  const result=planTemplateGroups(synthetic,params,{index:2},us,cornerWindows,structure);
  return {result,link:structure.links.find(l=>l.feature==='W2')};
 };
 const connected=cross(false);assert.ok(connected.link.cells.length>0);assert.ok(connected.result.some(g=>g.units.some(u=>u.cells[0].id<8)&&g.units.some(u=>u.cells[0].id>=8)));
 assert.equal(cross(true).link.cells.length,0,'W2 never fills a gap with a private corridor');
 report.negativeChecks.push('W2 actual private L cells merge; disconnected wing cells are rejected');
 const segments=verticalSegments(20);assert.deepEqual(Array.from({length:22},(_,i)=>segments.filter(s=>i>=s.first&&i<=s.last).length),Array(22).fill(1));
 report.negativeChecks.push('C→B→compact / incomplete capacity rejected','door openings do not fake daylight','one unique segment per actual level');
 const sample=make({baysX:20,baysY:20,floors:20,seed:3});const before=hash(sample.plan),edits=new RoomEdits();edits.apply(sample.plan);
 const bed=sample.plan.rooms.find(r=>r.type==='bedroom');edits.setType(bed.id,'laundry');const result=edits.apply(sample.plan);assert.equal(result.plan.rooms.find(r=>r.id===bed.id).type,'laundry');
 result.plan.programStructure.policies[0].largeWing='mutated';assert.equal(hash(sample.plan),before,'editing clones segment policies');edits.undo();assert.equal(edits.apply(sample.plan).plan.rooms.find(r=>r.id===bed.id).type,'bedroom');
 assert.equal(hash(make(sample.p).plan),before,'deterministic templates and draws');
 assert.deepEqual(generateBuilding({...sample.p,floorVariety:false},kit).topology,sample.b.topology,'programming does not reshape topology');
 if(!quick)assert.ok(report.outcomes.A&&report.outcomes.B&&report.outcomes.C&&report.outcomes.compact);
 if(json>=0)await writeFile(process.argv[json+1],JSON.stringify(report,null,2)+'\n');
 console.log(`Templates: ${report.cases.length} cases; segment ownership, A/B/C capacity, real windows, public protection, signatures, materials and edits passed.`);
}finally{await server.close()}
