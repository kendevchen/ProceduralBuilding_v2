/**
 * Stateless random numbers (KIT_SPEC.md §8.6): rand(seed, facade, bay, row,
 * purpose, ...) hashes its integer keys, so the same keys always give the same
 * value and changing one parameter (say, the number of floors) doesn't
 * reshuffle every other choice the way a sequential generator would.
 */
export function rand(...keys: number[]): number {
  let h = 0x811c9dc5;
  for (const k of keys) {
    h = Math.imul(h ^ (k | 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** what a random value is for: keeps the streams of different choices apart */
export const PURPOSE = {
  doorBay: 1,
  doorStyle: 2,
  balcony: 3,
  shutter: 4,
  shutterSide: 5,
  detail: 6,
  chimney: 7,
  chimneyKind: 8,
  shop: 9,
  shopKind: 10,
  awning: 11,
  partyChimney: 12,
  window: 13,
  windowAngle: 14,
  plan: 15,
  planService: 16,
  planFlats: 17,
  tree: 18,
  treeTurn: 19,
  treeSize: 20,
  cafeTheme: 21,
  atticTheme: 22,
} as const;
