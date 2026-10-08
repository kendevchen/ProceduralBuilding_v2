/** Developer acceptance page: invokes the real main scene through visible controls. */
import type { Group, PerspectiveCamera, WebGLRenderer, Scene } from 'three';
import type { BuildingParams } from './params';
import { defaultParams } from './params';
import type { BuildingPlan } from './plan';
import type { RoomEditor } from './roomEditor';

interface App {
  params: BuildingParams; plan: BuildingPlan | null; scene: Scene; renderer: WebGLRenderer; camera: PerspectiveCamera;
  controls: { target: import('three').Vector3; update(): void }; cut: { on: boolean; t: number; mode: string; axis: string };
  bounds: { min: import('three').Vector3; max: import('three').Vector3 };
  unfold: { selected: boolean }; view: { gallery: boolean; furnitureGallery: boolean };
  interiorView: { plan: boolean }; roomEditor: RoomEditor;
  rebuild(frame?: boolean, fresh?: boolean): void;
  applyCut(force?: boolean): void; frameHome(): void; refreshGui(): void;
  rebuildMetrics: { count: number; interiorBuilds: number; last: { cpuMs: number; prepareMs: number }; frames: number[] };
  pipelineCounts: Record<string, number>; unfoldView: { group: Group } | null;
  renderSettings: Record<string, unknown>;
}
const app = () => (window as unknown as { __app: App }).__app;
const fixtures: Record<string, Partial<BuildingParams>> = {
  '預設': {}, '舊上限 10×8×6': { baysX: 10, baysY: 8, floors: 6 },
  '20×20×20 中庭': { baysX: 20, baysY: 20, floors: 20, layoutMode: 'auto', dimensionVersion: 'bays-v2', ballroom: false },
  '20×20×20 中庭多樣性': { baysX: 20, baysY: 20, floors: 20, layoutMode: 'auto', dimensionVersion: 'bays-v2', ballroom: false, floorVariety: true, seed: 3 },
  '20×20×20 採光井': { baysX: 20, baysY: 20, floors: 20, layoutMode: 'lightwell', dimensionVersion: 'bays-v2', ballroom: false },
};
const panel = document.createElement('aside');
panel.style.cssText = 'position:fixed;left:12px;top:12px;z-index:10000;width:320px;max-height:42vh;overflow:auto;background:#18232ee8;color:white;padding:12px;font:12px system-ui;border-radius:8px';
const title = document.createElement('b'); title.textContent = 'P7 主程式性能驗收'; panel.append(title, document.createElement('br'));
const select = document.createElement('select'); select.setAttribute('aria-label', '性能案例');
for (const name of Object.keys(fixtures)) select.add(new Option(name, name)); panel.append(select);
const output = document.createElement('pre'); output.setAttribute('role', 'status'); output.style.cssText = 'white-space:pre-wrap;font-size:11px';
const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1] };
};
let busy = false, report: unknown;
const tick = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
function stats() {
  const a = app(), buffers = new Set<ArrayBufferLike>(); let triangles = 0, meshes = 0, sprites = 0, visibleSprites = 0;
  a.scene.traverse(o => {
    if ((o as import('three').Sprite).isSprite) {
      sprites++; if (o.visible) visibleSprites++;
    }
    const mesh = o as import('three').Mesh & { isInstancedMesh?: boolean; count?: number };
    if (!mesh.isMesh) return;
    for (let parent: import('three').Object3D | null = mesh; parent; parent = parent.parent) if (!parent.visible) return;
    const geometry = mesh.geometry; meshes++;
    triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3 * (mesh.isInstancedMesh ? mesh.count! : 1);
    for (const attribute of Object.values(geometry.attributes)) buffers.add(attribute.array.buffer);
    if (geometry.index) buffers.add(geometry.index.array.buffer);
    if (mesh.isInstancedMesh) buffers.add((mesh as unknown as import('three').InstancedMesh).instanceMatrix.array.buffer);
  });
  return { rooms: a.plan?.rooms.length, issues: a.plan?.issues, sprites, visibleSprites, meshes, submittedTriangles: triangles,
    geometryBytes: [...buffers].reduce((sum, b) => sum + b.byteLength, 0), renderer: { memory: { ...a.renderer.info.memory }, render: { ...a.renderer.info.render }, programs: a.renderer.info.programs?.length },
    rebuilds: a.rebuildMetrics.count, interiorBuilds: a.rebuildMetrics.interiorBuilds, caches: a.pipelineCounts, last: a.rebuildMetrics.last };
}
function display(extra?: unknown) { output.textContent = JSON.stringify(extra ?? stats(), null, 2); }
function button(name: string, action: () => void | Promise<void>) {
  const b = document.createElement('button'); b.textContent = name; b.onclick = () => { if (!busy) void action(); }; panel.append(b);
}
button('載入案例', async () => {
  await tick();
  const a = app(); Object.assign(a.params, { dimensionVersion: undefined, layoutMode: undefined, floorVariety: undefined }, defaultParams(), fixtures[select.value]);
  a.view.gallery = a.view.furnitureGallery = a.interiorView.plan = false;
  a.cut.on = true; a.cut.mode = 'horizontal'; a.cut.t = .25; a.unfold.selected = false;
  a.rebuild(false, true); a.refreshGui(); a.frameHome(); display();
});
button('更新數據', () => display());
button('俯視 3F', () => {
  const a = app(), plan = a.plan; if (!plan) return;
  const level = plan.levels[Math.min(2, plan.levels.length - 1)], at = level.floorZ + 1.5;
  a.unfold.selected = false; a.cut.on = true; a.cut.mode = 'horizontal';
  a.cut.t = (at - a.bounds.min.y) / (a.bounds.max.y - a.bounds.min.y); a.applyCut(true);
  a.controls.target.set(0, at, 0);
  a.camera.position.set(0, at + Math.max(plan.width / a.camera.aspect, plan.length) / (2 * Math.tan(a.camera.fov * Math.PI / 360)) * 1.12, .01);
  a.controls.update(); display();
});
button('冷重建', async () => { await tick(); app().rebuild(false, true); display(); });
button('CPU 5暖機＋30次', async () => {
  busy = true; const cpu: number[] = [], prepare: number[] = [], renderSubmission: number[] = [], frame: number[] = [];
  const a = app(), id = JSON.stringify(a.params), cold = { ...a.rebuildMetrics.last };
  // Render counts include every scene/shadow/post-processing pass of the normal animation loop.
  const autoReset = a.renderer.info.autoReset; a.renderer.info.autoReset = false;
  try {
    await tick();
    for (let i = 0; i < 35; i++) {
      if (JSON.stringify(a.params) !== id) throw new Error('案例已改變，停止取樣');
      output.textContent = `取樣 ${i + 1}/35；整棟同步重建，不分層`;
      a.rebuild(false, true);
      const value = { ...a.rebuildMetrics.last }, before = performance.now();
      await tick(); await tick();
      if (i >= 5) { cpu.push(value.cpuMs); prepare.push(value.prepareMs); frame.push(performance.now() - before); renderSubmission.push(a.rebuildMetrics.frames.at(-1)!); }
    }
    report = { fixture: select.value, warmup: 5, samples: 30, coldCPU: cold, cpuMs: summary(cpu), prepareMs: summary(prepare),
      renderSubmissionCpuMs: summary(renderSubmission), twoAnimationFramesMs: summary(frame), samplesRaw: { cpu, prepare, renderSubmission, frame }, stats: stats(),
      environment: { browser: navigator.userAgent, viewport: [innerWidth, innerHeight], pixelRatio: a.renderer.getPixelRatio(), shadows: a.renderer.shadowMap.enabled, ...a.renderSettings },
      scope: '完整 main.ts 外觀＋結構／平面／checker＋編輯重套＋室內／樓梯／家具＋標籤／街景 CPU；不含資產載入與 GPU 執行時間。renderSubmissionCpuMs 是 renderer 提交，非 GPU timer；twoAnimationFramesMs 含排程、上傳及呈現等待，不宣稱純 GPU 時間。' };
    display(report);
  } catch (error) { output.textContent = (error as Error).message; }
  finally { busy = false; a.renderer.info.autoReset = autoReset; }
});
button('保存報告', () => {
  const blob = new Blob([JSON.stringify(report ?? stats(), null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'P7-browser-performance.json'; link.click(); URL.revokeObjectURL(link.href);
});
panel.append(output); document.body.append(panel);
const refresh = setInterval(() => { if (app()?.plan && !busy) { clearInterval(refresh); display(); } }, 250);
