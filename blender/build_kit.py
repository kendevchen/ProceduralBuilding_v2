"""Build the European building kit into blender/european_kit.blend (KIT_SPEC.md).

  blender --background --factory-startup --python-exit-code 1 \
      --python blender/build_kit.py -- [out.blend] [--ref]

Every module is generated from kit_dims.json by kitlib/ -- nothing in the .blend
is edited by hand, so change the scripts and rebuild. Modules go into one
collection per slot under KIT, named "<collection>.<variant>", and are laid out
in two rows for viewing (export_kit.py ignores object transforms). Each
module's bounds are checked against the catalog; a mismatch stops the build.

--ref links FrenchBuilding.blend's modules into a hidden _REF collection for
side-by-side comparison only; they are never exported.
"""
import json
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from kitlib import blend, materials, modules  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
WITH_REF = "--ref" in argv
args = [a for a in argv if not a.startswith("--")]
OUT = os.path.abspath(args[0]) if args else os.path.join(HERE, "european_kit.blend")
REF_BLEND = os.path.normpath(os.path.join(
    HERE, "..", "..", "ProceduralBuilding_v1", "Shared_Assets_Library",
    "ProceduralBuildingsThreeJS", "blender", "FrenchBuilding.blend"))

with open(os.path.join(HERE, "kit_dims.json"), encoding="utf-8") as f:
    D = json.load(f)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
kit = bpy.data.collections.new("KIT")
scene.collection.children.link(kit)
labels = bpy.data.collections.new("_LABELS")
scene.collection.children.link(labels)

# viewing layout, one row per group from front to back: small overlays, roof,
# ground floor, then the upper floors bottom to top
ROWS = ["overlay", "R", "G", "N", "S", "A"]
ROW_Y = {r: 9.0 * i for i, r in enumerate(ROWS)}
cursor = {r: 0.0 for r in ROWS}
GAP = 1.2


def row_of(collection):
    if collection.startswith(("balcony", "head", "console")):
        return "overlay"
    return collection[0] if collection[0] in "RGNSA" else "overlay"


LABEL_MAT = bpy.data.materials.new("_label")
LABEL_MAT.diffuse_color = (0.05, 0.05, 0.06, 1.0)


def label(text, x, y):
    cu = bpy.data.curves.new(f"label {text}", type="FONT")
    cu.body = text
    cu.size = 0.42
    cu.align_x = "CENTER"
    cu.materials.append(LABEL_MAT)
    ob = bpy.data.objects.new(cu.name, cu)
    ob.location = (x, y, 0.01)
    labels.objects.link(ob)


slots = {}
built = []
# opening outlines ride along as a custom property; export_kit.py copies them
# into the manifest for the web app's inner walls
OPENINGS = modules.openings(D)
print(f"KIT build -> {OUT}")
for coll_name, variant, build, spec in modules.catalog(D):
    col = slots.get(coll_name)
    if col is None:
        col = slots[coll_name] = bpy.data.collections.new(coll_name)
        kit.children.link(col)
    ob = blend.to_object(build(D), f"{coll_name}.{variant}", col, materials.get)
    if ob.name in OPENINGS:
        ob["kit_openings"] = json.dumps(OPENINGS[ob.name])
    lo, hi = blend.check(ob, spec)
    row = row_of(coll_name)
    # lift modules that hang below their floor line (balcony slabs) above the ground
    ob.location = (cursor[row] - lo[0], ROW_Y[row], max(0.0, -lo[2]))
    label(f"{coll_name}\n{variant}", cursor[row] + (hi[0] - lo[0]) / 2, ROW_Y[row] - 1.8)
    cursor[row] += hi[0] - lo[0] + GAP
    built.append(ob)
    mats = [m.name for m in ob.data.materials]
    print(f"  {ob.name:28s} {blend.triangles(ob):5d} tris  "
          f"x {lo[0]:6.2f}..{hi[0]:5.2f}  y {lo[1]:6.2f}..{hi[1]:5.2f}  z {lo[2]:6.2f}..{hi[2]:5.2f}  {mats}")

blend.build_uv1(built)

if WITH_REF:
    if os.path.exists(REF_BLEND):
        with bpy.data.libraries.load(REF_BLEND, link=True) as (src, dst):
            dst.collections = [c for c in src.collections if c == "FR_Modules"]
        ref = bpy.data.collections.new("_REF")
        scene.collection.children.link(ref)
        for c in dst.collections:
            inst = bpy.data.objects.new("REF FR_Modules", None)
            inst.instance_type = "COLLECTION"
            inst.instance_collection = c
            inst.location = (0.0, 40.0, 0.0)  # its modules sit at y = -16 in their file
            ref.objects.link(inst)
        ref.hide_render = True
        print("  linked reference modules from", REF_BLEND)
    else:
        print("  reference .blend not found:", REF_BLEND)

total = sum(blend.triangles(o) for o in built)
print(f"KIT_OK {len(built)} modules, {total} triangles")
bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
