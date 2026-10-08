/** Developer-only visual acceptance fixture; production GUI limits are unchanged. */
import { Scene, WebGLRenderer, OrthographicCamera, HemisphereLight, DirectionalLight, Plane, Vector3, Group, Mesh, MeshStandardMaterial } from 'three';
import { defaultParams } from './params';
import { generateBuilding } from './generator';
import { planBuilding, ROOM_INFO } from './plan';
import { analyseCirculation } from './planning/circulation';
import { buildRooms3d } from './rooms3d';
import { buildStairs } from './stairs';
import { Cutaway } from './cutaway';
import { Kit } from './kit';
import { buildingRoofCap, courtyardClosure, buildingRoof, partyWalls } from './roof';
import { createMaterials } from './materials';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const svg = document.getElementById('plan')!;
const select = $<HTMLSelectElement>('level'), cutaway = new Cutaway();
cutaway.plane.constant = 10000;
const renderer = new WebGLRenderer({ canvas: $<HTMLCanvasElement>('three'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(500, 450, false); renderer.setClearColor(0xf8fafb);
renderer.localClippingEnabled = true;
const kit = new Kit(await createMaterials("/")); await kit.load("/assets/kit.glb", "/assets/kit_manifest.json");
let model: Group | null = null;
let roofMode = false;
async function show(baysX: number, baysY: number, floors: number, type: 'freestanding' | 'row' | 'corner' = 'freestanding', mode: 'auto'|'courtyard'|'lightwell' = 'courtyard') {
  const p = { ...defaultParams(), layoutMode: mode, floorVariety: true, seed: 3, dimensionVersion: 'bays-v2' as const, baysX, baysY, floors, type, ballroom: false };
  const b = generateBuilding(p, kit), plan = planBuilding(b, p), audit = analyseCirculation(plan);
  select.innerHTML = plan.levels.map(lv => `<option value="${lv.index}">${lv.name}</option>`).join(''); select.value = '3';
  const court = b.topology.courtyardLayout;
  $('status').textContent = `${baysX}×${baysY}×${floors} · ${b.topology.mode} · 樓層多樣性開啟 · 種子 3 · ${plan.issues.length ? plan.issues.join('；') : '檢查通過'} · ${b.topology.cores.length} 核心` ;
  if (model) model.traverse(o => { const mesh = o as import('three').Mesh; if (mesh.isMesh) mesh.geometry.dispose(); });
  model = new Group(); model.add(buildRooms3d(plan, b, kit, cutaway.interior, 'diagram')); model.add(buildStairs(plan, cutaway.interior, cutaway.interior.iron, cutaway.interior.iron, 'diagram'));
  // Exterior kit geometry remains owned by Kit across fixture switches.
  const exterior = kit.buildGroup(b.placements);
  const cap = buildingRoofCap(b);
  const roofMesh = new Mesh(cap.geometry, new MeshStandardMaterial({ color: '#7a858e' }));
  model.add(roofMesh, new Mesh(courtyardClosure(b), new MeshStandardMaterial({color: "#d7cbb8"})));
  const region = buildingRoof(b), party = partyWalls(region.footprint, region.edgeKinds, b.roofBase);
  model.add(new Mesh(party.geometry, new MeshStandardMaterial({color:'#d7cbb8'})));
  const scene = new Scene(); scene.add(exterior); scene.add(model); scene.add(new HemisphereLight(0xffffff, 0x8895a0, 2.5));
  const light = new DirectionalLight(0xffffff, 2); light.position.set(10, -30, 100); scene.add(light);
  const draw = () => {
    const level = Number(select.value), lv = plan.levels[level], rows = plan.rooms.filter(r => r.level === level);
    svg.setAttribute('viewBox', `-1 -1 ${b.width + 2} ${b.length + 2}`);
    const namespace = 'http://www.w3.org/2000/svg'; svg.replaceChildren();
    const element = (name: string, attrs: Record<string, string>) => { const el = document.createElementNS(namespace, name); for (const [k,v] of Object.entries(attrs)) el.setAttribute(k,v); svg.append(el); return el; };
    rows.forEach(r => { element('polygon', { points: r.polygon.map(q => q.join(',')).join(' '), fill: ROOM_INFO[r.type].color, stroke: '#536776', 'stroke-width': '.03' });
      const x = (r.rect[0]+r.rect[2])/2, y = (r.rect[1]+r.rect[3])/2;
      const label = element('text', { x: String(x), y: String(y), 'font-size': '.48', 'text-anchor': 'middle' }); label.textContent = r.name;
      if (r.structuralId) { const id = element('text', { x: String(x), y: String(y+.65), 'font-size': '.29', 'text-anchor': 'middle' }); id.textContent = r.structuralId; }
    });
    for (const well of court ? [{ polygon: court.polygon, rect: court.court }] : b.topology.deepLayout?.wells ?? []) {
      element('polygon', { points: well.polygon.map(q => q.join(',')).join(' '), fill: '#d3edf7', stroke: '#288bac', 'stroke-width': '.1' });
      const label = element('text', { x: String((well.rect[0]+well.rect[2])/2), y: String((well.rect[1]+well.rect[3])/2), 'font-size': '.55', 'text-anchor': 'middle' }); label.textContent = court ? `${court.shape} 形中庭` : '採光井';;
    }
    plan.windows.filter(w => w.level === level && w.facadeId).forEach(w => element('line', { x1: String(w.at[0]-w.dir[0]*w.width/2), y1: String(w.at[1]-w.dir[1]*w.width/2), x2: String(w.at[0]+w.dir[0]*w.width/2), y2: String(w.at[1]+w.dir[1]*w.width/2), stroke: '#218db7', 'stroke-width': '.12' }));
    plan.walls.filter(w => w.level === level).forEach(w => w.openings.forEach(d => {
      const len = Math.hypot(w.b[0]-w.a[0],w.b[1]-w.a[1]), x = w.a[0]+(w.b[0]-w.a[0])*d.at/len, y = w.a[1]+(w.b[1]-w.a[1])*d.at/len;
      element('circle', { cx: String(x), cy: String(y), r: '.13', fill: '#fff', stroke: '#163c53', 'stroke-width': '.04' });
    }));
    const policy = plan.programStructure!.policies.find(p=>p.segment===plan.programStructure!.segments.find(s=>level>=s.first&&level<=s.last)!.id)!;
    const templates=plan.programStructure!.templates.filter(t=>t.level===level);
    $('templates').textContent=`分段 ${policy.segment} · 大戶翼 ${policy.largeWing ?? '無'} · ${policy.symmetric ? '左右共用抽值' : '獨立抽值'}。`+templates.map(t=>`${t.area}/${t.coreId}：${t.requested}→${t.resolved}，${t.count} 戶${t.reason ? '（'+t.reason+'）' : ''}`).join('；');
    const rs = audit.apartments.filter(a => a.level === level);
    $('evidence').textContent = `${lv.name}：${rs.length} 戶；各戶有效樓梯數 ${rs.map(a => a.effectiveStairIds.length).join('／')}。取樣最遠至較近樓梯 ${Math.max(...rs.map(a => a.furthestNearestStair)).toFixed(2)} m，至另一座 ${Math.max(...rs.map(a => a.furthestSecondStair ?? 0)).toFixed(2)} m。`;
    renderer.clippingPlanes = roofMode ? [new Plane(new Vector3(0,0,1), -b.wallTop + .02)] : [new Plane(new Vector3(0,0,-1), lv.floorZ + 2.5), new Plane(new Vector3(0,0,1), -lv.floorZ + .02)];
    const span = Math.max(b.width,b.length);
    const camera = new OrthographicCamera(-span*.65,span*.65,span*.585,-span*.585,.01,500);
    camera.up.set(0,0,1); camera.position.set(b.width/2,-b.length*.45,(roofMode ? cap.top : lv.floorZ)+span*1.2); camera.lookAt(b.width/2,b.length/2,roofMode ? b.wallTop : lv.floorZ);
    renderer.render(scene,camera);
  };
  select.onchange = draw; $('roof').onclick = () => { roofMode = !roofMode; $('roof').textContent = roofMode ? '檢視樓層' : '檢視屋頂'; draw(); }; draw();
}
$('small').onclick = () => { void show(14,5,10,'freestanding','auto'); }; $('deep').onclick = () => { void show(20,20,20,'freestanding','lightwell'); }; $('high').onclick = () => { void show(20,20,20); };
$('corner').onclick = () => { void show(12,16,8,'row'); };
await show(20,20,20);
