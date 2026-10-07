/** V1–V5 helpers. Units belong to one candidate; fixed cells are never changed. */
import dims from "../../blender/kit_dims.json";
import type { RoomType, PlanWindow } from "../plan";
import type { Cell } from "./legacyGrid";
import { PURPOSE, rand } from "../rng";
import type { Rect } from "./edgeIndex";

export interface ProgramUnit {
  cells: Cell[];
  x0: number; y0: number; x1: number; y1: number;
  type: RoomType | null;
  apartment: number | null;
  win: number[];
  shop?: string;
  id?: string;
  /** Private service rooms can open only to these rooms (never become graph roots). */
  access?: ProgramUnit[];
  part?: string;
}
export interface ProgramChoice { apartment: number; feature: string; outcome: string }
export const unitRect = (u: ProgramUnit): Rect => [u.x0, u.y0, u.x1, u.y1];
export const programRoll = (seed: number, level: number, apt: number, purpose: number, retry: number, extra = 0) =>
  rand(seed, level, apt, purpose, retry, extra);

const K = dims.interior.variety, EPS = 1e-6;
const share = (a: Rect, b: Rect) => {
  if (Math.abs(a[2] - b[0]) < EPS || Math.abs(a[0] - b[2]) < EPS) return Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  if (Math.abs(a[3] - b[1]) < EPS || Math.abs(a[1] - b[3]) < EPS) return Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  return 0;
};
const adjacent = (a: ProgramUnit, b: ProgramUnit) => Math.abs(a.y0 - b.y0) < EPS && Math.abs(a.y1 - b.y1) < EPS &&
  (Math.abs(a.x1 - b.x0) < EPS || Math.abs(a.x0 - b.x1) < EPS);
const setRect = (u: ProgramUnit, r: Rect) => { [u.x0, u.y0, u.x1, u.y1] = r; };

interface VariationContext {
  units: ProgramUnit[];
  windows: PlanWindow[];
  seed: number;
  level: number;
  retry: number;
  choices: ProgramChoice[];
}
interface Hooks {
  fuse(units: ProgramUnit[], type: RoomType): ProgramUnit;
  interiorPoint(p: [number, number]): boolean;
}

/** All new cut endpoints must lie inside the external envelope. */
function strip(u: ProgramUnit, edge: number, depth: number, hooks: Hooks): { main: Rect; service: Rect; axis: number } | null {
  const r = unitRect(u), main: Rect = [...r], service: Rect = [...r];
  const axis = edge % 2;
  if (edge < 2) { service[axis + 2] = r[axis] + depth; main[axis] = service[axis + 2]; }
  else { service[axis] = r[axis + 2] - depth; main[axis + 2] = service[axis]; }
  const cut = edge < 2 ? service[axis + 2] : service[axis];
  const a: [number, number] = axis === 0 ? [cut, r[1]] : [r[0], cut];
  const b: [number, number] = axis === 0 ? [cut, r[3]] : [r[2], cut];
  const margin = Math.max(...Object.values(dims.interior.walls));
  if (!hooks.interiorPoint(a) || !hooks.interiorPoint(b) ||
    Math.min(main[2] - main[0], main[3] - main[1]) < dims.interior.minRoom.bedroom + margin) return null;
  return { main, service, axis };
}

export function varyApartment(ctx: VariationContext, apt: number, hooks: Hooks): void {
  const mine = () => ctx.units.filter(u => u.apartment === apt && u.type !== "corridor");
  const roll = (purpose: number, extra = 0) => programRoll(ctx.seed, ctx.level, apt, purpose, ctx.retry, extra);
  const pick = <T>(xs: T[], purpose: number) => xs[Math.floor(roll(purpose, 1) * xs.length)];
  const note = (feature: string, outcome: string) => ctx.choices.push({ apartment: apt, feature, outcome });
  const minimumBedrooms = mine().length >= 5 ? K.minBedrooms : 1;
  // V3: preserve rectangular rooms and at most three standard bays.
  let reception = "kept";
  if (roll(PURPOSE.planReceptionMerge) < K.receptionMergeChance) {
    const salons = mine().filter(u => u.type === "salon");
    const mode = roll(PURPOSE.planReceptionMerge, 2) < 0.5 ? "salon-dining" : "three-bay-salon";
    const pairs = salons.flatMap(a => mine().filter(b => b !== a && adjacent(a, b) &&
      (mode === "salon-dining" ? b.type === "dining" : b.type === "bedroom") &&
      Math.max(a.x1, b.x1) - Math.min(a.x0, b.x0) <= K.maxReceptionBays * dims.bay + EPS &&
      (b.type !== "bedroom" || mine().filter(u => u.type === "bedroom").length > minimumBedrooms)).map(b => [a, b]));
    if (pairs.length) { hooks.fuse(pick(pairs, PURPOSE.planReceptionMerge), "salon").apartment = apt; reception = mode; }
    else reception = "no legal pair";
  }
  note("V3", reception);
  // V4: a five-room flat keeps at least two bedrooms after merging.
  let bedrooms = "kept";
  if (roll(PURPOSE.planBedroomMerge) < K.bedroomMergeChance) {
    const beds = mine().filter(u => u.type === "bedroom");
    const pairs = beds.flatMap((a, i) => beds.slice(i + 1).filter(b => adjacent(a, b)).map(b => [a, b]));
    if (beds.length > minimumBedrooms && pairs.length) {
      const master = hooks.fuse(pick(pairs, PURPOSE.planBedroomMerge), "bedroom");
      master.apartment = apt; master.part = "master-bedroom";
      bedrooms = "master bedroom";
    } else bedrooms = "minimum bedrooms or no legal pair";
  }
  note("V4", bedrooms);
  const corridors = () => ctx.units.filter(u => u.type === "corridor" && (u.apartment === null || u.apartment === apt));
  const neededSpan = dims.interior.doors.single[0] + 0.3;
  const edgesAt = (u: ProgramUnit, neighbours: ProgramUnit[]) => [0, 1, 2, 3].filter(edge => neighbours.some(v => {
    const r = unitRect(v);
    return Math.abs((edge < 2 ? [u.x0, u.y0][edge] : [u.x1, u.y1][edge - 2]) - r[(edge + 2) % 4]) < EPS && share(unitRect(u), r) >= neededSpan;
  }));
  const windowless = (r: Rect, u: ProgramUnit) => u.win.every(wi => {
    const w = ctx.windows[wi], x = w.at[0] - w.dir[1] * 0.5, y = w.at[1] + w.dir[0] * 0.5;
    return x < r[0] - EPS || x > r[2] + EPS || y < r[1] - EPS || y > r[3] + EPS;
  });
  const add = (owner: ProgramUnit, rect: Rect, type: RoomType, access: ProgramUnit[]) => {
    const u: ProgramUnit = { ...owner, cells: [...owner.cells], win: [], type, access, part: type };
    setRect(u, rect); ctx.units.push(u); return u;
  };
  const complete = ["salon", "kitchen", "wc", "bedroom"].every(t => mine().some(u => u.type === t));
  // V5a: service strip at the corridor end; all facade windows stay with the bedroom.
  let suite = "not drawn";
  if (complete && roll(PURPOSE.planSuite) < K.suiteChance) {
    suite = "no safe internal strip";
    const candidates = mine().filter(u => u.type === "bedroom" && (u.part === "master-bedroom" || u.y1 - u.y0 >= K.minSuiteDepth))
      .flatMap(u => edgesAt(u, corridors()).flatMap(edge => {
        const cut = strip(u, edge, K.suiteDepth, hooks);
        if (!cut) return [];
        const across = 1 - cut.axis;
        return cut.service[across + 2] - cut.service[across] >= 2 * K.suitePartWidth &&
          windowless(cut.service, u) ? [{ u, cut }] : [];
      }));
    if (candidates.length) {
      const { u, cut } = pick(candidates, PURPOSE.planSuite);
      setRect(u, cut.main); u.part = "suite-bedroom";
      const r = cut.service, across = 1 - cut.axis;
      const bath: Rect = [...r], closet: Rect = [...r];
      bath[across + 2] = r[across] + K.suitePartWidth; closet[across] = bath[across + 2];
      add(u, bath, "bathroom", [u]); add(u, closet, "closet", [u]); suite = "bathroom and closet";
    }
  }
  note("V5-suite", suite);
  // V5b: the private foyer connects its reception room to an actual corridor.
  let foyer = "not drawn";
  if (complete && roll(PURPOSE.planFoyer) < K.foyerChance) {
    foyer = "no safe corridor entrance";
    const candidates = mine().filter(u => u.type === "salon" || u.type === "dining").flatMap(u => edgesAt(u, corridors()).flatMap(edge => {
      const cut = strip(u, edge, K.foyerDepth, hooks);
      if (!cut || !windowless(cut.service, u)) return [];
      const corridor = corridors().find(c => share(cut.service, unitRect(c)) >= neededSpan);
      return corridor ? [{ u, cut, corridor }] : [];
    }));
    if (candidates.length) {
      const { u, cut, corridor } = pick(candidates, PURPOSE.planFoyer);
      setRect(u, cut.main); u.part = "reception";
      add(u, cut.service, "foyer", [u, corridor]); foyer = "private entrance";
    }
  }
  note("V5-foyer", foyer);
  // V5c: never invent a pantry bridge through a corridor or another flat.
  let pantry = "not drawn";
  if (complete && roll(PURPOSE.planPantry) < K.pantryChance) {
    pantry = "no intervening room";
    const kitchen = mine().find(u => u.type === "kitchen"), dining = mine().find(u => u.type === "dining");
    if (kitchen && dining && share(unitRect(kitchen), unitRect(dining)) < neededSpan) {
      const safe = (r: Rect) => Math.min(r[2] - r[0], r[3] - r[1]) >= K.minServiceWidth + Math.max(...Object.values(dims.interior.walls)) &&
        (r[2] - r[0] - dims.interior.walls.spine) * (r[3] - r[1] - dims.interior.walls.spine) >= K.minServiceArea;
      const cuts = mine().filter(u => u.type === "storage" || u.type === "bedroom").flatMap(u => [0, 1, 2, 3].flatMap(edge => {
        const cut = strip(u, edge, K.pantryDepth, hooks);
        return cut && safe(cut.service) && windowless(cut.service, u) &&
          share(cut.service, unitRect(kitchen)) >= neededSpan && share(cut.service, unitRect(dining)) >= neededSpan ? [{ u, cut }] : [];
      }));
      const candidates = mine().filter(u => u.type === "storage" && !u.win.length &&
        share(unitRect(u), unitRect(kitchen)) >= neededSpan && share(unitRect(u), unitRect(dining)) >= neededSpan &&
        safe(unitRect(u)));
      if (cuts.length) {
        const { u, cut } = pick(cuts, PURPOSE.planPantry);
        setRect(u, cut.main); u.part = "pantry-carrier";
        add(u, cut.service, "pantry", [kitchen, dining]); pantry = "internal bridge strip";
      } else if (candidates.length) {
        const u = pick(candidates, PURPOSE.planPantry); u.type = "pantry"; u.access = [kitchen, dining]; u.part = "pantry";
        pantry = "between kitchen and dining";
      }
    }
  }
  note("V5-pantry", pantry);
}
