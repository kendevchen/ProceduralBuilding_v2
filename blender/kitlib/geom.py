"""Geometry helpers for the kit builder.

A MeshBuilder collects faces with a material name and per-corner UV0 each; the
primitives below cover everything the modules need:

  planar()  flat polygon (convex, concave or with holes) in a 2D frame
  sweep()   2D profile swept along a polyline, mitred at bends
  box()     axis-aligned box with optional faces left out
  prism()   polygon in the facade plane (x, z) extruded outwards (-Y)
  bar()     rectangular bar between two points

Conventions (KIT_SPEC.md §2): metres, Z up, facade plane y = 0, outward = -Y.
UV0 is in metres. Faces are written unshared; to_object() welds them.
"""
import math

from mathutils import Vector, geometry


def _area2(pts):
    """signed area of a 2D polygon (counterclockwise > 0)"""
    a = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i][0], pts[i][1]
        x1, y1 = pts[(i + 1) % len(pts)][0], pts[(i + 1) % len(pts)][1]
        a += x0 * y1 - x1 * y0
    return a * 0.5


def _convex(pts):
    sign = 0
    n = len(pts)
    for i in range(n):
        ax, ay = pts[i][0], pts[i][1]
        bx, by = pts[(i + 1) % n][0], pts[(i + 1) % n][1]
        cx, cy = pts[(i + 2) % n][0], pts[(i + 2) % n][1]
        c = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
        if abs(c) < 1e-12:
            continue
        s = 1 if c > 0 else -1
        if sign and s != sign:
            return False
        sign = s
    return True


def dedupe(loop, eps=1e-7):
    """drop consecutive duplicate points (and a repeated closing point)"""
    out = []
    for p in loop:
        if not out or math.dist(p, out[-1]) > eps:
            out.append(p)
    while len(out) > 1 and math.dist(out[0], out[-1]) <= eps:
        out.pop()
    return out


def arc(cx, cy, r, a0, a1, n):
    """n + 1 points on a circle from angle a0 to a1 (radians), in 2D"""
    return [(cx + r * math.cos(a0 + (a1 - a0) * k / n), cy + r * math.sin(a0 + (a1 - a0) * k / n))
            for k in range(n + 1)]


class MeshBuilder:
    def __init__(self):
        self.verts = []
        self.faces = []
        self.mats = []
        self.uvs = []

    # ---- raw ----
    def face(self, pts, mat, uvs):
        pts = [Vector(p) for p in pts]
        # Newell normal: skip degenerate (zero-area) faces
        n = Vector((0.0, 0.0, 0.0))
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            n.x += (a.y - b.y) * (a.z + b.z)
            n.y += (a.z - b.z) * (a.x + b.x)
            n.z += (a.x - b.x) * (a.y + b.y)
        if n.length < 1e-10:
            return
        base = len(self.verts)
        self.verts.extend(pts)
        self.faces.append(tuple(range(base, base + len(pts))))
        self.mats.append(mat)
        self.uvs.append([(float(u), float(v)) for u, v in uvs])

    def extend(self, other):
        for f, m, uv in zip(other.faces, other.mats, other.uvs):
            self.face([other.verts[i] for i in f], m, uv)

    # ---- flat polygons ----
    def planar(self, outer, mat, origin=(0, 0, 0), s_axis=(1, 0, 0), t_axis=(0, 0, 1),
               holes=(), uv=None, flip=False):
        """Flat polygon given in 2D (s, t); 3D point = origin + s*S + t*T, facing S x T
        (whatever the winding of `outer`), or the other way with flip. `holes` are
        inner loops. `uv(s, t)` gives UV0 (default: (s, t), i.e. metres)."""
        O, S, T = Vector(origin), Vector(s_axis), Vector(t_axis)
        uvf = uv or (lambda s, t: (s, t))
        outer = dedupe(list(outer))
        holes = [dedupe(list(h)) for h in holes]

        def to3(p):
            return O + S * p[0] + T * p[1]

        def emit(pts):
            if (_area2(pts) < 0) != flip:
                pts = pts[::-1]
            self.face([to3(p) for p in pts], mat, [uvf(p[0], p[1]) for p in pts])

        if not holes and _convex(outer):
            emit(list(outer))
            return
        loops = [outer] + holes
        flat = [p for loop in loops for p in loop]
        tris = geometry.tessellate_polygon([[Vector((p[0], p[1], 0.0)) for p in loop] for loop in loops])
        for tri in tris:
            pts = [flat[i] for i in tri]
            if abs(_area2(pts)) < 1e-12:
                continue
            emit(pts)

    def wall(self, x0, x1, z0, z1, mat, y=0.0, holes=(), outer=None):
        """facade-plane polygon (facing -Y) at depth y; default outer = rectangle"""
        loop = outer or [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
        self.planar(loop, mat, origin=(0, y, 0), holes=holes)

    # ---- sweeps ----
    def sweep(self, path, profile, mat, N=(0, 0, 1), closed_path=False, closed_profile=False,
              caps=False, cap_polys=None, cap_ends=(True, True), u0=0.0, v_from="arc", uv_fn=None):
        """Sweep a 2D profile along a polyline.

        path     3D points; every segment must be perpendicular to N.
        profile  (a, b) points: a = offset to the right of the walking direction
                 (r = t x N, mitred at bends), b = offset along N. List the profile
                 counterclockwise around the solid in (a, b) so faces point outward.
        mat      material name, or one name per profile segment.
        caps     close the open ends with the profile polygon; `cap_polys` gives
                 other (a, b) polygons for the ends instead (e.g. groove ends);
                 `cap_ends` picks the ends (start, end). A polygon's winding sets
                 which way its cap faces.
        UV0      u = arc length along the path at each profile point's offset
                 (so mitred corners keep their texel density) + u0; v = arc
                 length along the profile, the b coordinate itself with
                 v_from="b", or 0..1 across the profile with v_from="norm".
                 uv_fn(point) -> (u, v) overrides both (caps included).
        """
        N = Vector(N).normalized()
        P = [Vector(p) for p in path]
        n = len(P)
        prof = list(profile) + ([profile[0]] if closed_profile else [])
        segs = n if closed_path else n - 1
        rs = []
        for i in range(segs):
            t = (P[(i + 1) % n] - P[i]).normalized()
            rs.append(t.cross(N).normalized())
        M = []
        for i in range(n):
            if closed_path:
                r0, r1 = rs[i - 1], rs[i % segs]
            else:
                r0 = rs[i - 1] if i > 0 else rs[0]
                r1 = rs[i] if i < segs else rs[-1]
            m = r0 + r1
            if m.length < 1e-9:
                m = r1.copy()
            m.normalize()
            M.append(m / max(m.dot(r1), 1e-6))
        if v_from == "b":
            vs = [p[1] for p in prof]
        else:
            vs = [0.0]
            for j in range(1, len(prof)):
                vs.append(vs[-1] + math.dist(prof[j], prof[j - 1]))
            if v_from == "norm" and vs[-1] > 0:
                vs = [v / vs[-1] for v in vs]
        mats = list(mat) if isinstance(mat, (list, tuple)) else [mat] * (len(prof) - 1)

        def Q(i, j):
            return P[i % n] + M[i % n] * prof[j][0] + N * prof[j][1]

        # u per profile point, measured along its own offset line
        us = []
        for j in range(len(prof)):
            u = [u0]
            for i in range(1, segs + 1):
                u.append(u[-1] + (Q(i, j) - Q(i - 1, j)).length)
            us.append(u)

        for i in range(segs):
            for j in range(len(prof) - 1):
                quad = [Q(i, j), Q(i + 1, j), Q(i + 1, j + 1), Q(i, j + 1)]
                if uv_fn:
                    uvs = [uv_fn(q) for q in quad]
                else:
                    uvs = [(us[j][i], vs[j]), (us[j][i + 1], vs[j]), (us[j + 1][i + 1], vs[j + 1]), (us[j + 1][i], vs[j + 1])]
                self.face(quad, mats[j], uvs)
        if closed_path:
            return
        polys = cap_polys if cap_polys is not None else ([list(profile)] if caps else [])
        for poly in polys:
            if cap_ends[0]:
                self._cap(P[0], M[0], N, poly, mats[0], reverse=False, uv_fn=uv_fn)
            if cap_ends[1]:
                self._cap(P[-1], M[-1], N, poly, mats[0], reverse=True, uv_fn=uv_fn)

    def _cap(self, P0, M0, N, poly, mat, reverse, uv_fn=None):
        """end cap in the plane spanned by M0 (a) and N (b); a counterclockwise
        polygon faces back along the path at the start (reverse: at the end)"""
        poly = dedupe(list(poly))
        want = 1 if _area2(poly) > 0 else -1
        if reverse:
            want = -want
        tris = geometry.tessellate_polygon([[Vector((a, b, 0.0)) for a, b in poly]])
        for tri in tris:
            pts = [poly[i] for i in tri]
            a = _area2(pts)
            if abs(a) < 1e-14:
                continue
            if (a > 0) != (want > 0):
                pts = [pts[0], pts[2], pts[1]]
            corners = [P0 + M0 * p[0] + N * p[1] for p in pts]
            uvs = [uv_fn(c) for c in corners] if uv_fn else [(p[0], p[1]) for p in pts]
            self.face(corners, mat, uvs)

    # ---- solids ----
    def box(self, lo, hi, mat, skip=()):
        """axis-aligned box; `skip` names faces to leave out: -x +x -y +y -z +z"""
        x0, y0, z0 = lo
        x1, y1, z1 = hi
        faces = {
            "-y": ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]),
            "+y": ([(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)], [(-x1, z0), (-x0, z0), (-x0, z1), (-x1, z1)]),
            "-x": ([(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)], [(-y1, z0), (-y0, z0), (-y0, z1), (-y1, z1)]),
            "+x": ([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], [(y0, z0), (y1, z0), (y1, z1), (y0, z1)]),
            "-z": ([(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)], [(x0, -y1), (x1, -y1), (x1, -y0), (x0, -y0)]),
            "+z": ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]),
        }
        for k, (pts, uv) in faces.items():
            if k not in skip:
                self.face(pts, mat, uv)

    def prism(self, poly, depth, mat, y=0.0, back=False):
        """polygon in the facade plane (x, z), extruded from depth y outwards by
        `depth` (towards -Y): front face, side faces, optional back"""
        poly = dedupe(list(poly))
        if _area2(poly) < 0:
            poly.reverse()
        yf = y - depth
        self.planar(poly, mat, origin=(0, yf, 0))
        if back:
            self.planar(poly, mat, origin=(0, y, 0), flip=True)
        u = 0.0
        for i in range(len(poly)):
            (x0, z0), (x1, z1) = poly[i], poly[(i + 1) % len(poly)]
            ln = math.hypot(x1 - x0, z1 - z0)
            self.face([(x0, y, z0), (x1, y, z1), (x1, yf, z1), (x0, yf, z0)], mat,
                      [(u, 0), (u + ln, 0), (u + ln, depth), (u, depth)])
            u += ln

    def bar(self, p0, p1, w, d, mat, N=(0, -1, 0), caps=True):
        """rectangular bar from p0 to p1: width w across, depth d along N"""
        hw, hd = w / 2, d / 2
        self.sweep([p0, p1], [(-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)], mat, N=N,
                   closed_profile=True, caps=caps)
