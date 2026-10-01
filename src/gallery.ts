/**
 * Kit overview (零件總覽): every part laid out in two rows with its name, to
 * check the modules and their materials under the lighting moods. Same layout
 * as blender/preview_kit.py: low parts (balconies, roof) in front, tall behind.
 * Blender Z-up space, like the building.
 */
import { Group, Matrix4, Vector3 } from "three";
import type { Kit, PartInfo, Placement, Style } from "./kit";
import { textSprite } from "./labels";

const GAP = 1.4;
/** one row per group, front to back: small overlays, roof, ground floor, upper floors */
const ROWS = ["overlay", "R", "G", "N", "S", "A"] as const;
type RowKey = (typeof ROWS)[number];
const ROW_STEP = 9;
const rowOf = (p: PartInfo): RowKey =>
  /^(balcony|head|console)/.test(p.collection) ? "overlay" : ((ROWS as readonly string[]).includes(p.collection[0]) ? p.collection[0] as RowKey : "overlay");
/** within a row: bays first, then corners, surrounds, shutters, details */
const ORDER = ["_bay", "_corner", "_surround", "_shutter", "_detail", "balcony", "console", "head", "R_cornice", "R_mansard"];
const rank = (p: PartInfo) => {
  const i = ORDER.findIndex(s => p.collection.includes(s));
  return i < 0 ? ORDER.length : i;
};

export interface Gallery {
  group: Group;
  /** extent in Blender space, with the layout centred on the origin */
  width: number;
  depth: number;
  height: number;
}

export function buildGallery(kit: Kit, style: Style): Gallery {
  const rows = Object.fromEntries(ROWS.map(r => [r, [] as PartInfo[]])) as Record<RowKey, PartInfo[]>;
  for (const p of kit.list()) rows[rowOf(p)].push(p);
  const placements: Placement[] = [];
  const labels = new Group();
  const widths: number[] = [];
  let height = 0;
  ROWS.forEach((row, ri) => {
    const y = ri * ROW_STEP;
    let x = 0;
    for (const p of rows[row].sort((a, b) => rank(a) - rank(b))) {
      const size = p.box.getSize(new Vector3());
      // lift parts that hang below their floor line (balcony slabs, consoles)
      placements.push({
        key: p.key, style,
        matrix: new Matrix4().makeTranslation(x - p.box.min.x, y - p.box.min.y, Math.max(0, -p.box.min.z)),
      });
      const l = textSprite(`${p.collection}\n${p.variant}`);
      l.position.set(x + size.x / 2, y - 2.0, 0.5);
      labels.add(l);
      x += size.x + GAP;
      height = Math.max(height, size.z);
    }
    widths.push(x - GAP);
  });
  const width = Math.max(...widths);
  const group = kit.buildGroup(placements);
  group.add(labels);
  // rows left-aligned, the block centred
  const depth = (ROWS.length - 1) * ROW_STEP + 4;
  group.position.set(-width / 2, -depth / 2 + 2, 0);
  return { group, width, depth, height };
}
