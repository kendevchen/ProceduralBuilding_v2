/**
 * Lighting moods — every value the Environment, PostFX and night lights read, as one
 * flat preset. Colours are sRGB hex strings (GUI colour pickers edit them directly).
 * Sun azimuth is measured from +z (the building front) towards +x, in degrees.
 * "night" 0..1 drives lit windows, glowing signs and street lamps.
 */
import type { SkySettings } from "./sky";

export interface Mood {
  label: string;
  exposure: number;
  sunColor: string;
  sunIntensity: number;
  sunAzimuth: number;
  sunElevation: number;
  fillColor: string;
  fillIntensity: number;
  rimColor: string;
  rimIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  ambientColor: string;
  ambientIntensity: number;
  envIntensity: number;
  sky: SkySettings;
  fogDensity: number;
  night: number;
  neon: number;
  bloom: number;
  bloomThreshold: number;
  bloomRadius: number;
  vignette: number;
  saturation: number;
  contrast: number;
}

export const DEFAULT_MOOD = "architectural";

export const MOODS: Record<string, Mood> = {
  architectural: {
    label: "建築攝影 Architectural",
    exposure: 0.62,
    sunColor: "#fff3e2", sunIntensity: 3.3, sunAzimuth: 35, sunElevation: 40,
    fillColor: "#cfdcff", fillIntensity: 0.4,
    rimColor: "#ffe2b8", rimIntensity: 0,
    hemiSky: "#e4ecf5", hemiGround: "#6f6c66", hemiIntensity: 0.5,
    ambientColor: "#ffffff", ambientIntensity: 0.04,
    envIntensity: 0.28,
    sky: { horizon: "#e9edf1", zenith: "#a9bdd4", ground: "#b6b9bc", sunGlow: 0.4, stars: 0, clouds: 0.15, cloudColor: "#ffffff" },
    fogDensity: 0.0045,
    night: 0, neon: 2.5,
    bloom: 0.05, bloomThreshold: 1.2, bloomRadius: 0.5,
    vignette: 0.12, saturation: 1.0, contrast: 1.05,
  },
  clearDay: {
    label: "晴天 Clear Day",
    exposure: 0.62,
    sunColor: "#fff6e8", sunIntensity: 3.8, sunAzimuth: 20, sunElevation: 58,
    fillColor: "#bcd4ff", fillIntensity: 0.3,
    rimColor: "#ffffff", rimIntensity: 0,
    hemiSky: "#bcd6f5", hemiGround: "#6d6a62", hemiIntensity: 0.45,
    ambientColor: "#ffffff", ambientIntensity: 0.03,
    envIntensity: 0.3,
    sky: { horizon: "#cfe2f2", zenith: "#4f86d3", ground: "#9aa4ac", sunGlow: 0.8, stars: 0, clouds: 0.45, cloudColor: "#ffffff" },
    fogDensity: 0.0025,
    night: 0, neon: 2.5,
    bloom: 0.06, bloomThreshold: 1.2, bloomRadius: 0.5,
    vignette: 0.12, saturation: 1.1, contrast: 1.06,
  },
  goldenHour: {
    label: "黃金時刻 Golden Hour",
    exposure: 0.78,
    sunColor: "#ffb065", sunIntensity: 3.6, sunAzimuth: 62, sunElevation: 10,
    fillColor: "#7f95d8", fillIntensity: 0.35,
    rimColor: "#ffd29a", rimIntensity: 60,
    hemiSky: "#ffd8b0", hemiGround: "#5e5146", hemiIntensity: 0.5,
    ambientColor: "#ffe0c0", ambientIntensity: 0.05,
    envIntensity: 0.3,
    sky: { horizon: "#ffc58a", zenith: "#6c86bf", ground: "#6a5a4c", sunGlow: 1.0, stars: 0, clouds: 0.35, cloudColor: "#ffd1a8" },
    fogDensity: 0.0032,
    night: 0.25, neon: 3.5,
    bloom: 0.12, bloomThreshold: 1.0, bloomRadius: 0.55,
    vignette: 0.25, saturation: 1.12, contrast: 1.05,
  },
  blueHour: {
    label: "藍調時刻 Blue Hour",
    exposure: 0.9,
    sunColor: "#9fb3ff", sunIntensity: 0.35, sunAzimuth: 250, sunElevation: -3,
    fillColor: "#5f79c9", fillIntensity: 0.3,
    rimColor: "#ffb98a", rimIntensity: 40,
    hemiSky: "#7086c2", hemiGround: "#252a3a", hemiIntensity: 0.32,
    ambientColor: "#2a3450", ambientIntensity: 0.12,
    envIntensity: 0.2,
    sky: { horizon: "#8a92c0", zenith: "#1c2a57", ground: "#1a1f2e", sunGlow: 0.5, stars: 0.2, clouds: 0.2, cloudColor: "#8f86b5" },
    fogDensity: 0.004,
    night: 0.8, neon: 6,
    bloom: 0.4, bloomThreshold: 1.2, bloomRadius: 0.55,
    vignette: 0.3, saturation: 1.1, contrast: 1.03,
  },
  neonNight: {
    label: "霓虹夜 Neon Night",
    exposure: 1.1,
    sunColor: "#8ea4ff", sunIntensity: 0.35, sunAzimuth: 200, sunElevation: 40,
    fillColor: "#4a5bd0", fillIntensity: 0.2,
    rimColor: "#ff5ab4", rimIntensity: 15,
    hemiSky: "#26305a", hemiGround: "#0c0e16", hemiIntensity: 0.22,
    ambientColor: "#1b2240", ambientIntensity: 0.25,
    envIntensity: 0.1,
    sky: { horizon: "#1b1733", zenith: "#04050c", ground: "#07080d", sunGlow: 0.25, stars: 0.9, clouds: 0, cloudColor: "#302a50" },
    fogDensity: 0.005,
    night: 1, neon: 7,
    bloom: 0.55, bloomThreshold: 1.2, bloomRadius: 0.6,
    vignette: 0.35, saturation: 1.15, contrast: 1.08,
  },
  overcast: {
    label: "陰天 Overcast",
    exposure: 0.72,
    sunColor: "#f4f6f8", sunIntensity: 0.7, sunAzimuth: 30, sunElevation: 60,
    fillColor: "#dfe4ea", fillIntensity: 0.2,
    rimColor: "#ffffff", rimIntensity: 0,
    hemiSky: "#d5d9de", hemiGround: "#6e6f70", hemiIntensity: 1.25,
    ambientColor: "#ffffff", ambientIntensity: 0.06,
    envIntensity: 0.45,
    sky: { horizon: "#cfd3d7", zenith: "#a3a9b0", ground: "#9a9c9e", sunGlow: 0.05, stars: 0, clouds: 0.7, cloudColor: "#d8dbdf" },
    fogDensity: 0.008,
    night: 0, neon: 2.5,
    bloom: 0.03, bloomThreshold: 1.2, bloomRadius: 0.5,
    vignette: 0.15, saturation: 0.85, contrast: 0.95,
  },
  studio: {
    label: "攝影棚 Studio（原始）",
    exposure: 0.5,
    sunColor: "#fff1dd", sunIntensity: 3.0, sunAzimuth: 53, sunElevation: 50,
    fillColor: "#4a6cff", fillIntensity: 0.6,
    rimColor: "#ffd9a0", rimIntensity: 120,
    hemiSky: "#ffffff", hemiGround: "#000000", hemiIntensity: 0,
    ambientColor: "#223044", ambientIntensity: 0.4,
    envIntensity: 0.35,
    sky: { horizon: "#05060a", zenith: "#05060a", ground: "#05060a", sunGlow: 0, stars: 0, clouds: 0, cloudColor: "#ffffff" },
    fogDensity: 0.006,
    night: 0, neon: 2.5,
    bloom: 0.04, bloomThreshold: 0.62, bloomRadius: 0.7,
    vignette: 0.15, saturation: 1.0, contrast: 1.0,
  },
};
