"""Module builders (KIT_SPEC.md §4) and the catalog build_kit.py walks.

Every builder returns a MeshBuilder in the module's local frame (§2): facade
plane y = 0, outward -Y, x along the facade, z = floor level of the module.
Bay modules span x in [-1.5, 1.5]; corner modules sit in the corner square
x, y >= 0 (the facade owning the corner runs along +x, the previous one along x = 0).
"""
import math

from . import ornaments as O
from . import parts as P
from .geom import MeshBuilder, arc


def L_path(la, lb, z=0.0):
    """corner path: along x = 0 from y = lb down to the corner, then along y = 0 to x = la"""
    return [(0, lb, z), (0, 0, z), (la, 0, z)]


def corner_uv(D):
    """UV0 on a corner square's two faces that continues the neighbouring bays'
    joint pattern: the previous facade's last bay ends (u = +1.5) where face x = 0
    starts at y = corner; this facade's first bay starts (u = -1.5) at x = corner"""
    c, hb = D["corner"], D["bay"] / 2

    def uv(p):
        if p.y > p.x:                       # face along x = 0
            return (hb + (c - p.y), p.z)
        return (p.x - c - hb, p.z)           # face along y = 0
    return uv


# ---------------------------------------------------------------- ground floor (G)

def _ground_frame(mb, D, opening):
    """plinth, frieze and rusticated piers shared by every ground bay;
    `opening` = half width of the zone between the piers"""
    hb = D["bay"] / 2
    zp, zf = D["ground"]["plinth"], D["ground"]["frieze"]
    mb.sweep([(-hb, 0, 0), (hb, 0, 0)], P.frieze(D), "stone_trim")
    prof, notches = P.rustic(zp, zf, D["course"])
    # UV0 = (x, z) so the shader's head joints line up with the bay
    mb.sweep([(-hb, 0, 0), (-opening, 0, 0)], prof, "stone_ground", u0=-hb, v_from="b",
             cap_polys=notches, cap_ends=(False, True))
    mb.sweep([(opening, 0, 0), (hb, 0, 0)], prof, "stone_ground", u0=opening, v_from="b",
             cap_polys=notches, cap_ends=(True, False))


def _keystone(mb, z0, z1, w0, w1, depth):
    mb.prism([(-w0 / 2, z0), (w0 / 2, z0), (w1 / 2, z1), (-w1 / 2, z1)], depth, "stone_trim")


def G_window_arched(D):
    mb = MeshBuilder()
    g = D["ground"]
    hb = D["bay"] / 2
    hw, sill, spring = g["window"]["width"] / 2, g["window"]["sill"], g["window"]["spring"]
    pier = hw + 0.2  # smooth surround between the opening and the rusticated piers
    zf = g["frieze"]
    mb.sweep([(-hb, 0, 0), (hb, 0, 0)], P.plinth(D), "stone_trim")
    _ground_frame(mb, D, pier)
    loop = P.opening_loop(hw, sill, None, spring)
    panel = [(-pier, sill), (-hw, sill)] + arc(0, spring, hw, math.pi, 0, 12) + [(hw, sill), (pier, sill), (pier, zf), (-pier, zf)]
    mb.wall(0, 0, 0, 0, "stone_ground", outer=panel)
    mb.sweep(P.xz(P.opening_path(hw, sill, spring)), [(0.16, 0), (0.16, 0.03), (0, 0.03), (0, 0)],
             "stone_trim", N=(0, -1, 0), caps=True)
    P.reveal(mb, loop, "stone_ground")
    # joinery: frame, transom at the springing line, two leaves, fanlight
    P.dormant_frame(mb, loop)
    xi = hw - P.FW
    mb.box((-xi, 0.165, spring - 0.04), (xi, 0.225, spring + 0.04), "frame", skip=("+y",))
    P.leaf(mb, -xi, 0, sill + P.FW, spring - 0.04, 4)
    P.leaf(mb, 0, xi, sill + P.FW, spring - 0.04, 4)
    rr = hw - P.FW
    a0 = math.asin(0.04 / rr)
    fan = arc(0, spring, rr, a0, math.pi - a0, 12)
    mb.planar(fan, "glass", origin=(0, P.GY, 0))
    for ang in (math.pi / 4, math.pi / 2, 3 * math.pi / 4):
        mb.bar((0, 0.195, spring + 0.04), (rr * math.cos(ang), 0.195, spring + rr * math.sin(ang)), 0.022, 0.02, "frame")
    _keystone(mb, spring + hw - 0.08, zf, 0.22, 0.30, 0.08)
    return mb


def G_door_arched(D):
    mb = MeshBuilder()
    g = D["ground"]
    hb = D["bay"] / 2
    hw, spring = g["door"]["width"] / 2, g["door"]["spring"]
    zp, zf = g["plinth"], g["frieze"]
    top = spring + hw
    mb.sweep([(-hb, 0, 0), (-hw, 0, 0)], P.plinth(D), "stone_trim", caps=True, cap_ends=(False, True))
    mb.sweep([(hw, 0, 0), (hb, 0, 0)], P.plinth(D), "stone_trim", caps=True, cap_ends=(True, False))
    _ground_frame(mb, D, hw)
    spandrel = [(hw, spring), (hw, zf), (-hw, zf), (-hw, spring)] + arc(0, spring, hw, math.pi, 0, 14)
    mb.wall(0, 0, 0, 0, "stone_ground", outer=spandrel)
    mb.sweep(P.xz(P.opening_path(hw, zp, spring, 14)), [(0.12, 0), (0.12, 0.035), (0, 0.035), (0, 0)],
             "stone_trim", N=(0, -1, 0), caps=True)
    path = P.opening_path(hw, 0, spring, 14)
    mb.sweep(P.xz(path), [(0, 0), (0, -0.26)], "stone_ground", N=(0, -1, 0), uv_fn=P.joint_free_uv)
    P.dormant_frame(mb, path, closed=False, mat="paint", y0=0.22, y1=0.32, w=0.07)
    # leaves with raised panels, transom, fanlight with an iron grille
    xi = hw - 0.07
    zt = spring - 0.12
    mb.box((-xi, 0.22, zt), (xi, 0.32, spring), "paint", skip=("+y",))
    for x0, x1 in ((-xi, 0), (0, xi)):
        mb.box((x0, 0.26, 0.05), (x1, 0.32, zt), "paint", skip=("+y",))
        for z0, z1 in ((0.3, 1.1), (1.3, zt - 0.2)):
            mb.box((x0 + 0.12, 0.235, z0), (x1 - 0.12, 0.26, z1), "paint", skip=("+y",))
    rr = hw - 0.07
    mb.planar(arc(0, spring, rr, 0, math.pi, 14), "glass", origin=(0, 0.30, 0))
    for k in range(1, 8):
        ang = math.pi * k / 8
        c, s = math.cos(ang), math.sin(ang)
        mb.bar((0.25 * c, 0.29, spring + 0.25 * s), (rr * c, 0.29, spring + rr * s), 0.024, 0.024, "iron")
    mb.sweep(P.xz(arc(0, spring, 0.25, 0, math.pi, 8), 0.29), P.rect(-0.012, -0.012, 0.012, 0.012), "iron",
             N=(0, -1, 0), closed_profile=True, caps=True)
    mb.box((-hw, -0.12, 0), (hw, 0.24, 0.05), "stone_trim", skip=("-z", "+y"))
    _keystone(mb, top - 0.1, zf, 0.26, 0.34, 0.09)
    return mb


def _ground_panel(mb, D, pier, notch):
    """smooth stone panel between the rusticated piers, |x| < pier, from the
    plinth to the frieze, with the opening outline `notch` cut from below"""
    zp, zf = D["ground"]["plinth"], D["ground"]["frieze"]
    mb.wall(0, 0, 0, 0, "stone_ground", outer=[(-pier, zp)] + notch + [(pier, zp), (pier, zf), (-pier, zf)])


def G_window_rect(D):
    """rectangular window: flat lintel with a keystone, transom and fanlight"""
    mb = MeshBuilder()
    g = D["ground"]
    hb = D["bay"] / 2
    hw, sill = g["window"]["width"] / 2, g["window"]["sill"]
    top, pier = 3.2, hw + 0.2
    mb.sweep([(-hb, 0, 0), (hb, 0, 0)], P.plinth(D), "stone_trim")
    _ground_frame(mb, D, pier)
    _ground_panel(mb, D, pier, [(-hw, sill), (-hw, top), (hw, top), (hw, sill)])
    mb.sweep(P.xz([(hw, sill), (hw, top), (-hw, top), (-hw, sill)]), O.BAND, "stone_trim", N=(0, -1, 0), caps=True)
    loop = P.opening_loop(hw, sill, top)
    P.reveal(mb, loop, "stone_ground")
    P.dormant_frame(mb, loop)
    xi = hw - P.FW
    zt = top - 0.62
    mb.box((-xi, 0.165, zt - 0.04), (xi, 0.225, zt + 0.04), "frame", skip=("+y",))
    P.leaf(mb, -xi, 0, sill + P.FW, zt - 0.04, 4)
    P.leaf(mb, 0, xi, sill + P.FW, zt - 0.04, 4)
    P.glass_rect(mb, -xi, xi, zt + 0.04, top - P.FW)
    for x in (-xi / 3, xi / 3):
        mb.box((x - 0.011, 0.185, zt + 0.04), (x + 0.011, 0.205, top - P.FW), "frame", skip=("+y",))
    _keystone(mb, top - 0.06, top + 0.42, 0.22, 0.28, 0.08)
    return mb


def _door_leaves(mb, xi, z1, panels):
    """two panelled leaves between x = -xi .. xi from the threshold to z1"""
    for x0, x1 in ((-xi, 0), (0, xi)):
        mb.box((x0, 0.26, 0.05), (x1, 0.32, z1), "paint", skip=("+y",))
        for z0, za in panels:
            mb.box((x0 + 0.12, 0.235, z0), (x1 - 0.12, 0.26, za), "paint", skip=("+y",))


def _door_bays(mb, D, hw):
    """plinth on the piers only, frieze and rusticated piers of a door bay"""
    hb = D["bay"] / 2
    mb.sweep([(-hb, 0, 0), (-hw, 0, 0)], P.plinth(D), "stone_trim", caps=True, cap_ends=(False, True))
    mb.sweep([(hw, 0, 0), (hb, 0, 0)], P.plinth(D), "stone_trim", caps=True, cap_ends=(True, False))


def G_door_rect(D):
    """rectangular carriage door under an entablature, with an iron-barred transom"""
    mb = MeshBuilder()
    g = D["ground"]
    hw, zf = g["door"]["width"] / 2, g["frieze"]
    top = 3.4
    _door_bays(mb, D, hw)
    _ground_frame(mb, D, hw)
    mb.wall(-hw, hw, top, zf, "stone_ground")
    hood = [(0, 0), (0.04, 0), (0.04, 0.10), (0.07, 0.13), (0.11, 0.17), (0.13, 0.17), (0.13, 0.24), (0, 0.24)]
    mb.sweep([(-hw - 0.12, 0, top + 0.18), (hw + 0.12, 0, top + 0.18)], hood, "stone_trim", caps=True)
    path = [(hw, 0), (hw, top), (-hw, top), (-hw, 0)]
    mb.sweep(P.xz(path), [(0, 0), (0, -0.26)], "stone_ground", N=(0, -1, 0), uv_fn=P.joint_free_uv)
    P.dormant_frame(mb, path, closed=False, mat="paint", y0=0.22, y1=0.32, w=0.07)
    xi = hw - 0.07
    zt = 2.72
    _door_leaves(mb, xi, zt, ((0.3, 1.1), (1.3, zt - 0.2)))
    mb.box((-xi, 0.22, zt), (xi, 0.32, zt + 0.1), "paint", skip=("+y",))
    P.glass_rect(mb, -xi, xi, zt + 0.1, top - 0.07, y=0.30)
    n = 10
    for k in range(1, n):
        x = -xi + 2 * xi * k / n
        mb.box((x - 0.01, 0.275, zt + 0.1), (x + 0.01, 0.295, top - 0.07), "iron", skip=("+y",))
    mb.box((-xi, 0.275, (zt + top) / 2 - 0.01), (xi, 0.295, (zt + top) / 2 + 0.01), "iron", skip=("+y",))
    mb.box((-hw, -0.12, 0), (hw, 0.24, 0.05), "stone_trim", skip=("-z", "+y"))
    return mb


def G_door_glazed(D):
    """glazed entrance door: wooden lower panels, glass behind an iron grille"""
    mb = MeshBuilder()
    g = D["ground"]
    hw, top = 0.8, 3.2
    pier = g["window"]["width"] / 2 + 0.2
    _door_bays(mb, D, hw)
    _ground_frame(mb, D, pier)
    _ground_panel(mb, D, pier, [(-hw, g["plinth"]), (-hw, top), (hw, top), (hw, g["plinth"])])
    mb.sweep(P.xz([(hw, g["plinth"]), (hw, top), (-hw, top), (-hw, g["plinth"])]), O.BAND, "stone_trim",
             N=(0, -1, 0), caps=True)
    head = [(0, 0.18), (0.03, 0.18), (0.03, 0.28), (0.07, 0.32), (0.10, 0.32), (0.10, 0.38), (0, 0.38)]
    mb.sweep([(-hw - 0.2, 0, top), (hw + 0.2, 0, top)], head, "stone_trim", caps=True)
    path = [(hw, 0), (hw, top), (-hw, top), (-hw, 0)]
    mb.sweep(P.xz(path), [(0, 0), (0, -0.26)], "stone_ground", N=(0, -1, 0), uv_fn=P.joint_free_uv)
    P.dormant_frame(mb, path, closed=False, mat="paint", y0=0.22, y1=0.32, w=0.07)
    xi = hw - 0.07
    zt = 2.56
    sk = ("+y",)
    for x0, x1 in ((-xi, 0), (0, xi)):
        mb.box((x0, 0.26, 0.05), (x0 + 0.08, 0.32, zt), "paint", skip=sk)
        mb.box((x1 - 0.08, 0.26, 0.05), (x1, 0.32, zt), "paint", skip=sk)
        mb.box((x0 + 0.08, 0.26, 0.05), (x1 - 0.08, 0.32, 0.95), "paint", skip=sk)
        mb.box((x0 + 0.16, 0.24, 0.2), (x1 - 0.16, 0.26, 0.8), "paint", skip=sk)
        mb.box((x0 + 0.08, 0.26, zt - 0.08), (x1 - 0.08, 0.32, zt), "paint", skip=sk)
        P.glass_rect(mb, x0 + 0.08, x1 - 0.08, 0.95, zt - 0.08, y=0.29)
        for k in range(1, 5):
            x = x0 + 0.08 + (x1 - x0 - 0.16) * k / 5
            mb.box((x - 0.008, 0.25, 0.95), (x + 0.008, 0.265, zt - 0.08), "iron", skip=sk)
        mb.box((x0 + 0.08, 0.25, 1.7), (x1 - 0.08, 0.265, 1.73), "iron", skip=sk)
    mb.box((-xi, 0.22, zt), (xi, 0.32, zt + 0.08), "paint", skip=sk)
    P.glass_rect(mb, -xi, xi, zt + 0.08, top - 0.07, y=0.30)
    mb.box((-hw, -0.12, 0), (hw, 0.24, 0.05), "stone_trim", skip=("-z", "+y"))
    return mb


def G_wall(D):
    """ground bay without an opening: rusticated all across"""
    mb = MeshBuilder()
    hb = D["bay"] / 2
    mb.sweep([(-hb, 0, 0), (hb, 0, 0)], P.plinth(D), "stone_trim")
    mb.sweep([(-hb, 0, 0), (hb, 0, 0)], P.frieze(D), "stone_trim")
    prof, _ = P.rustic(D["ground"]["plinth"], D["ground"]["frieze"], D["course"])
    mb.sweep([(-hb, 0, 0), (hb, 0, 0)], prof, "stone_ground", u0=-hb, v_from="b")
    return mb


def G_corner_pier(D):
    mb = MeshBuilder()
    c = D["corner"]
    path = L_path(c, c)
    prof, _ = P.rustic(D["ground"]["plinth"], D["ground"]["frieze"], D["course"])
    mb.sweep(path, P.plinth(D), "stone_trim")
    mb.sweep(path, prof, "stone_ground", uv_fn=corner_uv(D))
    mb.sweep(path, P.frieze(D), "stone_trim")
    return mb


# ---------------------------------------------------------------- upper floors (N, S, A)

TRANSOM = {"N": 0.5, "S": 0.45, "A": None}
PANES = {"N": 4, "S": 3, "A": 3}


def upper_window(D, cls):
    mb = MeshBuilder()
    H, head = D["classes"][cls]["height"], D["classes"][cls]["head"]
    hb = D["bay"] / 2
    hw, sill = D["window"]["width"] / 2, D["window"]["sill"]
    mb.sweep([(-hb, 0, 0), (hb, 0, 0)], P.bandeau(D), "stone_trim")
    wall = [(-hb, sill), (-hw, sill), (-hw, head), (hw, head), (hw, sill), (hb, sill), (hb, H), (-hb, H)]
    mb.wall(0, 0, 0, 0, "stone", outer=wall)
    loop = P.opening_loop(hw, sill, head)
    P.reveal(mb, loop, "stone")
    P.french_window(mb, 2 * hw, sill, head, TRANSOM[cls], PANES[cls], leaves=False)
    return mb


def upper_leaf(D, cls):
    """left casement of a French window with its hinge at the origin (the
    generator places it at x = -xi, y = HINGE_Y and turns it to open it; the
    right casement is this one mirrored)"""
    hw, sill, head = D["window"]["width"] / 2, D["window"]["sill"], D["classes"][cls]["head"]
    xi, z0, z1 = P.leaf_span(2 * hw, sill, head, TRANSOM[cls])
    tmp = MeshBuilder()
    P.leaf(tmp, 0, xi, z0, z1, PANES[cls])
    mb = MeshBuilder()
    for f, mat, uv in zip(tmp.faces, tmp.mats, tmp.uvs):
        mb.face([(tmp.verts[i].x, tmp.verts[i].y - P.HINGE_Y, tmp.verts[i].z) for i in f], mat, uv)
    return mb


def upper_wall(D, cls):
    """upper bay without an opening (side facades, next to a neighbour)"""
    mb = MeshBuilder()
    H = D["classes"][cls]["height"]
    hb = D["bay"] / 2
    mb.sweep([(-hb, 0, 0), (hb, 0, 0)], P.bandeau(D), "stone_trim")
    mb.wall(-hb, hb, D["window"]["sill"], H, "stone")
    return mb


def upper_corner_pier(D, cls):
    """corner pier: flat faces, string course wrapping the corner, and quoins
    alternating long / short on the two faces"""
    mb = MeshBuilder()
    H = D["classes"][cls]["height"]
    c = D["corner"]
    bh = D["bandeau"]["height"]
    mb.sweep(L_path(c, c), P.bandeau(D), "stone_trim")
    # face along x = 0 (previous facade, facing -X), then along y = 0 (facing -Y);
    # UV0 continues the neighbouring bays' joint pattern (corner_uv)
    hb = D["bay"] / 2
    mb.planar([(0, bh), (c, bh), (c, H), (0, H)], "stone", origin=(0, c, 0), s_axis=(0, -1, 0),
              uv=lambda s, t: (hb + s, t))
    mb.planar([(0, bh), (c, bh), (c, H), (0, H)], "stone", s_axis=(1, 0, 0),
              uv=lambda s, t: (s - c - hb, t))
    course = D["course"]
    k = 0
    while course * k < H - 1e-6:
        z0 = max(course * k, bh) + 0.01
        z1 = min(course * (k + 1), H) - 0.01
        if z1 - z0 > 0.1:
            la, lb = (0.55, 0.30) if k % 2 == 0 else (0.30, 0.55)
            mb.sweep(L_path(la, lb), [(0, z0), (0.025, z0), (0.025, z1), (0, z1)], "stone", caps=True,
                     uv_fn=P.joint_free_uv)
        k += 1
    return mb


# ---------------------------------------------------------------- balconies (any floor)

def balcony_continuous(D):
    mb = MeshBuilder()
    hb = D["bay"] / 2
    a = P.RAIL_LINE
    # posts stay inside the bay so neighbouring modules never overlap
    P.balcony_railing(mb, [(-hb, 0, 0), (hb, 0, 0)], D, posts=[(-hb + 0.018, -a), (0, -a)])
    return mb


def balcony_corner(D):
    mb = MeshBuilder()
    c = D["corner"]
    a = P.RAIL_LINE
    P.balcony_railing(mb, L_path(c, c), D, posts=[(-a, -a), (-a, c - 0.018)])
    return mb


def balcony_gardecorps(D):
    mb = MeshBuilder()
    P.gardecorps(mb, D)
    return mb


# ---------------------------------------------------------------- roof (R)

def cornice_bay(D):
    mb = MeshBuilder()
    hb = D["bay"] / 2
    prof, mats = P.cornice(D)
    mb.sweep([(-hb, 0, 0), (hb, 0, 0)], prof, mats)
    return mb


def cornice_corner(D):
    mb = MeshBuilder()
    c = D["corner"]
    prof, mats = P.cornice(D)
    mb.sweep(L_path(c, c), prof, mats)
    return mb


def _slope(D):
    rise, run = D["mansard"]["rise"], D["mansard"]["run"]
    k = run / rise                       # y per metre of height
    return rise, run, k, math.sqrt(1 + k * k)


def _brisis(mb, D, outer):
    """steep mansard slope over the bay; `outer` in (x, z), z = height above the cornice"""
    rise, run, k, sl = _slope(D)
    mb.planar(outer, "zinc", s_axis=(1, 0, 0), t_axis=(0, k, 1), uv=lambda s, t: (s, t * sl))
    hb = D["bay"] / 2
    mb.sweep([(-hb, run, rise), (hb, run, rise)], P.circle(0, 0.012, 0.045), "zinc", closed_profile=True, caps=True)


def mansard_plain(D):
    mb = MeshBuilder()
    rise = D["mansard"]["rise"]
    hb = D["bay"] / 2
    _brisis(mb, D, [(-hb, 0), (hb, 0), (hb, rise), (-hb, rise)])
    return mb


def _dormer(D, kind):
    """dormer on a mansard bay (KIT_SPEC.md §4.4). Every kind has a front with the
    window, cheeks and a roof meeting the slope, which is cut where the dormer
    stands; they differ in the roof line and the front:
      zinc      gabled zinc roof, zinc front, two-leaf window
      triangle  gabled roof behind a stone front with a triangular pediment
      segment   curved roof behind a stone front with a segmental pediment
      oeil      low hooded dormer with a round window (oeil-de-boeuf)"""
    mb = MeshBuilder()
    rise, run, k, sl = _slope(D)
    hb = D["bay"] / 2
    d = D["dormer"]
    fw, hw = d["front"] / 2, d["width"] / 2
    ze, zr = d["eave"], d["ridge"]
    yf = -0.03                    # dormer front, just proud of the slope foot
    ov = 0.05                     # roof overhang at the sides
    ex = fw + ov
    yr = yf - 0.06                # roof front edge
    stone = kind in ("triangle", "segment")
    if kind == "oeil":
        ze, zr = 1.2, 1.2 + ex     # semicircular hood
    if kind in ("segment", "oeil"):
        R = (ex * ex + (zr - ze) ** 2) / (2 * (zr - ze))
        cz = zr - R

        def z_roof(x):
            return cz + math.sqrt(max(R * R - x * x, 0.0))
    else:
        def z_roof(x):            # gable
            return zr - (zr - ze) * abs(x) / ex

    def samples(x0, x1, n=12):
        return [x0 + (x1 - x0) * i / n for i in range(n + 1)]

    zc = z_roof(fw)
    top = [(x, z_roof(x)) for x in samples(fw, -fw)]
    _brisis(mb, D, [(-hb, 0), (-fw, 0)] + top[::-1] + [(fw, 0), (hb, 0), (hb, rise), (-hb, rise)])
    # front with the window opening
    front_mat = "stone_trim" if stone else "zinc"
    if kind == "oeil":
        loop = P.circle(0, 1.0, 0.3, 20)
    else:
        loop = P.opening_loop(hw, d["sill"], d["head"])
    front = [(-fw, 0), (fw, 0)] + [(x, z - 0.005) for x, z in top]
    mb.wall(0, 0, 0, 0, front_mat, y=yf, outer=front, holes=[loop])
    mb.sweep([(x, yf, z) for x, z in loop], [(0, 0), (0, -0.1)], front_mat, N=(0, -1, 0), closed_path=True)
    # cheeks (x = +-fw), from the front back to the slope
    mb.planar([(yf, 0), (0, 0), (zc * k, zc), (yf, zc)], "zinc", origin=(fw, 0, 0), s_axis=(0, 1, 0))
    mb.planar([(-yf, 0), (0, 0), (-zc * k, zc), (-yf, zc)], "zinc", origin=(-fw, 0, 0), s_axis=(0, -1, 0))
    # roof strips from the front edge back to where they meet the slope
    xs = samples(-ex, ex, 12 if kind != "zinc" and kind != "triangle" else 2)
    if kind in ("zinc", "triangle"):
        xs = [-ex, 0.0, ex]
    u = 0.0
    for x0, x1 in zip(xs, xs[1:]):
        z0, z1 = z_roof(x0), z_roof(x1)
        ln = math.hypot(x1 - x0, z1 - z0)
        mb.face([(x0, yr, z0), (x1, yr, z1), (x1, z1 * k, z1), (x0, z0 * k, z0)], "zinc",
                [(u, 0), (u + ln, 0), (u + ln, z1 * k - yr), (u, z0 * k - yr)])
        u += ln
    edge = [(x, z_roof(x)) for x in xs]
    mb.wall(0, 0, 0, 0, "zinc", y=yr, outer=edge + [(x, z - 0.06) for x, z in edge[::-1]])
    if stone:
        # pediment cornice along the front edge, a stone sill band at its foot
        from .ornaments import RAKE
        mb.sweep([(x, yr, z + 0.02) for x, z in edge[::-1]], RAKE, "stone_trim", N=(0, -1, 0), caps=True)
        mb.box((-fw - 0.04, yr, 0.0), (fw + 0.04, yf, 0.12), "stone_trim", skip=("-z", "+y"))
    # window
    fy0 = yf + 0.06
    P.dormant_frame(mb, loop, y0=fy0, y1=fy0 + 0.06, w=0.05)
    if kind == "oeil":
        mb.planar(P.circle(0, 1.0, 0.25, 20), "glass", origin=(0, fy0 + 0.02, 0))
        mb.box((-0.25, fy0, 0.99), (0.25, fy0 + 0.03, 1.01), "frame", skip=("+y",))
        mb.box((-0.01, fy0, 0.75), (0.01, fy0 + 0.03, 1.25), "frame", skip=("+y",))
        return mb
    xi = hw - 0.05
    for x0, x1 in ((-xi, 0), (0, xi)):
        mb.box((x0, fy0, d["sill"] + 0.05), (x0 + 0.045, fy0 + 0.04, d["head"] - 0.05), "frame", skip=("+y",))
        mb.box((x1 - 0.045, fy0, d["sill"] + 0.05), (x1, fy0 + 0.04, d["head"] - 0.05), "frame", skip=("+y",))
        mid = (d["sill"] + d["head"]) / 2
        mb.box((x0 + 0.045, fy0 + 0.01, mid - 0.01), (x1 - 0.045, fy0 + 0.03, mid + 0.01), "frame", skip=("+y",))
    P.glass_rect(mb, -xi, xi, d["sill"] + 0.05, d["head"] - 0.05, y=fy0 + 0.02)
    return mb


def mansard_dormer_zinc(D):
    return _dormer(D, "zinc")


# ---------------------------------------------------------------- roof ornaments (phase D)

def ridge_cresting(D):
    """cast-iron cresting along the top of the steep slope (a lace panel on a bar)"""
    mb = MeshBuilder()
    rise, run, _, _ = _slope(D)
    hb = D["bay"] / 2
    path = [(-hb, run, rise + 0.04), (hb, run, rise + 0.04)]
    mb.sweep(path, P.rect(-0.012, 0.0, 0.012, 0.03), "iron", closed_profile=True)
    mb.sweep(path, [(0, 0.03), (0, 0.38)], "iron_lace", v_from="norm")
    mb.sweep(path, P.rect(-0.01, 0.38, 0.01, 0.40), "iron", closed_profile=True)
    return mb


def ridge_post(D):
    """iron post with a ball where the cresting turns a corner (top of the hip)"""
    mb = MeshBuilder()
    rise, run, _, _ = _slope(D)
    x, y, z = run, run, rise + 0.04
    mb.box((x - 0.02, y - 0.02, z), (x + 0.02, y + 0.02, z + 0.42), "iron", skip=("-z",))
    mb.sweep([(x, y, z + 0.42), (x, y, z + 0.50)], P.circle(0, 0, 0.04, 10), "iron", N=(1, 0, 0),
             closed_profile=True, caps=True)
    return mb


def _lathe(mb, prof, mat, n=12):
    """surface of revolution about z from a (radius, z) polyline, bottom to top"""
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        for (r0, z0), (r1, z1) in zip(prof, prof[1:]):
            pts = [(r0 * math.cos(a0), r0 * math.sin(a0), z0), (r0 * math.cos(a1), r0 * math.sin(a1), z0),
                   (r1 * math.cos(a1), r1 * math.sin(a1), z1), (r1 * math.cos(a0), r1 * math.sin(a0), z1)]
            mb.face(pts, mat, [(i / n, z0), ((i + 1) / n, z0), ((i + 1) / n, z1), (i / n, z1)])


def ridge_finial(D):
    """zinc finial (épi) for the corners of the flat top"""
    mb = MeshBuilder()
    prof = [(0.09, 0.0), (0.09, 0.08), (0.05, 0.12), (0.04, 0.3), (0.08, 0.38), (0.09, 0.45), (0.06, 0.52),
            (0.025, 0.56), (0.03, 0.7), (0.05, 0.76), (0.03, 0.84), (0.012, 0.88), (0.008, 1.05), (0.0, 1.08)]
    _lathe(mb, prof, "zinc")
    return mb


def chimney(D, cols, rows):
    """plastered chimney stack with cols x rows terracotta pots; its foot runs
    2.5 m down so it can stand anywhere on the roof"""
    mb = MeshBuilder()
    w, dpt = 0.12 + 0.3 * cols, 0.12 + 0.3 * rows
    h = 1.3
    mb.box((-w / 2, -dpt / 2, -2.5), (w / 2, dpt / 2, h), "plaster", skip=("-z",))
    mb.box((-w / 2 - 0.05, -dpt / 2 - 0.05, h - 0.06), (w / 2 + 0.05, dpt / 2 + 0.05, h + 0.06), "stone_trim", skip=())
    pot = [(0.0, 0.0), (0.12, 0.0), (0.12, 0.05), (0.10, 0.08), (0.11, 0.4), (0.13, 0.43), (0.13, 0.47), (0.095, 0.47)]
    for i in range(cols):
        for j in range(rows):
            sub = MeshBuilder()
            _lathe(sub, pot, "terracotta", 10)
            cx, cy = -w / 2 + 0.21 + 0.3 * i, -dpt / 2 + 0.21 + 0.3 * j
            for f, m, uv in zip(sub.faces, sub.mats, sub.uvs):
                mb.face([(sub.verts[v].x + cx, sub.verts[v].y + cy, sub.verts[v].z + h + 0.06) for v in f], m, uv)
    return mb


def mansard_hip(D):
    """corner of the steep slope: two triangles meeting on the hip, with a zinc roll"""
    mb = MeshBuilder()
    rise, run, k, sl = _slope(D)
    c = D["corner"]
    top = (run, run, rise)
    mb.face([(0, 0, 0), (c, 0, 0), top], "zinc", [(0, 0), (c, 0), (run, rise * sl)])
    mb.face([(0, c, 0), (0, 0, 0), top], "zinc", [(-c, 0), (0, 0), (-run, rise * sl)])
    n = (-1 / math.sqrt(2), 1 / math.sqrt(2), 0)
    mb.sweep([(0, 0, 0), top], P.circle(0, 0, 0.04), "zinc", N=n, closed_profile=True, caps=True)
    return mb


# ---------------------------------------------------------------- pan coupé corners (phase E)
#
# Corner square 4 x 4 m: a 1 m return on each facade and a 4.24 m diagonal from
# (0, 3) to (3, 0). The middle 3 m of the diagonal takes standard bay modules
# (placed at (1.5, 1.5) turned -45 degrees); a pc frame module is everything
# else, as two paths walking from the previous facade (x = 0) to this one (y = 0).

def _pc_geometry(D):
    leg = D["panCoupe"]["leg"]
    sq = D["panCoupe"]["square"]
    diag = leg * math.sqrt(2)
    strip = (diag - D["bay"]) / 2
    d = (1 / math.sqrt(2), -1 / math.sqrt(2))
    a = (d[0] * strip, leg + d[1] * strip)
    b = (d[0] * (diag - strip), leg + d[1] * (diag - strip))
    return [(0, sq), (0, leg), a], [b, (leg, 0), (sq, 0)]


def pc_paths(D, z=0.0):
    p1, p2 = _pc_geometry(D)
    return [[(x, y, z) for x, y in p1], [(x, y, z) for x, y in p2]]


def _wall_seg(mb, p0, p1, z0, z1, mat, u0):
    """vertical wall quad along p0 -> p1 (2D), facing right of the walking direction"""
    (x0, y0), (x1, y1) = p0, p1
    ln = math.hypot(x1 - x0, y1 - y0)
    mb.face([(x0, y0, z0), (x1, y1, z0), (x1, y1, z1), (x0, y0, z1)], mat,
            [(u0, z0), (u0 + ln, z0), (u0 + ln, z1), (u0, z1)])


def _pc_walls(mb, D, z0, z1, mat):
    """flat wall faces of the frame; the returns continue the facades' joint
    pattern, the diagonal strips the centre bay's"""
    hb = D["bay"] / 2
    (r0, r1, sa), (sb, r2, r3) = _pc_geometry(D)
    strip = math.dist(r1, sa)
    _wall_seg(mb, r0, r1, z0, z1, mat, hb)
    _wall_seg(mb, r1, sa, z0, z1, mat, -hb - strip)
    _wall_seg(mb, sb, r2, z0, z1, mat, hb)
    _wall_seg(mb, r2, r3, z0, z1, mat, -hb - 1.0)


def miter_point(path, i, a):
    """position of a sweep's profile point at offset a, vertex i (N = +z)"""
    P = [tuple(p[:2]) for p in path]

    def right(p, q):
        dx, dy = q[0] - p[0], q[1] - p[1]
        ln = math.hypot(dx, dy)
        return (dy / ln, -dx / ln)
    r0 = right(P[i - 1], P[i]) if i > 0 else right(P[0], P[1])
    r1 = right(P[i], P[i + 1]) if i < len(P) - 1 else r0
    m = (r0[0] + r1[0], r0[1] + r1[1])
    ln = math.hypot(*m)
    m = (m[0] / ln, m[1] / ln)
    k = 1 / (m[0] * r1[0] + m[1] * r1[1])
    return (P[i][0] + m[0] * k * a, P[i][1] + m[1] * k * a)


def G_pc_frame(D):
    mb = MeshBuilder()
    prof, _ = P.rustic(D["ground"]["plinth"], D["ground"]["frieze"], D["course"])
    for path in pc_paths(D):
        mb.sweep(path, P.plinth(D), "stone_trim")
        mb.sweep(path, prof, "stone_ground", u0=D["bay"] / 2, v_from="b")
        mb.sweep(path, P.frieze(D), "stone_trim")
    return mb


def upper_pc_frame(D, cls):
    mb = MeshBuilder()
    H = D["classes"][cls]["height"]
    for path in pc_paths(D):
        mb.sweep(path, P.bandeau(D), "stone_trim")
    _pc_walls(mb, D, D["bandeau"]["height"], H, "stone")
    return mb


def balcony_pc(D):
    mb = MeshBuilder()
    a = P.RAIL_LINE
    for path in pc_paths(D):
        P.balcony_railing(mb, path, D, posts=[miter_point(path, 1, a)])
    return mb


def cornice_pc(D):
    mb = MeshBuilder()
    prof, mats = P.cornice(D)
    for path in pc_paths(D):
        mb.sweep(path, prof, mats)
    return mb


def mansard_pc(D):
    """steep slope round the pan coupé outside its centre bay: a return and a
    diagonal strip on each side, meeting on a hip"""
    mb = MeshBuilder()
    rise, run, k, sl = _slope(D)
    for path in pc_paths(D):
        base = [(p[0], p[1]) for p in path]
        top = [miter_point(path, i, -run) for i in range(3)]
        for i in range(2):
            (x0, y0), (x1, y1) = base[i], base[i + 1]
            (tx0, ty0), (tx1, ty1) = top[i], top[i + 1]
            ln = math.hypot(x1 - x0, y1 - y0)
            mb.face([(x0, y0, 0), (x1, y1, 0), (tx1, ty1, rise), (tx0, ty0, rise)], "zinc",
                    [(0, 0), (ln, 0), (ln, rise * sl), (0, rise * sl)])
        bx, by = base[1]
        tx, ty = top[1]
        hip = (tx - bx, ty - by, rise)
        n = (-hip[1] / math.hypot(hip[0], hip[1]), hip[0] / math.hypot(hip[0], hip[1]), 0)
        mb.sweep([(bx, by, 0), (tx, ty, rise)], P.circle(0, 0, 0.04), "zinc", N=n, closed_profile=True, caps=True)
        mb.sweep([(x, y, rise) for x, y in top], P.circle(0, 0.012, 0.045), "zinc", closed_profile=True, caps=True)
    return mb


# ---------------------------------------------------------------- end piers (phase E)
#
# Where a facade meets a party wall: a 0.5 m pier at x in [0, 0.5], whose end
# faces at x = 0 are capped (they show above a lower neighbour). Right ends use
# the same modules mirrored.

def _end_x(D):
    return [(0, 0, 0), (D["endPier"], 0, 0)]


def G_end_pier(D):
    mb = MeshBuilder()
    e = D["endPier"]
    hb = D["bay"] / 2
    prof, notches = P.rustic(D["ground"]["plinth"], D["ground"]["frieze"], D["course"])
    mb.sweep(_end_x(D), P.plinth(D), "stone_trim", caps=True, cap_ends=(True, False))
    mb.sweep(_end_x(D), prof, "stone_ground", u0=-hb - e, v_from="b", cap_polys=notches, cap_ends=(True, False))
    mb.sweep(_end_x(D), P.frieze(D), "stone_trim", caps=True, cap_ends=(True, False))
    return mb


def upper_end_pier(D, cls):
    mb = MeshBuilder()
    e = D["endPier"]
    H = D["classes"][cls]["height"]
    bh = D["bandeau"]["height"]
    mb.sweep(_end_x(D), P.bandeau(D), "stone_trim", caps=True, cap_ends=(True, False))
    mb.planar([(0, bh), (e, bh), (e, H), (0, H)], "stone", uv=lambda s, t: (s - e - D["bay"] / 2, t))
    return mb


def balcony_end(D):
    """continuous balcony ending at a party wall: slab end, side railing"""
    mb = MeshBuilder()
    e = D["endPier"]
    a = P.RAIL_LINE
    h = D["balcony"]["railing"]
    mb.sweep(_end_x(D), P.slab(D), "stone_trim", caps=True, cap_ends=(True, False))
    path = [(0.02, 0, 0), (0.02, -a, 0), (e, -a, 0)]
    mb.sweep(path, P.rect(-0.04, h - 0.05, 0.04, h), "iron", closed_profile=True, caps=True, cap_ends=(True, False))
    mb.sweep(path, P.rect(-0.015, 0.04, 0.015, 0.07), "iron", closed_profile=True, caps=True, cap_ends=(True, False))
    mb.sweep(path, [(0, 0.07), (0, h - 0.05)], "iron_lace", v_from="norm")
    for x, y in ((0.02, -a), (0.02, -0.02)):
        mb.box((x - 0.018, y - 0.018, 0), (x + 0.018, y + 0.018, h - 0.05), "iron", skip=("-z", "+z"))
    return mb


def cornice_end(D):
    mb = MeshBuilder()
    prof, mats = P.cornice(D)
    mb.sweep(_end_x(D), prof, mats, caps=True, cap_ends=(True, False))
    return mb


def mansard_end(D):
    mb = MeshBuilder()
    rise, run, k, sl = _slope(D)
    e = D["endPier"]
    mb.planar([(0, 0), (e, 0), (e, rise), (0, rise)], "zinc", s_axis=(1, 0, 0), t_axis=(0, k, 1),
              uv=lambda s, t: (s, t * sl))
    mb.sweep([(0, run, rise), (e, run, rise)], P.circle(0, 0.012, 0.045), "zinc", closed_profile=True, caps=True)
    return mb


# ---------------------------------------------------------------- shops (phase E)

SHOP_HW, SHOP_TOP = 1.2, 3.4


def G_shop_wood(D):
    """traditional painted wooden shopfront (devanture), proud of the wall over
    the whole bay so neighbouring shop bays read as one front"""
    mb = MeshBuilder()
    hb = D["bay"] / 2
    zf = D["ground"]["frieze"]
    mb.sweep([(-hb, 0, 0), (hb, 0, 0)], P.frieze(D), "stone_trim")
    sk = ("+y",)
    yb, yf = 0.0, -0.25
    # fascia (sign board) with a small cornice, pilasters, stall riser
    mb.box((-hb, yf - 0.03, SHOP_TOP), (hb, yb, zf - 0.04), "paint", skip=sk)
    mb.sweep([(-hb, 0, zf - 0.04), (hb, 0, zf - 0.04)], [(0, 0), (0.30, 0), (0.33, 0.03), (0.33, 0.07), (0, 0.07)], "paint")
    mb.box((-hb, yf, 0), (-hb + 0.2, yb, SHOP_TOP), "paint", skip=sk)
    mb.box((hb - 0.2, yf, 0), (hb, yb, SHOP_TOP), "paint", skip=sk)
    mb.box((-hb + 0.2, yf, 0), (hb - 0.2, yb, 0.5), "paint", skip=sk)
    mb.box((-hb + 0.35, yf - 0.02, 0.1), (hb - 0.35, yf, 0.4), "paint", skip=sk)
    # shop window: two mullions and a transom bar
    gx, gy = hb - 0.2, yf + 0.03
    P.glass_rect(mb, -gx, gx, 0.5, SHOP_TOP, y=gy)
    for x in (-gx / 3, gx / 3):
        mb.box((x - 0.03, yf, 0.5), (x + 0.03, yf + 0.06, SHOP_TOP), "paint", skip=sk)
    mb.box((-gx, yf, 2.8), (gx, yf + 0.06, 2.86), "paint", skip=sk)
    return mb


def _shop_opening(mb, D):
    """stone bay with a 2.4 m opening: rusticated piers, plinth on the piers,
    smooth lintel up to the frieze, reveals"""
    zf = D["ground"]["frieze"]
    _door_bays(mb, D, SHOP_HW)
    _ground_frame(mb, D, SHOP_HW)
    mb.wall(-SHOP_HW, SHOP_HW, SHOP_TOP, zf, "stone_ground")
    path = [(SHOP_HW, 0), (SHOP_HW, SHOP_TOP), (-SHOP_HW, SHOP_TOP), (-SHOP_HW, 0)]
    mb.sweep(P.xz(path), [(0, 0), (0, -0.26)], "stone_ground", N=(0, -1, 0), uv_fn=P.joint_free_uv)
    return path


def G_shop_stone(D):
    """stone-framed shop: a large window in a slim metal frame"""
    mb = MeshBuilder()
    path = _shop_opening(mb, D)
    P.dormant_frame(mb, path, closed=False, mat="iron", y0=0.18, y1=0.26, w=0.05)
    xi = SHOP_HW - 0.05
    sk = ("+y",)
    mb.box((-xi, 0.18, 0), (xi, 0.26, 0.35), "iron", skip=sk)
    mb.box((-xi, 0.18, 2.75), (xi, 0.26, 2.81), "iron", skip=sk)
    mb.box((-0.03, 0.18, 0.35), (0.03, 0.26, SHOP_TOP - 0.05), "iron", skip=sk)
    P.glass_rect(mb, -xi, xi, 0.35, SHOP_TOP - 0.05, y=0.22)
    return mb


def G_shop_cafe(D):
    """café front: folding glazed doors in a painted frame, a sign band above"""
    mb = MeshBuilder()
    path = _shop_opening(mb, D)
    P.dormant_frame(mb, path, closed=False, mat="paint", y0=0.18, y1=0.28, w=0.07)
    xi = SHOP_HW - 0.07
    sk = ("+y",)
    mb.box((-xi, 0.17, 2.85), (xi, 0.28, SHOP_TOP - 0.07), "paint", skip=sk)
    n = 6
    for k in range(n + 1):
        x = -xi + 2 * xi * k / n
        mb.box((x - 0.03, 0.2, 0), (x + 0.03, 0.26, 2.85), "paint", skip=sk)
    for z0, z1 in ((0, 0.45), (2.0, 2.06)):
        mb.box((-xi, 0.2, z0), (xi, 0.26, z1), "paint", skip=sk)
    P.glass_rect(mb, -xi, xi, 0.45, 2.85, y=0.23)
    return mb


def awning(D, open_):
    """retractable awning under a shop's sign: the cassette, and when open the
    sloping canvas (striped in the shader along u) with a valance and arms"""
    mb = MeshBuilder()
    hw = 1.45
    mb.box((-hw, -0.45, -0.18), (hw, -0.28, 0.0), "iron", skip=("+y",))
    if not open_:
        return mb
    y0, z0, y1, z1 = -0.45, -0.1, -1.75, -0.95
    uv = lambda s, t: (s + hw, t)
    mb.planar([(-hw, 0), (hw, 0), (hw, 1), (-hw, 1)], "fabric", origin=(0, y0, z0),
              s_axis=(1, 0, 0), t_axis=(0, y1 - y0, z1 - z0), uv=uv)
    # the undersides sit 4 mm off: shared vertices would be welded and the two
    # faces' smooth normals would cancel out
    mb.planar([(-hw, 0), (hw, 0), (hw, 1), (-hw, 1)], "fabric", origin=(0, y0 + 0.002, z0 - 0.004),
              s_axis=(1, 0, 0), t_axis=(0, y1 - y0, z1 - z0), uv=uv, flip=True)
    mb.wall(-hw, hw, z1 - 0.28, z1, "fabric", y=y1)
    mb.planar([(-hw, z1 - 0.28), (hw, z1 - 0.28), (hw, z1 - 0.004), (-hw, z1 - 0.004)], "fabric",
              origin=(0, y1 + 0.004, 0), flip=True)
    mb.bar((-hw, y1, z1), (hw, y1, z1), 0.04, 0.04, "iron", N=(0, 0, 1))
    for x in (-hw + 0.05, hw - 0.05):
        mb.bar((x, -0.3, z1 - 0.15), (x, y1 + 0.02, z1), 0.03, 0.03, "iron", N=(1, 0, 0))
    return mb


# ---------------------------------------------------------------- catalog

def catalog(D):
    """(collection, variant, builder, check) for every module of the current phase.
    check: expected bounds; 'x' is exact for modules that tile along the facade."""
    hb = D["bay"] / 2
    c = D["corner"]
    G = D["classes"]["G"]["height"]
    R = D["mansard"]["rise"]
    bay = {"x": (-hb, hb), "z": (0, G)}
    sq, e = D["panCoupe"]["square"], D["endPier"]
    out = [
        ("G_bay", "window_arched", G_window_arched, bay),
        ("G_bay", "window_rect", G_window_rect, bay),
        ("G_bay", "door_arched", G_door_arched, bay),
        ("G_bay", "door_rect", G_door_rect, bay),
        ("G_bay", "door_glazed", G_door_glazed, bay),
        ("G_bay", "wall", G_wall, bay),
        ("G_bay", "shop_wood", G_shop_wood, bay),
        ("G_bay", "shop_stone", G_shop_stone, bay),
        ("G_bay", "shop_cafe", G_shop_cafe, bay),
        ("G_corner", "pier", G_corner_pier, {"within": ((-0.06, c), (-0.06, c), (0, G))}),
        ("G_pc", "frame", G_pc_frame, {"within": ((-0.1, sq), (-0.1, sq), (0, G))}),
        ("G_end", "pier", G_end_pier, {"within": ((0, e), (-0.06, 0.03), (0, G))}),
    ]
    for cls in ("N", "S", "A"):
        H = D["classes"][cls]["height"]
        head = D["classes"][cls]["head"]
        hw = D["window"]["width"] / 2
        sill = D["window"]["sill"]
        out += [
            (f"{cls}_bay", "window", lambda D, cls=cls: upper_window(D, cls), {"x": (-hb, hb), "z": (0, H)}),
            (f"{cls}_bay", "wall", lambda D, cls=cls: upper_wall(D, cls), {"x": (-hb, hb), "z": (0, H)}),
            (f"{cls}_leaf", "left", lambda D, cls=cls: upper_leaf(D, cls), {"within": ((0, hw), (-0.04, 0.04), (sill, head))}),
            (f"{cls}_corner", "pier", lambda D, cls=cls: upper_corner_pier(D, cls),
             {"within": ((-0.07, c), (-0.07, c), (0, H))}),
            (f"{cls}_pc", "frame", lambda D, cls=cls: upper_pc_frame(D, cls), {"within": ((-0.1, sq), (-0.1, sq), (0, H))}),
            (f"{cls}_end", "pier", lambda D, cls=cls: upper_end_pier(D, cls), {"within": ((0, e), (-0.07, 0), (0, H))}),
            (f"{cls}_surround", "band", lambda D, cls=cls: O.surround(D, cls, "band"),
             {"within": ((-hw - 0.17, hw + 0.17), (-0.04, 0), (sill, head + 0.17))}),
            (f"{cls}_surround", "crossette", lambda D, cls=cls: O.surround(D, cls, "crossette"),
             {"within": ((-hw - 0.26, hw + 0.26), (-0.06, 0), (sill, head + 0.19))}),
            (f"{cls}_shutter", "closed", lambda D, cls=cls: O.shutter_closed(D, cls),
             {"within": ((-hw, 0), (0.03, 0.07), (sill, head))}),
            (f"{cls}_shutter", "folded", lambda D, cls=cls: O.shutter_folded(D, cls),
             {"within": ((-hw, -hw + 0.05), (0.015, 0.16), (sill, head))}),
            (f"{cls}_detail", "refends", lambda D, cls=cls: O.detail_refends(D, cls), {"x": (-hb, hb), "within": ((-hb, hb), (-0.03, 0), (0, H))}),
            (f"{cls}_detail", "pilasters", lambda D, cls=cls: O.detail_pilasters(D, cls), {"x": (-hb, hb), "within": ((-hb, hb), (-0.1, 0), (0, H))}),
            (f"{cls}_detail", "panels", lambda D, cls=cls: O.detail_panels(D, cls), {"within": ((-1.45, 1.45), (-0.05, 0), (0.45, H - 0.6))}),
        ]
    slab = D["balcony"]["slab"]
    out += [
        ("balcony", "continuous", balcony_continuous, {"x": (-hb, hb), "within": ((-hb, hb), (-0.91, 0), (-0.19, 1.0))}),
        ("balcony", "corner", balcony_corner, {"within": ((-0.91, c), (-0.91, c), (-0.19, 1.0))}),
        ("balcony", "gardecorps", balcony_gardecorps, {"within": ((-0.72, 0.72), (-0.09, 0), (0.19, 1.21))}),
        ("balcony", "pc", balcony_pc, {"within": ((-1.0, sq), (-1.0, sq), (-0.19, 1.0))}),
        ("balcony", "end", balcony_end, {"within": ((-0.03, e), (-0.91, 0), (-0.19, 1.0))}),
        ("awning", "open", lambda D: awning(D, True), {"within": ((-1.47, 1.47), (-1.8, 0), (-1.25, 0.01))}),
        ("awning", "retracted", lambda D: awning(D, False), {"within": ((-1.47, 1.47), (-0.46, 0), (-0.19, 0.01))}),
        ("balcony", "balconnet", O.balcony_balconnet, {"within": ((-0.96, 0.96), (-0.51, 0), (-0.19, 1.0))}),
        ("console", "block", O.console_block, {"within": ((-0.1, 0.1), (-0.37, 0), (-slab - 0.41, -slab))}),
        ("console", "scroll", O.console_scroll, {"within": ((-0.11, 0.11), (-0.47, 0), (-slab - 0.56, -slab))}),
        ("head", "cornice", lambda D: O.head_cornice(D), {"within": ((-0.96, 0.96), (-0.14, 0), (0.17, 0.43))}),
        ("head", "cornice_consoles", lambda D: O.head_cornice(D, consoles=True), {"within": ((-0.96, 0.96), (-0.14, 0), (-0.13, 0.43))}),
        ("head", "keystone", O.head_keystone, {"within": ((-0.13, 0.13), (-0.08, 0), (-0.07, 0.31))}),
        ("head", "segment", O.head_segment, {"within": ((-0.97, 0.97), (-0.12, 0), (0.17, 0.62))}),
        ("head", "triangle", O.head_triangle, {"within": ((-0.97, 0.97), (-0.12, 0), (0.17, 0.62))}),
        ("R_cornice", "bay", cornice_bay, {"x": (-hb, hb), "z": (0, D["cornice"]["height"])}),
        ("R_cornice_corner", "pier", cornice_corner, {"within": ((-0.61, c), (-0.61, c), (0, D["cornice"]["height"]))}),
        ("R_mansard", "plain", mansard_plain, {"x": (-hb, hb), "within": ((-hb, hb), (0, 1.1), (0, R + 0.06))}),
        ("R_mansard", "dormer_zinc", mansard_dormer_zinc, {"x": (-hb, hb), "within": ((-hb, hb), (-0.1, 1.1), (0, R + 0.06))}),
        ("R_mansard", "dormer_oeil", lambda D: _dormer(D, "oeil"), {"x": (-hb, hb), "within": ((-hb, hb), (-0.1, 1.1), (0, R + 0.06))}),
        ("R_mansard", "dormer_segment", lambda D: _dormer(D, "segment"), {"x": (-hb, hb), "within": ((-hb, hb), (-0.2, 1.1), (0, R + 0.06))}),
        ("R_mansard", "dormer_triangle", lambda D: _dormer(D, "triangle"), {"x": (-hb, hb), "within": ((-hb, hb), (-0.2, 1.1), (0, R + 0.06))}),
        ("R_cornice_pc", "frame", cornice_pc, {"within": ((-0.61, sq), (-0.61, sq), (0, D["cornice"]["height"]))}),
        ("R_cornice_end", "end", cornice_end, {"within": ((0, e), (-0.61, 0), (0, D["cornice"]["height"]))}),
        ("R_mansard_pc", "frame", mansard_pc, {"within": ((-0.05, sq), (-0.05, sq), (-0.05, R + 0.06))}),
        ("R_mansard_end", "end", mansard_end, {"within": ((0, e), (0, 1.1), (0, R + 0.06))}),
        ("R_mansard_corner", "hip", mansard_hip, {"within": ((-0.05, c + 0.05), (-0.05, c + 0.05), (-0.05, R + 0.05))}),
        ("R_ridge", "cresting", ridge_cresting, {"x": (-hb, hb), "within": ((-hb, hb), (0.9, 1.1), (R, R + 0.45))}),
        ("R_ridge", "post", ridge_post, {"within": ((0.9, 1.1), (0.9, 1.1), (R, R + 0.6))}),
        ("R_ridge", "finial", ridge_finial, {"within": ((-0.1, 0.1), (-0.1, 0.1), (0, 1.1))}),
        ("R_chimney", "stack2", lambda D: chimney(D, 2, 1), {"within": ((-0.5, 0.5), (-0.3, 0.3), (-2.5, 2.0))}),
        ("R_chimney", "stack4", lambda D: chimney(D, 4, 1), {"within": ((-0.8, 0.8), (-0.3, 0.3), (-2.5, 2.0))}),
        ("R_chimney", "party", lambda D: chimney(D, 6, 1), {"within": ((-1.05, 1.05), (-0.3, 0.3), (-2.5, 2.0))}),
        ("R_chimney", "stack6", lambda D: chimney(D, 3, 2), {"within": ((-0.65, 0.65), (-0.45, 0.45), (-2.5, 2.0))}),
    ]
    return out
