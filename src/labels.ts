/**
 * Text labels as camera-facing sprites (the kit overview's part names, the
 * room names of the floor plans and of the cut-open building). One canvas per
 * label, up to three lines. Two looks: white text with a dark outline, or
 * white text on a dark rounded tag, which reads on the white model's floors.
 */
import { CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial } from "three";

const CW = 512;
const LINE = 64;
const FONT = "600 52px ui-monospace, 'SF Mono', 'PingFang TC', monospace";
const TAG_FONT = "600 58px system-ui, -apple-system, 'PingFang TC', 'Noto Sans TC', sans-serif";

export type LabelStyle = "outline" | "tag";

/** `width` in metres; the height follows the canvas (512 x 160, or 224 for three lines) */
export function textSprite(text: string, width = 3.4, depthTest = true, style: LabelStyle = "outline", textures?: Map<string, CanvasTexture>): Sprite {
  const key = `${style}|${text}`, cached = textures?.get(key);
  if (cached) {
    const s = new Sprite(new SpriteMaterial({ map: cached, depthWrite: false, depthTest, transparent: true }));
    s.scale.set(width, width * cached.image.height / CW, 1); return s;
  }
  const lines = text.split("\n");
  const c = document.createElement("canvas");
  c.width = CW;
  c.height = lines.length > 2 ? 224 : 160;
  const g = c.getContext("2d")!;
  g.textAlign = "center";
  const top = (c.height - LINE * lines.length) / 2 + 48;
  if (style === "tag") {
    g.font = TAG_FONT;
    const w = Math.min(CW - 8, Math.max(...lines.map(l => g.measureText(l).width)) + 56);
    const h = LINE * lines.length + 22;
    const x = (CW - w) / 2, y = (c.height - h) / 2, r = 22;
    g.fillStyle = "rgba(22, 22, 22, 0.8)";
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fill();
    g.fillStyle = "#ffffff";
    lines.forEach((line, i) => g.fillText(line, CW / 2, top - 4 + i * LINE));
  } else {
    g.font = FONT;
    g.lineWidth = 8;
    g.strokeStyle = "rgba(0, 0, 0, 0.7)";
    g.fillStyle = "#ffffff";
    lines.forEach((line, i) => {
      g.strokeText(line, CW / 2, top + i * LINE, CW - 24);
      g.fillText(line, CW / 2, top + i * LINE, CW - 24);
    });
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  textures?.set(key, tex);
  const s = new Sprite(new SpriteMaterial({ map: tex, depthWrite: false, depthTest, transparent: true }));
  s.scale.set(width, (width * c.height) / CW, 1);
  return s;
}
