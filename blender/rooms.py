"""Render the interior atlas (KIT_SPEC.md §7): 17 Parisian room sections modelled
here from simple parts, each rendered by a camera 16 m in front of its open
front, so the interior shader (src/interiors.ts) can project the picture back
into the room boxes behind the windows.

  blender --background --factory-startup --python-exit-code 1 \
      --python blender/rooms.py -- public/assets/tex/interiors.jpg [--samples 24] [--only 0,3]

Room frame: x across (centred, width 4H), y depth from the open front (0..D),
z up from the floor (0..H). Camera at (0, -16, H/2) looking +y; its frame
covers 4H x H at y = 0. Atlas: 2048 x 2304, 2 columns x 9 rows of 1024 x 256
cells; cell k at column k % 2, row k // 2 from the bottom (src/interiors.ts).
"""
import math
import os
import random
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from kitlib import blend  # noqa: E402
from kitlib.geom import MeshBuilder  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


args = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or argv[i - 1] not in ("--samples", "--only"))]
OUT = os.path.abspath(args[0]) if args else os.path.join(HERE, "..", "public", "assets", "tex", "interiors.jpg")
SAMPLES = int(opt("--samples", "24"))
ONLY = {int(k) for k in opt("--only").split(",")} if opt("--only") else None
CW, CH = 1024, 256
CAM_DIST = 16.0


def srgb(*c):
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c) + (1.0,)


# --------------------------------------------------------------------------- room builder

class Room:
    """one room section: meshes by material key, lights, a palette"""

    def __init__(self, H, palette, depth=5.0, seed=0):
        self.H, self.D, self.W = H, depth, 4 * H
        self.palette = palette
        self.parts = {}
        self.lights = []
        self.rng = random.Random(seed)

    def m(self, key):
        if key not in self.palette:
            raise KeyError(f"palette has no {key}")
        return self.parts.setdefault(key, MeshBuilder())

    def box(self, key, x0, y0, z0, x1, y1, z1):
        self.m(key).box((min(x0, x1), min(y0, y1), min(z0, z1)), (max(x0, x1), max(y0, y1), max(z0, z1)), key)

    def cyl(self, key, cx, cy, z0, z1, r, n=14, r1=None):
        r1 = r if r1 is None else r1
        mb = self.m(key)
        for i in range(n):
            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            mb.face([(cx + r * math.cos(a0), cy + r * math.sin(a0), z0), (cx + r * math.cos(a1), cy + r * math.sin(a1), z0),
                     (cx + r1 * math.cos(a1), cy + r1 * math.sin(a1), z1), (cx + r1 * math.cos(a0), cy + r1 * math.sin(a0), z1)],
                    key, [(0, 0), (1, 0), (1, 1), (0, 1)])
        mb.face([(cx + r1 * math.cos(2 * math.pi * i / n), cy + r1 * math.sin(2 * math.pi * i / n), z1) for i in range(n)],
                key, [(0, 0)] * n)

    def ball(self, key, cx, cy, cz, r, n=10):
        mb = self.m(key)
        for i in range(n):
            for j in range(n // 2):
                def p(ii, jj):
                    th, ph = 2 * math.pi * ii / n, math.pi * jj / (n // 2) - math.pi / 2
                    return (cx + r * math.cos(ph) * math.cos(th), cy + r * math.cos(ph) * math.sin(th), cz + r * math.sin(ph))
                mb.face([p(i, j), p(i + 1, j), p(i + 1, j + 1), p(i, j + 1)], key, [(0, 0), (1, 0), (1, 1), (0, 1)])

    def light(self, x, y, z, power, color=(1.0, 0.78, 0.55), size=0.6, kind="AREA", direction=(0, 0, -1)):
        self.lights.append((x, y, z, power, color, size, kind, direction))

    def build(self, coll):
        mats = {}
        for key, spec in self.palette.items():
            mats[key] = make_material(f"{key}", *spec)
        for key, mb in self.parts.items():
            blend.to_object(mb, key, coll, lambda name: mats[name], smooth_angle=40)
        for i, (x, y, z, power, color, size, kind, direction) in enumerate(self.lights):
            ld = bpy.data.lights.new(f"light{i}", kind)
            ld.energy = power
            ld.color = color
            if kind == "AREA":
                ld.shape = "SQUARE"
                ld.size = size
            else:
                ld.shadow_soft_size = size
            ob = bpy.data.objects.new(ld.name, ld)
            ob.location = (x, y, z)
            ob.rotation_euler = direction_to_euler(direction)
            coll.objects.link(ob)


def direction_to_euler(d):
    from mathutils import Vector
    return Vector(d).to_track_quat("-Z", "Y").to_euler()


def make_material(name, color, rough=0.6, metal=0.0, emit=0.0, noise=0.0):
    """Principled material; `noise` mottles the colour (wood, rugs, worn walls)"""
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    col = srgb(*color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if noise > 0:
        tex = nt.nodes.new("ShaderNodeTexNoise")
        tex.inputs["Scale"].default_value = 6.0
        tex.inputs["Detail"].default_value = 6.0
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = tuple(c * (1 - noise) for c in col[:3]) + (1,)
        ramp.color_ramp.elements[1].color = tuple(min(1.0, c * (1 + noise * 0.6)) for c in col[:3]) + (1,)
        nt.links.new(tex.outputs[0], ramp.inputs[0])
        nt.links.new(ramp.outputs[0], b.inputs["Base Color"])
    else:
        b.inputs["Base Color"].default_value = col
    if emit > 0:
        b.inputs["Emission Color"].default_value = col
        b.inputs["Emission Strength"].default_value = emit
    return m


# --------------------------------------------------------------------------- furniture

def shell(r, wall="wall", floor="floor", ceiling="ceiling", trim="trim", partitions=(), doors=(), panels=True):
    W, D, H = r.W, r.D, r.H
    r.box(floor, -W / 2, 0, -0.1, W / 2, D, 0)
    r.box(ceiling, -W / 2, 0, H, W / 2, D, H + 0.1)
    r.box(wall, -W / 2, D, 0, W / 2, D + 0.1, H)
    r.box(wall, -W / 2 - 0.1, 0, 0, -W / 2, D, H)
    r.box(wall, W / 2, 0, 0, W / 2 + 0.1, D, H)
    r.box(trim, -W / 2, D - 0.03, 0, W / 2, D, 0.14)
    r.box(trim, -W / 2, D - 0.1, H - 0.12, W / 2, D, H)
    for x in partitions:  # walls between rooms, open at the doorway
        r.box(wall, x - 0.06, 0.6, 0, x + 0.06, D, H)
        r.box(trim, x - 0.07, 0.6, H - 0.12, x + 0.07, D, H)
    for x in doors:  # double doors in the back wall
        r.box("trim", x - 0.75, D - 0.06, 0, x + 0.75, D - 0.01, 2.45)
        r.box("door", x - 0.65, D - 0.08, 0.02, x + 0.65, D - 0.06, 2.35)
    if panels:  # wainscot panels on the back wall
        x = -W / 2 + 0.4
        while x < W / 2 - 1.0:
            if not any(abs(x + 0.4 - d) < 1.1 for d in doors):
                for z0, z1 in ((0.3, 0.9), (1.2, H - 0.45)):
                    for (a, b, c, d) in ((x, z0, x + 0.8, z0 + 0.03), (x, z1 - 0.03, x + 0.8, z1),
                                         (x, z0, x + 0.03, z1), (x + 0.77, z0, x + 0.8, z1)):
                        r.box(trim, a, D - 0.025, b, c, D - 0.005, d)
            x += 1.0


def rug(r, x, y, w, d, key="rug"):
    r.box(key, x - w / 2, y - d / 2, 0, x + w / 2, y + d / 2, 0.012)


def sofa(r, x, y, w=2.0, key="sofa"):
    r.box(key, x - w / 2, y - 0.45, 0.1, x + w / 2, y + 0.45, 0.45)
    r.box(key, x - w / 2, y + 0.25, 0.45, x + w / 2, y + 0.45, 0.9)
    for s in (-1, 1):
        r.box(key, x + s * w / 2 - 0.12 * (s > 0) - 0.0, y - 0.45, 0.1, x + s * w / 2 + 0.12 * (s < 0) * -1 + 0.0, y + 0.45, 0.65)
    for s in (-1, 1):
        r.box("wood_dark", x + s * (w / 2 - 0.08), y - 0.4, 0, x + s * (w / 2 - 0.12), y - 0.36, 0.1)


def armchair(r, x, y, key="sofa"):
    sofa(r, x, y, w=0.9, key=key)


def table(r, x, y, w=1.8, d=0.9, h=0.75, key="wood", chairs=True):
    r.box(key, x - w / 2, y - d / 2, h - 0.04, x + w / 2, y + d / 2, h)
    for sx in (-1, 1):
        for sy in (-1, 1):
            r.box(key, x + sx * (w / 2 - 0.08), y + sy * (d / 2 - 0.08), 0, x + sx * (w / 2 - 0.13), y + sy * (d / 2 - 0.13), h - 0.04)
    if chairs:
        n = max(1, int(w / 0.6))
        for i in range(n):
            cx = x - w / 2 + (i + 0.5) * w / n
            for sy in (-1, 1):
                cy = y + sy * (d / 2 + 0.25)
                r.box(key, cx - 0.2, cy - 0.2, 0.43, cx + 0.2, cy + 0.2, 0.47)
                r.box(key, cx - 0.2, cy + sy * 0.17, 0.47, cx + 0.2, cy + sy * 0.2, 0.95)


def bookshelf(r, x, w, h=2.2, key="wood_dark"):
    D = r.D
    r.box(key, x - w / 2, D - 0.4, 0, x + w / 2, D - 0.37, h)
    for s in (-1, 1):
        r.box(key, x + s * w / 2 - 0.03 * (s > 0), D - 0.4, 0, x + s * w / 2 + 0.03 * (s < 0) * -1, D - 0.02, h)
    shelves = int(h / 0.38)
    for k in range(shelves + 1):
        z = k * h / shelves
        r.box(key, x - w / 2, D - 0.4, z, x + w / 2, D - 0.02, z + 0.025)
        if k < shelves:
            bx = x - w / 2 + 0.04
            while bx < x + w / 2 - 0.08:
                bw = r.rng.uniform(0.03, 0.07)
                bh = r.rng.uniform(0.2, 0.3)
                r.box(r.rng.choice(["book_a", "book_b", "book_c"]), bx, D - 0.33, z + 0.025, bx + bw, D - 0.08, z + 0.025 + bh)
                bx += bw + 0.005


def painting(r, x, z, w, h, key="art_a"):
    D = r.D
    r.box("frame", x - w / 2 - 0.05, D - 0.05, z - h / 2 - 0.05, x + w / 2 + 0.05, D - 0.02, z + h / 2 + 0.05)
    r.box(key, x - w / 2, D - 0.06, z - h / 2, x + w / 2, D - 0.05, z + h / 2)


def fireplace(r, x):
    D = r.D
    r.box("marble", x - 0.8, D - 0.35, 0, x + 0.8, D, 0.15)
    for s in (-1, 1):
        r.box("marble", x + s * 0.75 - 0.1, D - 0.3, 0, x + s * 0.75 + 0.1, D, 1.05)
    r.box("marble", x - 0.85, D - 0.38, 1.05, x + 0.85, D, 1.15)
    r.box("soot", x - 0.55, D - 0.2, 0.15, x + 0.55, D - 0.01, 0.9)
    r.box("frame", x - 0.7, D - 0.05, 1.3, x + 0.7, D - 0.02, 2.5)
    r.box("mirror", x - 0.6, D - 0.06, 1.4, x + 0.6, D - 0.05, 2.4)
    r.box("brass", x - 0.08, D - 0.3, 1.15, x + 0.08, D - 0.2, 1.4)


def chandelier(r, x, y):
    H = r.H
    r.cyl("brass", x, y, H - 0.6, H, 0.015)
    r.cyl("brass", x, y, H - 0.75, H - 0.6, 0.25, r1=0.05)
    for k in range(6):
        a = 2 * math.pi * k / 6
        r.ball("bulb", x + 0.3 * math.cos(a), y + 0.3 * math.sin(a), H - 0.62, 0.04)
    r.light(x, y, H - 0.7, 120, size=0.5, kind="POINT")


def floor_lamp(r, x, y):
    r.cyl("brass", x, y, 0, 1.5, 0.015)
    r.cyl("shade", x, y, 1.45, 1.75, 0.22, r1=0.14)
    r.light(x, y, 1.6, 40, size=0.2, kind="POINT")


def ceiling_light(r, x, y, power=150, color=(1.0, 0.82, 0.62)):
    r.cyl("bulb", x, y, r.H - 0.06, r.H, 0.18)
    r.light(x, y, r.H - 0.1, power, color=color, size=0.8)


def plant(r, x, y, h=1.2):
    r.cyl("pot", x, y, 0, 0.35, 0.18, r1=0.22)
    for k in range(5):
        r.ball("leaf", x + r.rng.uniform(-0.2, 0.2), y + r.rng.uniform(-0.2, 0.2), 0.35 + h * r.rng.uniform(0.4, 0.9), 0.22)


def bed(r, x, y, w=1.6):
    D = r.D
    r.box("wood", x - w / 2, D - 2.1, 0.15, x + w / 2, D - 0.05, 0.45)
    r.box("linen", x - w / 2 + 0.03, D - 2.05, 0.45, x + w / 2 - 0.03, D - 0.1, 0.62)
    r.box("cover", x - w / 2, D - 1.7, 0.6, x + w / 2, D - 0.6, 0.66)
    r.box("wood_dark", x - w / 2 - 0.05, D - 0.08, 0, x + w / 2 + 0.05, D - 0.02, 1.2)
    for s in (-1, 1):
        r.box("linen", x + s * w / 4 - 0.3, D - 0.55, 0.62, x + s * w / 4 + 0.3, D - 0.2, 0.75)


def wardrobe(r, x, w=1.4):
    D = r.D
    r.box("wood", x - w / 2, D - 0.6, 0, x + w / 2, D - 0.02, 2.3)
    r.box("wood_dark", x - 0.01, D - 0.61, 0.1, x + 0.01, D - 0.6, 2.2)


def kitchen(r, x, w):
    D = r.D
    r.box("cabinet", x - w / 2, D - 0.62, 0, x + w / 2, D - 0.02, 0.9)
    r.box("counter", x - w / 2, D - 0.64, 0.9, x + w / 2, D - 0.02, 0.94)
    r.box("cabinet", x - w / 2, D - 0.38, 1.5, x + w / 2, D - 0.02, 2.2)
    r.box("tile", x - w / 2, D - 0.02, 0.94, x + w / 2, D - 0.01, 1.5)
    r.box("cabinet", x - 0.8, D - 2.2, 0, x + 0.8, D - 1.6, 0.92)
    r.box("counter", x - 0.85, D - 2.25, 0.92, x + 0.85, D - 1.55, 0.96)


def easel(r, x, y, key="art_b"):
    r.box("wood", x - 0.4, y, 0, x - 0.36, y + 0.04, 1.8)
    r.box("wood", x + 0.36, y, 0, x + 0.4, y + 0.04, 1.8)
    r.box("wood", x - 0.4, y - 0.02, 0.8, x + 0.4, y + 0.06, 0.84)
    r.box(key, x - 0.35, y - 0.03, 0.84, x + 0.35, y, 1.55)


def boxes(r, x, y, n=5):
    for k in range(n):
        w = r.rng.uniform(0.4, 0.7)
        h = r.rng.uniform(0.3, 0.5)
        bx, by = x + r.rng.uniform(-0.8, 0.8), y + r.rng.uniform(-0.5, 0.5)
        z = 0.0 if k < 3 else h
        r.box("cardboard", bx - w / 2, by - w / 2, z, bx + w / 2, by + w / 2, z + h)


def shelves_goods(r, x, w, h=2.4, goods=("bread", "bread_b")):
    D = r.D
    for k in range(5):
        z = 0.5 + k * (h - 0.5) / 4
        r.box("wood", x - w / 2, D - 0.45, z, x + w / 2, D - 0.02, z + 0.03)
        gx = x - w / 2 + 0.05
        while gx < x + w / 2 - 0.15:
            gw = r.rng.uniform(0.15, 0.3)
            r.box(r.rng.choice(goods), gx, D - 0.4, z + 0.03, gx + gw, D - 0.1, z + 0.03 + r.rng.uniform(0.08, 0.2))
            gx += gw + 0.04


def counter(r, x, y, w, key="wood_dark", top="marble"):
    r.box(key, x - w / 2, y - 0.3, 0, x + w / 2, y + 0.3, 1.0)
    r.box(top, x - w / 2 - 0.03, y - 0.33, 1.0, x + w / 2 + 0.03, y + 0.33, 1.05)


def bistro(r, x, y):
    r.cyl("brass", x, y, 0, 0.72, 0.03)
    r.cyl("marble", x, y, 0.72, 0.75, 0.32)
    for a in (0.3, 2.4, 4.4):
        cx, cy = x + 0.55 * math.cos(a), y + 0.55 * math.sin(a)
        r.cyl("rattan", cx, cy, 0.42, 0.46, 0.2)
        for s in (-1, 1):
            r.cyl("rattan", cx + s * 0.13, cy, 0, 0.42, 0.012)
        r.box("rattan", cx - 0.18, cy + 0.15, 0.46, cx + 0.18, cy + 0.19, 0.85)


def clothes_rack(r, x, y):
    r.box("brass", x - 0.8, y, 1.5, x + 0.8, y + 0.02, 1.52)
    for s in (-1, 1):
        r.box("brass", x + s * 0.8, y, 0, x + s * 0.8 + 0.02, y + 0.02, 1.52)
    gx = x - 0.75
    while gx < x + 0.7:
        r.box(r.rng.choice(["cloth_a", "cloth_b", "cloth_c"]), gx, y - 0.2, 0.5, gx + 0.04, y + 0.22, 1.48)
        gx += 0.07


def stairs(r, x, w=1.2, steps=14):
    D = r.D
    for k in range(steps):
        z = k * 0.18
        r.box("wood", x - w / 2 + k * 0.28 - 2.0, D - 1.3, 0, x - w / 2 + k * 0.28 - 1.72, D - 0.05, z + 0.18)
    r.box("brass", x - w / 2 - 2.0, D - 1.32, 0.9, x - w / 2 - 2.0 + steps * 0.28, D - 1.3, 0.95 + steps * 0.18)


def mailboxes(r, x):
    D = r.D
    for i in range(6):
        for j in range(3):
            r.box("wood_dark" if (i + j) % 2 else "wood", x - 0.9 + i * 0.3, D - 0.25, 1.0 + j * 0.3, x - 0.62 + i * 0.3, D - 0.02, 1.28 + j * 0.3)


def office(r, x, y):
    table(r, x, y, w=1.6, d=0.8, key="cabinet", chairs=False)
    r.box("screen", x - 0.3, y + 0.2, 0.76, x + 0.3, y + 0.24, 1.15)
    r.box("cloth_b", x - 0.25, y - 0.7, 0.45, x + 0.25, y - 0.3, 0.5)
    r.box("cloth_b", x - 0.25, y - 0.72, 0.5, x + 0.25, y - 0.68, 1.0)


# --------------------------------------------------------------------------- palettes and rooms

BASE = {
    "ceiling": ((0.92, 0.9, 0.86), 0.9), "trim": ((0.93, 0.91, 0.86), 0.5), "door": ((0.9, 0.88, 0.82), 0.4),
    "wood": ((0.52, 0.34, 0.2), 0.5, 0.0, 0.0, 0.3), "wood_dark": ((0.3, 0.18, 0.1), 0.45, 0.0, 0.0, 0.25),
    "frame": ((0.72, 0.56, 0.28), 0.35, 0.8), "brass": ((0.8, 0.62, 0.3), 0.3, 1.0), "mirror": ((0.62, 0.64, 0.66), 0.18, 1.0),
    "marble": ((0.9, 0.88, 0.84), 0.2, 0.0, 0.0, 0.08), "soot": ((0.06, 0.05, 0.05), 0.9),
    "bulb": ((1.0, 0.85, 0.6), 0.5, 0.0, 6.0), "shade": ((0.95, 0.85, 0.65), 0.6, 0.0, 1.5),
    "art_a": ((0.35, 0.42, 0.3), 0.6, 0.0, 0.0, 0.5), "art_b": ((0.6, 0.35, 0.25), 0.6, 0.0, 0.0, 0.5),
    "book_a": ((0.45, 0.12, 0.1), 0.7), "book_b": ((0.12, 0.2, 0.32), 0.7), "book_c": ((0.55, 0.45, 0.25), 0.7),
    "pot": ((0.6, 0.35, 0.22), 0.8), "leaf": ((0.18, 0.35, 0.15), 0.6, 0.0, 0.0, 0.3),
    "linen": ((0.92, 0.9, 0.85), 0.9), "cover": ((0.55, 0.6, 0.68), 0.9), "cardboard": ((0.62, 0.47, 0.3), 0.9),
    "cabinet": ((0.9, 0.9, 0.88), 0.4), "counter": ((0.25, 0.25, 0.26), 0.3), "tile": ((0.85, 0.88, 0.86), 0.2),
    "screen": ((0.35, 0.5, 0.65), 0.3, 0.0, 2.0), "rattan": ((0.6, 0.45, 0.25), 0.7),
    "bread": ((0.78, 0.55, 0.28), 0.8), "bread_b": ((0.65, 0.42, 0.2), 0.8),
    "cloth_a": ((0.2, 0.22, 0.3), 0.9), "cloth_b": ((0.55, 0.15, 0.12), 0.9), "cloth_c": ((0.85, 0.8, 0.7), 0.9),
}


def pal(**over):
    p = dict(BASE)
    for k, v in over.items():
        p[k] = v
    return p


def daylight(r, power=250):
    r.light(0, -1.0, r.H * 0.55, power, color=(0.85, 0.9, 1.0), size=r.W, direction=(0, 1, -0.15))


def salon(r):
    shell(r, partitions=(-r.W / 6, r.W / 6), doors=(-4.0, 4.0))
    fireplace(r, 0)
    sofa(r, 0, 2.6, 2.2)
    for s in (-1, 1):
        armchair(r, s * 1.6, 2.0)
    rug(r, 0, 2.4, 3.5, 2.5)
    chandelier(r, 0, 2.5)
    painting(r, -4.6, 1.8, 1.0, 0.8)
    painting(r, 4.6, 1.8, 0.8, 1.0, "art_b")
    table(r, -4.0, 2.6, 1.6, 0.9)
    plant(r, 3.4, 4.3)
    bookshelf(r, 4.6, 1.6)
    chandelier(r, -4.0, 2.6)
    daylight(r)


def dining(r):
    shell(r, partitions=(-r.W / 6,), doors=(3.5,))
    table(r, 0, 2.6, 2.6, 1.0)
    chandelier(r, 0, 2.6)
    r.box("wood_dark", -1.2, r.D - 0.5, 0, 1.2, r.D - 0.02, 0.95)
    painting(r, 0, 1.9, 1.4, 0.9)
    sofa(r, -4.2, 3.0, 2.0)
    floor_lamp(r, -5.4, 3.6)
    plant(r, 5.2, 4.2)
    daylight(r)


def bedroom(r):
    shell(r, partitions=(-r.W / 6, r.W / 6))
    bed(r, 0, 0)
    wardrobe(r, -4.4)
    armchair(r, 4.0, 3.0)
    floor_lamp(r, 4.9, 3.8)
    ceiling_light(r, 0, 2.5, 90)
    ceiling_light(r, -4.0, 2.5, 70)
    rug(r, 0, 2.2, 2.4, 1.6, "rug")
    painting(r, 4.2, 1.8, 0.9, 0.7, "art_b")
    daylight(r, 200)


def library(r):
    shell(r, partitions=(r.W / 6,), panels=False)
    for x in (-4.6, -2.8, -1.0, 0.8):
        bookshelf(r, x, 1.7, 2.6)
    table(r, -1.6, 2.4, 1.6, 0.8, chairs=False)
    armchair(r, 0.6, 2.2)
    floor_lamp(r, 1.4, 2.8)
    sofa(r, 4.0, 3.4, 2.2)
    ceiling_light(r, -2.0, 2.4, 120)
    ceiling_light(r, 4.0, 2.4, 100)
    plant(r, 5.3, 4.3)
    daylight(r)


def modern(r):
    shell(r, partitions=(), panels=False)
    kitchen(r, -3.6, 3.4)
    sofa(r, 2.6, 3.4, 2.6, "sofa")
    table(r, 0, 2.6, 1.6, 0.9)
    rug(r, 2.6, 2.8, 3.0, 2.0)
    for x in (-3.6, 0, 3.0):
        ceiling_light(r, x, 2.5, 110, color=(1.0, 0.92, 0.82))
    plant(r, 5.2, 4.3, 1.6)
    plant(r, -5.4, 4.2)
    painting(r, 2.6, 1.8, 1.6, 0.9)
    daylight(r, 300)


def atelier(r):
    shell(r, panels=False)
    for x, k in ((-3.5, "art_a"), (-1.0, "art_b"), (2.0, "art_a")):
        easel(r, x, 2.0 + r.rng.uniform(-0.5, 0.5), k)
    table(r, 3.8, 3.2, 2.2, 1.0, chairs=False)
    for x in (-5.0, -4.0, 4.6, 5.2):
        painting(r, x, 1.6, r.rng.uniform(0.6, 1.0), r.rng.uniform(0.6, 1.2), r.rng.choice(["art_a", "art_b"]))
    ceiling_light(r, -2.0, 2.5, 140, color=(1, 0.95, 0.9))
    ceiling_light(r, 3.0, 2.5, 120, color=(1, 0.95, 0.9))
    daylight(r, 350)


def renovation(r):
    shell(r, partitions=(-r.W / 6,), panels=False)
    boxes(r, -3.5, 2.5, 6)
    boxes(r, 3.0, 3.0, 5)
    r.box("wood", -0.3, 2.8, 0, -0.25, 2.9, 2.2)
    r.box("wood", 0.25, 2.8, 0, 0.3, 2.9, 2.2)
    for k in range(6):
        r.box("wood", -0.3, 2.8, 0.3 + k * 0.33, 0.3, 2.9, 0.33 + k * 0.33)
    r.box("plastic", -6, 0.5, 0, -1.0, 0.6, 2.8)
    r.cyl("bulb", 0, 2.5, r.H - 0.4, r.H, 0.03)
    r.light(0, 2.5, r.H - 0.45, 80, color=(1, 0.9, 0.75), size=0.1, kind="POINT")
    daylight(r, 300)


def kids(r):
    shell(r, partitions=(r.W / 6,))
    bed(r, -2.0, 0, 1.0)
    boxes(r, 1.0, 3.6, 3)
    rug(r, -0.5, 2.3, 2.0, 1.5, "rug")
    wardrobe(r, 4.6, 1.2)
    bookshelf(r, 1.4, 1.0, 1.4)
    ceiling_light(r, -1.0, 2.5, 100)
    ceiling_light(r, 4.2, 2.5, 80)
    painting(r, -4.2, 1.7, 0.8, 0.8, "art_b")
    daylight(r)


def attic(r, kind):
    shell(r, panels=False, partitions=(-r.W / 4, r.W / 4))
    # mansard slope: the ceiling comes down towards the window side
    r.box("ceiling", -r.W / 2, 0.0, r.H - 0.9, r.W / 2, 1.6, r.H - 0.85)
    if kind == 0:
        bed(r, -2.4, 0, 0.9)
        r.box("wood", 0.4, r.D - 0.5, 0, 1.0, r.D - 0.05, 0.8)
        r.box("tile", 2.0, r.D - 0.45, 0.8, 2.5, r.D - 0.05, 0.9)
        armchair(r, 3.6, 3.0)
    elif kind == 1:
        table(r, -1.5, 3.4, 1.4, 0.7, chairs=False)
        bookshelf(r, 2.0, 1.4, 1.8)
        sofa(r, 4.0, 3.8, 1.6)
        plant(r, -3.5, 4.2)
    else:
        boxes(r, -2.5, 3.2, 6)
        boxes(r, 2.2, 3.5, 5)
        r.box("wood_dark", 0.0, 3.6, 0, 1.0, 4.4, 0.6)
    ceiling_light(r, -2.0, 3.0, 70)
    ceiling_light(r, 2.5, 3.0, 60)
    daylight(r, 180)


def bakery(r):
    shell(r, panels=False)
    shelves_goods(r, -3.0, 3.6)
    shelves_goods(r, 2.0, 3.2)
    counter(r, -0.5, 2.6, 3.6)
    for x in (-1.6, 0.6):
        r.box("bread", x, 2.4, 1.05, x + 0.5, 2.8, 1.15)
    for x in (-3.0, 0.0, 3.0):
        ceiling_light(r, x, 2.5, 160, color=(1.0, 0.8, 0.55))
    daylight(r)


def cafe(r):
    shell(r, panels=False)
    counter(r, -3.6, 3.6, 3.2)
    for k in range(10):
        r.cyl(r.rng.choice(["book_a", "book_b", "leaf"]), -5.0 + k * 0.3, r.D - 0.2, 1.4, 1.75, 0.04)
    r.box("wood_dark", -5.2, r.D - 0.3, 1.38, -1.8, r.D - 0.02, 1.42)
    r.box("mirror", 0.0, r.D - 0.04, 1.2, 5.5, r.D - 0.02, 2.6)
    for x, y in ((0.2, 2.0), (2.0, 2.6), (3.8, 1.8), (5.0, 3.2)):
        bistro(r, x, y)
    for x in (-3.5, 0.5, 3.5):
        ceiling_light(r, x, 2.5, 150, color=(1.0, 0.78, 0.5))
    daylight(r)


def boutique(r):
    shell(r, panels=False)
    for x in (-4.0, -1.6, 3.6):
        clothes_rack(r, x, 3.6)
    table(r, 1.0, 2.2, 1.6, 0.8, key="wood", chairs=False)
    for k in range(4):
        r.box(r.rng.choice(["cloth_a", "cloth_b", "cloth_c"]), 0.4 + k * 0.32, 2.0, 0.75, 0.66 + k * 0.32, 2.4, 0.85)
    for x in (-3.0, 1.0, 4.0):
        ceiling_light(r, x, 2.5, 170, color=(1.0, 0.95, 0.88))
    daylight(r)


def hall(r):
    shell(r, panels=True, doors=(3.6,))
    stairs(r, -1.0)
    mailboxes(r, 1.6)
    r.box("wood_dark", 4.6, r.D - 1.6, 0, 5.8, r.D - 0.02, 1.0)
    ceiling_light(r, -1.5, 2.5, 130)
    ceiling_light(r, 3.0, 2.5, 110)
    daylight(r, 180)


def grand_chandelier(r, x, y):
    """the ballroom's crystal chandelier: two rings of lights under a crown"""
    H = r.H
    r.cyl("brass", x, y, H - 1.2, H, 0.02)
    r.cyl("brass", x, y, H - 1.9, H - 1.2, 0.55, r1=0.12)
    for ring, (rad, z, n) in enumerate(((0.6, H - 1.85, 10), (0.35, H - 1.45, 7))):
        for k in range(n):
            a = 2 * math.pi * (k + 0.5 * ring) / n
            r.ball("bulb", x + rad * math.cos(a), y + rad * math.sin(a), z, 0.05)
    r.ball("crystal", x, y, H - 2.05, 0.18)
    r.light(x, y, H - 1.7, 380, size=1.0, kind="POINT")


def ballroom(r):
    """the étage noble's ballroom over two floors: mirrors between pilasters,
    gilded cornice, parquet, chandeliers, chairs along the walls"""
    W, D, H = r.W, r.D, r.H
    shell(r, panels=False, doors=(-7.5, 7.5))
    for x in (-10.5, -4.5, 0.0, 4.5, 10.5):
        r.box("frame", x - 1.0, D - 0.06, 0.8, x + 1.0, D - 0.02, H - 1.6)
        r.box("mirror", x - 0.9, D - 0.07, 0.9, x + 0.9, D - 0.06, H - 1.7)
    for x in (-12.4, -9.0, -6.0, -2.25, 2.25, 6.0, 9.0, 12.4):
        r.box("trim", x - 0.22, D - 0.22, 0, x + 0.22, D, H - 0.75)
        r.box("frame", x - 0.3, D - 0.3, H - 0.95, x + 0.3, D, H - 0.75)
    r.box("frame", -W / 2, D - 0.4, H - 0.75, W / 2, D, H - 0.55)
    r.box("trim", -W / 2, D - 0.55, H - 0.55, W / 2, D, H - 0.35)
    for x in (-11.5, -8.0, -3.4, 3.4, 8.0, 11.5):
        r.box("sofa", x - 0.25, D - 0.75, 0.42, x + 0.25, D - 0.3, 0.48)
        r.box("sofa", x - 0.25, D - 0.36, 0.48, x + 0.25, D - 0.3, 1.0)
    r.box("wood_dark", -2.6, 2.4, 0.7, -0.6, 3.8, 1.0)
    r.box("wood_dark", -2.5, 2.5, 0, -2.35, 2.65, 0.7)
    for x in (-6.0, 0.0, 6.0):
        grand_chandelier(r, x, 2.6)
    daylight(r, 420)


def bureau(r):
    shell(r, panels=False, partitions=(0.0,))
    for x in (-4.4, -2.0, 2.0, 4.4):
        office(r, x, 2.6)
    for x in (-3.0, 3.0):
        ceiling_light(r, x, 2.5, 140, color=(0.95, 0.97, 1.0))
    r.box("cabinet", -1.2, r.D - 0.5, 0, -0.4, r.D - 0.02, 1.3)
    daylight(r, 300)


ROOMS = [  # (builder, height, palette)
    (salon, 3.0, pal(wall=((0.86, 0.8, 0.68), 0.9), floor=((0.5, 0.33, 0.2), 0.4, 0, 0, 0.35), rug=((0.5, 0.18, 0.15), 0.9, 0, 0, 0.4), sofa=((0.55, 0.42, 0.3), 0.8))),
    (dining, 3.0, pal(wall=((0.62, 0.72, 0.7), 0.9), floor=((0.45, 0.3, 0.18), 0.4, 0, 0, 0.35), rug=((0.4, 0.3, 0.2), 0.9), sofa=((0.3, 0.35, 0.45), 0.8))),
    (bedroom, 3.0, pal(wall=((0.8, 0.7, 0.68), 0.9), floor=((0.55, 0.38, 0.24), 0.4, 0, 0, 0.35), rug=((0.7, 0.62, 0.5), 0.9), sofa=((0.6, 0.5, 0.45), 0.8))),
    (library, 3.0, pal(wall=((0.25, 0.35, 0.28), 0.9), floor=((0.42, 0.27, 0.16), 0.4, 0, 0, 0.35), rug=((0.4, 0.15, 0.1), 0.9), sofa=((0.45, 0.25, 0.15), 0.7))),
    (modern, 3.0, pal(wall=((0.93, 0.93, 0.92), 0.9), floor=((0.72, 0.6, 0.45), 0.35, 0, 0, 0.25), rug=((0.6, 0.6, 0.6), 0.9), sofa=((0.45, 0.47, 0.5), 0.8))),
    (atelier, 3.0, pal(wall=((0.88, 0.86, 0.82), 0.9), floor=((0.48, 0.38, 0.28), 0.6, 0, 0, 0.45), rug=((0.5, 0.5, 0.5), 0.9), sofa=((0.5, 0.5, 0.5), 0.8))),
    (renovation, 3.0, pal(wall=((0.78, 0.76, 0.72), 0.95, 0, 0, 0.3), floor=((0.55, 0.52, 0.48), 0.8, 0, 0, 0.3), rug=((0.5, 0.5, 0.5), 0.9), sofa=((0.5, 0.5, 0.5), 0.8), plastic=((0.9, 0.92, 0.95), 0.2))),
    (kids, 3.0, pal(wall=((0.75, 0.82, 0.9), 0.9), floor=((0.6, 0.45, 0.3), 0.4, 0, 0, 0.3), rug=((0.85, 0.6, 0.3), 0.9), sofa=((0.85, 0.55, 0.4), 0.8), cover=((0.9, 0.7, 0.3), 0.9))),
    (lambda r: attic(r, 0), 2.6, pal(wall=((0.85, 0.83, 0.78), 0.9), floor=((0.55, 0.42, 0.3), 0.6, 0, 0, 0.4), sofa=((0.5, 0.45, 0.4), 0.8))),
    (lambda r: attic(r, 1), 2.6, pal(wall=((0.82, 0.78, 0.7), 0.9), floor=((0.5, 0.36, 0.24), 0.5, 0, 0, 0.4), sofa=((0.35, 0.4, 0.5), 0.8))),
    (lambda r: attic(r, 2), 2.6, pal(wall=((0.7, 0.66, 0.6), 0.95, 0, 0, 0.3), floor=((0.45, 0.35, 0.25), 0.7, 0, 0, 0.4))),
    (bakery, 3.6, pal(wall=((0.92, 0.86, 0.72), 0.9), floor=((0.75, 0.7, 0.62), 0.3, 0, 0, 0.2))),
    (cafe, 3.6, pal(wall=((0.55, 0.3, 0.2), 0.8), floor=((0.82, 0.8, 0.76), 0.3, 0, 0, 0.3))),
    (boutique, 3.6, pal(wall=((0.95, 0.94, 0.92), 0.9), floor=((0.62, 0.5, 0.38), 0.35, 0, 0, 0.25))),
    (hall, 3.6, pal(wall=((0.85, 0.78, 0.62), 0.9), floor=((0.7, 0.68, 0.64), 0.25, 0, 0, 0.35))),
    (bureau, 3.6, pal(wall=((0.9, 0.9, 0.88), 0.9), floor=((0.45, 0.47, 0.5), 0.6, 0, 0, 0.2))),
    (ballroom, 6.45, pal(wall=((0.9, 0.86, 0.76), 0.85), floor=((0.5, 0.32, 0.18), 0.3, 0, 0, 0.4),
                          sofa=((0.6, 0.2, 0.18), 0.8), crystal=((0.95, 0.95, 1.0), 0.05, 0.0, 2.0))),
]
ROWS = (len(ROOMS) + 1) // 2


# --------------------------------------------------------------------------- render

def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = SAMPLES
    sc.cycles.max_bounces = 6
    try:
        sc.cycles.use_denoising = True
        sc.cycles.denoiser = "OPENIMAGEDENOISE"
    except (AttributeError, TypeError):
        pass
    for vt in ("AgX", "Standard"):
        try:
            sc.view_settings.view_transform = vt
            break
        except TypeError:
            continue
    sc.render.resolution_x, sc.render.resolution_y = CW, CH
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    world = bpy.data.worlds.new("w")
    world.color = (0.015, 0.015, 0.02)
    sc.world = world
    return sc


def render_room(sc, k, builder, H, palette, tmp):
    coll = bpy.data.collections.new(f"room{k}")
    sc.collection.children.link(coll)
    r = Room(H, palette, seed=100 + k)
    builder(r)
    r.build(coll)
    cam = bpy.data.cameras.new(f"cam{k}")
    cam.sensor_fit = "HORIZONTAL"
    cam.angle = 2 * math.atan(r.W / 2 / CAM_DIST)
    cam.clip_start = 1.0
    cam.clip_end = 60.0
    cam_ob = bpy.data.objects.new(cam.name, cam)
    cam_ob.location = (0, -CAM_DIST, H / 2)
    cam_ob.rotation_euler = (math.pi / 2, 0, 0)
    coll.objects.link(cam_ob)
    sc.camera = cam_ob
    sc.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(tmp)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    for ob in list(coll.objects):
        bpy.data.objects.remove(ob)
    bpy.data.collections.remove(coll)
    return px.reshape(h, w, 4)


sc = setup_scene()
atlas = np.zeros((ROWS * CH, 2 * CW, 4), dtype=np.float32)
if ONLY and os.path.exists(OUT):  # re-render some cells into the existing atlas
    old = bpy.data.images.load(OUT)
    buf = np.empty(old.size[0] * old.size[1] * 4, dtype=np.float32)
    old.pixels.foreach_get(buf)
    old_px = buf.reshape(old.size[1], old.size[0], 4)
    atlas[:old_px.shape[0]] = old_px[:ROWS * CH]  # an atlas from before a cell was added is shorter
    bpy.data.images.remove(old)
tmp = os.path.join(os.path.dirname(OUT), "_room_cell.png")
for k, (builder, H, palette) in enumerate(ROOMS):
    if ONLY and k not in ONLY:
        continue
    px = render_room(sc, k, builder, H, palette, tmp)
    col, row = k % 2, k // 2
    atlas[row * CH:(row + 1) * CH, col * CW:(col + 1) * CW] = px
    print(f"  room {k:2d} {getattr(builder, '__name__', 'attic')}: mean {px[..., :3].mean():.3f}")
if os.path.exists(tmp):
    os.remove(tmp)
atlas[..., 3] = 1.0
out = bpy.data.images.new("interiors", 2 * CW, ROWS * CH, alpha=False)
out.pixels.foreach_set(atlas.ravel())
out.filepath_raw = OUT
out.file_format = "JPEG"
out.save(quality=90)
print("ROOMS_OK", OUT)
