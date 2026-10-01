"""Profiles and shared parts used by several modules.

Profiles are (a, b) polylines for MeshBuilder.sweep(): a = outward from the wall
line, b = up (or along the sweep's N). They run counterclockwise around the solid
and leave out the segment that lies on the wall, so only visible faces are made.
"""
import math

from .geom import arc

# ---- window joinery depths (y, into the wall) ----
FY0, FY1 = 0.16, 0.24     # dormant frame front / back
FW = 0.06                 # dormant frame width
LY0, LY1 = 0.17, 0.22     # casement leaves
GY = 0.195                # glass plane
REVEAL = 0.24             # depth of the opening reveals


def smooth(t):
    return t * t * (3 - 2 * t)


def ogee(a0, b0, a1, b1, n=5, vertical_ends=True):
    """S-curve from (a0, b0) to (a1, b1), excluding the start point. With vertical
    ends the curve leaves and arrives going up (cyma reversa); otherwise it leaves
    and arrives going outward (cyma recta)."""
    pts = []
    for k in range(1, n + 1):
        t = k / n
        if vertical_ends:
            pts.append((a0 + (a1 - a0) * smooth(t), b0 + (b1 - b0) * t))
        else:
            pts.append((a0 + (a1 - a0) * t, b0 + (b1 - b0) * smooth(t)))
    return pts


def circle(ca, cb, r, n=8):
    """closed counterclockwise circle profile"""
    return [(ca + r * math.cos(2 * math.pi * k / n), cb + r * math.sin(2 * math.pi * k / n)) for k in range(n)]


def rect(a0, b0, a1, b1):
    """closed counterclockwise rectangle profile"""
    return [(a0, b0), (a1, b0), (a1, b1), (a0, b1)]


def bandeau(D):
    """floor string course at z 0 .. height, on every upper floor"""
    h, p = D["bandeau"]["height"], D["bandeau"]["projection"]
    return [(0, 0), (p, 0), (p, h - 0.05), (p - 0.03, h), (0, h)]


def plinth(D):
    h = D["ground"]["plinth"]
    return [(0, 0), (0.03, 0), (0.03, h - 0.04), (0, h)]


def frieze(D):
    """ground floor top band, from the frieze line to the floor height"""
    z0, z1 = D["ground"]["frieze"], D["classes"]["G"]["height"]
    return [(0, z0), (0.025, z0), (0.05, z0 + 0.025), (0.05, z1), (0, z1)]


def rustic(z0, z1, step, g=0.03, d=0.02):
    """rusticated wall face from z0 to z1: a chamfered channel (refend) at every
    course joint, i.e. at the multiples of `step` from the floor line (z = 0)
    between z0 and z1. Returns the profile and the channel polygons (end caps)."""
    pts = [(0, z0)]
    notches = []
    k = math.floor(z0 / step + 1e-6) + 1
    while step * k < z1 - g - 1e-6:
        zj = step * k
        if zj - g > z0 + 1e-6:
            notch = [(0, zj - g), (-d, zj - g + d), (-d, zj + g - d), (0, zj + g)]
            pts += notch
            notches.append(notch)
        k += 1
    pts.append((0, z1))
    return pts, notches


def cornice(D):
    """main cornice: architrave band, bed moulding, corona with drip, crown;
    the top (gutter) is zinc. Returns (profile, materials per segment)."""
    h, p = D["cornice"]["height"], D["cornice"]["projection"]
    pts = [(0, 0), (0.05, 0), (0.05, 0.10), (0.08, 0.13), (0.08, 0.17)]
    pts += ogee(0.08, 0.17, 0.28, 0.30, n=5, vertical_ends=True)
    pts += [(p - 0.07, 0.30), (p - 0.05, 0.32), (p - 0.05, 0.45), (p - 0.035, 0.46)]
    pts += ogee(p - 0.035, 0.46, p, h - 0.04, n=4, vertical_ends=False)
    pts += [(p, h), (0, h)]
    mats = ["stone_trim"] * (len(pts) - 2) + ["zinc"]
    return pts, mats


def slab(D):
    """continuous balcony slab: top at z = 0, moulded front edge"""
    d, t = D["balcony"]["depth"], D["balcony"]["slab"]
    return [(0, -t), (d - 0.07, -t), (d - 0.03, -t + 0.04), (d - 0.03, -0.07), (d, -0.04), (d, 0), (0, 0)]


RAIL_LINE = 0.85  # continuous balcony railing, distance from the wall line


def balcony_railing(mb, path, D, posts):
    """slab + railing along `path` (horizontal, z = floor level); posts at 2D points"""
    h = D["balcony"]["railing"]
    a = RAIL_LINE
    mb.sweep(path, slab(D), "stone_trim")
    mb.sweep(path, rect(a - 0.04, h - 0.05, a + 0.04, h), "iron", closed_profile=True)
    mb.sweep(path, rect(a - 0.015, 0.04, a + 0.015, 0.07), "iron", closed_profile=True)
    # lace panel: u in metres along the railing, v 0..1 bottom to top (one atlas tile)
    mb.sweep(path, [(a, 0.07), (a, h - 0.05)], "iron_lace", v_from="norm")
    for x, y in posts:
        mb.box((x - 0.018, y - 0.018, 0), (x + 0.018, y + 0.018, h - 0.05), "iron", skip=("-z", "+z"))


def opening_loop(hw, z0, z1, spring=None, n=12):
    """counterclockwise (seen from outside) outline of a rectangular or round-arched
    opening; with this winding a sweep's `a` points away from the opening"""
    if spring is None:
        return [(hw, z1), (-hw, z1), (-hw, z0), (hw, z0)]
    return arc(0, spring, hw, 0, math.pi, n) + [(-hw, z0), (hw, z0)]


def opening_path(hw, z0, spring, n=12):
    """open outline of an arched door: up the right jamb, over the arch, down the left"""
    return [(hw, z0)] + arc(0, spring, hw, 0, math.pi, n) + [(-hw, z0)]


def xz(pts, y=0.0):
    return [(x, y, z) for x, z in pts]


def joint_free_uv(p):
    """UV0 for stone faces that should show the bed joints (v = z) but no head
    joints: u = 0.75 sits between the vertical joints of both course types, so
    the course lines run from the facade into the reveals"""
    return (0.75, p.z)


def reveal(mb, loop2d, mat, closed=True, depth=REVEAL):
    mb.sweep(xz(loop2d), [(0, 0), (0, -depth)], mat, N=(0, -1, 0), closed_path=closed, uv_fn=joint_free_uv)


def dormant_frame(mb, loop2d, closed=True, mat="frame", y0=FY0, y1=FY1, w=FW):
    """window frame set in the reveal: front face + inner face"""
    mb.sweep(xz(loop2d), [(0, -y0), (-w, -y0), (-w, -y1)], mat, N=(0, -1, 0), closed_path=closed)


def glass_rect(mb, x0, x1, z0, z1, y=GY):
    mb.wall(x0, x1, z0, z1, "glass", y=y)


def leaf(mb, x0, x1, z0, z1, panes, mat="frame"):
    """casement leaf: stiles, rails, glazing bars, glass"""
    s, top, bot = 0.055, 0.055, 0.11
    sk = ("+y",)
    mb.box((x0, LY0, z0), (x0 + s, LY1, z1), mat, skip=sk)
    mb.box((x1 - s, LY0, z0), (x1, LY1, z1), mat, skip=sk)
    mb.box((x0 + s, LY0, z0), (x1 - s, LY1, z0 + bot), mat, skip=sk)
    mb.box((x0 + s, LY0, z1 - top), (x1 - s, LY1, z1), mat, skip=sk)
    g0, g1 = z0 + bot, z1 - top
    for k in range(1, panes):
        zc = g0 + (g1 - g0) * k / panes
        mb.box((x0 + s, 0.185, zc - 0.011), (x1 - s, 0.205, zc + 0.011), mat, skip=sk)
    glass_rect(mb, x0 + s, x1 - s, g0, g1)


def leaf_span(w, z0, z1, transom):
    """x extent (+-xi) and z range of a French window's leaves"""
    xi = w / 2 - FW
    top = z1 - FW
    if transom:
        top = top - transom - 0.035
    return xi, z0 + FW, top


def french_window(mb, w, z0, z1, transom, panes, leaves=True):
    """two-leaf French window filling the opening x in [-w/2, w/2], z in [z0, z1];
    `transom`: height of the fanlight above the leaves (None: no fanlight);
    leaves=False leaves the casements out (they are separate modules)"""
    hw = w / 2
    dormant_frame(mb, opening_loop(hw, z0, z1))
    xi = hw - FW
    top = z1 - FW
    if transom:
        zt = top - transom
        mb.box((-xi, 0.165, zt - 0.035), (xi, 0.225, zt + 0.035), "frame", skip=("+y",))
        glass_rect(mb, -xi, xi, zt + 0.035, top)
        mb.box((-0.011, 0.185, zt + 0.035), (0.011, 0.205, top), "frame", skip=("+y",))
        top = zt - 0.035
    if leaves:
        leaf(mb, -xi, 0, z0 + FW, top, panes)
        leaf(mb, 0, xi, z0 + FW, top, panes)


HINGE_Y = (LY0 + LY1) / 2


def gardecorps(mb, D):
    """window guard rail in front of a French window, held just clear of the
    window surrounds (their faces are at 0.03 / 0.05)"""
    g = D["gardecorps"]
    hw, z0, z1 = g["width"] / 2, g["bottom"], g["top"]
    path = [(-hw, 0, 0), (hw, 0, 0)]
    a = 0.065
    mb.sweep(path, rect(a - 0.02, z1 - 0.03, a + 0.02, z1), "iron", closed_profile=True, caps=True)
    mb.sweep(path, rect(a - 0.01, z0, a + 0.01, z0 + 0.03), "iron", closed_profile=True, caps=True)
    mb.sweep(path, [(a, z0 + 0.03), (a, z1 - 0.03)], "iron_lace", v_from="norm")
    for x in (-hw, hw):
        mb.box((x - 0.016, -a - 0.016, z0), (x + 0.016, -a + 0.016, z1 - 0.03), "iron", skip=("-z", "+z"))
