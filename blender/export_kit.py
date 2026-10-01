"""Export the kit to a single GLB plus a manifest (KIT_SPEC.md §9).

  blender --background blender/european_kit.blend --python-exit-code 1 \
      --python blender/export_kit.py -- public/assets/kit.glb public/assets/kit_manifest.json

Every collection under KIT is a slot; each of its children becomes a top-level
node named COL[<collection>][<idx>] with its transform reset (idx = order of
the children sorted by name). The manifest maps each index back to the Blender
name ("<collection>.<variant>") and records its triangle count, so the web app
looks parts up by name. Collection-instance empties and sub-collections are
realized recursively (kept from the v1 exporter). Meshes keep UV0 and UV1;
images are not embedded -- textures ship separately in public/assets/tex/.
"""
import json
import sys

import bpy
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:]
out_glb = argv[0]
out_manifest = argv[1]

kit_root = bpy.data.collections.get("KIT")
if kit_root is None:
    raise RuntimeError("no KIT collection: build the .blend with build_kit.py first")
COLLECTIONS = sorted(c.name for c in kit_root.children)
OBJECTS = []

export_scene = bpy.data.scenes.new("KIT_EXPORT")
bpy.context.window.scene = export_scene

manifest = {"collections": {}, "objects": {}}
part_count = 0
mesh_count = 0


def tris_of(obj):
    if obj.type != "MESH":
        return 0
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def expand(obj, matrix, root):
    """Realize obj at `matrix` (relative to part root): copy meshes, recurse into
    collection-instance empties."""
    global mesh_count
    if obj.type == "MESH":
        dup = obj.copy()
        export_scene.collection.objects.link(dup)
        dup.parent = root
        dup.matrix_parent_inverse = mathutils.Matrix.Identity(4)
        dup.matrix_basis = matrix
        mesh_count += 1
    elif obj.type == "EMPTY" and obj.instance_collection:
        icol = obj.instance_collection
        off = mathutils.Matrix.Translation(-mathutils.Vector(icol.instance_offset))
        for o in icol.all_objects:
            expand(o, matrix @ off @ o.matrix_world, root)


def make_part(node_name):
    global part_count
    root = bpy.data.objects.new(node_name, None)
    export_scene.collection.objects.link(root)
    part_count += 1
    return root


def export_collection_child(col_name, idx, kind, child):
    node_name = f"COL[{col_name}][{idx}]"
    root = make_part(node_name)
    if kind == "OBJECT":
        # child placed at identity (Reset Children); bring parented descendants along
        inv = child.matrix_world.inverted()
        expand(child, mathutils.Matrix.Identity(4), root)
        for desc in child.children_recursive:
            expand(desc, inv @ desc.matrix_world, root)
        tris = tris_of(child) + sum(tris_of(d) for d in child.children_recursive)
        return {"index": idx, "kind": "OBJECT", "name": child.name, "tris": tris}
    else:
        # sub-collection child: unit keeps its internal world-space layout
        for o in child.all_objects:
            expand(o, o.matrix_world.copy(), root)
        tris = sum(tris_of(o) for o in child.all_objects)
        return {"index": idx, "kind": "COLLECTION", "name": child.name, "tris": tris}


for col_name in COLLECTIONS:
    col = bpy.data.collections.get(col_name)
    if not col:
        print("MISSING COLLECTION:", col_name)
        manifest["collections"][col_name] = {"missing": True}
        continue
    # children in NAME-sorted order: the index in COL[..][idx] is this order
    children = [("COLLECTION", c) for c in sorted(col.children, key=lambda c: c.name)] + \
               [("OBJECT", o) for o in sorted(col.objects, key=lambda o: o.name)
                if o.parent is None or o.parent.name not in col.objects]
    entries = [export_collection_child(col_name, i, k, c) for i, (k, c) in enumerate(children)]
    manifest["collections"][col_name] = {"children": entries}

for obj_name in OBJECTS:
    obj = bpy.data.objects.get(obj_name)
    if not obj:
        print("MISSING OBJECT:", obj_name)
        manifest["objects"][obj_name] = {"missing": True}
        continue
    root = make_part(f"OBJ[{obj_name}]")
    inv = obj.matrix_world.inverted()
    expand(obj, mathutils.Matrix.Identity(4), root)
    for desc in obj.children_recursive:
        expand(desc, inv @ desc.matrix_world, root)
    manifest["objects"][obj_name] = {"exported": True}

bpy.context.view_layer.update()

bpy.ops.export_scene.gltf(
    filepath=out_glb,
    export_format="GLB",
    use_active_scene=True,
    export_apply=True,
    export_yup=False,           # keep Blender Z-up; the web app rotates the root
    export_texcoords=True,      # UV0 (pattern, metres) + UV1 (AO atlas)
    export_normals=True,
    export_materials="EXPORT",  # only the names matter: materials.ts rebuilds them
    export_image_format="NONE",
    export_animations=False,
    export_skins=False,
)

with open(out_manifest, "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=1)

total = sum(e["tris"] for c in manifest["collections"].values() for e in c.get("children", []))
print("EXPORT_OK", part_count, "parts,", mesh_count, "meshes,", total, "triangles ->", out_glb)
