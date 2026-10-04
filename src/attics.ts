import type { BuildingPlan } from "./plan";
import { PURPOSE, rand } from "./rng";

export type AtticTheme = 0 | 1;
export const ATTIC_THEME_NAMES = ["淺原木／奶油牆面", "深原木／書房地板與護牆板"] as const;

/** Stable palettes by room footprint, independent of room IDs and floor count. */
export function markAtticRooms(plan: BuildingPlan, seed: number): void {
  const rooms = plan.rooms.filter(r => r.type === "maid" && plan.levels[r.level].cls === "R")
    .sort((a, b) => a.rect[0] - b.rect[0] || a.rect[1] - b.rect[1]);
  for (const room of plan.rooms) delete room.atticTheme;
  for (const room of rooms) room.atticTheme = Math.floor(rand(seed, Math.round(room.rect[0] * 100), Math.round(room.rect[1] * 100), PURPOSE.atticTheme) * 2) as AtticTheme;
  // A single room uses the new palette; multiple rooms always show both styles.
  if (rooms.length && !rooms.some(r => r.atticTheme === 1)) rooms[0].atticTheme = 1;
  if (rooms.length > 1 && !rooms.some(r => r.atticTheme === 0)) rooms[rooms.length - 1].atticTheme = 0;
}
