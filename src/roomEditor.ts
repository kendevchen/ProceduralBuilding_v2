import { CAFE_THEME_NAMES } from "./cafes";
/** Room-label selection and an automatically opened GUI, with touch multiselect. */
import type GUI from "lil-gui";
import { type Camera, Raycaster, Vector2 } from "three";
import { ROOM_INFO } from "./plan";
import { RoomEdits, editableRoom, roomTypesForLevel, mergeReason, type EditableRoomType, type EditedPlan } from "./roomEdits";
import type { RoomLabels } from "./roomLabels";
import type { SalonInfo, DiningInfo, KitchenInfo, CafeInfo } from "./furniture";

interface Host {
  canvas: HTMLCanvasElement;
  camera: Camera;
  gui: GUI;
  edits: RoomEdits;
  labels(): RoomLabels | null;
  rebuild(): void;
}
const choicesForLevel = (level: number) => Object.fromEntries(roomTypesForLevel(level).map(type => [ROOM_INFO[type].name, type]));

export class RoomEditor {
  private folder: GUI | null = null;
  private selection: string[][] = [];
  private ids: string[] = [];
  private result: EditedPlan | null = null;
  private salon: SalonInfo | null = null;
  private dining: DiningInfo | null = null;
  private kitchen: KitchenInfo | null = null;
  private cafe: CafeInfo | null = null;
  private ray = new Raycaster();
  private consumed = new WeakSet<Event>();
  private pointers = new Set<number>();
  private press: { id: number; x: number; y: number; room: string | null; shift: boolean; touch: boolean; held: boolean } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private touchMulti = false;
  private message = "";

  constructor(private host: Host) {
    const canvas = host.canvas;
    canvas.addEventListener("pointerdown", e => {
      this.pointers.add(e.pointerId);
      this.cancelPress();
      if (this.pointers.size > 1 || e.button !== 0) return;
      const room = this.pick(e);
      this.press = { id: e.pointerId, x: e.clientX, y: e.clientY, room, shift: e.shiftKey, touch: e.pointerType === "touch", held: false };
      if (room && e.pointerType === "touch") this.timer = setTimeout(() => {
        if (!this.press || this.pointers.size !== 1) return;
        this.press.held = true;
        this.touchMulti = true;
        if (this.ids.includes(room)) this.render(true); else this.choose(room, true);
      }, 500);
    }, true);
    canvas.addEventListener("pointermove", e => {
      if (this.press && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 8) this.cancelPress();
    }, true);
    canvas.addEventListener("pointerup", e => {
      const press = this.press;
      this.pointers.delete(e.pointerId);
      this.cancelPress();
      if (!press || press.id !== e.pointerId || Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) return;
      if (press.room) {
        this.consumed.add(e);
        if (!press.held) this.choose(press.room, press.shift || (press.touch && this.touchMulti));
      } else this.clearSelection();
    }, true);
    canvas.addEventListener("pointercancel", e => { this.pointers.delete(e.pointerId); this.cancelPress(); }, true);
    canvas.addEventListener("contextmenu", e => { if (this.pick(e) || this.touchMulti) e.preventDefault(); });
    addEventListener("keydown", e => { if (e.key === "Escape") this.clearSelection(); });
  }

  consumedEvent(e: Event): boolean { return this.consumed.has(e); }
  private cancelPress() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null; this.press = null;
  }
  private pick(e: { clientX: number; clientY: number }): string | null {
    const labels = this.host.labels();
    if (!labels) return null;
    const r = this.host.canvas.getBoundingClientRect();
    this.host.camera.updateWorldMatrix(true, false);
    this.ray.setFromCamera(new Vector2((e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2), this.host.camera);
    return labels.pick(this.ray);
  }

  update(result: EditedPlan | null, salon: SalonInfo | null = null, dining: DiningInfo | null = null, kitchen: KitchenInfo | null = null, cafe: CafeInfo | null = null): void {
    this.result = result;
    this.salon = salon;
    this.dining = dining;
    this.kitchen = kitchen;
    this.cafe = cafe;
    this.ids = [];
    if (result) for (const keys of this.selection) {
      const entry = [...result.members].find(([, values]) => values.length === keys.length && values.every((v, i) => v === keys[i]));
      if (entry) this.ids.push(entry[0]);
    }
    this.selection = this.ids.map(id => result!.members.get(id)!);
    this.host.labels()?.select(this.ids);
    this.render(false);
  }

  private choose(id: string, add: boolean): void {
    if (!this.result?.members.has(id)) return;
    this.message = "";
    if (!add) this.ids = [id];
    else if (this.ids.includes(id)) this.ids = this.ids.filter(v => v !== id);
    else if (this.ids.length < 2) this.ids.push(id);
    else this.message = "一次合併兩間房間，請先取消其中一間的選取。";
    this.selection = this.ids.map(id => this.result!.members.get(id)!);
    this.host.labels()?.select(this.ids);
    this.render(true);
  }
  clearSelection(): void {
    this.ids = []; this.selection = []; this.touchMulti = false; this.message = "";
    this.host.labels()?.select([]);
    this.render(false);
  }
  private act(action: () => void): void {
    try { action(); this.message = ""; this.host.rebuild(); }
    catch (error) { this.message = (error as Error).message; this.render(true); }
  }

  private render(open: boolean): void {
    const wasOpen = this.folder ? !this.folder._closed : false;
    this.folder?.destroy();
    const folder = this.folder = this.host.gui.addFolder("房間編輯");
    const result = this.result, edits = this.host.edits;
    const info = (text: string) => {
      const p = document.createElement("p"); p.textContent = text; p.setAttribute("role", "status");
      p.style.cssText = "margin:8px 10px;line-height:1.5;white-space:normal;font-size:12px";
      folder.domElement.appendChild(p);
    };
    const rooms = this.ids.map(id => result?.plan.rooms.find(r => r.id === id)).filter(r => !!r);
    if (rooms.length === 1) {
      const room = rooms[0];
      info(`${result!.plan.levels[room.level].name} · ${room.name} · ${room.area.toFixed(1)} m²`);
      if (room.type === "shop") {
        const cafe = this.cafe?.rooms[room.id];
        if (cafe) {
          info(CAFE_THEME_NAMES[cafe.theme]);
          info(cafe.furnished
            ? `咖啡店：室內 ${cafe.tables} 桌／${cafe.chairs} 椅、吧台、木質背牆與菜單、${cafe.stools} 張吧台椅${cafe.cabinet ? "、展示櫃" : ""}；戶外 ${cafe.outdoorTables} 桌／${cafe.outdoorChairs} 椅。`
            : `此店面的實牆與門窗配置無法容納吧台及服務通道；戶外 ${cafe.outdoorTables} 桌／${cafe.outdoorChairs} 椅。`);
        }
      }
      if (editableRoom(room)) {
        const state = { type: room.type };
        const choices = choicesForLevel(room.level);
        const options = room.type === "maid" ? { ...choices, "閣樓房（原始）": "maid" } : choices;
        folder.add(state, "type", options).name("房間種類").onChange((value: EditableRoomType) => this.act(() => edits.setType(room.id, value)));
        folder.add({ restore: () => this.act(() => edits.restoreType(room.id)) }, "restore").name("恢復原始房型");
        if (room.type === "salon") info(this.salon?.furnished.includes(room.id)
          ? `客廳家具${this.salon.scales[room.id] < 1 ? "（依空間採緊湊尺寸）" : ""}：沙發、桌組、壁爐書櫃與掛畫。`
          : "目前客廳的輪廓、門窗或淨高無法安全容納完整家具組。");
        else if (room.type === "dining") {
          const furniture = this.dining?.rooms[room.id];
          info(furniture ? `餐廳：長桌、${furniture.chairs} 張餐椅、地毯、餐邊櫃、掛畫與兩盆花${furniture.displayCabinets ? `，搭配 ${furniture.displayCabinets} 座餐具高櫃` : ""}。`
            : "此餐廳的輪廓、門窗或淨高無法安全容納家具及拉椅空間。");
        }
        else if (room.type === "kitchen" || (room.type === "shopBack" && room.level === 0)) {
          const furniture = this.kitchen?.rooms[room.id];
          info(furniture ? `${room.type === "shopBack" ? "店面後場" : "廚房"}：沿牆廚具 ${furniture.wallLength.toFixed(2)} m、瓦斯爐烤箱、排煙罩${furniture.hasIsland ? "、水槽中島" : "（門窗與通道限制，本室不放中島）"}${room.type === "kitchen" ? "及黑白石磚地板" : "（保留原地板）"}${furniture.hasIsland ? `；工作通道 ${Math.round(furniture.aisle * 100)} cm` : ""}${furniture.displayCabinets ? `，對面 ${furniture.displayCabinets} 座餐具展示櫃` : ""}。`
              : "目前空間無法容納完整廚具與獨立中島的通道；可調整房間或另行規劃半島。");
        }
        else if (room.type === "shop") info("更換房型後同步更新咖啡店家具、牆面與地板；店面僅限一樓。戶外桌椅依原有店面開口配置。");
        else info(room.type === "bedroom" || room.type === "study" ? "更換後同步更新家具、牆面與地板。" : "此房型尚無家具，會套用對應牆面與地板。");
      } else info("此空間連動樓梯、入口或建築結構，保留原始用途。");
    } else if (rooms.length === 2 && result) {
      info(rooms.map(r => `${result.plan.levels[r.level].name} ${r.name}`).join(" ＋ "));
      const reason = mergeReason(result.plan, this.ids);
      if (reason) info(reason);
      else {
        info(`目前合計 ${(rooms[0].area + rooms[1].area).toFixed(1)} m²；合併後再加回拆牆面積。請選擇合併後的房型。`);
        const state = { type: "" };
        const type = folder.add(state, "type", { "請選擇房型": "", ...choicesForLevel(rooms[0].level) }).name("合併後房型");
        const merge = folder.add({ merge: () => this.act(() => {
          const members = edits.merge([this.ids[0], this.ids[1]], state.type as EditableRoomType);
          this.selection = [members]; this.touchMulti = false;
        }) }, "merge").name("合併兩間房間").disable();
        type.onChange((value: string) => { if (value) merge.enable(); else merge.disable(); });
      }
    } else info("點房間名稱更換房型。Shift＋點擊多選；手機長按進入多選，再點另一間。");
    if (this.message) info(this.message);
    if (this.touchMulti) info("手機多選中：點標籤加選或取消，按下方按鈕結束。");
    if (rooms.length || this.touchMulti) folder.add({ clear: () => this.clearSelection() }, "clear").name("取消選取／結束多選");
    const undo = folder.add({ undo: () => this.act(() => edits.undo()) }, "undo").name("復原上一步");
    const redo = folder.add({ redo: () => this.act(() => edits.redo()) }, "redo").name("重做");
    if (!edits.canUndo) undo.disable();
    if (!edits.canRedo) redo.disable();
    if (edits.count) folder.add({ clear: () => this.act(() => edits.clear()) }, "clear").name("清除房間編輯（可復原）");
    if (result?.suspended.length) info(`${result.suspended.length} 筆編輯因平面改變暫停套用；恢復原配置可重新套用。`);
    if (result?.warnings.length) info(`用途提醒：${result.warnings.slice(0, 3).join("；")}`);
    if (open || wasOpen) folder.open(); else folder.close();
    if (open) {
      this.host.gui.open();
      folder.domElement.scrollIntoView({ block: "nearest" });
    }
  }
}
