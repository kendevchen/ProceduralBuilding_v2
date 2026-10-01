/**
 * European building kit viewer.
 * Lighting moods, sky and post-processing come from v1 (see CLAUDE.md); the building
 * itself is a placeholder until the European kit (blender/) exists.
 */
import {
  ACESFilmicToneMapping, BoxGeometry, Clock, GridHelper, Mesh, MeshStandardMaterial,
  PerspectiveCamera, PlaneGeometry, SRGBColorSpace, Scene, Vector3, WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";
import { Environment } from "./environment";
import { PostFX } from "./postfx";

const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer: true });
const DEFAULT_PIXEL_RATIO = Math.min(devicePixelRatio, 1.25);
renderer.setPixelRatio(DEFAULT_PIXEL_RATIO);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.outputColorSpace = SRGBColorSpace;
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

// placeholder building (15 × 12 × 18 m) until the European kit is built
const placeholder = new Mesh(new BoxGeometry(15, 18, 12), new MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.85 }));
placeholder.position.y = 9;
placeholder.castShadow = placeholder.receiveShadow = true;
scene.add(placeholder);
env.frame({ center: new Vector3(0, 9, 0), radius: 14 });

// ---- GUI ----
const gui = new GUI({ title: "european building kit" });
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
  post.bloom.strength = s.bloom;
  post.bloom.threshold = s.bloomThreshold;
  post.bloom.radius = s.bloomRadius;
  post.gradeUniforms["uVignette"].value = s.vignette;
  post.gradeUniforms["uSaturation"].value = s.saturation;
  post.gradeUniforms["uContrast"].value = s.contrast;
};
env.applyMood(env.settings.mood);
document.getElementById("loading")?.remove();

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
});

const clock = new Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  controls.update();
  env.tick(camera.position);
  post.render(dt);
});
