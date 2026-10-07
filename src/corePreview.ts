/** Developer-only visual acceptance fixture; production GUI limits are unchanged. */
import { Scene, WebGLRenderer, OrthographicCamera, HemisphereLight, DirectionalLight, Plane, Vector3, Group } from 'three';
import { defaultParams } from './params';
import { generateBuilding } from './generator';
import { planBuilding, ROOM_INFO } from './plan';
import { analyseCirculation } from './planning/circulation';
import { buildRooms3d } from './rooms3d';
import { buildStairs } from './stairs';
import { Cutaway } from './cutaway';
import { Kit } from './kit';
import { createMaterials } from './materials';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const svg = document.getElementById('plan')!;
const select = $<HTMLSelectElement>('level'), cutaway = new Cutaway();
cutaway.plane.constant = 10000;
const renderer = new WebGLRenderer({ canvas: $<HTMLCanvasElement>('three'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(500, 450, false); renderer.setClearColor(0xf8fafb);
renderer.localClippingEnabled = true;
const kit = new Kit(await createMaterials("/")); await kit.load("/assets/kit.glb", "/assets/kit_manifest.json");
let model: Group | null = null, floors = 10;
async function show(floorsRequested: number) {
  floors = floorsRequested;
  const p = { ...defaultParams(), layoutMode: 'auto' as const, baysX: 14, baysY: 5, floors, floorVariety: true };
  const b = generateBuilding(p, kit), plan = planBuilding(b, p), audit = analyseCirculation(plan);
  select.innerHTML = plan.levels.map(lv => `<option value="${lv.index}">${lv.name}</option>`).join(''); select.value = '3';
  $('status').textContent = `${plan.issues.length ? plan.issues.join('；') : '檢查通過'} · ${b.topology.cores.length} 核心 · ${audit.effectiveStairIds.length} 座連續至戶外的樓梯 · ${b.topology.cores.flatMap(c => c.elevatorIds ?? []).length} 座電梯`;
  if (model) model.traverse(o => { const mesh = o as import('three').Mesh; if (mesh.isMesh) mesh.geometry.dispose(); });
  model = new Group(); model.add(buildRooms3d(plan, b, kit, cutaway.interior, 'diagram')); model.add(buildStairs(plan, cutaway.interior, cutaway.interior.iron, cutaway.interior.iron, 'diagram'));
  const scene = new Scene(); scene.add(model); scene.add(new HemisphereLight(0xffffff, 0x8895a0, 2.5));
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
    plan.walls.filter(w => w.level === level).forEach(w => w.openings.forEach(d => {
      const len = Math.hypot(w.b[0]-w.a[0],w.b[1]-w.a[1]), x = w.a[0]+(w.b[0]-w.a[0])*d.at/len, y = w.a[1]+(w.b[1]-w.a[1])*d.at/len;
      element('circle', { cx: String(x), cy: String(y), r: '.13', fill: '#fff', stroke: '#163c53', 'stroke-width': '.04' });
    }));
    const rs = audit.apartments.filter(a => a.level === level);
    $('evidence').textContent = `${lv.name}：${rs.length} 戶；各戶有效樓梯數 ${rs.map(a => a.effectiveStairIds.length).join('／')}。取樣最遠至較近樓梯 ${Math.max(...rs.map(a => a.furthestNearestStair)).toFixed(2)} m，至另一座 ${Math.max(...rs.map(a => a.furthestSecondStair ?? 0)).toFixed(2)} m。`;
    renderer.clippingPlanes = [new Plane(new Vector3(0,0,-1), lv.floorZ + 2.5), new Plane(new Vector3(0,0,1), -lv.floorZ + .02)];
    const camera = new OrthographicCamera(-b.width*.55,b.width*.55,b.width*.495,-b.width*.495,.01,200);
    camera.up.set(0,0,1); camera.position.set(b.width/2,-b.length*.8,lv.floorZ+35); camera.lookAt(b.width/2,b.length/2,lv.floorZ);
    renderer.render(scene,camera);
  };
  select.onchange = draw; draw();
}
$('ten').onclick = () => { void show(10); }; $('twenty').onclick = () => { void show(20); };
await show(floors);
