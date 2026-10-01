"""Kit materials (KIT_SPEC.md §6.2). The web app rebuilds every material by name,
so in Blender these are flat placeholders: the colours only serve the previews."""
import bpy

# name: (linear base colour, roughness, metallic)
COLORS = {
    "stone": ((0.62, 0.55, 0.43), 0.85, 0.0),
    "stone_ground": ((0.55, 0.49, 0.38), 0.9, 0.0),
    "stone_trim": ((0.70, 0.64, 0.52), 0.8, 0.0),
    "zinc": ((0.20, 0.23, 0.26), 0.5, 0.4),
    "iron": ((0.02, 0.02, 0.022), 0.5, 0.6),
    "iron_lace": ((0.02, 0.02, 0.022), 0.5, 0.6),
    "frame": ((0.75, 0.73, 0.66), 0.6, 0.0),
    "paint": ((0.03, 0.10, 0.07), 0.45, 0.0),
    "shutter": ((0.45, 0.45, 0.42), 0.5, 0.0),
    "plaster": ((0.50, 0.48, 0.44), 0.9, 0.0),
    "terracotta": ((0.45, 0.17, 0.08), 0.85, 0.0),
    "fabric": ((0.40, 0.06, 0.05), 0.9, 0.0),
    "glass": ((0.03, 0.045, 0.06), 0.05, 0.5),
}


def get(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    col, rough, metal = COLORS[name]
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*col, 1.0)  # viewport / Workbench colour
    m.roughness = rough
    m.metallic = metal
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m.node_tree else None
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*col, 1.0)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
    return m
