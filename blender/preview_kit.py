"""Render a contact sheet of every kit module with its name (Workbench; the
.blend is not saved). The format follows the extension (.jpg or .png).

  blender --background blender/european_kit.blend --python blender/preview_kit.py \
      -- blender/kit_preview.jpg [--view front|three-quarter|back]
"""
import math
import os
import sys

import bpy
from mathutils import Euler, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
args = [a for a in argv if not a.startswith("--")]
OUT = os.path.abspath(args[0]) if args else os.path.join(os.path.dirname(bpy.data.filepath), "kit_preview.jpg")
VIEW = argv[argv.index("--view") + 1] if "--view" in argv else "three-quarter"

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
sh = scene.display.shading
sh.light = "STUDIO"
sh.color_type = "MATERIAL"
sh.show_shadows = True
sh.show_cavity = True
sh.cavity_type = "BOTH"
scene.display.shadow_focus = 0.2
scene.render.resolution_x, scene.render.resolution_y = 2600, 1500
scene.render.film_transparent = False
world = bpy.data.worlds.new("preview")
world.color = (0.82, 0.83, 0.85)
scene.world = world

for c in bpy.data.collections:
    if c.name == "_REF":
        c.hide_render = True

# ground plane for the shadows
me = bpy.data.meshes.new("ground")
me.from_pydata([(-20, -20, 0), (160, -20, 0), (160, 70, 0), (-20, 70, 0)], [], [(0, 1, 2, 3)])
mat = bpy.data.materials.new("ground")
mat.diffuse_color = (0.72, 0.72, 0.74, 1)
me.materials.append(mat)
scene.collection.objects.link(bpy.data.objects.new("ground", me))

rot = {
    "three-quarter": Euler((math.radians(57), 0, math.radians(-18))),
    "front": Euler((math.radians(75), 0, 0)),
    "back": Euler((math.radians(57), 0, math.radians(160))),
}[VIEW]
cam = bpy.data.cameras.new("cam")
cam.type = "ORTHO"
cam_ob = bpy.data.objects.new("cam", cam)
cam_ob.rotation_euler = rot
scene.collection.objects.link(cam_ob)
scene.camera = cam_ob

# fit the orthographic frame around every module and label
pts = []
for c in ("KIT", "_LABELS"):
    for o in bpy.data.collections[c].all_objects:
        pts += [o.matrix_world @ Vector(b) for b in o.bound_box]
R = rot.to_matrix()
right, up, fwd = R.col[0], R.col[1], -R.col[2]
center = sum(pts, Vector()) / len(pts)
xs = [(p - center).dot(right) for p in pts]
ys = [(p - center).dot(up) for p in pts]
mid = center + right * (max(xs) + min(xs)) / 2 + up * (max(ys) + min(ys)) / 2
aspect = scene.render.resolution_x / scene.render.resolution_y
cam.ortho_scale = max(max(xs) - min(xs), (max(ys) - min(ys)) * aspect) * 1.06
cam_ob.location = mid - fwd * 120
cam.clip_end = 400

img = scene.render.image_settings
formats = [i.identifier for i in img.bl_rna.properties["file_format"].enum_items]
if OUT.lower().endswith((".jpg", ".jpeg")) and "JPEG" in formats:
    img.file_format = "JPEG"
    img.quality = 88
else:
    img.file_format = "PNG"
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("PREVIEW_OK", OUT)
