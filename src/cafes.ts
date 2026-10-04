import type { BuildingPlan } from "./plan";
import { PURPOSE, rand } from "./rng";

export type CafeTheme = 0 | 1 | 2;
export const CAFE_THEME_NAMES = ["淡綠地毯／白色桌椅", "紅色棋盤／紅色桌椅", "灰調原木地板／原木色桌椅"] as const;

/** Stable random per storefront: regeneration and floor changes retain the pairing. */
export function markCafeShops(plan: BuildingPlan, seed: number): void {
  for (const room of plan.rooms) {
    delete room.cafeTheme;
    if (room.level !== 0 || room.type !== "shop") continue;
    const window = room.windows.map(i => plan.windows[i]).find(w => w.kind === "shop");
    const key = window ? [window.side, window.bay] : [Math.round(room.rect[0] * 100), Math.round(room.rect[1] * 100)];
    room.cafeTheme = Math.floor(rand(seed, ...key, PURPOSE.cafeTheme) * 3) as CafeTheme;
  }
}
