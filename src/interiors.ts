/**
 * Interiors (KIT_SPEC.md §7): a room box behind every window, painted with the
 * self-made room atlas (blender/rooms.py -> tex/interiors.jpg), and voile
 * curtains. The idea follows the reference site's interiors (MIT, Achref El
 * Ouafi): each atlas cell is a room section rendered by a pinhole 16 m in front
 * of its open front, so projecting a point of the box through the same pinhole
 * gives its pixel, and the back wall shrinks with depth like in the picture.
 *
 * Room boxes are open towards the window: X across (centred on the window),
 * Y depth from the room front, Z up from its floor. Near a facade's ends each
 * vertex's depth is clipped by its distance to the end, so the rooms of two
 * facades meeting at a corner never cross. Blender Z-up space, like the kit.
 */
import { BufferGeometry, Float32BufferAttribute, type Matrix4, Vector3 } from "three";
import type { BuildingPlan, PlanRoom, RoomType } from "./plan";
import { rand } from "./rng";

export type RoomKind = "upper" | "ground" | "shop_wood" | "shop_stone" | "shop_cafe" | "hall" | "attic" | "ballroom";

export interface RoomSlot {
  /** frame of the bay module the window belongs to (Blender space) */
  matrix: Matrix4;
  kind: RoomKind;
  /** room front (module-local y), floor and height (module-local z) */
  y0: number;
  floor: number;
  height: number;
  /** half width of the box, and its depth */
  half: number;
  depth: number;
  /** bay centre along its facade and the facade length, for the corner clipping */
  along: number;
  length: number;
  /** window for the curtains (module-local); none: no curtains */
  curtain?: { half: number; sill: number; head: number; y?: number; gathered?: boolean };
  /** dormers: a short tunnel from the window back to the room front */
  tunnel?: boolean;
  /** the tunnel's half width and height range when it is not the usual dormer's (the atelier) */
  tunnelSize?: { x: number; z0: number; z1: number };
  /** curtains only: the window looks into a room box made for another (the ballroom's upper row) */
  noBox?: boolean;
  /** set on this window alone (params.facade): its curtains, and how far open ones are drawn back */
  curtainMode?: "none" | "closed" | "open";
  curtainOpen?: number;
  /** the window on the floor plan: facade side, bay (-1 the pan coupé), level */
  at?: { side: number; bay: number; level: number };
  /** stable random key */
  seed: number[];
}

/** atlas cells (rooms.py ROOMS) by room kind */
const CELLS: Record<RoomKind, number[]> = {
  upper: [0, 1, 2, 3, 4, 5, 6, 7],
  ground: [15, 0, 4, 1],
  attic: [8, 9, 10],
  shop_wood: [11, 13],
  shop_stone: [13, 15],
  shop_cafe: [12],
  hall: [14],
  ballroom: [16],
};

/** what the floor plan says about the room behind a window: its atlas cells,
 *  and whether its curtains are always drawn (INTERIOR_SPEC.md §8.3) */
export type RoomRule = (slot: RoomSlot) => { cells: number[]; closed?: boolean } | null;

/** atlas cells by the plan's room type; shops keep their front's cells */
const VIEWS: Partial<Record<RoomType, number[]>> = {
  elevator: [6], shaft: [6], liftHall: [14], bathroom: [6], closet: [6], foyer: [14], pantry: [4],
  salon: [0], dining: [1], bedroom: [2, 7], study: [3], kitchen: [4], vestibule: [14], stair: [14], corridor: [14],
  concierge: [15], shopBack: [15, 6], maid: [8, 9], ballroom: [16],
};

/** the room behind each window from the floor plan (INTERIOR_SPEC.md §8.3) */
export function planRule(plan: BuildingPlan): RoomRule {
  const rooms = new Map(plan.rooms.map(r => [r.id, r]));
  const behind = new Map<string, PlanRoom>();
  for (const w of plan.windows) {
    const r = w.room ? rooms.get(w.room) : undefined;
    if (r) behind.set(`${w.level}|${w.side}|${w.bay}`, r);
  }
  const attic = plan.levels[plan.levels.length - 1].index;
  return s => {
    const r = s.at && behind.get(`${s.at.level}|${s.at.side}|${s.at.bay}`);
    if (!r) return null;
    if (r.type === "wc" || r.type === "bathroom" || r.type === "elevator" || r.type === "shaft") return { cells: CELLS[s.kind], closed: true };
    if (r.type === "storage") return { cells: r.level === attic ? [10] : [6] };
    const cells = VIEWS[r.type];
    return cells ? { cells } : null;
  };
}

class Buffers {
  pos: number[] = [];
  local: number[] = [];
  info: number[] = [];
  height: number[] = [];
  index: number[] = [];
}

export interface Interiors {
  rooms: BufferGeometry;
  curtains: BufferGeometry;
}

/** curtainOpen: how far open curtains are drawn back, 0 almost meeting .. 1 bunched at the sides */
export function buildInteriors(slots: RoomSlot[], noCurtain = 0.3, closedCurtain = 0.3, curtainOpen = 0.5, rule?: RoomRule): Interiors {
  const b = new Buffers();
  const cpos: number[] = [];
  const v = new Vector3();
  for (const s of slots) {
    const r = (k: number) => rand(...s.seed, 9000 + k);
    const plan = rule?.(s) ?? null;
    const cells = plan?.cells ?? CELLS[s.kind];
    const cell = cells[Math.floor(r(1) * cells.length)];
    const h = s.height;
    const offset = (r(2) - 0.5) * Math.max(0, 4 * h - 2 * s.half);
    const mirror = r(3) < 0.5 ? 1 : 0;
    const light = 0.3 + r(4);
    const depthAt = (X: number) =>
      Math.max(0.6, Math.min(s.depth, s.along + X - 0.1, s.length - s.along - X - 0.1));

    /** one quad of the box in room coordinates (X, Y, Z) */
    const quad = (pts: [number, number, number][]) => {
      const base = b.pos.length / 3;
      for (const [X, Y, Z] of pts) {
        v.set(X, s.y0 + Y, s.floor + Z).applyMatrix4(s.matrix);
        b.pos.push(v.x, v.y, v.z);
        b.local.push(X, Y, Z);
        b.info.push(cell, offset, mirror, light);
        b.height.push(h);
      }
      b.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const hw = s.half, dl = depthAt(-hw), dr = depthAt(hw);
    if (!s.noBox) {
      quad([[-hw, dl, 0], [hw, dr, 0], [hw, dr, h], [-hw, dl, h]]); // back
      quad([[-hw, 0, 0], [-hw, dl, 0], [-hw, dl, h], [-hw, 0, h]]); // left
      quad([[hw, dr, 0], [hw, 0, 0], [hw, 0, h], [hw, dr, h]]); // right
      quad([[-hw, 0, 0], [hw, 0, 0], [hw, dr, 0], [-hw, dl, 0]]); // floor
      quad([[-hw, dl, h], [hw, dr, h], [hw, 0, h], [-hw, 0, h]]); // ceiling
      if (s.tunnel) {
        // dormer: walls from the window (y = 0.02) to the room front
        const ty = 0.02 - s.y0, tx = s.tunnelSize?.x ?? 0.42, z0 = s.tunnelSize?.z0 ?? 0.52, z1 = s.tunnelSize?.z1 ?? 1.88;
        quad([[-tx, ty, z0], [-tx, 0, z0], [-tx, 0, z1], [-tx, ty, z1]]);
        quad([[tx, 0, z0], [tx, ty, z0], [tx, ty, z1], [tx, 0, z1]]);
        quad([[-tx, ty, z0], [tx, ty, z0], [tx, 0, z0], [-tx, 0, z0]]);
        quad([[-tx, 0, z1], [tx, 0, z1], [tx, ty, z1], [-tx, ty, z1]]);
      }
    }

    // voile curtains: none, drawn closed, or open in two panels
    if (s.curtain) {
      // the window's own setting, else the plan (WCs closed), else chance
      const mode = s.curtainMode ?? (plan?.closed ? "closed" : null);
      const u = r(10);
      if (mode === "none" || (!mode && u < noCurtain)) continue;
      const c = s.curtain;
      const open = mode ? mode === "open" : u >= noCurtain + closedCurtain;
      const drawn = s.curtainOpen ?? curtainOpen;
      // gathered: the casements swing in through the window, so the curtain is
      // held flat on the wall in two bunches beside the opening
      const panels: [number, number][] = c.gathered
        ? (() => {
          const edge = c.half + 0.08, w = (k: number) => 0.26 + 0.16 * r(k);
          return [[-edge - w(11), -edge], [edge, edge + w(12)]] as [number, number][];
        })()
        : open
        ? (() => {
          // each panel covers half the window less the drawn-back share, varied per side
          const w = (k: number) => Math.max(0.12, c.half * (1 - drawn * 0.85) * (0.8 + 0.4 * r(k)));
          return [[-c.half, -c.half + w(11)], [c.half - w(12), c.half]] as [number, number][];
        })()
        : [[-c.half, c.half]];
      const SEG = 24;
      for (const [x0, x1] of panels) {
        for (let k = 0; k < SEG; k++) {
          const p = (t: number, z: number) => {
            v.set(x0 + (x1 - x0) * t, s.y0 + (c.y ?? 0.06) + Math.sin(t * Math.PI * 2 * Math.max(2, Math.round((x1 - x0) / 0.18))) * 0.016, z)
              .applyMatrix4(s.matrix);
            return [v.x, v.y, v.z];
          };
          const t0 = k / SEG, t1 = (k + 1) / SEG;
          const a = p(t0, c.sill), bb = p(t1, c.sill), cc = p(t1, c.head), d = p(t0, c.head);
          cpos.push(...a, ...bb, ...cc, ...a, ...cc, ...d);
        }
      }
    }
  }
  const rooms = new BufferGeometry();
  rooms.setAttribute("position", new Float32BufferAttribute(b.pos, 3));
  rooms.setAttribute("roomLocal", new Float32BufferAttribute(b.local, 3));
  rooms.setAttribute("roomInfo", new Float32BufferAttribute(b.info, 4));
  rooms.setAttribute("roomH", new Float32BufferAttribute(b.height, 1));
  rooms.setIndex(b.index);
  rooms.computeBoundingSphere();
  const curtains = new BufferGeometry();
  curtains.setAttribute("position", new Float32BufferAttribute(cpos, 3));
  curtains.computeVertexNormals();
  return { rooms, curtains };
}
