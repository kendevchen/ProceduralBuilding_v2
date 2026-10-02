"""Facade ornaments (phase C, KIT_SPEC.md §4.2-4.3): window surrounds and heads,
balcony consoles, persiennes, pier details and the single-window balcony.

Frames as in modules.py: facade plane y = 0, outward -Y, x along the facade.
Surrounds, shutters and details are per height class (they follow the window
height); heads sit at the window head (z = 0 there), consoles at the floor line
of the balcony they carry, under its slab.
"""
import math

from . import parts as P
from .geom import MeshBuilder

HEAD_W = 0.95  # half width of the window heads


def _opening(D, cls):
    return D["window"]["width"] / 2, D["window"]["sill"], D["classes"][cls]["head"]


# ---------------------------------------------------------------- surrounds

# (a = away from the opening, b = out of the wall), counterclockwise, wall omitted
BAND = [(0.16, 0), (0.16, 0.03), (0, 0.03), (0, 0)]
CROSSETTE = [(0.18, 0), (0.18, 0.02), (0.15, 0.035), (0.11, 0.04), (0.07, 0.05), (0.03, 0.05), (0.0, 0.035), (0, 0)]


def surround(D, cls, kind):
    """chambranle round the jambs and head of a French window; the crossette
    kind is moulded and has 'ears' stepping out at the top corners"""
    hw, sill, head = _opening(D, cls)
    return surround_span(hw, sill, head, kind)


def surround_span(hw, sill, head, kind):
    """a surround round an opening of half width hw from sill to head (the
    ballroom's tall windows reach over two floors)"""
    mb = MeshBuilder()
    path = P.xz([(hw, sill), (hw, head), (-hw, head), (-hw, sill)])
    prof = BAND if kind == "band" else CROSSETTE
    mb.sweep(path, prof, "stone_trim", N=(0, -1, 0), caps=True)
    if kind == "crossette":
        w = prof[0][0]
        for s in (-1, 1):
            xa, xb = sorted((s * (hw + w - 0.01), s * (hw + w + 0.07)))
            mb.prism([(xa, head - 0.14), (xb, head - 0.14), (xb, head + w), (xa, head + w)], 0.035, "stone_trim")
    return mb


# ---------------------------------------------------------------- window heads

def _hood_profile():
    """frieze band and a small cornice above the surround (b = z from the head)"""
    pts = [(0, 0.18), (0.03, 0.18), (0.03, 0.29), (0.05, 0.30)]
    pts += P.ogee(0.05, 0.30, 0.11, 0.36, n=4, vertical_ends=True)
    pts += [(0.13, 0.37), (0.13, 0.42), (0, 0.42)]
    return pts


def _bracket(mb, x, z0, z1, depth, w=0.09):
    """small scrolled bracket from z0 (bottom) to z1 under a moulding, depth out"""
    curve = [(0.035 + (depth - 0.035) * (1 - math.cos(math.pi / 2 * t / 6)),
              z0 + 0.04 + (z1 - 0.06 - z0 - 0.04) * math.sin(math.pi / 2 * t / 6)) for t in range(7)]
    prof = [(0, z0), (0.035, z0)] + curve + [(depth, z1), (0, z1)]
    mb.sweep([(x - w / 2, 0, 0), (x + w / 2, 0, 0)], prof, "stone_trim", caps=True)


def head_cornice(D, consoles=False):
    mb = MeshBuilder()
    mb.sweep([(-HEAD_W, 0, 0), (HEAD_W, 0, 0)], _hood_profile(), "stone_trim", caps=True)
    if consoles:
        for s in (-1, 1):
            _bracket(mb, s * (HEAD_W - 0.07), -0.12, 0.30, 0.11)
    return mb


def head_keystone(D):
    mb = MeshBuilder()
    mb.prism([(-0.09, -0.06), (0.09, -0.06), (0.12, 0.30), (-0.12, 0.30)], 0.07, "stone_trim")
    return mb


# raking cornice of a pediment (a = out from the top edge, b = out of the wall)
RAKE = [(0, 0), (0, 0.075), (-0.015, 0.095), (-0.03, 0.11), (-0.10, 0.11), (-0.10, 0)]
PED_BASE, PED_TOP = 0.34, 0.6


def _pediment_base(mb):
    prof = [(0, 0.18), (0.03, 0.18), (0.03, 0.27), (0.05, 0.28), (0.09, 0.31), (0.11, 0.31), (0.11, PED_BASE), (0, PED_BASE)]
    mb.sweep([(-HEAD_W, 0, 0), (HEAD_W, 0, 0)], prof, "stone_trim", caps=True)


def head_triangle(D):
    mb = MeshBuilder()
    _pediment_base(mb)
    mb.sweep(P.xz([(HEAD_W, PED_BASE), (0, PED_TOP), (-HEAD_W, PED_BASE)]), RAKE, "stone_trim",
             N=(0, -1, 0), caps=True)
    mb.prism([(-HEAD_W + 0.16, PED_BASE), (HEAD_W - 0.16, PED_BASE), (0, PED_TOP - 0.14)], 0.02, "stone_trim")
    return mb


def head_segment(D):
    mb = MeshBuilder()
    _pediment_base(mb)
    s = PED_TOP - PED_BASE
    R = (HEAD_W * HEAD_W + s * s) / (2 * s)
    cz = PED_TOP - R
    a0 = math.atan2(PED_BASE - cz, HEAD_W)
    arc = [(R * math.cos(a0 + (math.pi - 2 * a0) * k / 12), cz + R * math.sin(a0 + (math.pi - 2 * a0) * k / 12))
           for k in range(13)]
    mb.sweep(P.xz(arc), RAKE, "stone_trim", N=(0, -1, 0), caps=True)
    r2 = R - 0.1
    b0 = math.asin(min(1.0, (PED_BASE + 0.005 - cz) / r2))
    field = [(r2 * math.cos(b0 + (math.pi - 2 * b0) * k / 12), cz + r2 * math.sin(b0 + (math.pi - 2 * b0) * k / 12))
             for k in range(13)]
    mb.prism(field, 0.02, "stone_trim")
    return mb


# ---------------------------------------------------------------- balcony consoles

def console_block(D):
    """plain corbel under a balcony slab: a concave sweep from the wall"""
    mb = MeshBuilder()
    top = -D["balcony"]["slab"]
    curve = [(0.05 + 0.25 * (1 - math.cos(math.pi / 2 * k / 8)), top - 0.40 + 0.34 * math.sin(math.pi / 2 * k / 8))
             for k in range(9)]
    prof = [(0, top - 0.40)] + curve + [(0.36, top - 0.06), (0.36, top), (0, top)]
    mb.sweep([(-0.09, 0, 0), (0.09, 0, 0)], prof, "stone_trim", caps=True)
    return mb


def _bezier(p0, p1, p2, p3, n):
    out = []
    for k in range(1, n + 1):
        t = k / n
        u = 1 - t
        out.append(tuple(u ** 3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t ** 3 * d
                         for a, b, c, d in zip(p0, p1, p2, p3)))
    return out


def console_scroll(D):
    """modillion: S-curved front ending in volutes, the classic Haussmann bracket"""
    mb = MeshBuilder()
    top = -D["balcony"]["slab"]
    p0, p3 = (0.07, top - 0.55), (0.40, top - 0.08)
    prof = [(0, top - 0.55), p0] + _bezier(p0, (0.07, top - 0.25), (0.40, top - 0.35), p3, 12)
    prof += [(0.46, top - 0.04), (0.46, top), (0, top)]
    mb.sweep([(-0.09, 0, 0), (0.09, 0, 0)], prof, "stone_trim", caps=True)
    for (ca, cb, r) in ((0.10, top - 0.47, 0.07), (0.39, top - 0.13, 0.055)):
        mb.sweep([(-0.105, 0, 0), (0.105, 0, 0)], P.circle(ca, cb, r, 12), "stone_trim", closed_profile=True, caps=True)
    return mb


# ---------------------------------------------------------------- persiennes

SY = 0.035  # front of the shutters inside the reveal


def shutter_closed(D, cls):
    """left half of a pair of folding metal shutters, closed: frame + louvres
    (the right half is this module mirrored)"""
    mb = MeshBuilder()
    hw, sill, head = _opening(D, cls)
    x0, x1 = -hw + 0.012, -0.004
    z0, z1 = sill + 0.01, head - 0.01
    sk = ("+y",)
    mb.box((x0, SY, z0), (x0 + 0.05, SY + 0.03, z1), "shutter", skip=sk)
    mb.box((x1 - 0.05, SY, z0), (x1, SY + 0.03, z1), "shutter", skip=sk)
    mb.box((x0 + 0.05, SY, z0), (x1 - 0.05, SY + 0.03, z0 + 0.08), "shutter", skip=sk)
    mb.box((x0 + 0.05, SY, z1 - 0.06), (x1 - 0.05, SY + 0.03, z1), "shutter", skip=sk)
    zs0, zs1 = z0 + 0.08, z1 - 0.06
    n = max(1, round((zs1 - zs0) / 0.055))
    dz = (zs1 - zs0) / n
    prof = []
    for k in range(n + 1):
        prof.append((-(SY + 0.022), zs0 + dz * k))           # back edge of a slat
        if k < n:
            prof.append((-(SY + 0.004), zs0 + dz * k + dz * 0.75))  # front edge, lower than the next back edge
    mb.sweep([(x0 + 0.05, 0, 0), (x1 - 0.05, 0, 0)], prof, "shutter", v_from="b")
    return mb


def shutter_folded(D, cls):
    """left set of shutters folded open into the reveal, against the jamb"""
    mb = MeshBuilder()
    hw, sill, head = _opening(D, cls)
    x0 = -hw + 0.004
    z0, z1 = sill + 0.01, head - 0.01
    mb.box((x0, 0.02, z0), (x0 + 0.04, 0.155, z1), "shutter", skip=("-x",))
    for k in range(1, 4):
        y = 0.02 + 0.135 * k / 4
        mb.box((x0 + 0.04, y - 0.004, z0), (x0 + 0.046, y + 0.004, z1), "shutter", skip=("-x", "-z", "+z"))
    return mb


# ---------------------------------------------------------------- pier details

PIER_IN = 0.85  # pier details start beyond the surrounds


def detail_refends(D, cls):
    """rusticated strips proud of the piers, a channel at every course"""
    mb = MeshBuilder()
    H = D["classes"][cls]["height"]
    hb = D["bay"] / 2
    bh = D["bandeau"]["height"]
    prof, _ = P.rustic(bh, H, D["course"])
    strip = [(0, bh)] + [(a + 0.02, b) for a, b in prof] + [(0, H)]
    mb.sweep([(PIER_IN, 0, 0), (hb, 0, 0)], strip, "stone", u0=PIER_IN, v_from="b", caps=True, cap_ends=(True, False))
    mb.sweep([(-hb, 0, 0), (-PIER_IN, 0, 0)], strip, "stone", u0=-hb, v_from="b", caps=True, cap_ends=(False, True))
    return mb


def detail_pilasters(D, cls):
    """half pilasters at both bay edges (neighbouring bays complete them):
    base, shaft and a moulded capital"""
    mb = MeshBuilder()
    H = D["classes"][cls]["height"]
    hb = D["bay"] / 2
    bh = D["bandeau"]["height"]
    prof = [(0, bh), (0.07, bh), (0.07, bh + 0.10), (0.05, bh + 0.15), (0.05, H - 0.40), (0.065, H - 0.37),
            (0.065, H - 0.32), (0.09, H - 0.29), (0.09, H - 0.2), (0, H - 0.2)]
    w = 0.25
    mb.sweep([(hb - w, 0, 0), (hb, 0, 0)], prof, "stone", u0=hb - w, v_from="b", caps=True, cap_ends=(True, False))
    mb.sweep([(-hb, 0, 0), (-hb + w, 0, 0)], prof, "stone", u0=-hb, v_from="b", caps=True, cap_ends=(False, True))
    return mb


def detail_panels(D, cls):
    """a raised panel with a moulded frame and a medallion on each pier half"""
    mb = MeshBuilder()
    H = D["classes"][cls]["height"]
    z0, z1 = 0.5, H - 0.7
    frame = [(0.05, 0), (0.05, 0.015), (0.03, 0.035), (0, 0.035), (0, 0)]
    for s in (-1, 1):
        cx, hw = s * 1.17, 0.21
        loop = [(cx + hw, z1), (cx - hw, z1), (cx - hw, z0), (cx + hw, z0)]
        mb.sweep(P.xz(loop), frame, "stone_trim", N=(0, -1, 0), closed_path=True)
        mb.prism([(cx - hw, z0), (cx + hw, z0), (cx + hw, z1), (cx - hw, z1)], 0.012, "stone_trim")
        zc = z1 - 0.26
        mb.sweep([(cx, -0.012, zc), (cx, -0.04, zc)], P.circle(0, 0, 0.08, 16), "stone_trim",
                 N=(0, 0, 1), closed_profile=True, caps=True)
    return mb


# ---------------------------------------------------------------- single-window balcony

def balcony_balconnet(D):
    """balconnet: a 1.9 m slab with a railing returning to the wall"""
    mb = MeshBuilder()
    hw, d = HEAD_W, 0.5
    t = D["balcony"]["slab"]
    h = D["balcony"]["railing"]
    slab = [(0, -t), (d - 0.05, -t), (d - 0.02, -t + 0.03), (d - 0.02, -0.05), (d, -0.03), (d, 0), (0, 0)]
    mb.sweep([(-hw, 0, 0), (hw, 0, 0)], slab, "stone_trim", caps=True)
    e, rl = 0.04, d - 0.04
    path = [(-hw + e, 0, 0), (-hw + e, -rl, 0), (hw - e, -rl, 0), (hw - e, 0, 0)]
    mb.sweep(path, P.rect(-0.04, h - 0.05, 0.04, h), "iron", closed_profile=True, caps=True)
    mb.sweep(path, P.rect(-0.015, 0.04, 0.015, 0.07), "iron", closed_profile=True, caps=True)
    mb.sweep(path, [(0, 0.07), (0, h - 0.05)], "iron_lace", v_from="norm")
    for x, y in ((-hw + e, -rl), (hw - e, -rl), (-hw + e, -0.02), (hw - e, -0.02)):
        mb.box((x - 0.018, y - 0.018, 0), (x + 0.018, y + 0.018, h - 0.05), "iron", skip=("-z", "+z"))
    return mb
