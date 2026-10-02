/**
 * The section panel and the bottom toolbar (INTERIOR_SPEC.md §2.1, §2.2),
 * after the user's reference screenshots:
 *   panel   剖開建築: 縱剖 / 水平, a slider, 換方向 (vertical cuts), 自動掃描, the legend, ✕
 *   toolbar 下一座 | 旋轉 剖切 歸位 輸出
 * Plain DOM; main.ts owns the state and gets the user's actions through the callbacks.
 */
import type { CutAxis, CutMode } from "./cutaway";

export interface ToolbarActions {
  next(): void;
  rotate(on: boolean): void;
  cut(on: boolean): void;
  home(): void;
  save(): void;
  mode(m: CutMode): void;
  axis(a: CutAxis): void;
  /** vertical cuts: keep the other side of the plane */
  flip(on: boolean): void;
  slide(t: number): void;
  sweep(on: boolean): void;
}

const CSS = /* css */ `
.tb { position: fixed; left: 0; right: 0; bottom: 0; z-index: 60; height: 64px; display: flex; align-items: center;
  gap: 6px; padding: 0 16px; background: rgba(16, 16, 16, 0.94); border-top: 1px solid rgba(255, 255, 255, 0.1);
  font: 500 16px/1 system-ui, -apple-system, "PingFang TC", "Noto Sans TC", sans-serif; color: #e9e9e9;
  overflow-x: auto; scrollbar-width: none; }
.tb button { flex: none; height: 44px; padding: 0 16px; display: flex; align-items: center; gap: 9px; border: 0;
  border-radius: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.tb button:hover { background: rgba(255, 255, 255, 0.07); }
.tb button.on { background: rgba(255, 255, 255, 0.13); }
.tb button.primary { background: #e7e7e7; color: #121212; font-weight: 600; padding: 0 22px; }
.tb button.primary:hover { background: #ffffff; }
.tb button:disabled { opacity: 0.35; cursor: default; }
.tb .sep { flex: none; width: 1px; height: 28px; margin: 0 8px; background: rgba(255, 255, 255, 0.16); }
.tb svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.cut { position: fixed; left: 16px; bottom: 80px; z-index: 61; width: min(430px, calc(100vw - 32px));
  padding: 16px 18px 14px; border-radius: 8px; background: rgba(22, 22, 22, 0.95); border: 1px solid rgba(255, 255, 255, 0.13);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45); color: #ececec;
  font: 500 15px/1.3 system-ui, -apple-system, "PingFang TC", "Noto Sans TC", sans-serif; }
.cut[hidden] { display: none; }
.cut .head { display: flex; align-items: center; gap: 10px; }
.cut .dot { flex: none; width: 11px; height: 11px; background: #d9824f; }
.cut .title { flex: 1; font-size: 18px; font-weight: 600; letter-spacing: 0.02em; }
.cut .seg { display: flex; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 4px; overflow: hidden; }
.cut .seg button { padding: 7px 15px; border: 0; background: transparent; color: #dcdcdc; font: inherit; font-size: 16px; cursor: pointer; }
.cut .seg button.on { background: #e7e7e7; color: #121212; }
.cut .close { width: 34px; height: 34px; border: 0; background: transparent; color: #ddd; font-size: 22px; cursor: pointer; }
.cut .row { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
.cut .end { flex: none; min-width: 1.4em; color: #bdbdbd; text-align: center; }
.cut input[type=range] { flex: 1; height: 22px; margin: 0; background: transparent; -webkit-appearance: none; appearance: none; cursor: pointer; }
.cut input[type=range]::-webkit-slider-runnable-track { height: 6px; border-radius: 3px; background: #4a4a4a; }
.cut input[type=range]::-moz-range-track { height: 6px; border-radius: 3px; background: #4a4a4a; }
.cut input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 22px; height: 22px; margin-top: -8px;
  border-radius: 50%; background: #f2f2f2; border: 0; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5); }
.cut input[type=range]::-moz-range-thumb { width: 22px; height: 22px; border-radius: 50%; background: #f2f2f2; border: 0; }
.cut .legend { flex: 1; color: #b5b5b5; font-size: 14px; }
.cut .level { color: #ececec; margin-left: 8px; }
.cut .btn { flex: none; padding: 8px 13px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.2);
  background: transparent; color: #e0e0e0; font: inherit; font-size: 14px; cursor: pointer; }
.cut .btn.on { border-color: #d9824f; background: rgba(217, 130, 79, 0.22); }
.cut .btn[hidden] { display: none; }
.credit { bottom: 76px !important; }
body:has(.cut:not([hidden])) .credit { display: none; }
@media (max-width: 560px) {
  .tb { gap: 2px; padding: 0 8px; }
  .tb button { padding: 0 10px; }
  .tb button span { display: none; }
  .tb button.primary span { display: inline; }
}
`;

const ICON = {
  rotate: `<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>`,
  cut: `<svg viewBox="0 0 24 24"><path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 14l16-4"/></svg>`,
  home: `<svg viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><rect x="9.5" y="9.5" width="5" height="5"/></svg>`,
  save: `<svg viewBox="0 0 24 24"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M5 14v6h14v-6"/></svg>`,
};

/** slider end labels: [left end, right end] */
const ENDS: Record<string, [string, string]> = {
  horizontal: ["下", "上"],
  across: ["左", "右"],
  along: ["前", "後"],
};

export class Toolbar {
  private panel: HTMLDivElement;
  private slider: HTMLInputElement;
  private lo: HTMLSpanElement;
  private hi: HTMLSpanElement;
  private levelLabel: HTMLSpanElement;
  private buttons: Record<string, HTMLButtonElement> = {};
  private modeButtons: Record<CutMode, HTMLButtonElement>;
  private axisButton: HTMLButtonElement;
  private flipButton: HTMLButtonElement;
  private sweepButton: HTMLButtonElement;
  private dragging = false;
  private open = false;

  constructor(private actions: ToolbarActions) {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    const bar = document.createElement("div");
    bar.className = "tb";
    const button = (id: string, text: string, icon = "", cls = "") => {
      const b = document.createElement("button");
      b.className = cls;
      b.innerHTML = `${icon}<span>${text}</span>`;
      bar.appendChild(b);
      this.buttons[id] = b;
      return b;
    };
    button("next", "下一座", "", "primary").onclick = () => actions.next();
    const sep = document.createElement("div");
    sep.className = "sep";
    bar.appendChild(sep);
    button("rotate", "旋轉", ICON.rotate).onclick = () => {
      const on = !this.buttons.rotate.classList.contains("on");
      this.buttons.rotate.classList.toggle("on", on);
      actions.rotate(on);
    };
    button("cut", "剖切", ICON.cut).onclick = () => this.setOpen(!this.open, true);
    button("home", "歸位", ICON.home).onclick = () => actions.home();
    button("save", "輸出", ICON.save).onclick = () => actions.save();
    document.body.appendChild(bar);

    this.panel = document.createElement("div");
    this.panel.className = "cut";
    this.panel.hidden = true;
    this.panel.innerHTML = `
      <div class="head">
        <span class="dot"></span><span class="title">剖開建築</span>
        <div class="seg"><button data-mode="vertical">縱剖</button><button data-mode="horizontal">水平</button></div>
        <button class="close" title="關閉">✕</button>
      </div>
      <div class="row"><span class="end lo"></span><input type="range" min="0" max="1000" step="1"><span class="end hi"></span></div>
      <div class="row">
        <span class="legend">橘色為實體切面<span class="level"></span></span>
        <button class="btn axis">換方向</button>
        <button class="btn flip" title="保留切面的另一側">反向</button>
        <button class="btn sweep">自動掃描</button>
      </div>`;
    document.body.appendChild(this.panel);
    const q = <E extends Element>(s: string) => this.panel.querySelector(s) as E;
    this.slider = q<HTMLInputElement>("input");
    this.lo = q<HTMLSpanElement>(".lo");
    this.hi = q<HTMLSpanElement>(".hi");
    this.levelLabel = q<HTMLSpanElement>(".level");
    this.modeButtons = { vertical: q<HTMLButtonElement>('[data-mode="vertical"]'), horizontal: q<HTMLButtonElement>('[data-mode="horizontal"]') };
    this.axisButton = q<HTMLButtonElement>(".axis");
    this.flipButton = q<HTMLButtonElement>(".flip");
    this.sweepButton = q<HTMLButtonElement>(".sweep");
    for (const m of ["vertical", "horizontal"] as CutMode[]) this.modeButtons[m].onclick = () => actions.mode(m);
    q<HTMLButtonElement>(".close").onclick = () => this.setOpen(false, true);
    // dragging the slider takes over from the sweep
    this.slider.onpointerdown = () => (this.dragging = true);
    this.slider.onpointerup = this.slider.onpointercancel = () => (this.dragging = false);
    this.slider.oninput = () => {
      if (this.sweepButton.classList.contains("on")) {
        this.setSweep(false);
        actions.sweep(false);
      }
      actions.slide(Number(this.slider.value) / 1000);
    };
    this.flipButton.onclick = () => actions.flip(!this.flipButton.classList.contains("on"));
    this.axisButton.onclick = () => actions.axis(this.axisButton.dataset.axis === "across" ? "along" : "across");
    this.sweepButton.onclick = () => {
      const on = !this.sweepButton.classList.contains("on");
      this.setSweep(on);
      actions.sweep(on);
    };
  }

  /** open or close the panel (and with it the cut) */
  setOpen(open: boolean, notify = false): void {
    this.open = open;
    this.panel.hidden = !open;
    this.buttons.cut.classList.toggle("on", open);
    if (!open) this.setSweep(false);
    if (notify) {
      if (!open) this.actions.sweep(false);
      this.actions.cut(open);
    }
  }

  /** show the cut's mode, axis and position */
  show(mode: CutMode, axis: CutAxis, t: number, flip = false): void {
    for (const m of ["vertical", "horizontal"] as CutMode[]) this.modeButtons[m].classList.toggle("on", m === mode);
    const ends = ENDS[mode === "horizontal" ? "horizontal" : axis];
    this.lo.textContent = ends[0];
    this.hi.textContent = ends[1];
    this.axisButton.hidden = this.flipButton.hidden = mode !== "vertical";
    this.flipButton.classList.toggle("on", flip);
    this.axisButton.dataset.axis = axis;
    this.axisButton.textContent = axis === "across" ? "換成前後剖" : "換成左右剖";
    if (!this.dragging) this.slider.value = String(Math.round(t * 1000));
  }

  /** the floor a horizontal cut is in, e.g. "3F" (empty for vertical cuts) */
  setLevel(name: string): void {
    this.levelLabel.textContent = name ? `・切在 ${name}` : "";
  }

  setSweep(on: boolean): void {
    this.sweepButton.classList.toggle("on", on);
    this.sweepButton.textContent = on ? "停止掃描" : "自動掃描";
  }

  /** the cut makes no sense in the kit overview */
  enableCut(on: boolean): void {
    this.buttons.cut.disabled = !on;
    if (!on && this.open) this.setOpen(false, true);
  }
}
