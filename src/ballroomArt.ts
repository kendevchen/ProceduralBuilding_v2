/** Original peacock/flower painting drawn once; a single textured plane per frame. */
import { CanvasTexture, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace } from "three";
let material: MeshStandardMaterial | undefined;
function paintingMaterial(): MeshStandardMaterial {
  if (material) return material;
  material = new MeshStandardMaterial({ name: "banquet_peacock_painting", color: "#ffffff", roughness: 0.92 });
  if (typeof document === "undefined") return material;
  const canvas = document.createElement("canvas"); canvas.width = 768; canvas.height = 1024;
  const c = canvas.getContext("2d")!;
  const ground = c.createLinearGradient(0, 0, 768, 1024);
  ground.addColorStop(0, "#354c49"); ground.addColorStop(0.6, "#293b31"); ground.addColorStop(1, "#6c563c");
  c.fillStyle = ground; c.fillRect(0, 0, 768, 1024);
  // Dappled foliage and distant light, painted with translucent strokes.
  for (let i = 0; i < 240; i++) {
    const x = (i * 137.53) % 768, y = (i * 79.17) % 1024;
    c.fillStyle = i % 3 ? "#92a07820" : "#dbc49118";
    c.beginPath(); c.ellipse(x, y, 15 + i % 25, 7 + i % 15, i, 0, Math.PI * 2); c.fill();
  }
  // A fan of long feathers; gold, teal and blue eyes give the painting its subject.
  for (let i = 0; i < 31; i++) {
    const a = -Math.PI * 0.90 + i * Math.PI * 0.80 / 30;
    const x = 390 + Math.cos(a) * (270 + i % 4 * 10), y = 730 + Math.sin(a) * (530 - i % 3 * 20);
    c.strokeStyle = "#b7ad71"; c.lineWidth = 3;
    c.beginPath(); c.moveTo(390, 730); c.quadraticCurveTo((390 + x) / 2 + 25, (730 + y) / 2, x, y); c.stroke();
    c.save(); c.translate(x, y); c.rotate(a + Math.PI / 2);
    for (const [rx, ry, color] of [[27, 45, "#8c9054"], [19, 29, "#c1a665"], [13, 20, "#4e8f8c"], [7, 13, "#223c62"]] as [number, number, string][]) {
      c.fillStyle = color; c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
  const body = c.createLinearGradient(355, 430, 445, 765);
  body.addColorStop(0, "#6ba9ab"); body.addColorStop(0.5, "#286575"); body.addColorStop(1, "#173b4f");
  c.fillStyle = body;
  c.beginPath(); c.ellipse(410, 713, 65, 95, -0.3, 0, Math.PI * 2); c.fill();
  c.strokeStyle = "#428b96"; c.lineWidth = 38; c.lineCap = "round";
  c.beginPath(); c.moveTo(405, 701); c.bezierCurveTo(430, 601, 449, 570, 430, 510); c.stroke();
  c.fillStyle = "#76b2b1"; c.beginPath(); c.ellipse(431, 494, 26, 22, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#d8bd80"; c.beginPath(); c.moveTo(452, 490); c.lineTo(480, 504); c.lineTo(449, 506); c.fill();
  c.fillStyle = "#162b2c"; c.beginPath(); c.arc(437, 489, 4, 0, Math.PI * 2); c.fill();
  c.lineWidth = 2; c.strokeStyle = "#c3ba81";
  for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(423, 477); c.lineTo(405 + i * 9, 444); c.stroke(); }
  // Flowers frame the lower edge of the original composition.
  for (let i = 0; i < 20; i++) {
    const x = 50 + (i * 171) % 680, y = 820 + (i * 37) % 180;
    c.strokeStyle = "#879369"; c.lineWidth = 4; c.beginPath(); c.moveTo(x, 1024); c.lineTo(x, y); c.stroke();
    c.fillStyle = i % 3 ? "#d5c5ad" : "#aa7975";
    for (let j = 0; j < 5; j++) {
      const a = j * Math.PI * 2 / 5;
      c.beginPath(); c.ellipse(x + Math.cos(a) * 10, y + Math.sin(a) * 10, 10, 14, a, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = "#c4a057"; c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill();
  }
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
  material.map = texture; material.needsUpdate = true;
  return material;
}
export function ballroomPainting(m: Matrix4, width: number, height: number, bottom: number, frame: number): Mesh {
  const g = new PlaneGeometry(width - frame * 2, height - frame * 2);
  g.rotateX(Math.PI / 2); g.rotateZ(Math.PI); g.translate(0, 0.071, bottom + height / 2); g.applyMatrix4(m);
  const mesh = new Mesh(g, paintingMaterial()); mesh.receiveShadow = true; return mesh;
}

let cardMaterial: MeshStandardMaterial | undefined;
export function banquetPlaceCard(m: Matrix4, width: number, height: number): Mesh {
  if (!cardMaterial) {
    cardMaterial = new MeshStandardMaterial({ name: "banquet_place_card", color: "#f4eedb", roughness: 0.85 });
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 160;
      const c = canvas.getContext("2d")!;
      c.fillStyle = "#f4eedb"; c.fillRect(0, 0, 256, 160);
      c.strokeStyle = "#b89745"; c.lineWidth = 3; c.strokeRect(12, 12, 232, 136);
      c.fillStyle = "#6e5537"; c.textAlign = "center"; c.font = "italic 30px Georgia"; c.fillText("Bon appetit", 128, 74);
      c.font = "17px Georgia"; c.fillText("MENU DU SOIR", 128, 110);
      const t = new CanvasTexture(canvas); t.colorSpace = SRGBColorSpace; cardMaterial.map = t;
    }
  }
  const g = new PlaneGeometry(width - 0.008, height - 0.008);
  g.rotateX(Math.PI / 2); g.rotateZ(Math.PI); g.translate(0, 0.0185, height / 2); g.applyMatrix4(m);
  const mesh = new Mesh(g, cardMaterial); return mesh;
}
