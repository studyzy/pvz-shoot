# 把 aigc/僵尸博士.fbx 转成 public/models/zombie-doctor.glb
# 用法（需要 Blender 4.2 的 bpy）：
#   LD_LIBRARY_PATH=<libSM/libICE 目录> python3 tools/build-boss-model.py <in.fbx> <out.glb>
#
# 规格与决策见 docs/ZOMBIE-MODELS.md「僵尸博士」一节。要点：
# - 源 FBX 42.9 MB / 50,034 面 / 28 骨骼（Mixamo 命名）/ 0 段动画 / 4×4096² 贴图
# - 抽面到 12,000（Blender Decimate，保留顶点组与 UV；gltf-transform simplify 会毁蒙皮，别换）
# - 贴图：baseColor → 1024 JPEG，normal → 512 PNG，metallic/roughness 丢掉改常量
# - armature 对象带 0.01 缩放（FBX 厘米单位）：不 apply 会让 three.js 里蒙皮塌缩
# - 模型朝 -Y（FBX 常见），这里转到 +Z，与游戏其余模型一致
import bpy, sys, os
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
SRC, OUT = argv[0], argv[1]
TARGET_TRIS = 12000

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC, use_anim=True, global_scale=1.0)

mesh = [o for o in bpy.data.objects if o.type == 'MESH'][0]
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]

# 1) 把 0.01 缩放烘进骨骼与网格（three.js 里蒙皮才不会塌缩）
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = mesh
mesh.select_set(True)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
# 重新挂回骨骼（只留 Armature modifier 的父子关系）
mesh.parent = arm
mesh.matrix_parent_inverse = arm.matrix_world.inverted()
if not any(m.type == 'ARMATURE' for m in mesh.modifiers):
    mod = mesh.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm

# 2) 抽面（保留顶点组 + UV）
mesh.data.calc_loop_triangles()
before = len(mesh.data.loop_triangles)
dec = mesh.modifiers.new('Decimate', 'DECIMATE')
dec.decimate_type = 'COLLAPSE'
dec.ratio = TARGET_TRIS / before
dec.use_collapse_triangulate = True
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.modifier_apply(modifier=dec.name)
mesh.data.calc_loop_triangles()
print('DECIMATE', before, '->', len(mesh.data.loop_triangles))

# 3) 贴图：baseColor 1024 PNG、normal 512 PNG，其余（roughness/metallic）丢掉改常量。
#    baseColor 用 PNG 不用 JPEG：导出后 gltf-transform 会把它转 WebP，PNG 的无损源不会多一层色阶损失
def shrink(img, size, fmt, filepath):
    img.scale(size, size)
    img.file_format = fmt
    img.filepath_raw = filepath
    img.save()
    return bpy.data.images.load(filepath)

base_dir = OUT + '.tex'
os.makedirs(base_dir, exist_ok=True)
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    nodes = mat.node_tree.nodes
    bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        continue
    for sock_name, size, fmt, ext in (('Base Color', 1024, 'PNG', '.png'), ('Normal', 512, 'PNG', '.png')):
        sock = bsdf.inputs.get(sock_name)
        if not sock or not sock.is_linked:
            continue
        tex = sock.links[0].from_node
        if tex.type != 'TEX_IMAGE' or not tex.image:
            continue
        out = os.path.join(base_dir, sock_name.replace(' ', '_').lower() + ext)
        new_img = shrink(tex.image.copy(), size, fmt, out)
        tex.image = new_img
    # metallic/roughness 常量
    for link in list(bsdf.inputs['Metallic'].links):
        mat.node_tree.links.remove(link)
    for link in list(bsdf.inputs['Roughness'].links):
        mat.node_tree.links.remove(link)
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 0.72
    mat.blend_method = 'OPAQUE'

# 4) 朝 +Z：FBX 进来是 -Y 朝前，绕 Z 转 180°
rot = Matrix.Rotation(3.141592653589793, 4, 'Z')
for obj in (mesh, arm):
    obj.matrix_world = rot @ obj.matrix_world
for obj in (mesh, arm):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    obj.select_set(False)

# 5) 导出：只保留骨骼与网格，不带动画
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    use_selection=True,
    export_yup=True,
    export_animations=False,
    export_skins=True,
    export_apply=False,
    export_image_format='AUTO',
    export_materials='EXPORT',
    export_texcoords=True,
    export_normals=True,
)
print('WROTE', OUT, os.path.getsize(OUT) / 1024 / 1024, 'MB')