"""Bake the kit's ambient occlusion into one atlas (KIT_SPEC.md §6.3, §6.5).

  blender --background blender/european_kit.blend --python-exit-code 1 \
      --python blender/bake_ao.py -- public/assets/tex/kit_ao.jpg [--samples 32]

Every module's UV1 is a non-overlapping island of one shared 0..1 layout
(build_kit.py), so a single Cycles AO bake over all modules fills the atlas.
Modules sit 1.2 m apart in the .blend and the AO distance is 0.6 m, so they
don't shade each other. The .blend is not saved.
"""
import os
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0]) if argv and not argv[0].startswith("--") else "kit_ao.jpg"
SAMPLES = int(argv[argv.index("--samples") + 1]) if "--samples" in argv else 32
SIZE = 2048

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = SAMPLES
if scene.world is None:
    scene.world = bpy.data.worlds.new("bake")
scene.world.light_settings.distance = 0.6

objs = [o for o in bpy.data.collections["KIT"].all_objects if o.type == "MESH"]
img = bpy.data.images.new("kit_ao", SIZE, SIZE, alpha=False, float_buffer=False)
img.colorspace_settings.name = "Non-Color"
img.pixels.foreach_set(np.ones(SIZE * SIZE * 4, dtype=np.float32))  # white where no island

for mat in {m for o in objs for m in o.data.materials if m}:
    nt = mat.node_tree
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = img
    nt.nodes.active = node

vl = bpy.context.view_layer
for o in vl.objects:
    o.select_set(False)
for o in objs:
    o.data.uv_layers.active = o.data.uv_layers["UV1"]
    o.select_set(True)
vl.objects.active = objs[0]
bpy.ops.object.bake(type="AO", margin=6, use_clear=False)

img.filepath_raw = OUT
img.file_format = "JPEG" if OUT.lower().endswith((".jpg", ".jpeg")) else "PNG"
img.save(quality=88) if img.file_format == "JPEG" else img.save()
px = np.empty(SIZE * SIZE * 4, dtype=np.float32)
img.pixels.foreach_get(px)
print(f"AO_OK {OUT} mean {px.reshape(-1, 4)[:, 0].mean():.3f}")
