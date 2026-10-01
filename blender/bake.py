"""Bake the kit's texture sets and the railing patterns (KIT_SPEC.md §6.5).

  blender --background --factory-startup --python-exit-code 1 \
      --python blender/bake.py -- public/assets/tex [--only stone,zinc] [--no-lace] [--save blender/textures.blend]

Every texture is made here from scratch as a Blender node material: noise and
Voronoi fields fed with 4D torus coordinates (u -> a circle in xy, v -> a
circle in zw), so each texture tiles seamlessly by construction, octaves
included. Each set bakes (Cycles, Emit) to
  <set>_color.jpg   1024 px, sRGB
  <set>_rh.png       512 px, R = roughness, G = height (Non-Color)
The wrought-iron railing patterns are curves drawn here and rendered
orthographically (Workbench) into iron_lace.png: four 0.9 x 0.9 m tiles in a
2 x 2 atlas (tile k at column k % 2, row k // 2 from the bottom), RGB = shading,
A = coverage. Tiles repeat horizontally; vertically one tile is the full panel.

--save keeps the authoring file (node materials + pattern curves) for tweaking.
"""
import math
import os
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def opt(name):
    return argv[argv.index(name) + 1] if name in argv else None


HERE = os.path.dirname(os.path.abspath(__file__))
args = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or argv[i - 1] not in ("--only", "--save"))]
OUT = os.path.abspath(args[0]) if args else os.path.join(HERE, "..", "public", "assets", "tex")
ONLY = set(opt("--only").split(",")) if opt("--only") else None
SAVE = opt("--save")
os.makedirs(OUT, exist_ok=True)

TAU = 2 * math.pi
COLOR_SIZE, RH_SIZE, LACE_TILE = 1024, 512, 512


def srgb(*c):
    """sRGB colour -> linear (node colours are scene-linear)"""
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c) + (1.0,)


# --------------------------------------------------------------------------- node graph helper

class Graph:
    """Small builder for procedural node materials. Arguments may be numbers
    or sockets. All fields are functions of the plane's UV in [0, 1]^2."""

    def __init__(self, name):
        self.mat = bpy.data.materials.new(name)
        try:
            self.mat.use_nodes = True
        except AttributeError:
            pass
        nt = self.mat.node_tree
        self.nodes, self.links = nt.nodes, nt.links
        for n in list(self.nodes):
            self.nodes.remove(n)
        tc = self.nodes.new("ShaderNodeTexCoord")
        sep = self.nodes.new("ShaderNodeSeparateXYZ")
        self.links.new(tc.outputs["UV"], sep.inputs[0])
        self.u, self.v = sep.outputs[0], sep.outputs[1]
        self.emit = self.nodes.new("ShaderNodeEmission")
        out = self.nodes.new("ShaderNodeOutputMaterial")
        self.links.new(self.emit.outputs[0], out.inputs["Surface"])
        self.image = self.nodes.new("ShaderNodeTexImage")  # bake target, unconnected
        self._torus = {}

    def _set(self, sock, val):
        if isinstance(val, bpy.types.NodeSocket):
            self.links.new(val, sock)
        else:
            sock.default_value = val

    # ---- maths ----
    def math(self, op, a, b=0.0, c=0.0, clamp=False):
        n = self.nodes.new("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
        self._set(n.inputs[0], a)
        self._set(n.inputs[1], b)
        self._set(n.inputs[2], c)
        return n.outputs[0]

    def add(self, a, b):
        return self.math("ADD", a, b)

    def mul(self, a, b):
        return self.math("MULTIPLY", a, b)

    def lin(self, x, k, c=0.0):
        """k * (x - 0.5) + c: centre a 0..1 field and scale it"""
        return self.math("MULTIPLY_ADD", self.math("SUBTRACT", x, 0.5), k, c)

    def smooth(self, x, e0, e1):
        n = self.nodes.new("ShaderNodeMapRange")
        n.interpolation_type = "SMOOTHSTEP"
        self._set(n.inputs["Value"], x)
        n.inputs["From Min"].default_value = e0
        n.inputs["From Max"].default_value = e1
        n.inputs["To Min"].default_value = 0.0
        n.inputs["To Max"].default_value = 1.0
        n.clamp = True
        return n.outputs[0]

    def clamp01(self, x):
        return self.math("ADD", x, 0.0, clamp=True)

    # ---- periodic fields ----
    def torus(self, fu, fv, seed):
        """4D point on a flat torus: fu features per tile along u, fv along v (at
        Scale 1); `seed` shifts the point so equal frequencies give different noise"""
        key = (fu, fv, seed)
        if key not in self._torus:
            a, b = self.mul(self.u, TAU), self.mul(self.v, TAU)
            ru, rv = fu / TAU, fv / TAU
            comb = self.nodes.new("ShaderNodeCombineXYZ")
            self._set(comb.inputs[0], self.math("MULTIPLY_ADD", self.math("COSINE", a), ru, 13.7 * seed))
            self._set(comb.inputs[1], self.math("MULTIPLY_ADD", self.math("SINE", a), ru, 5.3 * seed))
            self._set(comb.inputs[2], self.math("MULTIPLY_ADD", self.math("COSINE", b), rv, 9.1 * seed))
            w = self.math("MULTIPLY_ADD", self.math("SINE", b), rv, 3.9 * seed)
            self._torus[key] = (comb.outputs[0], w)
        return self._torus[key]

    def noise(self, f, fv=None, seed=0, detail=3.0, rough=0.5, lac=2.0, distortion=0.0):
        vec, w = self.torus(f, fv if fv is not None else f, seed)
        n = self.nodes.new("ShaderNodeTexNoise")
        n.noise_dimensions = "4D"
        n.noise_type = "FBM"
        n.normalize = True
        self._set(n.inputs["Vector"], vec)
        self._set(n.inputs["W"], w)
        n.inputs["Scale"].default_value = 1.0
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        n.inputs["Lacunarity"].default_value = lac
        n.inputs["Distortion"].default_value = distortion
        return n.outputs[0]

    def voronoi(self, f, seed=0, feature="F1", randomness=1.0, output=0):
        vec, w = self.torus(f, f, seed)
        n = self.nodes.new("ShaderNodeTexVoronoi")
        n.voronoi_dimensions = "4D"
        n.feature = feature
        self._set(n.inputs["Vector"], vec)
        self._set(n.inputs["W"], w)
        n.inputs["Scale"].default_value = 1.0
        n.inputs["Randomness"].default_value = randomness
        return n.outputs[output]

    def ramp(self, x, stops):
        """scalar -> colour through (position, linear RGBA) stops"""
        n = self.nodes.new("ShaderNodeValToRGB")
        els = n.color_ramp.elements
        while len(els) < len(stops):
            els.new(0.5)
        for el, (pos, col) in zip(els, stops):
            el.position = pos
            el.color = col
        self._set(n.inputs[0], x)
        return n.outputs[0]

    def mix(self, fac, a, b):
        n = self.nodes.new("ShaderNodeMix")
        n.data_type = "RGBA"
        self._set(n.inputs[0], fac)
        self._set(n.inputs[6], a)
        self._set(n.inputs[7], b)
        return n.outputs[2]

    def out(self, socket):
        self.links.new(socket, self.emit.inputs["Color"])


# --------------------------------------------------------------------------- texture sets

def tex_stone(g):
    """Paris limestone (pierre de taille): warm cream, cloudy, fine grain, pores"""
    cloud = g.noise(3, seed=1, detail=5, rough=0.55)
    grain = g.noise(18, seed=2, detail=3, rough=0.6)
    fine = g.noise(90, seed=3, detail=2, rough=0.5)
    pore = g.math("SUBTRACT", 1.0, g.smooth(g.voronoi(55, seed=4), 0.0, 0.11))
    pores = g.mul(pore, g.smooth(g.noise(6, seed=5, detail=2), 0.5, 0.62))
    tone = g.add(g.add(g.lin(cloud, 0.9, 0.5), g.lin(grain, 0.35)), g.lin(fine, 0.18))
    tone = g.clamp01(g.math("MULTIPLY_ADD", pores, -0.22, tone))
    color = g.ramp(tone, [(0.0, srgb(0.60, 0.55, 0.46)), (0.35, srgb(0.74, 0.68, 0.58)),
                          (0.55, srgb(0.80, 0.75, 0.65)), (0.8, srgb(0.85, 0.81, 0.72)),
                          (1.0, srgb(0.90, 0.87, 0.79))])
    rough = g.clamp01(g.add(g.lin(grain, 0.3, 0.55), g.mul(pores, 0.25)))
    height = g.clamp01(g.math("MULTIPLY_ADD", pores, -0.45, g.add(g.lin(grain, 0.6, 0.55), g.lin(fine, 0.35))))
    return color, rough, height


def tex_plaster(g):
    """rendered wall (enduit): grey-beige, trowel marks, stains, vertical run-off streaks"""
    stain = g.noise(2.5, seed=11, detail=4, rough=0.55)
    streak = g.noise(26, 2, seed=12, detail=3)
    trowel = g.noise(8, seed=13, detail=2, distortion=1.5)
    fine = g.noise(70, seed=14, detail=2)
    tone = g.add(g.add(g.lin(stain, 0.7, 0.55), g.lin(streak, 0.35)), g.add(g.lin(trowel, 0.25), g.lin(fine, 0.15)))
    color = g.ramp(g.clamp01(tone), [(0.0, srgb(0.52, 0.50, 0.46)), (0.45, srgb(0.70, 0.68, 0.63)),
                                     (1.0, srgb(0.83, 0.81, 0.77))])
    rough = g.clamp01(g.lin(fine, 0.1, 0.9))
    height = g.clamp01(g.add(g.lin(trowel, 0.7, 0.5), g.lin(fine, 0.4)))
    return color, rough, height


def tex_zinc(g):
    """patinated zinc: blue-grey, mottled lighter patina, run-off streaks down the slope"""
    patina = g.noise(3, seed=21, detail=4, rough=0.6)
    streak = g.noise(22, 1.5, seed=22, detail=3)
    fine = g.noise(60, seed=23, detail=2)
    tone = g.clamp01(g.add(g.add(g.lin(patina, 0.8, 0.5), g.lin(streak, 0.45)), g.lin(fine, 0.12)))
    color = g.ramp(tone, [(0.0, srgb(0.33, 0.37, 0.41)), (0.45, srgb(0.47, 0.52, 0.56)),
                          (0.8, srgb(0.56, 0.60, 0.63)), (1.0, srgb(0.66, 0.69, 0.71))])
    rough = g.clamp01(g.add(g.lin(patina, 0.5, 0.45), g.lin(streak, 0.2)))
    height = g.clamp01(g.lin(fine, 0.8, 0.5))
    return color, rough, height


def tex_metal(g):
    """painted wrought iron: near-black paint, worn spots, a little rust"""
    wear = g.noise(7, seed=31, detail=4, rough=0.6)
    spots = g.smooth(g.noise(16, seed=32, detail=3), 0.62, 0.72)
    fine = g.noise(80, seed=33, detail=2)
    paint = g.ramp(g.clamp01(g.add(g.lin(wear, 0.6, 0.5), g.lin(fine, 0.3))),
                   [(0.0, srgb(0.05, 0.05, 0.055)), (1.0, srgb(0.11, 0.115, 0.12))])
    color = g.mix(g.mul(spots, 0.8), paint, srgb(0.30, 0.17, 0.10))
    rough = g.clamp01(g.add(g.lin(wear, 0.4, 0.5), g.mul(spots, 0.3)))
    height = g.clamp01(g.math("MULTIPLY_ADD", spots, -0.4, g.lin(fine, 0.5, 0.6)))
    return color, rough, height


def tex_wood(g):
    """painted wood, near white so a tint carries the paint colour: grain runs along u"""
    grain = g.noise(3, 40, seed=41, detail=3, rough=0.55)
    brush = g.noise(6, 140, seed=42, detail=2)
    knots = g.noise(4, seed=43, detail=2)
    tone = g.clamp01(g.add(g.add(g.lin(grain, 0.7, 0.5), g.lin(brush, 0.3)), g.lin(knots, 0.2)))
    color = g.ramp(tone, [(0.0, srgb(0.84, 0.83, 0.80)), (1.0, srgb(0.96, 0.955, 0.94))])
    rough = g.clamp01(g.add(g.lin(brush, 0.25, 0.45), g.lin(grain, 0.15)))
    height = g.clamp01(g.add(g.lin(grain, 0.8, 0.5), g.lin(brush, 0.3)))
    return color, rough, height


def tex_terracotta(g):
    """chimney pots: fired clay, mottled, sooty patches"""
    mottle = g.noise(5, seed=51, detail=4, rough=0.6)
    soot = g.smooth(g.noise(3, seed=52, detail=3), 0.5, 0.75)
    fine = g.noise(70, seed=53, detail=2)
    clay = g.ramp(g.clamp01(g.add(g.lin(mottle, 0.8, 0.5), g.lin(fine, 0.25))),
                  [(0.0, srgb(0.55, 0.28, 0.17)), (0.5, srgb(0.68, 0.38, 0.24)), (1.0, srgb(0.78, 0.50, 0.34))])
    color = g.mix(g.mul(soot, 0.7), clay, srgb(0.16, 0.13, 0.11))
    rough = g.clamp01(g.lin(fine, 0.1, 0.88))
    height = g.clamp01(g.add(g.lin(mottle, 0.4, 0.5), g.lin(fine, 0.5)))
    return color, rough, height


def tex_fabric(g):
    """awning canvas: plain weave (64 threads per tile each way), near white"""
    wu = g.math("SINE", g.mul(g.u, TAU * 64))
    wv = g.math("SINE", g.mul(g.v, TAU * 64))
    weave = g.math("MULTIPLY_ADD", g.mul(wu, wv), 0.5, 0.5)
    slub = g.noise(10, 80, seed=61, detail=2)
    tone = g.clamp01(g.add(g.lin(weave, 0.25, 0.5), g.lin(slub, 0.3)))
    color = g.ramp(tone, [(0.0, srgb(0.82, 0.81, 0.78)), (1.0, srgb(0.95, 0.94, 0.92))])
    rough = g.clamp01(g.lin(slub, 0.06, 0.93))
    height = g.clamp01(g.add(g.lin(weave, 0.9, 0.5), g.lin(slub, 0.2)))
    return color, rough, height


SETS = {
    "stone": tex_stone, "plaster": tex_plaster, "zinc": tex_zinc, "metal": tex_metal,
    "wood": tex_wood, "terracotta": tex_terracotta, "fabric": tex_fabric,
}


# --------------------------------------------------------------------------- baking

def new_image(name, size, colorspace):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = colorspace
    return img


def pixels(img):
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(h, w, 4)


def save(px, name, path, fmt, colorspace, alpha=False):
    """write an (h, w, 4) float array; Blender images always hold RGBA"""
    h, w = px.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=alpha, float_buffer=False)
    img.colorspace_settings.name = colorspace
    img.alpha_mode = "STRAIGHT"
    img.pixels.foreach_set(px.astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = fmt
    if fmt == "JPEG":
        img.save(quality=92)
    else:
        img.save()
    bpy.data.images.remove(img)


def bake_sets(scene):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 8
    scene.render.bake.margin = 0
    bpy.ops.mesh.primitive_plane_add(size=1.0)
    plane = bpy.context.active_object
    written = []
    for name, recipe in SETS.items():
        if ONLY and name not in ONLY:
            continue
        g = Graph(f"TEX_{name}")
        color, rough, height = recipe(g)
        plane.data.materials.clear()
        plane.data.materials.append(g.mat)
        results = {}
        for key, sock, size, cs in (("color", color, COLOR_SIZE, "sRGB"),
                                    ("rough", rough, RH_SIZE, "Non-Color"),
                                    ("height", height, RH_SIZE, "Non-Color")):
            g.out(sock)
            img = new_image(f"{name}_{key}", size, cs)
            g.image.image = img
            g.nodes.active = g.image
            bpy.ops.object.bake(type="EMIT", margin=0, use_clear=True)
            results[key] = img
        save(pixels(results["color"]), f"{name}_color_out", os.path.join(OUT, f"{name}_color.jpg"), "JPEG", "sRGB")
        r, h = pixels(results["rough"]), pixels(results["height"])
        rh = np.zeros_like(r)
        rh[..., 0], rh[..., 1], rh[..., 3] = r[..., 0], h[..., 0], 1.0
        save(rh, f"{name}_rh_out", os.path.join(OUT, f"{name}_rh.png"), "PNG", "Non-Color")
        written += [f"{name}_color.jpg", f"{name}_rh.png"]
        print(f"  baked {name}: tone {pixels(results['color'])[..., :3].mean(axis=(0, 1)).round(3)}")
    bpy.data.objects.remove(plane)
    return written


# --------------------------------------------------------------------------- railing patterns

T = 0.9            # tile size (m): one period horizontally, the full panel vertically
FRAME = (0.03, T - 0.03)


def pts_circle(cx, cy, r, n=48):
    return [(cx + r * math.cos(TAU * k / n), cy + r * math.sin(TAU * k / n)) for k in range(n)]


class Pattern:
    """strokes for one tile, drawn as bevelled curves (tubes) of a few widths"""

    def __init__(self, coll, name):
        self.coll, self.name, self.curves = coll, name, {}

    def _curve(self, r):
        if r not in self.curves:
            cu = bpy.data.curves.new(f"{self.name}_{r}", type="CURVE")
            cu.dimensions = "3D"
            cu.bevel_depth = r
            cu.bevel_resolution = 3
            cu.fill_mode = "FULL"
            ob = bpy.data.objects.new(cu.name, cu)
            self.coll.objects.link(ob)
            self.curves[r] = cu
        return self.curves[r]

    def stroke(self, pts, r=0.006, closed=False, wrap=True):
        """a poly stroke; with wrap it is repeated one tile left and right so the
        pattern stays continuous across the tile edges"""
        for dx in ((-T, 0.0, T) if wrap else (0.0,)):
            sp = self._curve(r).splines.new("POLY")
            sp.points.add(len(pts) - 1)
            for p, (x, y) in zip(sp.points, pts):
                p.co = (x + dx, y, 0.0, 1.0)
            sp.use_cyclic_u = closed

    def circle(self, cx, cy, rad, r=0.005):
        self.stroke(pts_circle(cx, cy, rad), r, closed=True)

    def frame(self):
        for y in FRAME:
            self.stroke([(-0.05, y), (T + 0.05, y)], 0.008, wrap=False)


def spiral(cx, cy, r0, a0, turn, k, n=90):
    """logarithmic spiral from angle a0 (radians), turning `turn` radians
    (negative = clockwise), radius r0 * exp(-k * |theta|)"""
    out = []
    for i in range(n + 1):
        th = turn * i / n
        r = r0 * math.exp(-k * abs(th))
        out.append((cx + r * math.cos(a0 + th), cy + r * math.sin(a0 + th)))
    return out


def lace_balusters(p):
    p.frame()
    s = T / 8
    for i in range(8):
        x = (i + 0.5) * s
        p.stroke([(x, FRAME[0]), (x, FRAME[1])], 0.0055)
        p.circle(x, 0.45, 0.03)
        p.circle(i * s, 0.17, 0.02, 0.0045)
        p.circle(i * s, 0.73, 0.02, 0.0045)
    p.stroke([(-0.05, 0.31), (T + 0.05, 0.31)], 0.004, wrap=False)
    p.stroke([(-0.05, 0.59), (T + 0.05, 0.59)], 0.004, wrap=False)


def lace_entrelacs(p):
    p.frame()
    s = 0.15
    for i in range(6):
        x = (i + 0.5) * s
        p.circle(x, 0.45, 0.095, 0.0055)
        p.circle(x, 0.45, 0.032, 0.0045)
        p.stroke([(x, FRAME[0]), (x, 0.355)], 0.0055)
        p.stroke([(x, 0.545), (x, FRAME[1])], 0.0055)
        p.circle(i * s, 0.19, 0.026, 0.0045)
        p.circle(i * s, 0.71, 0.026, 0.0045)


def lace_volutes(p):
    p.frame()
    U = T / 2
    for i in range(2):
        xc = (i + 0.5) * U
        p.stroke([(xc, FRAME[0]), (xc, FRAME[1])], 0.0065)
        p.stroke([(i * U, FRAME[0]), (i * U, FRAME[1])], 0.0065)
        p.circle(xc, 0.62, 0.042, 0.0055)
        p.circle(xc, 0.62, 0.016, 0.0045)
        for s in (-1, 1):
            # large scroll curling down and in, smaller one curling up at the top
            a0 = math.pi - math.radians(20) if s > 0 else math.radians(20)
            p.stroke(spiral(xc + s * 0.115, 0.37, 0.11, a0, -s * 3.2 * math.pi, 0.2), 0.0055)
            a1 = math.pi + math.radians(25) if s > 0 else -math.radians(25)
            p.stroke(spiral(xc + s * 0.10, 0.77, 0.075, a1, s * 2.6 * math.pi, 0.25), 0.0045)


def lace_losanges(p):
    p.frame()
    w = T / 4
    for i in range(4):
        xc = (i + 0.5) * w
        p.stroke([(xc, 0.85), (xc + w / 2, 0.45), (xc, 0.05), (xc - w / 2, 0.45)], 0.0055, closed=True)
        p.stroke([(xc, 0.66), (xc + w / 4.4, 0.45), (xc, 0.24), (xc - w / 4.4, 0.45)], 0.0045, closed=True)
        p.circle(xc, 0.45, 0.014, 0.0045)
        p.circle(i * w, 0.45, 0.03, 0.005)


LACE = [lace_balusters, lace_entrelacs, lace_volutes, lace_losanges]


def render_lace(scene):
    scene.render.engine = "BLENDER_WORKBENCH"
    sh = scene.display.shading
    sh.light = "STUDIO"
    sh.color_type = "SINGLE"
    sh.single_color = (0.92, 0.92, 0.92)
    sh.show_shadows = False
    sh.show_cavity = False
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = LACE_TILE
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    cam = bpy.data.cameras.new("lace_cam")
    cam.type = "ORTHO"
    cam.ortho_scale = T
    cam_ob = bpy.data.objects.new("lace_cam", cam)
    cam_ob.location = (T / 2, T / 2, 2.0)
    scene.collection.objects.link(cam_ob)
    scene.camera = cam_ob
    atlas = np.zeros((2 * LACE_TILE, 2 * LACE_TILE, 4), dtype=np.float32)
    colls = []
    for k, draw in enumerate(LACE):
        coll = bpy.data.collections.new(f"LACE_{k}_{draw.__name__}")
        scene.collection.children.link(coll)
        draw(Pattern(coll, draw.__name__))
        colls.append(coll)
    tmp = os.path.join(OUT, "_lace_tile.png")
    for k, coll in enumerate(colls):
        for c in colls:
            c.hide_render = c is not coll
        scene.render.filepath = tmp
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(tmp)
        px = pixels(img)
        bpy.data.images.remove(img)
        col, row = k % 2, k // 2
        atlas[row * LACE_TILE:(row + 1) * LACE_TILE, col * LACE_TILE:(col + 1) * LACE_TILE] = px
    os.remove(tmp)
    save(atlas, "iron_lace_out", os.path.join(OUT, "iron_lace.png"), "PNG", "sRGB", alpha=True)
    print("  rendered iron_lace:", [d.__name__ for d in LACE])
    return ["iron_lace.png"]


# --------------------------------------------------------------------------- main

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
written = bake_sets(scene)
if "--no-lace" not in argv:
    written += render_lace(scene)
if SAVE:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(SAVE), compress=True)
print("BAKE_OK", written)
