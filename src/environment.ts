/**
 * Lighting rig + sky, driven by mood presets (moods.ts):
 *   - sun (key, casts the shadows) placed from azimuth / elevation, cool fill opposite,
 *     warm rim spotlight behind, hemisphere sky/ground bounce, dim ambient
 *   - RoomEnvironment image-based lighting for reflections
 *   - sky dome (sky.ts) + exponential fog in the horizon colour, so the city fades into
 *     the sky rather than into black
 * `settings` holds the live values (the current mood, then any GUI tweaks). Light
 * positions are fitted to the live building bounds so any size stays framed.
 */
import {
  AmbientLight, DirectionalLight, FogExp2, HemisphereLight, PCFSoftShadowMap, PMREMGenerator,
  Scene, SpotLight, Vector3, WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type GUI from "lil-gui";
import { Sky } from "./sky";
import { DEFAULT_MOOD, MOODS, type Mood } from "./moods";

export interface Bounds {
  center: Vector3;
  radius: number;
}

export type EnvSettings = Mood & { mood: string; fog: boolean; fogAuto: boolean };

const DEG = Math.PI / 180;
/** unit direction towards a light at (azimuth from +z towards +x, elevation), degrees */
const dirFrom = (az: number, el: number) =>
  new Vector3(Math.sin(az * DEG) * Math.cos(el * DEG), Math.sin(el * DEG), Math.cos(az * DEG) * Math.cos(el * DEG));

export class Environment {
  readonly key = new DirectionalLight();
  readonly fill = new DirectionalLight();
  readonly rim = new SpotLight(0xffffff, 0, 50, Math.PI * 0.25, 0.4, 1.2);
  readonly ambient = new AmbientLight();
  readonly hemi = new HemisphereLight();
  readonly sky = new Sky();
  readonly settings: EnvSettings;
  /** called after a mood is applied or the night slider moves (post + night lights) */
  onMood?: (s: EnvSettings) => void;

  private scene: Scene;
  private renderer: WebGLRenderer;
  private bounds: Bounds = { center: new Vector3(0, 3, 0), radius: 8 };
  private uniformDebug = false;

  constructor(scene: Scene, renderer: WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.settings = { ...structuredClone(MOODS[DEFAULT_MOOD]), mood: DEFAULT_MOOD, fog: true, fogAuto: true };

    scene.fog = new FogExp2(0x000000, 0);
    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    const s = this.key.shadow;
    this.key.castShadow = true;
    s.mapSize.set(2048, 2048);
    s.bias = -0.0002;
    s.normalBias = 0.02;

    scene.add(this.sky.mesh);
    scene.add(this.key, this.key.target, this.fill, this.rim, this.rim.target, this.ambient, this.hemi);
    this.refresh();
  }

  /** load a preset into the live settings (in place, so GUI bindings stay valid) */
  applyMood(id: string): void {
    const m = MOODS[id];
    if (!m) return;
    const { sky, ...rest } = structuredClone(m);
    Object.assign(this.settings, rest, { mood: id });
    Object.assign(this.settings.sky, sky);
    this.refresh();
    this.onMood?.(this.settings);
  }

  /** debug: white uniform ambient only (isolates the texture from the light rig) */
  setUniformDebug(on: boolean): void {
    this.uniformDebug = on;
    this.refresh();
  }

  /** fit light positions + the shadow frustum around the building bounds */
  frame(b: Bounds): void {
    this.bounds = b;
    const s = this.settings;
    const dist = Math.max(b.radius * 2.4, 20);
    // a sun below the horizon still lights from just above it (blue hour)
    this.key.position.copy(b.center).addScaledVector(dirFrom(s.sunAzimuth, Math.max(s.sunElevation, 4)), dist);
    this.key.target.position.copy(b.center);
    this.key.target.updateMatrixWorld();
    this.fill.position.copy(b.center).addScaledVector(dirFrom(s.sunAzimuth + 193, 27), dist);
    this.rim.position.copy(b.center).addScaledVector(dirFrom(s.sunAzimuth + 158, 35), dist);
    this.rim.target.position.copy(b.center);
    this.rim.target.updateMatrixWorld();
    this.rim.distance = dist * 2.4;
    this.rim.angle = Math.atan2(b.radius * 1.5, dist);

    const cam = this.key.shadow.camera;
    const r = b.radius * 1.3;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.5;
    cam.far = dist + b.radius * 3;
    cam.updateProjectionMatrix();
  }

  /** push the live settings into lights, sky, fog and exposure */
  refresh(): void {
    const s = this.settings;
    const dbg = this.uniformDebug;
    this.renderer.toneMappingExposure = s.exposure;
    this.scene.environmentIntensity = dbg ? 0 : s.envIntensity;
    this.key.color.set(s.sunColor);
    this.key.intensity = dbg ? 0 : s.sunIntensity;
    this.fill.color.set(s.fillColor);
    this.fill.intensity = dbg ? 0 : s.fillIntensity;
    this.rim.color.set(s.rimColor);
    this.rim.intensity = dbg ? 0 : s.rimIntensity;
    this.hemi.color.set(s.hemiSky);
    this.hemi.groundColor.set(s.hemiGround);
    this.hemi.intensity = dbg ? 0 : s.hemiIntensity;
    this.ambient.color.set(dbg ? "#ffffff" : s.ambientColor);
    this.ambient.intensity = dbg ? 3 : s.ambientIntensity;

    this.sky.set(s.sky, dirFrom(s.sunAzimuth, s.sunElevation), this.key.color);
    const fog = this.scene.fog as FogExp2;
    fog.color.set(s.sky.horizon);
    this.fogScale = 1;
    fog.density = s.fog && !dbg ? s.fogDensity : 0;
    this.frame(this.bounds);
  }

  private fogScale = 1;
  /** camera distance of the default view, where the fog slider applies as set */
  homeDistance = 0;

  /** per frame: keep the sky dome around the camera, and thin the fog as the camera pulls back.
   *  The slider is the density at the framing distance; farther out it falls off in proportion
   *  (never thicker when closer), so the building stays as clear as in the home view. */
  tick(camera: Vector3, target?: Vector3): void {
    this.sky.follow(camera);
    if (!target) return;
    const s = this.settings, fog = this.scene.fog as FogExp2;
    if (!s.fog || this.uniformDebug) return;
    const home = this.homeDistance || Math.max(this.bounds.radius * 3.7, 30);
    const scale = s.fogAuto ? Math.min(1, Math.max(0.05, home / Math.max(camera.distanceTo(target), 1e-3))) : 1;
    if (Math.abs(scale - this.fogScale) < 1e-4) return;
    this.fogScale = scale;
    fog.density = s.fogDensity * scale;
  }

  addGui(gui: GUI): GUI {
    const s = this.settings;
    const r = () => this.refresh();
    const f = gui.addFolder("🎬 燈光氛圍 (Lighting)");
    const labels = Object.fromEntries(Object.entries(MOODS).map(([id, m]) => [m.label, id]));
    f.add(s, "mood", labels).name("氛圍預設").onChange((id: string) => {
      this.applyMood(id);
      gui.controllersRecursive().forEach(c => c.updateDisplay());
    });
    f.add(s, "exposure", 0.1, 3, 0.01).name("曝光").onChange(r);
    f.add(s, "sunAzimuth", 0, 360, 1).name("太陽方位 °").onChange(r);
    f.add(s, "sunElevation", -10, 90, 0.5).name("太陽仰角 °").onChange(r);
    f.add(s, "sunIntensity", 0, 8, 0.01).name("太陽強度").onChange(r);
    f.addColor(s, "sunColor").name("太陽顏色").onChange(r);
    f.addColor(s.sky, "horizon").name("地平線顏色").onChange(r);
    f.addColor(s.sky, "zenith").name("天頂顏色").onChange(r);
    f.add(s.sky, "clouds", 0, 1, 0.01).name("雲量").onChange(r);
    f.add(s.sky, "stars", 0, 1, 0.01).name("星星").onChange(r);
    f.add(s, "fog").name("霧").onChange(r);
    f.add(s, "fogDensity", 0, 0.03, 0.0005).name("霧濃度").onChange(r);
    f.add(s, "fogAuto").name("霧隨鏡頭距離調整").onChange(r);
    f.add(s, "night", 0, 1, 0.01).name("夜間燈光").onChange(() => this.onMood?.(s));
    const adv = f.addFolder("進階");
    adv.add(s, "hemiIntensity", 0, 4, 0.01).name("天空光").onChange(r);
    adv.add(s, "fillIntensity", 0, 4, 0.01).name("補光").onChange(r);
    adv.add(s, "rimIntensity", 0, 400, 1).name("輪廓光").onChange(r);
    adv.add(s, "envIntensity", 0, 2, 0.01).name("環境反射 (IBL)").onChange(r);
    adv.close();
    return f;
  }
}
