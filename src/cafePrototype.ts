import type { BuildingPlan, PlanRoom } from "./plan";

/** One front-facing shop until the cafe sample is approved. Re-evaluate after edits. */
export function markCafePrototype(plan: BuildingPlan): PlanRoom | null {
  for (const room of plan.rooms) delete room.cafePrototype;
  const shops = plan.rooms.filter(r => r.level === 0 && r.type === "shop" && r.windows.some(i => plan.windows[i].kind === "shop"));
  shops.sort((a, b) => {
    const front = (r: PlanRoom) => Number(r.windows.some(i => plan.windows[i].side === 0));
    return front(b) - front(a) || (Math.abs(b.area - a.area) > 0.01 ? b.area - a.area : a.doors.length - b.doors.length) || a.id.localeCompare(b.id);
  });
  const room = shops[0];
  if (room) room.cafePrototype = true;
  return room ?? null;
}
