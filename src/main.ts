/**
 * European building kit viewer.
 * Lighting moods, sky and post-processing come from v1 (see CLAUDE.md); the building
 * is assembled from the kit (blender/ -> public/assets/kit.glb) by generator.ts.
 */
import {
  ACESFilmicToneMapping, Box3, Clock, GridHelper, Group, type InstancedMesh, Mesh, MeshStandardMaterial,
  PerspectiveCamera, PlaneGeometry, Raycaster, SRGBColorSpace, Scene, type Sprite, Vector2, Vector3, WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";
import { Environment } from "./environment";
import { buildGallery } from "./gallery";
import { buildFurnitureGallery } from "./furnitureGallery";
import { buildingStyle, generateBuilding, partyChimneys } from "./generator";
import { Kit } from "./kit";
import { FACADE_LOOKS, type FacadeLook, type KitMaterials, LACE_PATTERNS, createMaterials } from "./materials";
import { type BuildingParams, defaultParams } from "./params";
import { PostFX } from "./postfx";
import { buildInteriors, planRule } from "./interiors";
import { type BuildingPlan, planBuilding } from "./plan";
import { buildPlanView } from "./planView";
import { partyWalls, roofCap, roofShape } from "./roof";
import { type CutAxis, type CutMode, Cutaway } from "./cutaway";
import { buildRooms3d } from "./rooms3d";
import { RoomLabels } from "./roomLabels";
import { type FurnitureInfo, type SalonInfo, type DiningInfo, type KitchenInfo, type CafeInfo, type BallroomInfo, type AtticInfo, buildCafeTerrace, buildFurniture } from "./furniture";
import { LampLights } from "./lampLights";
import { buildStairs } from "./stairs";
import { StreetLife } from "./streetlife";
import { markCafeShops } from "./cafes";
import { markAtticRooms } from "./attics";
import { WindowEditor } from "./windowEditor";
import { RoomEdits } from "./roomEdits";
import { RoomEditor } from "./roomEditor";
import type { Look } from "./finishes";
import { Toolbar } from "./toolbar";
import { UnfoldView, type UnfoldFocus } from "./unfold";
import dims from "../blender/kit_dims.json";

const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer: true });
const DEFAULT_PIXEL_RATIO = Math.min(devicePixelRatio, 1.25);
renderer.setPixelRatio(DEFAULT_PIXEL_RATIO);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.outputColorSpace = SRGBColorSpace;
renderer.localClippingEnabled = true; // the section plane (cutaway.ts)
document.getElementById("app")!.appendChild(renderer.domElement);

const scene = new Scene();
const camera = new PerspectiveCamera(35, innerWidth / innerHeight, 0.3, 1500);
camera.position.set(36, 20, 46);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 7, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.maxDistance = 400;

const env = new Environment(scene, renderer);
const post = new PostFX(renderer, scene, camera, 2);

// ground + 1 m grid: a scale reference for the kit's modules (meters)
const ground = new Mesh(new PlaneGeometry(400, 400), new MeshStandardMaterial({ color: 0x8a8d90, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new GridHelper(60, 60, 0x5c6066, 0x7a7e84);
grid.position.y = 0.01;
scene.add(grid);

// ---- building / kit overview ----
// kit space is Blender Z-up: rotate it into three's Y-up
const root = new Group();
root.rotation.x = -Math.PI / 2;
scene.add(root);
const params = defaultParams();
const roomEdits = new RoomEdits();
const view = { gallery: false, furnitureGallery: false };
let overviewSize: { width: number; depth: number } | null = null;
/** the study lamps' light (lampLights.ts) */
const lampLights = new LampLights(scene);
/** sidewalk and street trees, in world space beside the building (streetlife.ts) */
const street = new StreetLife();
scene.add(street.group);
/** floor plans (INTERIOR_SPEC.md): the plan view of one level, its labels, the plan check */
const interiorView = { plan: false, level: 1, labels: true, area: false, check: "—", look: "real" as Look };
let materials: KitMaterials | null = null;
let kit: Kit | null = null;
let shown: Group | null = null;
let lastPlan: BuildingPlan | null = null;

/** cutting the building open (INTERIOR_SPEC.md §2): t is the plane's place, 0..1 within the bounds */
const cut = { on: false, mode: "horizontal" as CutMode, axis: "across" as CutAxis, flip: false, t: 1, sweep: false, dir: 1 };
const cutaway = new Cutaway();
/** world bounds of the building (all it is made of, a little beyond), for placing the plane and framing the camera */
const bounds = { min: new Vector3(-8, 0, -6), max: new Vector3(8, 22, 6) };
const CUT_MARGIN = 0.05;
/** the footprint, to turn the plane's place into the building's own coordinates */
const site = { width: 16, length: 12 };
/** whether the building on show wears the cut materials */
let cutShown = false;
/** the white model of the interior, the atlas rooms it replaces while cut, the room names */
let interior: Group | null = null;
let roomBoxes: Mesh | null = null;
let labels: RoomLabels | null = null;
const unfold = { selected: false, amount: 1, depth: dims.interior.unfold.frontDepth, focus: "all" as UnfoldFocus };
let unfoldView: UnfoldView | null = null;
let unfoldCurrent = 0;
let unfoldMotion: { from: number; to: number; elapsed: number } | null = null;
let cameraMotion: { from: Vector3; targetFrom: Vector3; to: Vector3; targetTo: Vector3; elapsed: number } | null = null;
let beforeUnfold: { position: Vector3; target: Vector3 } | null = null;
let lampSources: Parameters<LampLights["setLamps"]>[0] = [];
const unfoldActive = () => unfold.selected && cut.on && !view.gallery && !view.furnitureGallery && !interiorView.plan;
controls.addEventListener("start", () => { cameraMotion = null; });

function releaseUnfold(): void {
  if (!unfoldView) return;
  if (labels && shown) shown.add(labels.group);
  unfoldView.dispose(); unfoldView = null;
  if (shown) shown.visible = true;
  lampLights.setLamps(lampSources);
  env.frame({ center: new Vector3(0, bounds.max.y / 2, 0), radius: Math.hypot(site.width, site.length, bounds.max.y) / 2 });
}

function updateUnfold(): void {
  if (!unfoldView) return;
  unfoldView.update(unfoldCurrent, unfold.depth, unfold.focus);
  labels?.updateUnfold(interiorView.labels, r => unfoldView!.placement(r));
  lampLights.setLamps(unfoldView.lamps(lampSources));
}

function setUnfoldAmount(amount: number): void {
  cameraMotion = null;
  unfold.amount = amount;
  if (amount === 0) unfold.focus = "all";
  unfoldMotion = { from: unfoldCurrent, to: amount, elapsed: 0 };
  applyCut();
}

function focusUnfold(focus: UnfoldFocus): void {
  unfold.focus = focus;
  if (focus !== "all" && unfold.amount < 0.05) setUnfoldAmount(1);
  applyCut(); frameUnfold();
}

/** Frame every retained corner with a restrained, slightly elevated perspective. */
function frameUnfold(): void {
  if (!unfoldView) return;
  unfoldView.update(unfold.amount, unfold.depth, unfold.focus);
  const box = unfoldView.bounds();
  updateUnfold();
  if (box.isEmpty()) return;
  const target = box.getCenter(new Vector3());
  const el = dims.interior.unfold.elevation * Math.PI / 180;
  const forward = new Vector3(0, Math.sin(el), Math.cos(el)), up = new Vector3(0, Math.cos(el), -Math.sin(el));
  const tanV = Math.tan(camera.fov * Math.PI / 360) * 0.83, tanH = tanV * camera.aspect;
  let distance = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = new Vector3(x, y, z).sub(target), depth = p.dot(forward);
    distance = Math.max(distance, Math.abs(p.x) / tanH + depth, Math.abs(p.dot(up)) / tanV + depth);
  }
  cameraMotion = { from: camera.position.clone(), targetFrom: controls.target.clone(), to: target.clone().addScaledVector(forward, distance), targetTo: target, elapsed: 0 };
  env.frame({ center: target, radius: box.getSize(new Vector3()).length() / 2 });
}

function show(g: Group, center: Vector3, radius: number): void {
  if (shown) {
    root.remove(shown);
    shown.traverse(o => {
      // instanced parts share the kit's geometry: free only their instance buffers
      if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose();
      else if ((o as Mesh).isMesh) (o as Mesh).geometry.dispose();
      else if ((o as Sprite).isSprite) {
        const m = (o as Sprite).material;
        m.map?.dispose();
        m.dispose();
      }
    });
  }
  root.add(g);
  shown = g;
  env.frame({ center, radius });
}

/** put the camera in front of the kit overview, far enough that even the
 *  front row (nearest the camera, `front` metres ahead of the centre) fits */
function frameGallery(width: number, front: number): void {
  const vfov = (camera.fov * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const el = (28 * Math.PI) / 180;
  const dist = ((width / 2) * 1.06 / Math.tan(hfov / 2) + front) / Math.cos(el);
  camera.position.set(0, 1.5 + dist * Math.sin(el), dist * Math.cos(el));
  controls.target.set(0, 1.5, 0);
}

function rebuild(frame = false): void {
  if (!kit || !materials) return;
  releaseUnfold();
  cameraMotion = null;
  interior = roomBoxes = null;
  labels?.dispose();
  labels = null;
  street.group.visible = false;
  cutShown = false; // every new group starts with the plain materials
  if (view.gallery || view.furnitureGallery) {
    const gal = view.furnitureGallery ? buildFurnitureGallery(cutaway.galleryInterior) : buildGallery(kit, buildingStyle(params));
    overviewSize = gal;
    lampLights.setLamps([]); lampLights.on = false;
    show(gal.group, new Vector3(0, gal.height / 2, 0), Math.hypot(gal.width, gal.depth, gal.height) / 2);
    windows.update(null, null);
    roomEditor.update(null);
    if (frame) {
      frameGallery(gal.width, gal.depth / 2);
      if (view.furnitureGallery) camera.position.z *= -1;
    }
    toolbar.setInterior(false); toolbar.setLevel("");
    return;
  }
  const b = generateBuilding(params, kit);
  const edited = roomEdits.apply(planBuilding(b, params));
  const plan = edited.plan;
  markCafeShops(plan, params.seed);
  markAtticRooms(plan, params.seed);
  lastPlan = plan;
  interiorView.check = plan.issues.length ? `${plan.issues.length} 個問題` : "OK";
  if (plan.issues.length) console.warn(`plan: ${plan.issues.length} issues`, plan.issues);
  syncLevels(plan);
  if (interiorView.plan) {
    const g = buildPlanView(plan, interiorView.level, interiorView);
    g.position.set(-b.width / 2, -b.length / 2, 0);
    show(g, new Vector3(0, plan.levels[interiorView.level].floorZ, 0), Math.hypot(b.width, b.length) / 2 + 2);
    windows.update(null, null);
    roomEditor.update(null);
    return;
  }
  const walls = partyWalls(b.footprint, b.edgeKinds, b.roofBase);
  const flat = roofShape(b.footprint, b.edgeKinds, b.roofBase).z2;
  const g = kit.buildGroup(b.placements.concat(partyChimneys(params, kit, b.style, walls.edges, flat)));
  const cap = roofCap(b.footprint, b.edgeKinds, b.roofBase);
  const roof = new Mesh(cap.geometry, materials.byName.get("zinc:noao"));
  roof.castShadow = roof.receiveShadow = true;
  g.add(roof);
  if (walls.edges.length) {
    const wall = new Mesh(walls.geometry, materials.byName.get("plaster:noao"));
    wall.castShadow = wall.receiveShadow = true;
    g.add(wall);
  } else walls.geometry.dispose();
  const inside = buildInteriors(b.rooms, params.curtainNone, params.curtainClosed, params.curtainOpen, planRule(plan));
  roomBoxes = new Mesh(inside.rooms, materials.interior);
  roomBoxes.userData.uncut = true;
  g.add(roomBoxes);
  const curtains = new Mesh(inside.curtains, materials.voile);
  curtains.receiveShadow = true;
  g.add(curtains);
  interior = buildRooms3d(plan, b, kit, cutaway.interior, interiorView.look);
  // the stairs' railing: the kit's first lace pattern (欄杆與圓環)
  interior.add(buildStairs(plan, cutaway.interior, cutaway.cut(materials.lace(0)), materials.laceDepth(0), interiorView.look));
  const furniture = buildFurniture(plan, b, cutaway.interior, interiorView.look);
  interior.add(furniture);
  // the lamps' places in world space: Blender (x, y, z) -> (x - W/2, z, L/2 - y)
  const furnitureInfo = furniture.userData.furniture as FurnitureInfo;
  const worldLight = (p: Vector3) => new Vector3(p.x - b.width / 2, p.z, b.length / 2 - p.y);
  lampSources = [
    ...furnitureInfo.lamps.map(p => ({ position: worldLight(p), intensity: 9, distance: 4.2 })),
    ...furnitureInfo.lightSources.map(source => ({ ...source, position: worldLight(source.position) })),
  ];
  lampLights.setLamps(lampSources);
  g.add(interior);
  g.position.set(-b.width / 2, -b.length / 2, 0); // footprint centred on the origin
  const terrace = buildCafeTerrace(plan, b, cutaway.galleryInterior, street.params);
  terrace.group.userData.unfoldSkip = true;
  const cafeInfo = furniture.userData.cafe as CafeInfo;
  for (const [id, count] of Object.entries(terrace.rooms)) {
    const cafe = cafeInfo.rooms[id];
    if (cafe) { cafe.outdoorTables = count; cafe.outdoorChairs = count * 2; }
  }
  g.add(terrace.group);
  street.rebuild(b, params.seed, terrace.reserved);
  street.group.visible = true;
  show(g, new Vector3(0, cap.top / 2, 0), Math.hypot(b.width, b.length, cap.top) / 2);
  windows.update(b, g);
  // the cut runs over everything that stands out too (balconies, cornices, chimneys)
  g.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(g);
  bounds.min.copy(box.min).subScalar(CUT_MARGIN);
  bounds.max.copy(box.max).addScalar(CUT_MARGIN);
  site.width = b.width;
  site.length = b.length;
  labels = new RoomLabels(plan, interiorView.area);
  g.add(labels.group);
  applyCut(true);
  if (unfoldActive()) frameUnfold();
  roomEditor.update(edited, furniture.userData.salons as SalonInfo, furniture.userData.dining as DiningInfo, furniture.userData.kitchens as KitchenInfo, cafeInfo, furniture.userData.ballroom as BallroomInfo ?? null, furniture.userData.attic as AtticInfo ?? null);
}

/** the plane's place (world space) for the slider */
function cutPosition(): { at: number } {
  const { min, max } = bounds;
  if (cut.mode === "horizontal") return { at: min.y + (max.y - min.y) * cut.t };
  // the plane always sits at the same place; flipped, it keeps the other side, so the other end is the uncut one
  if (cut.axis === "across") return { at: min.x + (max.x - min.x) * cut.t };
  return { at: max.z - (max.z - min.z) * cut.t };
}

/**
 * Place the cut, and open the building or close it: while cut its materials
 * are the cut variants and the white model stands in for the atlas rooms. A
 * plane past the building leaves it whole, with the interior still in place (the toggle hides it).
 */
function applyCut(force = false): void {
  if (unfoldActive() && shown && lastPlan) {
    if (!unfoldView) {
      // Enable the real interior before copying render objects; atlas rooms are explicitly skipped.
      if (interior) interior.visible = true;
      if (roomBoxes) roomBoxes.visible = false;
      windows.update(null, null);
      unfoldView = new UnfoldView(shown, lastPlan, cutaway);
      root.add(unfoldView.group);
      if (labels) unfoldView.group.add(labels.group);
    }
    shown.visible = false; street.group.visible = false;
    cutShown = true; lampLights.on = true;
    unfold.depth = Math.min(unfold.depth, site.length * dims.interior.unfold.maxDepthRatio);
    updateUnfold();
    toolbar.show("unfold", cut.axis, cut.t, cut.flip);
    toolbar.showUnfold(unfold.amount, unfold.depth, site.length * dims.interior.unfold.maxDepthRatio, unfold.focus);
    toolbar.setInterior(true); toolbar.setLevel("");
    return;
  }
  if (unfoldView) {
    releaseUnfold(); force = true;
    street.group.visible = !view.gallery && !view.furnitureGallery && !interiorView.plan;
    if (kit && shown) windows.update(generateBuilding(params, kit), shown);
    if (beforeUnfold) {
      cameraMotion = { from: camera.position.clone(), targetFrom: controls.target.clone(), to: beforeUnfold.position, targetTo: beforeUnfold.target, elapsed: 0 };
      beforeUnfold = null;
    }
  }
  // the interior is on show whenever the toggle is on, also with the plane past the building (nothing cut away,
  // the real rooms behind the windows); the toggle hides it
  const { at } = cutPosition();
  const on = cut.on && !view.gallery && !view.furnitureGallery && !interiorView.plan;
  if (force || on !== cutShown) {
    if (shown) cutaway.apply(shown, on);
    if (interior) interior.visible = on;
    if (roomBoxes) roomBoxes.visible = !on;
    cutShown = on;
    lampLights.on = on;
  }
  cutaway.place(cut.mode, cut.axis, at, cut.flip);
  toolbar.show(unfold.selected ? "unfold" : cut.mode, cut.axis, cut.t, cut.flip);
  toolbar.setInterior(on);
  toolbar.setLevel(on && cut.mode === "horizontal" ? levelAt(at) : "");
  // the plane in the building's own (Blender) coordinates, for the room names
  const own = cut.mode === "horizontal" ? at : cut.axis === "across" ? at + site.width / 2 : site.length / 2 - at;
  labels?.update(on && interiorView.labels, cut.mode, cut.axis, own, cut.flip);
  labels?.setClip(on ? cutaway.plane : null);
}

/** name of the floor a height (m) is in, for the horizontal cut */
function levelAt(z: number): string {
  const lv = lastPlan?.levels;
  if (!lv || z < lv[0].floorZ) return "";
  for (let i = lv.length - 1; i >= 0; i--) if (z >= lv[i].floorZ) return z > lv[i].ceilingZ + 0.4 && i === lv.length - 1 ? "屋頂" : lv[i].name;
  return "";
}

/** the default view, framing the whole building (in the narrower of the two fields of view) */
function frameHome(): void {
  if (unfoldActive()) { frameUnfold(); return; }
  if ((view.gallery || view.furnitureGallery) && overviewSize) {
    frameGallery(overviewSize.width, overviewSize.depth / 2);
    if (view.furnitureGallery) camera.position.z *= -1;
    return;
  }
  const r = Math.hypot(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z, bounds.max.y) / 2;
  const vfov = (camera.fov * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const d = (r / Math.sin(Math.min(vfov, hfov) / 2)) * 1.05;
  controls.target.set(0, bounds.max.y * 0.42, 0);
  camera.position.copy(controls.target).addScaledVector(new Vector3(36, 13, 46).normalize(), d);
}

// ---- GUI ----
const gui = new GUI({ title: "european building kit" });
const update = () => rebuild();
gui.add(view, "gallery").name("零件總覽").listen().onChange((on: boolean) => {
  if (on) { view.furnitureGallery = false; interiorView.plan = false; }
  if (!on) {
    camera.position.set(36, 20, 46);
    controls.target.set(0, 7, 0);
  }
  toolbar.enableCut(!on && !interiorView.plan);
  rebuild(true);
});
gui.add(view, "furnitureGallery").name("家具總覽").listen().onChange((on: boolean) => {
  if (on) { view.gallery = false; interiorView.plan = false; }
  else { camera.position.set(36, 20, 46); controls.target.set(0, 7, 0); }
  toolbar.enableCut(!on && !interiorView.plan);
  rebuild(true);
});
const fBuilding = gui.addFolder("🏛 建築 (Building)");
fBuilding.add(params, "type", { "獨棟": "freestanding", "街角": "corner", "連棟": "row" }).name("建築類型").onChange(update);
fBuilding.add(params, "cornerStyle", { "直角": "pier", "斜切": "panCoupe" }).name("街角轉角").onChange(update);
fBuilding.add(params, "depth", 8, 20, 0.5).name("連棟進深 m").onChange(update);
fBuilding.add(params, "groundUse", { "住宅": "residential", "混合": "mixed", "店面": "shops" }).name("一樓用途").onChange(update);
fBuilding.add(params, "baysX", 2, 10, 1).name("正面開間數").onChange(update);
fBuilding.add(params, "baysY", 2, 8, 1).name("側面開間數").onChange(update);
fBuilding.add(params, "floors", 1, 6, 1).name("上層數").onChange(update);
fBuilding.add(params, "profile", { "奧斯曼（往上遞減）": "haussmann", "均一": "uniform" }).name("樓高配置").onChange(update);
fBuilding.add(params, "dormerEvery", { "每個開間": 1, "隔一個開間": 2 }).name("老虎窗").onChange(update);
fBuilding.add(params, "seed", 1, 999, 1).name("隨機種子").onChange(update);
const fRoof = gui.addFolder("🏠 屋頂 (Roof)");
fRoof.add(params, "dormerStyle", { "混合": "mixed", "鋅板": "zinc", "圓窗": "oeil", "弧頂": "segment", "三角山花": "triangle" }).name("老虎窗款式").onChange(update);
fRoof.add(params, "cresting").name("屋脊花飾").onChange(update);
fRoof.add(params, "chimneys", 0, 1, 0.05).name("煙囪密度").onChange(update);
const fFacade = gui.addFolder("🪟 立面細節 (Facade)");
fFacade.add(params, "ornament", { "0 無裝飾": 0, "1 只有窗套": 1, "2 奧斯曼層級": 2, "3 豐富": 3 }).name("裝飾層級").onChange(update);
fFacade.add(params, "pediment", { "三角、弧形交替": "alternate", "中央三角": "center", "全三角": "triangle", "全弧形": "segment", "平窗楣加托架": "cornice" }).name("二樓窗楣").onChange(update);
fFacade.add(params, "otherBalcony", { "窗前欄杆": "gardecorps", "單窗陽台": "balconnet", "交替": "alternate", "隨機": "random" }).name("其他樓層陽台").onChange(update);
fFacade.add(params, "consoles").name("陽台托架").onChange(update);
fFacade.add(params, "detailPattern", { "不放": "off", "全部相同": "same", "每層輪替": "alternate", "隨機": "random" }).name("窗間壁裝飾").onChange(update);
fFacade.add(params, "detailStyle", { "橫向溝槽": "refends", "壁柱": "pilasters", "浮雕飾板": "panels" }).name("裝飾樣式").onChange(update);
fFacade.add(params, "shutterClosed", 0, 1, 0.01).name("百葉全關機率").onChange(update);
fFacade.add(params, "shutterHalf", 0, 1, 0.01).name("百葉半開機率").onChange(update);
fFacade.add(params, "curtainNone", 0, 1, 0.01).name("無窗簾機率").onChange(update);
fFacade.add(params, "curtainClosed", 0, 1, 0.01).name("窗簾拉上機率").onChange(update);
fFacade.add(params, "curtainOpen", 0, 1, 0.01).name("窗簾拉開程度").onChange(update);
fFacade.add(params, "windowOpen", 0, 1, 0.01).name("開窗機率").onChange(update);
fFacade.add(params, "windowDir", { "內開": "in", "外開": "out" }).name("開窗方向").onChange(update);
fFacade.add(params, "windowAngle", 10, 110, 1).name("最大開窗角度 °").onChange(update);
fFacade.add(params, "doorStyle", { "拱形馬車大門": "arched", "方形馬車大門": "rect", "玻璃大門": "glazed", "隨機": "random" }).name("大門款式").onChange(update);
fFacade.add(params, "groundWindow", { "拱窗": "arched", "方窗": "rect" }).name("一樓窗").onChange(update);
fFacade.add({ clear: () => windows.clearAll() }, "clear").name("清除所有個別設定的窗戶");
const fLook = gui.addFolder("🎨 外觀 (Look)");
fLook.add({ look: "haussmann" as FacadeLook }, "look", { "奧斯曼（原本）": "haussmann", "巴黎淺色石灰岩": "paris" }).name("外牆材質")
  .onChange((l: FacadeLook) => {
    materials?.setLook(l);
    // the look brings its own shutter paint (it can still be changed after)
    params.shutter = FACADE_LOOKS[l].shutter;
    gui.controllersRecursive().forEach(c => c.updateDisplay());
    rebuild();
  });
fLook.addColor(params, "stone").name("石材色調").onChange(update);
fLook.addColor(params, "paint").name("大門漆色").onChange(update);
fLook.addColor(params, "shutter").name("百葉漆色").onChange(update);
fLook.addColor(params, "awning").name("遮雨棚顏色").onChange(update);
fLook.add(params, "lace", Object.fromEntries(LACE_PATTERNS.map((n, i) => [n, i]))).name("欄杆鐵花").onChange(update);
const fStreet = gui.addFolder("🌳 街道 (Street)");
fStreet.add(street.params, "sidewalk").name("人行道").onChange(update);
fStreet.add(street.params, "width", 1.5, 6, 0.1).name("人行道寬度 m").onChange(update);
fStreet.add(street.params, "count", 0, 8, 1).name("每面路樹數").onChange(update);
const fInterior = gui.addFolder("🏢 室內樓層 (Interior)");
fInterior.add(interiorView, "plan").name("平面檢視（除錯）").listen().onChange((on: boolean) => {
  if (on) {
    view.gallery = view.furnitureGallery = false;
    const z = lastPlan?.levels[interiorView.level]?.floorZ ?? 0;
    controls.target.set(0, z, 0);
    camera.position.set(12, z + 30, 26);
  } else {
    camera.position.set(36, 20, 46);
    controls.target.set(0, 7, 0);
  }
  toolbar.enableCut(!on && !view.gallery && !view.furnitureGallery);
  rebuild();
});
const levelCtrl = fInterior.add(interiorView, "level", 0, 7, 1).name("樓層（除錯）").onChange(() => {
  // keep the view, at the new floor's height
  const z = lastPlan?.levels[interiorView.level]?.floorZ;
  if (interiorView.plan && z !== undefined) {
    const dz = z - controls.target.y;
    controls.target.y += dz;
    camera.position.y += dz;
  }
  rebuild();
});
fInterior.add(interiorView, "look", { "寫實材質": "real", "圖解（每種空間一個顏色）": "diagram", "白模": "white" }).name("室內呈現").onChange(update);
fInterior.add(interiorView, "labels").name("房間名稱").onChange(update);
fInterior.add(interiorView, "area").name("顯示面積").onChange(update);
fInterior.add(params, "ballroom").name("宴會廳").onChange(update);
fInterior.add(params, "ballroomFacade", { "兩排窗": "rows", "跨兩層高窗": "tall" }).name("宴會廳立面").onChange(update);
fInterior.add(params, "apartments", { "自動": "auto", "一戶": "one", "兩戶": "two" }).name("每層戶數").onChange(update);
fInterior.add(interiorView, "check").name("平面檢查").disable().listen();

/** the level slider follows the building's floors and shows the level's name */
function syncLevels(plan: BuildingPlan): void {
  const top = plan.levels.length - 1;
  if (interiorView.level > top) interiorView.level = top;
  levelCtrl.max(top);
  levelCtrl.name(`樓層（除錯：${plan.levels[interiorView.level].name}）`);
  levelCtrl.updateDisplay();
}

/** click a window to set its facade details on its own (windowEditor.ts) */
const roomEditor = new RoomEditor({
  canvas: renderer.domElement, camera, gui, edits: roomEdits,
  labels: () => labels,
  rebuild: () => rebuild(),
});
const windows = new WindowEditor({
  canvas: renderer.domElement, camera, gui, params,
  shown: () => (unfoldActive() || view.gallery || view.furnitureGallery || interiorView.plan ? null : shown),
  clip: () => (cutShown ? cutaway.plane : null),
  rebuild: () => rebuild(),
  ignorePointer: e => roomEditor.consumedEvent(e),
});

// ---- the section panel and the bottom toolbar ----
let saveNext = false;
const toolbar = new Toolbar({
  interior: on => {
    if (on && unfold.selected) {
      beforeUnfold = { position: camera.position.clone(), target: controls.target.clone() };
      unfoldCurrent = 0; unfoldMotion = { from: 0, to: unfold.amount, elapsed: 0 };
    }
    cut.on = on;
    if (on) gui.close();
    applyCut();
    if (unfoldActive()) frameUnfold();
  },
  rotate: on => {
    controls.autoRotate = on;
    controls.autoRotateSpeed = 0.8;
  },
  cut: on => {
    if (on && unfold.selected && !cut.on) {
      beforeUnfold = { position: camera.position.clone(), target: controls.target.clone() };
      unfoldCurrent = 0; unfoldMotion = { from: 0, to: unfold.amount, elapsed: 0 };
    }
    cut.on = on;
    if (on) gui.close(); // out of the panel's way; the person can open it again
    applyCut();
    if (unfoldActive()) frameUnfold();
  },
  home: () => frameHome(),
  save: () => (saveNext = true),
  mode: m => {
    const entering = m === "unfold" && !unfold.selected;
    unfold.selected = m === "unfold";
    cut.sweep = false; toolbar.setSweep(false);
    if (m !== "unfold") { cut.mode = m; unfoldMotion = null; cameraMotion = null; }
    else {
      cut.on = true;
      if (entering) {
        controls.autoRotate = false; toolbar.setRotate(false);
        beforeUnfold = { position: camera.position.clone(), target: controls.target.clone() };
        unfoldCurrent = 0; unfoldMotion = { from: 0, to: unfold.amount, elapsed: 0 };
      }
    }
    applyCut();
    if (m === "unfold") frameUnfold();
  },
  unfoldAmount: setUnfoldAmount,
  unfoldDepth: t => {
    unfold.depth = t * site.length * dims.interior.unfold.maxDepthRatio;
    applyCut();
  },
  unfoldFocus: focusUnfold,
  axis: a => {
    cut.axis = a;
    applyCut();
  },
  flip: on => {
    cut.flip = on;
    applyCut();
  },
  slide: t => {
    cut.t = t;
    applyCut();
  },
  sweep: on => (cut.sweep = on),
});
toolbar.show(cut.mode, cut.axis, cut.t, cut.flip);

// A click focuses a retained slice; dragging remains orbit control and room-label clicks keep editing.
let unfoldPress: { x: number; y: number; id: number } | null = null;
renderer.domElement.addEventListener("pointerdown", e => {
  if (unfoldPress) { unfoldPress = null; return; }
  if (unfoldActive() && e.isPrimary && e.button === 0) unfoldPress = { x: e.clientX, y: e.clientY, id: e.pointerId };
});
renderer.domElement.addEventListener("pointercancel", () => { unfoldPress = null; });
renderer.domElement.addEventListener("pointerup", e => {
  const p = unfoldPress; unfoldPress = null;
  if (!p || p.id !== e.pointerId || !unfoldView || !unfoldActive() || roomEditor.consumedEvent(e) || Math.hypot(p.x - e.clientX, p.y - e.clientY) > 5) return;
  const rect = renderer.domElement.getBoundingClientRect(), ray = new Raycaster();
  camera.updateWorldMatrix(true, false);
  ray.setFromCamera(new Vector2((e.clientX - rect.left) / rect.width * 2 - 1, 1 - (e.clientY - rect.top) / rect.height * 2), camera);
  const focus = unfoldView.pick(ray);
  if (focus) focusUnfold(focus);
});

/** download the frame just rendered as a PNG (called right after rendering, while the canvas still holds it) */
function savePicture(): void {
  renderer.domElement.toBlob(blob => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `building-${params.seed}${cut.on ? `-${unfold.selected ? "展開" : cut.mode === "horizontal" ? "水平" : "縱剖"}` : ""}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, "image/png");
}

const perf = { pixelRatio: DEFAULT_PIXEL_RATIO, msaa: 2 };
const fPerf = gui.addFolder("⚡ 效能與畫質");
fPerf.add(perf, "pixelRatio", 0.5, 2, 0.05).name("渲染像素比").onChange((v: number) => {
  renderer.setPixelRatio(v);
  post.setPixelRatio(v);
});
fPerf.add(post, "enabled").name("後製特效");
fPerf.add(perf, "msaa", { "關閉": 0, "2x": 2, "4x": 4 }).name("後製抗鋸齒").onChange((v: number) => post.setSamples(Number(v)));
fPerf.close();
env.addGui(gui);

// mood extras beyond lights + sky: the post-processing grade
env.onMood = s => {
  materials?.setNight(s.night);
  post.bloom.strength = s.bloom;
  post.bloom.threshold = s.bloomThreshold;
  post.bloom.radius = s.bloomRadius;
  post.gradeUniforms["uVignette"].value = s.vignette;
  post.gradeUniforms["uSaturation"].value = s.saturation;
  post.gradeUniforms["uContrast"].value = s.contrast;
};
env.applyMood(env.settings.mood);

/** dev: plan every combination of the test matrix (INTERIOR_SPEC.md §12) and
 *  collect the ones checkPlan complains about */
function planCheckAll(seeds = [1, 2], apartments: BuildingParams["apartments"][] = ["auto"]) {
  if (!kit) return null;
  const fails: unknown[] = [];
  /** problems by kind (numbers and room ids stripped), with the first case of each */
  const kinds: Record<string, { count: number; example: unknown }> = {};
  let total = 0;
  for (const type of ["freestanding", "corner", "row"] as const) {
    for (const cornerStyle of ["pier", "panCoupe"] as const) {
      for (const baysX of [2, 3, 5, 7, 10]) {
        for (const side of type === "row" ? [8, 12, 16, 20] : [2, 3, 5, 8]) {
          for (const floors of [1, 2, 4, 6]) {
            for (const ballroom of [true, false]) {
              for (const groundUse of ["residential", "mixed", "shops"] as const) {
                for (const seed of seeds) {
                  for (const apt of apartments) {
                    const q: BuildingParams = {
                      ...params, type, cornerStyle, baysX, floors, ballroom, groundUse, seed, apartments: apt,
                      ...(type === "row" ? { depth: side } : { baysY: side }),
                    };
                    const plan = planBuilding(generateBuilding(q, kit), q);
                    total++;
                    if (plan.issues.length) {
                      const f = { type, cornerStyle, baysX, side, floors, ballroom, groundUse, seed, apt, issues: plan.issues.slice(0, 4) };
                      fails.push(f);
                      for (const i of plan.issues) {
                        const k = i.replace(/\d+F-\d+|閣樓-\d+|[\d.]+/g, "#");
                        kinds[k] ??= { count: 0, example: f };
                        kinds[k].count++;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return { total, failed: fails.length, kinds, sample: fails.slice(0, 30) };
}

// dev only: handles for scripted screenshots / debugging from the console
if (import.meta.env.DEV) {
  Object.assign(window, {
    __app: {
      camera, controls, params, view, interiorView, rebuild, scene, renderer, env, planCheckAll,
      cut, cutaway, toolbar, applyCut, frameHome, bounds, site, street, windows,
      roomEdits, roomEditor,
      unfold, focusUnfold, setUnfoldAmount,
      get unfoldView() { return unfoldView; },
      get plan() { return lastPlan; },
      get kit() { return kit; },
    },
  });
}

const base = import.meta.env.BASE_URL;
createMaterials(base).then(async m => {
  materials = m;
  kit = new Kit(m);
  m.setNight(env.settings.night);
  await kit.load(`${base}assets/kit.glb`, `${base}assets/kit_manifest.json`);
  rebuild();
  document.getElementById("loading")?.remove();
}).catch(err => {
  console.error(err);
  const el = document.getElementById("loading");
  if (el) el.textContent = "kit failed to load";
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
  if (unfoldActive()) frameUnfold();
});

const clock = new Clock();
const SWEEP_SECONDS = 14; // one way
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (unfoldActive() && unfoldMotion) {
    unfoldMotion.elapsed += dt;
    const t = Math.min(1, unfoldMotion.elapsed / dims.interior.unfold.seconds), smooth = t * t * (3 - 2 * t);
    unfoldCurrent = unfoldMotion.from + (unfoldMotion.to - unfoldMotion.from) * smooth;
    updateUnfold();
    if (t === 1) unfoldMotion = null;
  }
  if (cameraMotion) {
    cameraMotion.elapsed += dt;
    const t = Math.min(1, cameraMotion.elapsed / dims.interior.unfold.seconds), smooth = t * t * (3 - 2 * t);
    camera.position.lerpVectors(cameraMotion.from, cameraMotion.to, smooth);
    controls.target.lerpVectors(cameraMotion.targetFrom, cameraMotion.targetTo, smooth);
    if (t === 1) cameraMotion = null;
  }
  if (cut.on && cut.sweep && !unfold.selected) {
    // back and forth, short of the ends (all gone / all there)
    cut.t += (cut.dir * dt) / SWEEP_SECONDS;
    if (cut.t > 0.98) [cut.t, cut.dir] = [0.98, -1];
    if (cut.t < 0.04) [cut.t, cut.dir] = [0.04, 1];
    applyCut();
  }
  controls.update();
  lampLights.update(controls.target);
  env.tick(camera.position);
  post.render(dt);
  if (saveNext) {
    saveNext = false;
    savePicture();
  }
});
