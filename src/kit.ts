/**
 * Loads the European kit (public/assets/kit.glb + kit_manifest.json, made by
 * blender/build_kit.py and blender/export_kit.py) and draws placement lists as
 * InstancedMeshes, one per part mesh and material.
 *
 * Ported from v1's src/kit.ts: glTF node-name recovery, and mirrored instances
 * drawn from geometry with the mirror baked in. The GLB's materials are only
 * names; they are swapped for the ones from materials.ts. Per-building colours
 * go into instance colours by each material's tint category, and the railing
 * lace is split into one material variant per pattern (KIT_SPEC.md §6.6).
 */
import {
  Box3, BufferAttribute, BufferGeometry, Color, Group, InstancedMesh, type Material, Matrix4, type Mesh,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { KitMaterials, TintKey } from "./materials";

/** per-building look, shared by all of a building's placements */
export interface Style {
  stone: Color;
  /** doors, shopfronts */
  paint: Color;
  /** persiennes */
  shutter: Color;
  fabric: Color;
  /** railing lace pattern (atlas tile) */
  lace: number;
}

export interface Placement {
  /** glTF node name, e.g. COL[S_bay][0] (see Kit.key) */
  key: string;
  /** Blender Z-up space */
  matrix: Matrix4;
  style?: Style;
  /** the window it belongs to (generator.ts windowKey), for picking; kept per instance in userData.tags */
  tag?: string;
}

/** an opening of a module (modules.openings in blender/kitlib) */
export interface PartOpening {
  /** module-local (x, z) outline */
  loop: [number, number][];
  /** depth (y) where the module's own reveal ends and the inner wall's begins */
  reveal: number;
}

/** a dormer's attic tunnel behind the window, module-local */
export interface PartRecess {
  halfWidth: number;
  floor: number;
  ceiling: number;
  /** depth (y) of its front, just behind the window frame */
  front: number;
}

export interface PartInfo {
  collection: string;
  variant: string;
  key: string;
  tris: number;
  /** bounds in Blender space */
  box: Box3;
  openings?: PartOpening[];
  recess?: PartRecess;
}

interface ManifestChild {
  index: number;
  kind: string;
  /** Blender object name, "<collection>.<variant>" */
  name: string;
  tris?: number;
  openings?: PartOpening[];
  recess?: PartRecess;
}
interface Manifest {
  collections: Record<string, { children?: ManifestChild[]; missing?: boolean }>;
}

const MIRROR_X = new Matrix4().makeScale(-1, 1, 1);
const WHITE = new Color(1, 1, 1);

interface Bucket {
  mirrored: boolean;
  pattern: number;
  matrices: Matrix4[];
  styles: (Style | undefined)[];
  tags: (string | undefined)[];
}

export class Kit {
  private parts = new Map<string, Object3D>();
  /** "<collection>.<variant>" -> node name */
  private keys = new Map<string, string>();
  private infos: PartInfo[] = [];
  private byKey = new Map<string, PartInfo>();
  private mirrorCache = new Map<BufferGeometry, BufferGeometry>();
  private warned = new Set<string>();

  constructor(private materials: KitMaterials) {}

  async load(glbUrl: string, manifestUrl: string): Promise<void> {
    const [gltf, manifest] = await Promise.all([
      new GLTFLoader().loadAsync(glbUrl),
      fetch(manifestUrl).then(r => r.json() as Promise<Manifest>),
    ]);
    // GLTFLoader sanitizes Object3D names (strips [ ] . and spaces): recover the
    // original glTF node names through the parser associations
    const json = gltf.parser.json as { nodes?: { name?: string }[] };
    const assoc = gltf.parser.associations as Map<Object3D, { nodes?: number }>;
    for (const child of [...gltf.scene.children]) {
      const a = assoc.get(child);
      const original = a?.nodes !== undefined ? json.nodes?.[a.nodes]?.name : undefined;
      this.parts.set(original ?? child.name, child);
      child.updateMatrixWorld(true);
    }
    gltf.scene.traverse(o => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const name = (mesh.material as Material).name;
      const material = this.materials.byName.get(name);
      if (!material) console.warn(`kit: no material "${name}"`);
      mesh.material = material ?? this.materials.byName.get("debug")!;
    });
    for (const [collection, entry] of Object.entries(manifest.collections)) {
      for (const child of entry.children ?? []) {
        const key = `COL[${collection}][${child.index}]`;
        this.keys.set(child.name, key);
        const part = this.parts.get(key);
        if (!part) continue;
        const rootInv = new Matrix4().copy(part.matrixWorld).invert();
        const box = new Box3();
        part.traverse(o => {
          const mesh = o as Mesh;
          if (!mesh.isMesh) return;
          mesh.geometry.computeBoundingBox();
          box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(rootInv.clone().multiply(mesh.matrixWorld)));
        });
        const info: PartInfo = {
          collection, variant: child.name.slice(collection.length + 1), key, tris: child.tris ?? 0, box,
          openings: child.openings, recess: child.recess,
        };
        this.infos.push(info);
        this.byKey.set(key, info);
      }
    }
  }

  /** node name of a part by its Blender name, e.g. key("S_bay", "window") */
  key(collection: string, variant: string): string {
    const k = this.keys.get(`${collection}.${variant}`);
    if (!k) throw new Error(`kit: no part ${collection}.${variant}`);
    return k;
  }

  /** a part's bounds and openings by its node name */
  info(key: string): PartInfo | undefined {
    return this.byKey.get(key);
  }

  /** every part of the kit, in manifest order */
  list(): readonly PartInfo[] {
    return this.infos;
  }

  /**
   * Geometry with the X-mirror baked in (negated positions / normals / tangents,
   * reversed winding). InstancedMesh transforms normals with the plain instance
   * matrix, so a reflection (negative determinant) would light the mirrored
   * instances with inverted normals; baking the mirror into the geometry and
   * cancelling it in the matrix keeps every determinant positive.
   */
  private mirroredGeometry(src: BufferGeometry): BufferGeometry {
    let g = this.mirrorCache.get(src);
    if (g) return g;
    g = src.clone();
    for (const name of ["position", "normal", "tangent"]) {
      const attr = g.getAttribute(name) as BufferAttribute | undefined;
      if (!attr) continue;
      for (let i = 0; i < attr.count; i++) attr.setX(i, -attr.getX(i));
      if (name === "tangent" && attr.itemSize === 4) {
        for (let i = 0; i < attr.count; i++) attr.setW(i, -attr.getW(i));
      }
      attr.needsUpdate = true;
    }
    if (!g.index) {
      const n = g.getAttribute("position").count;
      const arr = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
      for (let i = 0; i < n; i++) arr[i] = i;
      g.setIndex(new BufferAttribute(arr, 1));
    }
    const idx = g.index!;
    for (let i = 0; i + 2 < idx.count; i += 3) {
      const b = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, b);
    }
    idx.needsUpdate = true;
    g.computeBoundingSphere();
    this.mirrorCache.set(src, g);
    return g;
  }

  /** Build a Group of InstancedMeshes from placements (matrices in Blender Z-up space). */
  buildGroup(placements: Placement[], materials = this.materials): Group {
    const group = new Group();
    const byPart = new Map<string, Placement[]>();
    for (const pl of placements) {
      let list = byPart.get(pl.key);
      if (!list) byPart.set(pl.key, (list = []));
      list.push(pl);
    }
    const tmp = new Matrix4();
    for (const [key, list] of byPart) {
      const part = this.parts.get(key);
      if (!part) {
        if (!this.warned.has(key)) {
          this.warned.add(key);
          console.warn(`kit: missing part ${key}`);
        }
        continue;
      }
      const rootInv = new Matrix4().copy(part.matrixWorld).invert();
      part.traverse(o => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const original = mesh.material as Material;
        const materialKey = [...this.materials.byName].find(([, value]) => value === original)?.[0];
        const base = materialKey ? materials.byName.get(materialKey) ?? original : original;
        const isLace = base.userData.lace === true;
        const tint = base.userData.tint as TintKey | undefined;
        // mesh transform relative to the part root (GLTFLoader splits
        // multi-material meshes into one child mesh per material)
        const meshLocal = rootInv.clone().multiply(mesh.matrixWorld);
        // one InstancedMesh per (mirroring, lace pattern)
        const buckets = new Map<string, Bucket>();
        for (const pl of list) {
          tmp.copy(pl.matrix).multiply(meshLocal);
          const mirrored = tmp.determinant() < 0;
          const pattern = isLace ? (pl.style?.lace ?? 0) : 0;
          const id = `${mirrored}|${pattern}`;
          let b = buckets.get(id);
          if (!b) buckets.set(id, (b = { mirrored, pattern, matrices: [], styles: [], tags: [] }));
          b.matrices.push(mirrored ? tmp.clone().multiply(MIRROR_X) : tmp.clone());
          b.styles.push(pl.style);
          b.tags.push(pl.tag);
        }
        for (const b of buckets.values()) {
          const geom = b.mirrored ? this.mirroredGeometry(mesh.geometry) : mesh.geometry;
          const material = isLace ? materials.lace(b.pattern) : base;
          const im = new InstancedMesh(geom, material, b.matrices.length);
          im.name = key;
          if (b.tags.some(t => t)) im.userData.tags = b.tags;
          // glass: transparent, drawn after the rooms behind it, casts no shadow
          im.castShadow = !material.transparent;
          im.receiveShadow = !material.transparent;
          if (isLace) im.customDepthMaterial = materials.laceDepth(b.pattern);
          for (let i = 0; i < b.matrices.length; i++) {
            im.setMatrixAt(i, b.matrices[i]);
            if (tint) im.setColorAt(i, b.styles[i]?.[tint] ?? WHITE);
          }
          im.instanceMatrix.needsUpdate = true;
          if (im.instanceColor) im.instanceColor.needsUpdate = true;
          im.computeBoundingSphere();
          group.add(im);
        }
      });
    }
    return group;
  }
}
