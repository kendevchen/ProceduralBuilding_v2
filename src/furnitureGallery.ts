/** Furniture overview: actual component recipes with English and Traditional Chinese labels. */
import { Box3, Group, Mesh, Vector3 } from "three";
import { buildFurnitureItems } from "./furniture";
import type { Gallery } from "./gallery";
import type { InteriorMaterials } from "./rooms3d";
import { textSprite } from "./labels";

const CATEGORIES = ["宴會廳", "書房", "臥室", "客廳", "餐廳", "廚房"];
const ROW_STEP = 6, LABEL_WIDTH = 3.7, MAX_COLUMNS = 6;

export function buildFurnitureGallery(mats: InteriorMaterials): Gallery {
  const items = buildFurnitureItems(mats), group = new Group();
  const positions: { item: typeof items[number]; x: number; y: number; box: Box3 }[] = [];
  const headings: { text: string; row: number }[] = [];
  let row = 0, width = 0, height = 0;
  for (const category of CATEGORIES) {
    const members = items.filter(item => item.category === category);
    for (let start = 0; start < members.length; start += MAX_COLUMNS) {
      let x = 0;
      headings.push({ text: start ? `${category}（續）` : category, row });
      for (const item of members.slice(start, start + MAX_COLUMNS)) {
        const box = new Box3().setFromObject(item.group), size = box.getSize(new Vector3());
        const slot = Math.max(LABEL_WIDTH + 0.5, size.x + 1);
        positions.push({ item, x: x + (slot - size.x) / 2 - box.min.x, y: row * ROW_STEP - box.min.y, box });
        x += slot; height = Math.max(height, size.z);
      }
      width = Math.max(width, x); row++;
    }
  }
  const depth = (row - 1) * ROW_STEP + 4;
  for (const { item, x, y, box } of positions) {
    const dx = x - width / 2, dy = y - depth / 2 + 2, dz = -box.min.z;
    // Bake positions so world-space finish patterns move with each display item.
    item.group.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const geometry = object.geometry;
      geometry.translate(dx, dy, dz);
      const pattern = geometry.getAttribute("finPattern"), a = geometry.getAttribute("finA"), z = geometry.getAttribute("finZ");
      if (pattern) for (let i = 0; i < pattern.count; i++) {
        if ([6, 7, 8].includes(Math.round(pattern.getX(i)))) a.setXY(i, a.getX(i) + dx, a.getY(i) - dy);
        z.setXY(i, z.getX(i) + dz, z.getY(i) + dz);
      }
    });
    const label = textSprite(`${item.name}\n${item.zh}`, LABEL_WIDTH, false);
    label.position.set(dx + (box.min.x + box.max.x) / 2, dy + box.min.y - 0.85, 0.25);
    item.group.add(label); group.add(item.group);
  }
  for (const heading of headings) {
    const label = textSprite(heading.text, 2.7, false, "tag");
    label.position.set(-width / 2 - 2.2, heading.row * ROW_STEP - depth / 2 + 3, 0.7);
    group.add(label);
  }
  group.userData.furnitureCatalogue = items.map(({ name, zh, category }) => ({ name, zh, category }));
  return { group, width: width + 7, depth, height };
}
