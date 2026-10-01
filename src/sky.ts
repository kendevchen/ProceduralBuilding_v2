/**
 * Sky dome: a camera-centred sphere drawn first (no depth), with a horizon → zenith
 * gradient, a sun glow + disk, stars and a soft cloud layer. Colours are linear (the
 * composer's OutputPass tone-maps); the fog uses the horizon colour so distant city
 * blocks dissolve into the sky instead of into black.
 */
import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from "three";

export interface SkySettings {
  horizon: string;
  zenith: string;
  ground: string;
  /** 0..1 sun glow / disk strength */
  sunGlow: number;
  stars: number;
  clouds: number;
  cloudColor: string;
}

export class Sky {
  readonly mesh: Mesh;
  private uniforms = {
    uHorizon: { value: new Color() },
    uZenith: { value: new Color() },
    uGround: { value: new Color() },
    uSunDir: { value: new Vector3(0, 1, 0) },
    uSunColor: { value: new Color(1, 1, 1) },
    uSunGlow: { value: 1 },
    uStars: { value: 0 },
    uClouds: { value: 0 },
    uCloudColor: { value: new Color(1, 1, 1) },
  };

  constructor(radius = 450) {
    const mat = new ShaderMaterial({
      uniforms: this.uniforms,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uHorizon, uZenith, uGround, uSunDir, uSunColor, uCloudColor;
        uniform float uSunGlow, uStars, uClouds;
        varying vec3 vDir;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = hash(vec3(i, 0.0)), b = hash(vec3(i + vec2(1, 0), 0.0));
          float c = hash(vec3(i + vec2(0, 1), 0.0)), d = hash(vec3(i + vec2(1, 1), 0.0));
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
          return v;
        }
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = h >= 0.0
            ? mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55))
            : mix(uHorizon, uGround, clamp(-h * 5.0, 0.0, 1.0));
          // sun: broad glow + small disk
          float sd = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSunColor * uSunGlow * (pow(sd, 6.0) * 0.28 + pow(sd, 1200.0) * 4.0);
          // stars
          if (uStars > 0.0 && h > 0.0) {
            vec3 q = floor(d * 380.0);
            float s = step(0.9986, hash(q)) * (0.4 + 0.6 * hash(q + 7.0));
            col += vec3(s * uStars * smoothstep(0.02, 0.3, h));
          }
          // clouds: fbm on a flat layer projected over the dome
          if (uClouds > 0.0 && h > 0.0) {
            vec2 uv = d.xz / (h + 0.12) * 1.4;
            float n = fbm(uv);
            float c = smoothstep(0.48, 0.78, n) * uClouds * smoothstep(0.0, 0.18, h);
            col = mix(col, uCloudColor, c);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(new SphereGeometry(radius, 32, 16), mat);
    this.mesh.name = "sky";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000; // first, behind everything
  }

  set(s: SkySettings, sunDir: Vector3, sunColor: Color): void {
    const u = this.uniforms;
    u.uHorizon.value.set(s.horizon);
    u.uZenith.value.set(s.zenith);
    u.uGround.value.set(s.ground);
    u.uSunGlow.value = s.sunGlow;
    u.uStars.value = s.stars;
    u.uClouds.value = s.clouds;
    u.uCloudColor.value.set(s.cloudColor);
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.copy(sunColor);
  }

  /** keep the dome centred on the camera */
  follow(camera: Vector3): void {
    this.mesh.position.copy(camera);
  }
}
