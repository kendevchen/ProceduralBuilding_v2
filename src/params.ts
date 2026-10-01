/** Building inputs (KIT_SPEC.md §8.1): phase A the freestanding building,
 *  phase B its colours, phase C the facade details. */
export type HeightProfile = "haussmann" | "uniform";
export type DoorStyle = "arched" | "rect" | "glazed" | "random";
export type GroundWindow = "arched" | "rect";
export type OtherBalcony = "gardecorps" | "balconnet" | "alternate" | "random";
export type PedimentStyle = "alternate" | "center" | "triangle" | "segment" | "cornice";
export type DetailPattern = "off" | "same" | "alternate" | "random";
export type DetailStyle = "refends" | "pilasters" | "panels";
export type DormerStyle = "zinc" | "oeil" | "segment" | "triangle" | "mixed";
export type BuildingType = "freestanding" | "corner" | "row";
export type GroundUse = "residential" | "mixed" | "shops";

export interface BuildingParams {
  /** freestanding (4 street facades), corner (2 streets, 2 party walls),
   *  row (street front, court back, party walls both sides) */
  type: BuildingType;
  /** street-street corners: square piers or pan coupés (cut at 45 degrees) */
  cornerStyle: "pier" | "panCoupe";
  /** depth of a row building, metres */
  depth: number;
  /** ground floor of the street facades: homes, some shops, all shops */
  groundUse: GroundUse;
  /** bays on the front / back facades */
  baysX: number;
  /** bays on the side facades */
  baysY: number;
  /** upper floors between the ground floor and the mansard */
  floors: number;
  /** haussmann: tallest étage noble, then standard floors, a lower top floor */
  profile: HeightProfile;
  /** dormer on every bay (1) or every other bay (2) */
  dormerEvery: number;
  dormerStyle: DormerStyle;
  /** cast-iron cresting on the slopes, finials on the flat top */
  cresting: boolean;
  /** share of the chimney spots (one per bay along the middle of the flat top) that get one */
  chimneys: number;
  /** random choices (door bay on even facades, balconies, shutters, details) */
  seed: number;
  doorStyle: DoorStyle;
  groundWindow: GroundWindow;
  /** balconies on the floors without a continuous balcony */
  otherBalcony: OtherBalcony;
  /** stone consoles under the balcony slabs */
  consoles: boolean;
  /** 0 none, 1 surrounds, 2 the Haussmann hierarchy, 3 rich (KIT_SPEC.md §8.5) */
  ornament: number;
  pediment: PedimentStyle;
  detailPattern: DetailPattern;
  detailStyle: DetailStyle;
  /** chance of a window with both shutters closed / one closed */
  shutterClosed: number;
  shutterHalf: number;
  /** chance of a window without curtains / with them drawn closed (else open) */
  curtainNone: number;
  curtainClosed: number;
  /** how far open curtains are drawn back, 0..1 */
  curtainOpen: number;
  /** chance of open casements, which way they open, and how far at most (degrees) */
  windowOpen: number;
  windowDir: "in" | "out";
  windowAngle: number;
  /** stone tint (sRGB hex), multiplies the stone texture */
  stone: string;
  /** paint of the doors (and later the shopfronts) */
  paint: string;
  /** paint of the persiennes */
  shutter: string;
  /** awning canvas colour */
  awning: string;
  /** railing lace pattern, materials.LACE_PATTERNS */
  lace: number;
}

export function defaultParams(): BuildingParams {
  return {
    type: "freestanding", cornerStyle: "pier", depth: 12, groundUse: "residential",
    baysX: 5, baysY: 3, floors: 4, profile: "haussmann", dormerEvery: 1, dormerStyle: "mixed", cresting: true, chimneys: 0.5,
    seed: 1, doorStyle: "arched", groundWindow: "arched", otherBalcony: "gardecorps", consoles: true,
    ornament: 2, pediment: "alternate", detailPattern: "off", detailStyle: "pilasters",
    shutterClosed: 0.15, shutterHalf: 0.15,
    curtainNone: 0.3, curtainClosed: 0.3, curtainOpen: 0.5, windowOpen: 0.15, windowDir: "in", windowAngle: 75,
    stone: "#ffffff", paint: "#22382f", shutter: "#c9c5ba", awning: "#8c2b2b", lace: 2,
  };
}
