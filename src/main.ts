/**
 * European building kit viewer.
 * Lighting moods, sky and post-processing come from v1 (see CLAUDE.md); the building
 * is assembled from the kit (blender/ -> public/assets/kit.glb) by generator.ts.
 */
import {
  ACESFilmicToneMapping, Box3, BoxGeometry, Clock, GridHelper, Group, type InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  Matrix4, PerspectiveCamera, PlaneGeometry, Ray, Raycaster, SRGBColorSpace, Scene, type Sprite, Vector2, Vector3, WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";
import { Environment } from "./environment";
import { buildGallery } from "./gallery";
import { buildFurnitureGallery } from "./furnitureGallery";
import { buildingStyle, generateBuilding, partyChimneys, type Building } from "./generator";
import { Kit } from "./kit";
import { FACADE_LOOKS, type FacadeLook, type KitMaterials, LACE_PATTERNS, createMaterials, forkKitMaterials } from "./materials";
import { type BuildingParams, defaultInteractiveParams, copyBuildingParams } from "./params";
import { fitPerspectiveBox, perspectiveBoxFits } from "./cameraFrame";
import { PostFX } from "./postfx";
import { buildInteriors, planRule } from "./interiors";
import { type BuildingPlan, planBuilding } from "./plan";
import { runPlanChecks } from "./planChecks";
import { limitCases, checkLimitCase } from "./limitChecks";
import { buildPlanView } from "./planView";
import { partyWalls, buildingRoof, buildingRoofCap, courtyardClosure, roofShape } from "./roof";
import { type CutAxis, type CutMode, Cutaway } from "./cutaway";
import { buildRooms3d } from "./rooms3d";
import { RoomLabels } from "./roomLabels";
import { type FurnitureInfo, type CafeInfo, buildCafeTerrace, buildFurniture } from "./furniture";
import { LampLights } from "./lampLights";
import { buildStairs } from "./stairs";
import { StreetLife, defaultStreet } from "./streetlife";
import { markCafeShops } from "./cafes";
import { markAtticRooms } from "./attics";
import { WindowEditor } from "./windowEditor";
import { RoomEdits, type EditedPlan } from "./roomEdits";
import { RoomEditor } from "./roomEditor";
import type { Look } from "./finishes";
import { Toolbar } from "./toolbar";
import { UnfoldView, type UnfoldFocus } from "./unfold";
import dims from "../blender/kit_dims.json";
import { BuildingScene, type AddDirection } from "./buildingScene";
import { bindBuildingOrigin } from "./shaderVariant";
import { FacadeTransparency } from "./facadeTransparency";
import { BuildingPipeline, interiorKey } from './buildingPipeline';

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
const params = defaultInteractiveParams();
let lastAcceptedParams: BuildingParams | null = null;
let roomEdits = new RoomEdits();
const view = { gallery: false, furnitureGallery: false };
let overviewSize: { width: number; depth: number } | null = null;
/** the study lamps' light (lampLights.ts) */
const lampLights = new LampLights(scene);
/** sidewalk and street trees, in world space beside the building (streetlife.ts) */
let street = new StreetLife();
const streetSettings = defaultStreet();
const facadeSettings = { look: "haussmann" as FacadeLook };
scene.add(street.group);
/** floor plans (INTERIOR_SPEC.md): the plan view of one level, its labels, the plan check */
const interiorView = { plan: false, level: 1, labels: true, area: false, check: "—", look: "real" as Look };
let materials: KitMaterials | null = null;
let sharedMaterials: KitMaterials | null = null;
let kit: Kit | null = null;
let shown: Group | null = null;
let lastPlan: BuildingPlan | null = null;
let lastBuilding: Building | null = null;
let lastFurniture: Group | null = null;
let lastEdited: EditedPlan | null = null;
let pipeline = new BuildingPipeline();
let builtInteriorKey = '';
const rebuildMetrics = { count: 0, interiorBuilds: 0, last: { prepareMs: 0, cpuMs: 0 }, frames: [] as number[] };

/** cutting the building open (INTERIOR_SPEC.md §2): t is the plane's place, 0..1 within the bounds */
const cut = { on: false, mode: "horizontal" as CutMode, axis: "across" as CutAxis, flip: false, t: 1, sweep: false, dir: 1, facadeTransparency: 0 };
const facadeTransparency = new FacadeTransparency();
let cutaway = new Cutaway();
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
const unfold = { selected: false, amount: dims.interior.unfold.initialAmount, depth: dims.interior.unfold.frontDepth, focus: "all" as UnfoldFocus };
let unfoldView: UnfoldView | null = null;
let unfoldCurrent = 0;
let unfoldSpacing: number | null = null;
let unfoldMotion: { from: number; to: number; elapsed: number } | null = null;
let cameraMotion: { from: Vector3; targetFrom: Vector3; to: Vector3; targetTo: Vector3; elapsed: number } | null = null;
let beforeUnfold: { position: Vector3; target: Vector3 } | null = null;
let lampSources: Parameters<LampLights["setLamps"]>[0] = [];
const unfoldActive = () => unfold.selected && cut.on && !view.gallery && !view.furnitureGallery && !interiorView.plan;

interface BuildingRuntime {
  params: BuildingParams; edits: RoomEdits; street: StreetLife; materials: KitMaterials;
  cutaway: Cutaway; cut: typeof cut; unfold: typeof unfold; spacing: number | null;
  interiorView: typeof interiorView; facadeLook: FacadeLook;
  shown: Group | null; interior: Group | null; roomBoxes: Mesh | null; labels: RoomLabels | null;
  plan: BuildingPlan | null; building: Building | null; furniture: Group | null;
  edited: EditedPlan | null;
  pipeline: BuildingPipeline; interiorKey: string;
  bounds: { min: Vector3; max: Vector3 }; site: typeof site; lamps: typeof lampSources;
}
let cityEditMode = false;
const city = new BuildingScene<BuildingRuntime>(dims.street.block.clearance);
city.add("right", null, new Box3(new Vector3(-8, 0, -6), new Vector3(8, 22, 6)), 12);
scene.add(city.active.root);

function captureBuilding(): BuildingRuntime {
  return { params: structuredClone(lastAcceptedParams ?? params), edits: roomEdits, street, materials: materials!,
    cutaway, cut: { ...cut }, unfold: { ...unfold }, spacing: unfoldSpacing,
    interiorView: { ...interiorView }, facadeLook: facadeSettings.look,
    shown, interior, roomBoxes, labels, plan: lastPlan, building: lastBuilding, furniture: lastFurniture, edited: lastEdited, pipeline, interiorKey: builtInteriorKey,
    bounds: { min: bounds.min.clone(), max: bounds.max.clone() }, site: { ...site }, lamps: lampSources };
}

function restoreBuildingParams(saved: BuildingParams): void {
  // Optional mode/version fields from another building must not survive restoration.
  for (const key of Object.keys(params) as (keyof BuildingParams)[]) if (!(key in saved)) delete params[key];
  Object.assign(params, structuredClone(saved));
  params.floorVariety = saved.floorVariety ?? false;
  lastAcceptedParams = structuredClone(params);
}

function bindBuildingEditors(): void {
  windows.update(lastBuilding, shown);
  const data = lastFurniture?.userData;
  roomEditor.update(lastEdited,
    data?.salons ?? null, data?.dining ?? null, data?.kitchens ?? null, data?.cafe ?? null,
    data?.ballroom ?? null, data?.attic ?? null);
}

interface BuildingCreation { params: BuildingParams; edits: RoomEdits; pipeline: BuildingPipeline }
function selectBuilding(id: string, animate = false, creation?: BuildingCreation): void {
  const next = city.buildings.find(b => b.id === id);
  if (!cityEditMode || !next || id === city.activeId || !materials || view.gallery || view.furnitureGallery || interiorView.plan) return;
  if (!next.state && !creation) return;
  if (citySwitchTimer !== null) clearTimeout(citySwitchTimer);
  citySwitchTimer = null;
  cancelQueuedRebuild();
  cancelExteriorPreview();
  const cameraFrom = camera.position.clone(), targetFrom = controls.target.clone();
  const previous = city.active, saved = captureBuilding();
  previous.state = saved;
  facadeTransparency.dispose();
  roomEditor.clearSelection(); windows.update(null, null);
  releaseUnfold();
  if (shown) { cutaway.apply(shown, false); shown.visible = true; previous.root.add(shown); }
  // Dormant buildings retain only their exterior. Recreate rooms lazily on selection/cutting.
  if (interior) {
    interior.removeFromParent();
    interior.traverse(o => {
      if ((o as InstancedMesh).isInstancedMesh) { (o as InstancedMesh).dispose(); if (o.userData.ownsGeometry) (o as Mesh).geometry.dispose(); }
      else if ((o as Mesh).isMesh) (o as Mesh).geometry.dispose();
    });
    saved.interior = null; saved.furniture = null; saved.lamps = [];
  }
  if (roomBoxes) roomBoxes.visible = true;
  labels?.dispose(); saved.labels = null;
  street.group.visible = true;
  city.activeId = id;
  root.position.copy(next.position);
  const offset = next.position.clone().sub(previous.position);
  camera.position.add(offset); controls.target.add(offset);
  cameraMotion = null; unfoldMotion = null; beforeUnfold = null; cutShown = false;
  const state = next.state;
  if (state) {
    restoreBuildingParams(state.params); roomEdits = state.edits;
    street = state.street; materials = state.materials; cutaway = state.cutaway;
    Object.assign(streetSettings, street.params); Object.assign(cut, state.cut); Object.assign(unfold, state.unfold);
    Object.assign(interiorView, state.interiorView); facadeSettings.look = state.facadeLook;
    unfoldSpacing = state.spacing; unfoldCurrent = unfold.amount;
    shown = state.shown; interior = state.interior; roomBoxes = state.roomBoxes; labels = state.labels;
    lastPlan = state.plan; lastBuilding = state.building; lastFurniture = state.furniture;
    lastEdited = state.edited;
    pipeline = state.pipeline; builtInteriorKey = state.interiorKey;
    bounds.min.copy(state.bounds.min); bounds.max.copy(state.bounds.max); Object.assign(site, state.site);
    const box = new Box3(bounds.min, bounds.max);
    env.frame({ center: box.getCenter(new Vector3()), radius: box.getSize(new Vector3()).length() / 2 });
    lampSources = state.lamps; lampLights.setLamps(lampSources);
    if (shown) root.add(shown);
    bindBuildingEditors();
    if (lastPlan) syncLevels(lastPlan);
    syncPlanningControls();
    applyCut(true);
  } else {
    restoreBuildingParams(creation!.params);
    roomEdits = creation!.edits; pipeline = creation!.pipeline; builtInteriorKey = ''; cutaway = new Cutaway(); materials = forkKitMaterials(sharedMaterials!, next.position);
    for (const material of new Set(Object.values(cutaway.interior))) bindBuildingOrigin(material, next.position);
    materials.setLook(saved.facadeLook); facadeSettings.look = saved.facadeLook;
    street = new StreetLife(); Object.assign(street.params, streetSettings); street.group.position.copy(next.position); scene.add(street.group);
    shown = null; interior = null; roomBoxes = null; labels = null; lastBuilding = null; lastPlan = null; lastFurniture = null;
    Object.assign(cut, { on: false, sweep: false, t: 1, facadeTransparency: 0 });
    Object.assign(unfold, { selected: false, amount: dims.interior.unfold.initialAmount, depth: dims.interior.unfold.frontDepth, focus: "all" });
    unfoldCurrent = 0; unfoldSpacing = null; interiorView.plan = false;
    rebuild();
  }
  gui.controllersRecursive().forEach(c => c.updateDisplay());
  citySelection.building = id; cityController.updateDisplay();
  toolbar.setSweep(cut.sweep); updateCityUI();
  if (animate) {
    // Reframe the selected building rather than carrying over an off-centre orbit target.
    const box = unfoldView ? unfoldView.bounds() : new Box3(bounds.min, bounds.max);
    const targetTo = box.getCenter(new Vector3());
    const halfFov = Math.min(camera.fov * Math.PI / 360, Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect));
    const distance = box.getSize(new Vector3()).length() / 2 / Math.sin(halfFov) * 1.05;
    const to = targetTo.clone().addScaledVector(new Vector3(36, 13, 46).normalize(), distance);
    camera.position.copy(cameraFrom); controls.target.copy(targetFrom);
    cameraMotion = { from: cameraFrom, targetFrom, to, targetTo, elapsed: 0 };
  }
}

function addBuilding(side: AddDirection): void {
  if (!cityEditMode || !materials || !kit || view.gallery || view.furnitureGallery || interiorView.plan || unfoldActive()) return;
  const source = city.active;
  const accepted = lastAcceptedParams ?? params;
  const creation: BuildingCreation = {
    params: copyBuildingParams(accepted, Math.max(accepted.seed, ...city.buildings.map(b => b.state?.params.seed ?? 0)) + 1),
    edits: new RoomEdits(), pipeline: new BuildingPipeline(),
  };
  // Validate the independent seed before adding an entry or releasing the source.
  try { creation.pipeline.prepare(creation.params, kit, creation.edits); }
  catch (error) {
    cancelQueuedRebuild(); cancelExteriorPreview(); restoreBuildingParams(accepted); syncPlanningControls();
    planningStatus.textContent = `無法新增：${(error as Error).message}。已保留目前建築。`;
    planningStatus.dataset.state = "error";
    gui.controllersRecursive().forEach(c => c.updateDisplay());
    return;
  }
  const oldPositions = new Map(city.buildings.map(entry => [entry.id, entry.position.clone()]));
  const entry = city.add(side, null, source.localBounds, source.length);
  syncDormantPositions(oldPositions);
  scene.add(entry.root); refreshCityChoices(); selectBuilding(entry.id, true, creation);
}
function syncDormantPositions(oldPositions: Map<string, Vector3>): void {
  for (const entry of city.buildings) {
    const old = oldPositions.get(entry.id);
    if (!old || entry.id === city.activeId || !entry.state) continue;
    const delta = entry.position.clone().sub(old);
    entry.state.street.group.position.copy(entry.position);
    entry.state.bounds.min.add(delta); entry.state.bounds.max.add(delta);
    for (const lamp of entry.state.lamps) lamp.position.add(delta);
  }
}
controls.addEventListener("start", () => { cameraMotion = null; });

function releaseUnfold(): void {
  if (!unfoldView) return;
  facadeTransparency.dispose();
  if (labels && shown) shown.add(labels.group);
  unfoldView.dispose(); unfoldView = null;
  if (shown) shown.visible = true;
  lampLights.setLamps(lampSources);
  env.frame({ center: root.position.clone().add(new Vector3(0, bounds.max.y / 2, 0)), radius: Math.hypot(site.width, site.length, bounds.max.y) / 2 });
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
  unfoldMotion = null;
  unfoldCurrent = amount;
  applyCut();
}

function focusUnfold(focus: UnfoldFocus): void {
  unfold.focus = focus;
  if (focus !== "all" && unfold.amount < 0.05) setUnfoldAmount(1);
  applyCut(); frameUnfold(false);
}

/** Frame every retained corner with a restrained, slightly elevated perspective. */
function frameUnfold(usePresentation = true): void {
  if (!unfoldView) return;
  unfoldView.update(unfold.amount, unfold.depth, unfold.focus);
  const box = unfoldView.bounds();
  updateUnfold();
  if (box.isEmpty()) return;
  const presentationTarget = new Vector3().fromArray(dims.interior.unfold.presentationTarget).add(root.position);
  const presentationPosition = new Vector3().fromArray(dims.interior.unfold.presentationPosition).add(root.position);
  if (usePresentation && perspectiveBoxFits(box, presentationPosition, presentationTarget, camera.fov, camera.aspect)) {
    const target = presentationTarget;
    cameraMotion = {
      from: camera.position.clone(), targetFrom: controls.target.clone(),
      to: presentationPosition, targetTo: target, elapsed: 0,
    };
    env.frame({ center: box.getCenter(new Vector3()), radius: box.getSize(new Vector3()).length() / 2 });
    return;
  }
  const el = dims.interior.unfold.elevation * Math.PI / 180;
  const forward = new Vector3(0, Math.sin(el), Math.cos(el));
  const { target, position } = fitPerspectiveBox(box, forward, camera.fov, camera.aspect);
  cameraMotion = { from: camera.position.clone(), targetFrom: controls.target.clone(), to: position, targetTo: target, elapsed: 0 };
  env.frame({ center: target, radius: box.getSize(new Vector3()).length() / 2 });
}

function show(g: Group, center: Vector3, radius: number): void {
  if (shown) {
    root.remove(shown);
    shown.traverse(o => {
      // instanced parts share the kit's geometry: free only their instance buffers
      if ((o as InstancedMesh).isInstancedMesh) { (o as InstancedMesh).dispose(); if (o.userData.ownsGeometry) (o as Mesh).geometry.dispose(); }
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
  env.frame({ center: center.clone().add(root.position), radius });
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

let previewTimer: ReturnType<typeof setTimeout> | null = null;
let commitTimer: ReturnType<typeof setTimeout> | null = null;
function cancelQueuedRebuild(): void {
  if (commitTimer !== null) clearTimeout(commitTimer);
  commitTimer = null;
}
/** Let the input event finish, coalesce commits and discard work after a city switch. */
function queueRebuild(): void {
  cancelQueuedRebuild();
  const buildingId = city.activeId;
  commitTimer = setTimeout(() => {
    commitTimer = null;
    if (city.activeId === buildingId) rebuild();
  }, 0);
}
let exteriorPreview: Group | null = null;
let previewVisibility: { shown: boolean; unfold: boolean; street: boolean } | null = null;
function cancelExteriorPreview(): void {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = null;
  if (exteriorPreview) {
    exteriorPreview.removeFromParent();
    exteriorPreview.traverse(o => {
      if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose();
      else if ((o as Mesh).isMesh) (o as Mesh).geometry.dispose();
    });
    exteriorPreview = null;
  }
  if (previewVisibility) {
    if (shown) shown.visible = previewVisibility.shown;
    if (unfoldView) unfoldView.group.visible = previewVisibility.unfold;
    street.group.visible = previewVisibility.street;
    previewVisibility = null;
  }
}
function previewExterior(): void {
  if (previewTimer || !kit || !materials || view.gallery || view.furnitureGallery || interiorView.plan) return;
  const buildingId = city.activeId;
  previewTimer = setTimeout(() => {
    previewTimer = null;
    if (city.activeId !== buildingId || !kit || !materials) return;
    let b: Building;
    try { b = generateBuilding(params, kit); } catch { return; }
    cancelExteriorPreview();
    const g = kit.buildGroup(b.placements, materials), cap = buildingRoofCap(b);
    g.add(new Mesh(cap.geometry, materials.byName.get('zinc:noao')));
    g.position.set(-b.width / 2, -b.length / 2, 0);
    // Preview has no old-plan room boxes, labels or furniture behind its changed windows.
    previewVisibility = { shown: shown?.visible ?? false, unfold: unfoldView?.group.visible ?? false, street: street.group.visible };
    if (shown) shown.visible = false;
    if (unfoldView) unfoldView.group.visible = false;
    street.group.visible = false;
    exteriorPreview = g; root.add(g);
  }, 120);
}

function rebuild(frame = false, fresh = false): void {
  if (!kit || !materials) return;
  cancelQueuedRebuild();
  cancelExteriorPreview();
  const started = performance.now();
  const activePipeline = fresh ? new BuildingPipeline() : pipeline;
  let prepared: ReturnType<BuildingPipeline['prepare']> | null = null;
  if (!view.gallery && !view.furnitureGallery) {
    try { prepared = activePipeline.prepare(params, kit, roomEdits); }
    catch (error) {
      console.error(error);
      if (lastAcceptedParams) restoreBuildingParams(lastAcceptedParams);
      interiorView.check = (error as Error).message;
      syncPlanningControls();
      planningStatus.textContent = `無法套用：${(error as Error).message}。已保留最後有效建築。`;
      planningStatus.dataset.state = "error";
      gui.controllersRecursive().forEach(c => c.updateDisplay());
      return;
    }
  }
  if (prepared) lastAcceptedParams = structuredClone(params);
  pipeline = activePipeline;
  const prepareMs = performance.now() - started;
  const nextInteriorKey = interiorKey(params, roomEdits, interiorView.look);
  const retainedInterior = !fresh && prepared && cut.on && !interiorView.plan && builtInteriorKey === nextInteriorKey ? interior : null;
  const retainedFurniture = retainedInterior ? lastFurniture : null;
  const retainedLabels = !fresh && prepared?.edited.plan === lastPlan && !interiorView.plan ? labels : null;
  // Detach before disposing the old exterior. A reused interior owns its buffers.
  retainedInterior?.removeFromParent();
  facadeTransparency.dispose();
  releaseUnfold();
  retainedLabels?.group.removeFromParent();
  const overview = view.gallery || view.furnitureGallery || interiorView.plan;
  root.position.copy(view.gallery || view.furnitureGallery ? new Vector3() : city.active.position);
  for (const entry of city.buildings) {
    entry.root.visible = !overview;
    if (entry.id !== city.activeId && entry.state) entry.state.street.group.visible = !overview;
  }
  updateCityUI();
  cameraMotion = null;
  interior = roomBoxes = null;
  if (!retainedLabels) labels?.dispose();
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
  const { building: b, edited } = prepared!;
  lastBuilding = b;
  syncPlanningControls();
  lastEdited = edited;
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
    if (city.active.state) city.active.state.params = structuredClone(params);
    rebuildMetrics.count++; rebuildMetrics.last = { prepareMs, cpuMs: performance.now() - started };
    return;
  }
  const region = buildingRoof(b);
  const walls = partyWalls(region.footprint, region.edgeKinds, b.roofBase, region.inner);
  const flat = roofShape(region.footprint, region.edgeKinds, b.roofBase).z2;
  Object.assign(street.params, streetSettings);
  const g = kit.buildGroup(b.placements.concat(partyChimneys(params, kit, b.style, walls.edges, flat)), materials);
  const cap = buildingRoofCap(b);
  const roof = new Mesh(cap.geometry, materials.byName.get("zinc:noao"));
  roof.castShadow = roof.receiveShadow = true;
  g.add(roof);
  if (b.topology.courtyardLayout) {
    const closure = new Mesh(courtyardClosure(b), materials.byName.get("plaster:noao"));
    closure.castShadow = closure.receiveShadow = true; g.add(closure);
  }
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
  // Only the exterior shell: never mark furniture, stairs or internal partitions.
  g.traverse(object => { if (object instanceof Mesh && object !== roomBoxes) object.userData.facadeShell = true; });
  if (cut.on) {
    interior = retainedInterior ?? buildRooms3d(plan, b, kit, cutaway.interior, interiorView.look);
    // the stairs' railing: the kit's first lace pattern (欄杆與圓環)
    if (!retainedInterior) interior.add(buildStairs(plan, cutaway.interior, cutaway.cut(materials.lace(0)), materials.laceDepth(0), interiorView.look));
    const furniture = retainedFurniture ?? buildFurniture(plan, b, cutaway.interior, interiorView.look);
    if (!retainedInterior) rebuildMetrics.interiorBuilds++;
    builtInteriorKey = nextInteriorKey;
    lastFurniture = furniture;
    interior.add(furniture);
    // Blender (x, y, z) -> world (x - W/2, z, L/2 - y), plus the building origin.
    const furnitureInfo = furniture.userData.furniture as FurnitureInfo;
    const worldLight = (p: Vector3) => new Vector3(p.x - b.width / 2, p.z, b.length / 2 - p.y).add(root.position);
    lampSources = [
      ...furnitureInfo.lamps.map(p => ({ position: worldLight(p), intensity: 9, distance: 4.2 })),
      ...furnitureInfo.lightSources.map(source => ({ ...source, position: worldLight(source.position) })),
    ];
    lampLights.setLamps(lampSources);
    g.add(interior);
  } else {
    lastFurniture = null; lampSources = []; lampLights.setLamps([]);
  }
  g.position.set(-b.width / 2, -b.length / 2, 0); // footprint centred on the origin
  const terrace = buildCafeTerrace(plan, b, cutaway.galleryInterior, street.params);
  terrace.group.userData.unfoldSkip = true;
  const cafeInfo = lastFurniture?.userData.cafe as CafeInfo | undefined;
  for (const [id, count] of Object.entries(terrace.rooms)) {
    const cafe = cafeInfo?.rooms[id];
    if (cafe) { cafe.outdoorTables = count; cafe.outdoorChairs = count * 2; }
  }
  g.add(terrace.group);
  street.rebuild(b, params.seed, terrace.reserved);
  street.group.visible = true;
  show(g, new Vector3(0, cap.top / 2, 0), Math.hypot(b.width, b.length, cap.top) / 2);
  const oldPositions = new Map(city.buildings.map(entry => [entry.id, entry.position.clone()]));
  g.updateWorldMatrix(true, true); street.group.updateWorldMatrix(true, true);
  const footprint = new Box3().setFromObject(g).union(new Box3().setFromObject(street.group)).translate(root.position.clone().negate());
  city.updateFootprint(city.activeId, footprint, b.length);
  for (const entry of city.buildings) {
    const delta = entry.position.clone().sub(oldPositions.get(entry.id)!);
    if (entry.id === city.activeId) {
      root.position.copy(entry.position); street.group.position.copy(entry.position);
      for (const lamp of lampSources) lamp.position.add(delta);
      camera.position.add(delta); controls.target.add(delta);
    } else if (entry.state) {
      entry.state.street.group.position.copy(entry.position);
      entry.state.bounds.min.add(delta); entry.state.bounds.max.add(delta);
      for (const lamp of entry.state.lamps) lamp.position.add(delta);
    }
  }
  lampLights.setLamps(lampSources);
  windows.update(b, g);
  // the cut runs over everything that stands out too (balconies, cornices, chimneys)
  g.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(g);
  bounds.min.copy(box.min).subScalar(CUT_MARGIN);
  bounds.max.copy(box.max).addScalar(CUT_MARGIN);
  env.frame({ center: box.getCenter(new Vector3()), radius: box.getSize(new Vector3()).length() / 2 });
  site.width = b.width;
  site.length = b.length;
  if (cut.on) { labels = retainedLabels ?? new RoomLabels(plan, interiorView.area); g.add(labels.group); }
  else retainedLabels?.dispose();
  applyCut(true);
  if (unfoldActive()) frameUnfold();
  bindBuildingEditors();
  city.active.state = captureBuilding();
  updateCityUI();
  rebuildMetrics.count++; rebuildMetrics.last = { prepareMs, cpuMs: performance.now() - started };
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
  facadeTransparency.restore();
  toolbar.showFacadeTransparency(cut.facadeTransparency);
  if (cut.on && !interior && !view.gallery && !view.furnitureGallery && !interiorView.plan && kit) {
    rebuild(); return;
  }
  if (unfoldActive() && shown && lastPlan) {
    if (!unfoldView) {
      // Enable the real interior before copying render objects; atlas rooms are explicitly skipped.
      if (interior) interior.visible = true;
      if (roomBoxes) roomBoxes.visible = false;
      windows.update(null, null);
      unfoldView = new UnfoldView(shown, lastPlan, cutaway);
      if (unfoldSpacing !== null) {
        const [min, max] = unfoldView.spacingRange;
        unfoldView.setSpacing(min + (max - min) * unfoldSpacing);
      }
      root.add(unfoldView.group);
      if (labels) unfoldView.group.add(labels.group);
    }
    shown.visible = false; street.group.visible = false;
    cutShown = true; lampLights.on = true;
    unfold.depth = Math.min(unfold.depth, site.length * dims.interior.unfold.maxDepthRatio);
    updateUnfold();
    facadeTransparency.apply(unfoldView.group, cut.facadeTransparency);
    toolbar.show("unfold", cut.axis, cut.t, cut.flip);
    toolbar.showUnfold(unfold.amount, unfold.depth, site.length * dims.interior.unfold.maxDepthRatio, unfold.focus);
    toolbar.showUnfoldSpacing(unfoldView.spacing, unfoldView.spacingRange);
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
  const own = cut.mode === "horizontal" ? at : cut.axis === "across" ? at - root.position.x + site.width / 2 : site.length / 2 - (at - root.position.z);
  labels?.update(on && interiorView.labels, cut.mode, cut.axis, own, cut.flip);
  labels?.setClip(on ? cutaway.plane : null);
  if (on && shown) facadeTransparency.apply(shown, cut.facadeTransparency);
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
  const { target, position } = fitPerspectiveBox(new Box3(bounds.min, bounds.max), new Vector3(36, 13, 46), camera.fov, camera.aspect);
  controls.target.copy(target); camera.position.copy(position);
  env.homeDistance = position.distanceTo(target);
}

// ---- GUI ----
const gui = new GUI({ title: "european building kit" });
const fCity = gui.addFolder("城市編輯");
fCity.hide();
const citySelection = { building: city.activeId };
let citySwitchTimer: ReturnType<typeof setTimeout> | null = null;
const cityController = fCity.add(citySelection, "building", { "建築 1": "1" }).name("目前建築").onChange((id: string) => {
  cancelQueuedRebuild(); cancelExteriorPreview();
  if (citySwitchTimer !== null) clearTimeout(citySwitchTimer);
  citySwitchTimer = setTimeout(() => {
    citySwitchTimer = null;
    selectBuilding(id, true); citySelection.building = city.activeId; cityController.updateDisplay();
  }, 0);
});
function refreshCityChoices(): void {
  cityController.options(Object.fromEntries(city.buildings.map(b => [b.name, b.id])));
}
fCity.add({ left: () => addBuilding("left") }, "left").name("＋ 左側新增建築");
fCity.add({ right: () => addBuilding("right") }, "right").name("＋ 右側新增建築");
fCity.add({ front: () => addBuilding("front") }, "front").name("＋ 前方新增建築");
fCity.add({ back: () => addBuilding("back") }, "back").name("＋ 後方新增建築");
fCity.add({ overview: () => {
  if (!cityEditMode || view.gallery || view.furnitureGallery || interiorView.plan) return;
  const box = city.bounds(); if (unfoldView) box.union(unfoldView.bounds());
  const target = box.getCenter(new Vector3());
  const forward = new Vector3(0.25, 0.3, 1).normalize();
  const right = new Vector3(0, 1, 0).cross(forward).normalize(), up = forward.clone().cross(right);
  const tanV = Math.tan(camera.fov * Math.PI / 360) * 0.83, tanH = tanV * camera.aspect;
  let distance = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = new Vector3(x, y, z).sub(target), depth = p.dot(forward);
    distance = Math.max(distance, Math.abs(p.dot(right)) / tanH + depth, Math.abs(p.dot(up)) / tanV + depth);
  }
  cameraMotion = null; controls.target.copy(target);
  camera.position.copy(target).addScaledVector(forward, distance);
  env.frame({ center: target, radius: box.getSize(new Vector3()).length() / 2 });
}}, "overview").name("街區總覽");
const update = () => {
  // Old saved buildings display Auto; interactive edits must enter feasibility
  // resolution when leaving the legacy envelope, without changing API defaults.
  if (!params.layoutMode || params.layoutMode === "legacy") params.layoutMode = "auto";
  syncDimensionControls();
  queueRebuild();
};
gui.add(view, "gallery").name("零件總覽").listen().onChange((on: boolean) => {
  if (on) { view.furnitureGallery = false; interiorView.plan = false; }
  if (!on) {
    camera.position.set(36, 20, 46).add(city.active.position);
    controls.target.set(0, 7, 0).add(city.active.position);
  }
  toolbar.enableCut(!on && !interiorView.plan);
  rebuild(true);
});
gui.add(view, "furnitureGallery").name("家具總覽").listen().onChange((on: boolean) => {
  if (on) { view.gallery = false; interiorView.plan = false; }
  else { camera.position.set(36, 20, 46).add(city.active.position); controls.target.set(0, 7, 0).add(city.active.position); }
  toolbar.enableCut(!on && !interiorView.plan);
  rebuild(true);
});
const fBuilding = gui.addFolder("🏛 建築 (Building)");
fBuilding.add(params, "type", { "獨棟": "freestanding", "街角": "corner", "連棟": "row" }).name("建築類型").onChange(update);
fBuilding.add(params, "cornerStyle", { "直角": "pier", "斜切": "panCoupe" }).name("街角轉角").onChange(update);
fCity.add(city, "clearance", 0, 20, 0.5).name("每棟間距 m").onChange(() => {
  const oldPositions = new Map(city.buildings.map(entry => [entry.id, entry.position.clone()]));
  city.layout();
  syncDormantPositions(oldPositions);
});
fBuilding.add(params, "groundUse", { "住宅": "residential", "混合": "mixed", "店面": "shops" }).name("一樓用途").onChange(update);
const courtGroundCtrl = fBuilding.add(params, "courtGround", { "住宅": "residential", "混合": "mixed", "店面": "shops" }).name("中庭一樓用途").onChange(update);
fBuilding.add(params, "baysX", dims.interior.planning.inputLimits.baysMin, dims.interior.planning.inputLimits.baysMax, 1).name("正面開間數").onChange(update);
const sideBaysCtrl = fBuilding.add(params, "baysY", dims.interior.planning.inputLimits.baysMin, dims.interior.planning.inputLimits.baysMax, 1).name("側面開間數").onChange(update);
fBuilding.add(params, "floors", dims.interior.planning.inputLimits.floorsMin, dims.interior.planning.inputLimits.floorsMax, 1).name("上層數").onChange(update);
fBuilding.add(params, "profile", { "奧斯曼（往上遞減）": "haussmann", "均一": "uniform" }).name("樓高配置").onChange(update);
fBuilding.add(params, "dormerEvery", { "每個開間": 1, "隔一個開間": 2 }).name("老虎窗").onChange(update);
fBuilding.add(params, "seed", 1, 999, 1).name("隨機種子").onChange(update);
const planningInput = {
  get mode() { return params.layoutMode === "legacy" || !params.layoutMode ? "auto" : params.layoutMode; },
  set mode(value: "auto" | "courtyard" | "lightwell") { params.layoutMode = value; },
  get dimensions() { return params.dimensionVersion ?? "legacy"; },
  set dimensions(value: "legacy" | "bays-v2") { params.dimensionVersion = value; },
};
fBuilding.add(planningInput, "mode", { "自動": "auto", "中庭": "courtyard", "採光井": "lightwell" }).name("平面配置").onChange(update);
const dimensionCtrl = fBuilding.add(planningInput, "dimensions", { "按側面開間": "bays-v2", "相容公尺": "legacy" }).name("連棟尺寸").onChange(update);
const depthCtrl = fBuilding.add(params, "depth").name("連棟進深 m").onChange(update);
const planningStatus = document.createElement("p");
planningStatus.setAttribute("role", "status"); planningStatus.setAttribute("aria-live", "polite");
planningStatus.style.cssText = "margin:8px 12px;white-space:normal;line-height:1.5";
fBuilding.$children.append(planningStatus);
const performanceNote = document.createElement("p");
performanceNote.textContent = "大型建築會停頓：20×20×20 整棟重建實測約 2.6–3.6 秒，尚未達 300 ms 目標。";
performanceNote.style.cssText = "margin:8px 12px;color:#b9b9b9;white-space:normal;line-height:1.5";
fBuilding.$children.append(performanceNote);
function syncDimensionControls(): void {
  const row = params.type === "row", metres = planningInput.dimensions === "legacy";
  dimensionCtrl.show(row); depthCtrl.show(row && metres); sideBaysCtrl.disable(row && metres);
}
function syncPlanningControls(): void {
  syncDimensionControls();
  courtGroundCtrl.show(lastBuilding?.topology.mode === "courtyard");
  apartmentsCtrl.name(lastBuilding?.topology.mode === "legacy" ? "每層戶數" : "每個核心戶數");
  if (lastBuilding) {
    const t = lastBuilding.topology;
    const mode = { legacy: "原配置", cores: "多核心", courtyard: "中庭", lightwell: "採光井" }[t.mode];
    planningStatus.textContent = `${mode} · ${t.width.toFixed(2)} × ${t.length.toFixed(2)} m · ${params.floors + 2} 層（含一樓、閣樓）`;
    planningStatus.dataset.state = "ready";
  }
}

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
fLook.add(facadeSettings, "look", { "奧斯曼（原本）": "haussmann", "巴黎淺色石灰岩": "paris" }).name("外牆材質")
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
fStreet.add(streetSettings, "sidewalk").name("人行道").onChange(update);
fStreet.add(streetSettings, "width", 1.5, 6, 0.1).name("人行道寬度 m").onChange(update);
fStreet.add(streetSettings, "count", 0, 8, 1).name("每面路樹數").onChange(update);
const fInterior = gui.addFolder("🏢 室內樓層 (Interior)");
fInterior.add(interiorView, "plan").name("平面檢視（除錯）").listen().onChange((on: boolean) => {
  if (on) {
    view.gallery = view.furnitureGallery = false;
    const z = lastPlan?.levels[interiorView.level]?.floorZ ?? 0;
    controls.target.set(0, z, 0).add(city.active.position);
    camera.position.set(12, z + 30, 26).add(city.active.position);
  } else {
    camera.position.set(36, 20, 46).add(city.active.position);
    controls.target.set(0, 7, 0).add(city.active.position);
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
fInterior.add(interiorView, "labels").name("房間名稱").onChange(() => applyCut());
fInterior.add(interiorView, "area").name("顯示面積").onChange(() => {
  if (interiorView.plan) { rebuild(); return; }
  labels?.dispose(); labels = lastPlan && cut.on ? new RoomLabels(lastPlan, interiorView.area) : null;
  if (labels && shown) (unfoldView?.group ?? shown).add(labels.group);
  applyCut(true); bindBuildingEditors();
});
fInterior.add(params, "ballroom").name("宴會廳").onChange(update);
fInterior.add(params, "ballroomFacade", { "兩排窗": "rows", "跨兩層高窗": "tall" }).name("宴會廳立面").onChange(update);
const apartmentsCtrl = fInterior.add(params, "apartments", { "自動": "auto", "一戶": "one", "兩戶": "two" }).name("每層戶數").onChange(update);
const floorProgramming = { get enabled() { return !!params.floorVariety; }, set enabled(on: boolean) { params.floorVariety = on; } };
fInterior.add(floorProgramming, "enabled").name("樓層配置多樣性").listen().onChange(update);
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
  canvas: renderer.domElement, camera, gui, get edits() { return roomEdits; },
  labels: () => exteriorPreview ? null : labels,
  rebuild: queueRebuild,
});
const windows = new WindowEditor({
  canvas: renderer.domElement, camera, gui, params,
  shown: () => (exteriorPreview || unfoldActive() || view.gallery || view.furnitureGallery || interiorView.plan ? null : shown),
  clip: () => (cutShown ? cutaway.plane : null),
  rebuild: queueRebuild,
  ignorePointer: e => roomEditor.consumedEvent(e) || cityEvents.has(e),
});

// Project ground anchors into accessible controls. Hover only reveals the nearby edge.
const cityEvents = new WeakSet<Event>();
const cityBadge = document.createElement("div");
cityBadge.style.cssText = "position:fixed;left:16px;top:16px;color:white;background:#24282bcc;padding:8px 12px;border-radius:8px;pointer-events:none;z-index:5;font:14px sans-serif";
cityBadge.hidden = true;
document.body.append(cityBadge);
const cityNavigation = document.createElement("div");
cityNavigation.style.cssText = "position:fixed;right:340px;top:16px;display:flex;gap:5px;z-index:10";
const cityArrows = ([-1, 1] as const).map(step => {
  const button = document.createElement("button");
  button.textContent = step < 0 ? "‹" : "›";
  button.title = step < 0 ? "切換左側建築" : "切換右側建築";
  button.setAttribute("aria-label", button.title);
  button.style.cssText = "width:34px;height:34px;border:1px solid #ffffff55;border-radius:8px;background:#24282bcc;color:white;font:28px sans-serif;cursor:pointer";
  button.onclick = () => {
    const index = city.buildings.findIndex(b => b.id === city.activeId);
    const next = city.buildings[index + step];
    if (next) selectBuilding(next.id, true);
  };
  cityNavigation.append(button); return { step, button };
});
cityNavigation.hidden = true;
document.body.append(cityNavigation);
let cityNavigationWidth = -1;
const cityPointer = new Vector2(-10000, -10000);
const cityMarkers = (["left", "right", "front", "back"] as const).map(side => {
  const marker = new Group(), spec = dims.street.block;
  const white = new MeshBasicMaterial({ color: 0xffffff, depthTest: false });
  marker.add(new Mesh(new BoxGeometry(spec.markerSize, spec.markerThickness, spec.markerStroke), white));
  marker.add(new Mesh(new BoxGeometry(spec.markerStroke, spec.markerThickness, spec.markerSize), white));
  marker.visible = false; scene.add(marker);
  const preview = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.45, depthWrite: false }));
  preview.visible = false; scene.add(preview);
  const button = document.createElement("button");
  button.title = `${{ left: "左側", right: "右側", front: "前方", back: "後方" }[side]}新增建築`;
  button.setAttribute("aria-label", button.title);
  button.style.cssText = "position:fixed;display:none;transform:translate(-50%,-50%);width:54px;height:54px;background:transparent;border:0;cursor:pointer;z-index:6";
  button.addEventListener("pointerdown", e => e.stopPropagation());
  button.addEventListener("click", () => addBuilding(side));
  document.body.append(button);
  return { side, button, marker, preview };
});
addEventListener("pointermove", e => cityPointer.set(e.clientX, e.clientY));
function updateCityUI(): void {
  const badge = `${city.active.name} · 共 ${city.buildings.length} 棟`;
  if (cityBadge.textContent !== badge) cityBadge.textContent = badge;
  cityBadge.hidden = cityNavigation.hidden = !cityEditMode;
  const enabled = cityEditMode && !!materials && !view.gallery && !view.furnitureGallery && !interiorView.plan;
  cityController.enable(enabled);
  const activeIndex = city.buildings.findIndex(b => b.id === city.activeId);
  if (cityNavigationWidth !== innerWidth) {
    cityNavigationWidth = innerWidth;
    const right = innerWidth - gui.domElement.getBoundingClientRect().left + 10;
    cityNavigation.style.right = `${Math.max(16, Math.min(right, innerWidth - 84))}px`;
  }
  for (const { step, button } of cityArrows) {
    button.disabled = !enabled || !city.buildings[activeIndex + step];
    button.style.opacity = button.disabled ? "0.35" : "1";
  }
  for (const { side, button, marker, preview } of cityMarkers) {
    if (!enabled || unfoldActive()) { button.style.display = "none"; marker.visible = preview.visible = false; continue; }
    const edge = city.active, local = edge.localBounds;
    const next = city.candidate(side, local, edge.length);
    const size = local.getSize(new Vector3()), center = local.getCenter(new Vector3());
    marker.position.copy(next.position).add(center).setY(0.1);
    const p = marker.position.clone().project(camera);
    const px = (p.x + 1) * innerWidth / 2, py = (1 - p.y) * innerHeight / 2;
    const visible = p.z > -1 && p.z < 1 && Math.hypot(cityPointer.x - px, cityPointer.y - py) < 110;
    button.style.display = visible ? "block" : "none";
    marker.visible = visible;
    preview.visible = visible;
    if (visible) {
      preview.scale.set(size.x, dims.street.block.markerThickness, size.z);
      preview.position.copy(next.position).add(center).setY(0.08);
    }
    button.style.left = `${px}px`; button.style.top = `${py}px`;
  }
}
let cityDown: Vector2 | null = null;
renderer.domElement.addEventListener("pointerdown", e => {
  cityDown = e.button === 0 && e.isPrimary ? new Vector2(e.clientX, e.clientY) : null;
}, true);
renderer.domElement.addEventListener("pointercancel", () => { cityDown = null; }, true);
renderer.domElement.addEventListener("pointerup", e => {
  const down = cityDown; cityDown = null;
  if (!cityEditMode || !down || down.distanceTo(new Vector2(e.clientX, e.clientY)) > 5 || roomEditor.consumedEvent(e)
    || view.gallery || view.furnitureGallery || interiorView.plan) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2((e.clientX - rect.left) / rect.width * 2 - 1, 1 - (e.clientY - rect.top) / rect.height * 2), camera);
  const targets: Mesh[] = [];
  const doors: { id: string; distance: number }[] = [];
  for (const entry of city.buildings) {
    entry.root.updateWorldMatrix(true, true);
    const model = entry.id === city.activeId ? shown : entry.state?.shown;
    if (model?.visible) model.traverseVisible(o => { if ((o as Mesh).isMesh) targets.push(o as Mesh); });
    entry.state?.street.group.traverseVisible(o => { if ((o as Mesh).isMesh) targets.push(o as Mesh); });
    if (entry.id === city.activeId || !model) continue;
    for (const door of entry.state?.building?.windows ?? []) {
      if (door.kind !== "door") continue;
      const matrix = new Matrix4().multiplyMatrices(model.matrixWorld, door.matrix);
      const local = new Ray().copy(ray.ray).applyMatrix4(matrix.clone().invert());
      if (Math.abs(local.direction.y) < 1e-6) continue;
      const t = -local.origin.y / local.direction.y;
      if (t <= 0) continue;
      const at = local.at(t, new Vector3());
      if (Math.abs(at.x) > door.half || at.z < door.z0 || at.z > door.z1) continue;
      doors.push({ id: entry.id, distance: at.applyMatrix4(matrix).distanceTo(ray.ray.origin) });
    }
  }
  const picked = doors.sort((a, b) => a.distance - b.distance)[0]; if (!picked) return;
  const foreground = ray.intersectObjects(targets, false)[0];
  if (foreground && foreground.distance < picked.distance - 0.25) return;
  cityEvents.add(e); selectBuilding(picked.id, true);
}, true);

// ---- the section panel and the bottom toolbar ----
let saveNext = false;
const toolbar = new Toolbar({
  cityEdit: on => {
    cityEditMode = on;
    toolbar.setCityEdit(on);
    fCity.show(on);
    if (on) { gui.open(); fCity.open(); }
    cityPointer.set(-10000, -10000);
    cityDown = null;
    updateCityUI();
  },
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
  facadeTransparency: t => {
    cut.facadeTransparency = t;
    cut.on = true;
    applyCut();
  },
  unfoldSpacing: t => {
    if (!unfoldView) return;
    cameraMotion = null;
    unfoldSpacing = t;
    const [min, max] = unfoldView.spacingRange;
    unfoldView.setSpacing(min + (max - min) * t);
    applyCut();
  },
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
  if (!p || p.id !== e.pointerId || !unfoldView || !unfoldActive() || roomEditor.consumedEvent(e) || cityEvents.has(e) || Math.hypot(p.x - e.clientX, p.y - e.clientY) > 5) return;
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
// Number controls preview during dragging; one committed rebuild on release or text entry.
for (const controller of gui.controllersRecursive()) {
  if (controller.object === params && typeof params[controller.property as keyof BuildingParams] === 'number') {
    controller.onChange(previewExterior).onFinishChange(update);
  }
}

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
  const parts = kit;
  return runPlanChecks(params, q => planBuilding(generateBuilding(q, parts), q), seeds, apartments);
}

// dev only: handles for scripted screenshots / debugging from the console
if (import.meta.env.DEV) {
  Object.assign(window, {
    __app: {
      camera, controls, params, view, interiorView, rebuild, scene, renderer, env, planCheckAll, rebuildMetrics,
      planCheckLimits: (seeds = [1]) => kit ? [...limitCases(seeds)].map(f => checkLimitCase(f, kit!)) : null,
      get pipelineCounts() { return pipeline.counts; },
      get renderSettings() { return { postFX: post.enabled, msaa: perf.msaa, shadowType: renderer.shadowMap.type }; },
      refreshGui: () => { syncPlanningControls(); gui.controllersRecursive().forEach(c => c.updateDisplay()); },
      cut, cutaway, toolbar, applyCut, frameHome, bounds, site, street, windows,
      get roomEdits() { return roomEdits; }, roomEditor,
      unfold, focusUnfold, setUnfoldAmount,
      get unfoldView() { return unfoldView; },
      get plan() { return lastPlan; },
      get kit() { return kit; },
    },
  });
}

const base = import.meta.env.BASE_URL;
createMaterials(base).then(async m => {
  sharedMaterials = m;
  materials = forkKitMaterials(m, city.active.position);
  for (const material of new Set(Object.values(cutaway.interior))) bindBuildingOrigin(material, city.active.position);
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
  const frameStart = performance.now();
  if (!renderer.info.autoReset) renderer.info.reset();
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
  updateCityUI();
  lampLights.update(controls.target);
  env.tick(camera.position, controls.target);
  post.render(dt);
  if (import.meta.env.DEV) {
    rebuildMetrics.frames.push(performance.now() - frameStart);
    if (rebuildMetrics.frames.length > 120) rebuildMetrics.frames.shift();
  }
  if (saveNext) {
    saveNext = false;
    savePicture();
  }
});
