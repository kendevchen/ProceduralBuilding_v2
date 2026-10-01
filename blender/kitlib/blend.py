"""bpy glue: MeshBuilder -> mesh object, bounds checks, the shared UV1 layout."""
import math

import bmesh
import bpy


def to_object(mb, name, collection, get_material, smooth_angle=30.0):
    """Create a mesh object from a MeshBuilder: material slots in first-use order,
    UV0 from the builder, coincident vertices welded, smooth shading split at
    edges sharper than `smooth_angle` degrees."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in mb.verts], [], mb.faces)
    order = []
    for m in mb.mats:
        if m not in order:
            order.append(m)
    for m in order:
        me.materials.append(get_material(m))
    index = {m: i for i, m in enumerate(order)}
    me.polygons.foreach_set("material_index", [index[m] for m in mb.mats])
    uv = me.uv_layers.new(name="UV0")
    uv.data.foreach_set("uv", [c for f in mb.uvs for corner in f for c in corner])
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(smooth_angle))
    me.update()
    ob = bpy.data.objects.new(name, me)
    collection.objects.link(ob)
    return ob


def bounds(ob):
    vs = [v.co for v in ob.data.vertices]
    lo = tuple(min(v[i] for v in vs) for i in range(3))
    hi = tuple(max(v[i] for v in vs) for i in range(3))
    return lo, hi


def check(ob, spec, tol=1e-4):
    """'x' / 'z': exact extents; 'within': ((x0, x1), (y0, y1), (z0, z1)) limits"""
    lo, hi = bounds(ob)
    errs = []
    for key, axis in (("x", 0), ("z", 2)):
        if key in spec:
            a, b = spec[key]
            if abs(lo[axis] - a) > tol or abs(hi[axis] - b) > tol:
                errs.append(f"{key} extent {lo[axis]:.4f}..{hi[axis]:.4f}, expected {a}..{b}")
    for axis, (a, b) in enumerate(spec.get("within", ())):
        if lo[axis] < a - tol or hi[axis] > b + tol:
            errs.append(f"{'xyz'[axis]} {lo[axis]:.4f}..{hi[axis]:.4f} outside {a}..{b}")
    if errs:
        raise RuntimeError(f"{ob.name}: " + "; ".join(errs))
    return lo, hi


def triangles(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def build_uv1(objs, margin=0.002):
    """UV1: every module unwrapped without overlaps and packed together into one
    0..1 square, the layout of the kit's AO atlas (KIT_SPEC.md §6.3)"""
    for o in objs:
        uvs = o.data.uv_layers
        uvs.active = uvs.new(name="UV1")
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(o in objs)
    vl.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")
    for o in objs:
        uvs = o.data.uv_layers
        uvs.active = uvs["UV0"]
        uvs["UV0"].active_render = True
        o.select_set(False)
