/**
 * Setting the facade details of one window on its own: click a window (a click,
 * not a drag of the camera) to select it; it gets an outline, and the GUI shows
 * a folder with the same controls as 立面細節 for it alone. Every control can
 * follow the global setting; what is set is kept in params.facade, by the
 * window's key (generator.ts windowKey), and survives rebuilds.
 */
import type GUI from "lil-gui";
import {
  BoxGeometry, type Camera, EdgesGeometry, type Group, type InstancedMesh, LineBasicMaterial, LineSegments, Matrix4,
  type Object3D, type Plane, Ray, Raycaster, Vector2, Vector3,
} from "three";
import type { Building, WindowSlot } from "./generator";
import { type BuildingParams, type WindowOverride, defaultParams } from "./params";

const AUTO = "auto";
const SIDES = ["正面", "右側", "背面", "左側"];

/** the choices of each control: label -> value, "auto" following the global setting */
const CHOICES = {
  ornament: { "沿用全域": AUTO, "0 無裝飾": "0", "1 只有窗套": "1", "2 奧斯曼層級": "2", "3 豐富": "3" },
  head: { "沿用全域": AUTO, "不放": "none", "三角山花": "triangle", "弧形": "segment", "平窗楣": "cornice", "平窗楣加托架": "cornice_consoles", "拱心石": "keystone" },
  balcony: { "沿用全域": AUTO, "窗前欄杆": "gardecorps", "單窗陽台": "balconnet", "連續陽台": "continuous" },
  consoles: { "沿用全域": AUTO, "有": "on", "沒有": "off" },
  detail: { "沿用全域": AUTO, "不放": "none", "橫向溝槽": "refends", "壁柱": "pilasters", "浮雕飾板": "panels" },
  shutters: { "沿用全域": AUTO, "全開": "open", "左扇關": "left", "右扇關": "right", "全關": "closed" },
  window: { "沿用全域": AUTO, "關": "closed", "開": "open" },
  dir: { "沿用全域": AUTO, "內開": "in", "外開": "out" },
  curtain: { "沿用全域": AUTO, "無窗簾": "none", "拉上": "closed", "拉開": "open" },
  ground: { "沿用全域": AUTO, "拱窗": "arched", "方窗": "rect" },
  door: { "沿用全域": AUTO, "拱形馬車大門": "arched", "方形馬車大門": "rect", "玻璃大門": "glazed" },
  dormer: { "沿用全域": AUTO, "不放": "none", "鋅板": "zinc", "圓窗": "oeil", "弧頂": "segment", "三角山花": "triangle", "大玻璃落地窗": "studio", "大玻璃窗（平頂）": "atelier" },
} as const;

type Field = keyof typeof CHOICES;

export interface WindowEditorHost {
  canvas: HTMLCanvasElement;
  camera: Camera;
  gui: GUI;
  params: BuildingParams;
  /** the building group on show (null in the kit overview or the plan view) */
  shown(): Group | null;
  /** the section plane while the building is cut open, else null */
  clip(): Plane | null;
  rebuild(): void;
  ignorePointer?(event: PointerEvent): boolean;
}

export class WindowEditor {
  private building: Building | null = null;
  private selected: WindowSlot | null = null;
  private folder: GUI | null = null;
  private outline = new LineSegments(new EdgesGeometry(new BoxGeometry(1, 1, 1)),
    new LineBasicMaterial({ color: 0xff8a3d, depthTest: false, transparent: true }));
  private ray = new Raycaster();
  private down: { x: number; y: number } | null = null;

  constructor(private host: WindowEditorHost) {
    this.outline.renderOrder = 999;
    this.outline.matrixAutoUpdate = false;
    this.outline.visible = false;
    host.canvas.addEventListener("pointerdown", e => (this.down = { x: e.clientX, y: e.clientY }));
    host.canvas.addEventListener("pointerup", e => {
      const d = this.down;
      this.down = null;
      if (this.host.ignorePointer?.(e)) return;
      // a click: the camera did not move with it
      if (d && e.button === 0 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) this.pick(e);
    });
    addEventListener("keydown", e => {
      if (e.key === "Escape") this.select(null);
    });
  }

  /** after every rebuild: the new building, its group (the outline goes in it), the selection kept */
  update(b: Building | null, group: Group | null): void {
    this.building = b;
    if (group) group.add(this.outline);
    const key = this.selected?.key;
    const slot = key ? b?.windows.find(w => w.key === key) ?? null : null;
    if (slot && this.folder) {
      // the same window: keep its folder, so a slider being dragged goes on working
      this.selected = slot;
      this.place(slot);
      return;
    }
    this.selected = null;
    this.select(slot, false);
  }

  /** the outline round a window's opening */
  private place(slot: WindowSlot): void {
    const pad = 0.08;
    const box = new Matrix4().makeTranslation(0, -0.03, (slot.z0 + slot.z1) / 2)
      .multiply(new Matrix4().makeScale(2 * (slot.half + pad), 0.3, slot.z1 - slot.z0 + 2 * pad));
    this.outline.matrix.copy(slot.matrix).multiply(box);
    this.outline.matrixWorldNeedsUpdate = true;
  }

  /** forget every window's own settings */
  clearAll(): void {
    this.host.params.facade = defaultParams().facade; // back to the defaults, not to nothing
    this.host.rebuild();
  }

  private pick(e: PointerEvent): void {
    const group = this.host.shown();
    if (!group || !this.building) return;
    const r = this.host.canvas.getBoundingClientRect();
    const ndc = new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.host.camera);
    const targets: Object3D[] = [];
    group.traverseVisible(o => {
      if ((o as InstancedMesh).isInstancedMesh || (o as { isMesh?: boolean }).isMesh) targets.push(o);
    });
    const clip = this.host.clip();
    const kept = (p: Vector3) => !clip || clip.distanceToPoint(p) >= 0;
    // the nearest part of a window (frame, shutter, balcony...)
    let best: { d: number; key: string } | null = null;
    for (const h of this.ray.intersectObjects(targets, false)) {
      const tags = h.object.userData.tags as (string | undefined)[] | undefined;
      const key = tags && h.instanceId !== undefined ? tags[h.instanceId] : undefined;
      if (key && kept(h.point)) {
        best = { d: h.distance, key };
        break;
      }
    }
    // or an opening itself: an open window has no glass in it
    const inv = new Matrix4(), local = new Ray(), at = new Vector3();
    for (const w of this.building.windows) {
      const m = new Matrix4().multiplyMatrices(group.matrixWorld, w.matrix);
      local.copy(this.ray.ray).applyMatrix4(inv.copy(m).invert());
      if (Math.abs(local.direction.y) < 1e-6) continue;
      const t = -local.origin.y / local.direction.y;
      if (t <= 0) continue;
      local.at(t, at);
      if (Math.abs(at.x) > w.half || at.z < w.z0 || at.z > w.z1) continue;
      const p = at.clone().applyMatrix4(m);
      const d = p.distanceTo(this.ray.ray.origin);
      if (kept(p) && (!best || d < best.d - 0.05)) best = { d, key: w.key };
    }
    this.select(best ? this.building.windows.find(w => w.key === best!.key) ?? null : null);
  }

  private select(slot: WindowSlot | null, fresh = true): void {
    if (fresh && slot?.key === this.selected?.key) return;
    this.selected = slot;
    this.folder?.destroy();
    this.folder = null;
    this.outline.visible = !!slot;
    if (!slot) return;
    this.place(slot);
    this.buildFolder(slot);
  }

  private buildFolder(slot: WindowSlot): void {
    const p = this.host.params;
    const [side, bay, row] = slot.key.split("|");
    const floor = row === "g" ? "1F" : row === "r" ? slot.facadeId ? "閣樓" : "閣樓（老虎窗）" : `${Number(row) + 2}F`;
    const where = `${slot.facadeId ? slot.facadeId.startsWith("court:") ? "中庭內側" : "採光井內側" : SIDES[Number(side)] ?? ""} ${bay === "-1" ? "斜切轉角" : `第 ${Number(bay) + 1} 開間`} · ${floor}`;
    const f = this.host.gui.addFolder(`🎯 選取的窗戶：${where}`);
    this.folder = f;
    // at the top of the GUI, which opens if it was folded
    this.host.gui.$children.prepend(f.domElement);
    this.host.gui.open();
    f.open();
    const own = (): WindowOverride => p.facade[slot.key] ?? {};
    const set = (patch: Partial<Record<keyof WindowOverride, unknown>>) => {
      const next: Record<string, unknown> = { ...own(), ...patch };
      for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
      if (Object.keys(next).length) p.facade[slot.key] = next as WindowOverride;
      else delete p.facade[slot.key];
      this.host.rebuild();
    };
    const state: Record<string, string | number> = {};
    const choice = (field: Field, name: string, read: (o: WindowOverride) => unknown, write: (v: string) => unknown) => {
      const v = read(own());
      state[field] = v === undefined ? AUTO : String(v);
      f.add(state, field, CHOICES[field]).name(name).onChange((value: string) => set({ [field]: value === AUTO ? undefined : write(value) }));
    };
    const plain = (field: Field, name: string) => choice(field, name, o => o[field as keyof WindowOverride], v => v);

    if (slot.kind === "upper") {
      if (!slot.facadeId) {
        choice("ornament", "裝飾層級", o => o.ornament, v => Number(v));
        plain("head", "窗楣");
        plain("balcony", "陽台");
        choice("consoles", "陽台托架", o => (o.consoles === undefined ? undefined : o.consoles ? "on" : "off"), v => v === "on");
        plain("detail", "窗間壁裝飾");
      }
      plain("shutters", "百葉");
      plain("window", "窗戶");
      plain("dir", "開窗方向");
      state.angle = own().angle ?? p.windowAngle;
      f.add(state, "angle", 10, 110, 1).name("開窗角度 °").onFinishChange((v: number) => set({ angle: v }));
    } else if (slot.kind === "ground") {
      plain("ground", "一樓窗");
    } else if (slot.kind === "door") {
      plain("door", "大門款式");
    } else if (slot.kind === "dormer") {
      plain("dormer", "老虎窗款式");
    }
    if (slot.kind !== "door" && slot.kind !== "shop" && slot.kind !== "dormer") {
      plain("curtain", "窗簾");
      state.curtainOpen = own().curtainOpen ?? p.curtainOpen;
      f.add(state, "curtainOpen", 0, 1, 0.01).name("窗簾拉開程度").onFinishChange((v: number) => set({ curtainOpen: v }));
    }
    if (slot.kind === "shop") f.add({ note: "店面沒有個別設定" }, "note").name("說明").disable();

    const copyTo = (match: (k: string[]) => boolean) => {
      const o = own();
      for (const w of this.building?.windows ?? []) {
        if (w.key === slot.key || w.kind !== slot.kind || !match(w.key.split("|"))) continue;
        if (Object.keys(o).length) p.facade[w.key] = { ...o };
        else delete p.facade[w.key];
      }
      this.host.rebuild();
    };
    const actions = {
      column: () => copyTo(k => k[0] === side && k[1] === bay),
      row: () => copyTo(k => k[0] === side && k[2] === row),
      reset: () => {
        set(Object.fromEntries(Object.keys(own()).map(k => [k, undefined])));
        // the controls show the global settings again
        this.folder?.destroy();
        this.buildFolder(this.selected ?? slot);
      },
      close: () => this.select(null),
    };
    if (slot.kind === "upper") f.add(actions, "column").name("套用到整欄（所有樓層）");
    f.add(actions, "row").name("套用到整排（同一層）");
    f.add(actions, "reset").name("還原這扇窗（沿用全域）");
    f.add(actions, "close").name("取消選取");
  }
}
