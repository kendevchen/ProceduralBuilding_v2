/**
 * Text labels as camera-facing sprites (the kit overview's part names, the
 * room names of the floor plans). One canvas per label, up to three lines.
 */
import { CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial } from "three";

const CW = 512;
const LINE = 64;

/** `width` in metres; the height follows the canvas (512 x 160, or 224 for three lines) */
export function textSprite(text: string, width = 3.4, depthTest = true): Sprite {
  const lines = text.split("\n");
  const c = document.createElement("canvas");
  c.width = CW;
  c.height = lines.length > 2 ? 224 : 160;
  const g = c.getContext("2d")!;
  g.font = "600 52px ui-monospace, 'SF Mono', 'PingFang TC', monospace";
  g.textAlign = "center";
  g.lineWidth = 8;
  g.strokeStyle = "rgba(0, 0, 0, 0.7)";
  g.fillStyle = "#ffffff";
  const top = (c.height - LINE * lines.length) / 2 + 48;
  lines.forEach((line, i) => {
    g.strokeText(line, CW / 2, top + i * LINE);
    g.fillText(line, CW / 2, top + i * LINE);
  });
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const s = new Sprite(new SpriteMaterial({ map: tex, depthWrite: false, depthTest, transparent: true }));
  s.scale.set(width, (width * c.height) / CW, 1);
  return s;
}
