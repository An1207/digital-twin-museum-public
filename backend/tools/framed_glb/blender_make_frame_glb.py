import os
import sys
from pathlib import Path

import bpy


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def create_material(name, color=None, image_path=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")

    if image_path:
        tex_image = mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex_image.image = bpy.data.images.load(image_path)
        mat.node_tree.links.new(tex_image.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.45
        bsdf.inputs["Metallic"].default_value = 0.0
    else:
        bsdf.inputs["Base Color"].default_value = color or (1.0, 1.0, 1.0, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.55
        bsdf.inputs["Metallic"].default_value = 0.0

    return mat


def create_box(name, location, dimensions, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        obj.data.materials.append(material)
    return obj


def create_artwork_plane(width, height, z_offset, material):
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, z_offset))
    plane = bpy.context.object
    plane.name = "Artwork_Image_Front"
    plane.dimensions = (width, height, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        plane.data.materials.append(material)
    return plane


def remove_camera_and_lights():
    for obj in list(bpy.context.scene.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)


def fit_dimensions_to_long_edge(img_width, img_height, target_long_edge):
    if img_width <= 0 or img_height <= 0:
        raise ValueError(f"Invalid image size: {img_width}x{img_height}")

    if img_width >= img_height:
        artwork_width = target_long_edge
        artwork_height = target_long_edge * (img_height / img_width)
    else:
        artwork_height = target_long_edge
        artwork_width = target_long_edge * (img_width / img_height)

    return artwork_width, artwork_height


def create_frame_from_image(
    image_path,
    output_path,
    artwork_long_edge=2.0,
    frame_thickness=0.12,
    board_depth=0.06,
    frame_depth=0.10,
    image_orientation="landscape",
):
    clear_scene()

    img = bpy.data.images.load(image_path)
    img_width, img_height = img.size
    artwork_width, artwork_height = fit_dimensions_to_long_edge(
        img_width,
        img_height,
        artwork_long_edge,
    )
    total_width = artwork_width + frame_thickness * 2
    total_height = artwork_height + frame_thickness * 2

    artwork_mat = create_material("Artwork_Texture_Material", image_path=image_path)
    frame_mat = create_material(
        "Dark_Wood_Frame_Material",
        color=(0.08, 0.045, 0.025, 1.0),
    )
    back_mat = create_material(
        "Back_Board_Material",
        color=(0.18, 0.16, 0.14, 1.0),
    )

    create_box(
        name="Back_Board",
        location=(0, 0, -board_depth / 2),
        dimensions=(total_width, total_height, board_depth),
        material=back_mat,
    )

    artwork_plane = create_artwork_plane(
        width=artwork_width,
        height=artwork_height,
        z_offset=0.005,
        material=artwork_mat,
    )
    # Blender primitive planes already carry a stable UV layout that matches the
    # image axes. Re-unwrapping here can rotate the UV island and turn a
    # landscape photo sideways inside an otherwise correct frame.

    frame_z = frame_depth / 2 - board_depth
    create_box(
        name="Frame_Top",
        location=(0, artwork_height / 2 + frame_thickness / 2, frame_z),
        dimensions=(total_width, frame_thickness, frame_depth),
        material=frame_mat,
    )
    create_box(
        name="Frame_Bottom",
        location=(0, -artwork_height / 2 - frame_thickness / 2, frame_z),
        dimensions=(total_width, frame_thickness, frame_depth),
        material=frame_mat,
    )
    create_box(
        name="Frame_Left",
        location=(-artwork_width / 2 - frame_thickness / 2, 0, frame_z),
        dimensions=(frame_thickness, total_height, frame_depth),
        material=frame_mat,
    )
    create_box(
        name="Frame_Right",
        location=(artwork_width / 2 + frame_thickness / 2, 0, frame_z),
        dimensions=(frame_thickness, total_height, frame_depth),
        material=frame_mat,
    )

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")

    scene_root = bpy.data.objects.new("FramedArtworkRoot", None)
    bpy.context.scene.collection.objects.link(scene_root)
    for obj in list(bpy.context.scene.objects):
        if obj.name in {"Back_Board", "Artwork_Image_Front", "Frame_Top", "Frame_Bottom", "Frame_Left", "Frame_Right"}:
            obj.parent = scene_root
            obj.matrix_parent_inverse = scene_root.matrix_world.inverted()

    remove_camera_and_lights()

    output_dir = os.path.dirname(output_path)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    result = bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )

    if "FINISHED" not in result:
        raise RuntimeError(f"bpy.ops.export_scene.gltf returned {result} for output: {output_path}")

    if not os.path.exists(output_path):
        raise RuntimeError(f"GLB export reported success but output file was not created: {output_path}")

    print(f"[done] created GLB: {output_path}")
    print(
        "[dimensions] "
        f"image_px={img_width}x{img_height} "
        f"orientation={image_orientation} "
        f"artwork={artwork_width:.4f}x{artwork_height:.4f} "
        f"outer={total_width:.4f}x{total_height:.4f}"
    )


def parse_args(args):
    if len(args) < 2:
        raise ValueError(
            "Usage: blender --background --python backend/tools/framed_glb/blender_make_frame_glb.py -- "
            "<input_image> <output_glb> [artwork_long_edge] [frame_thickness] [board_depth] [frame_depth] [image_orientation]"
        )

    input_image = Path(args[0]).resolve()
    output_glb = Path(args[1]).resolve()
    artwork_long_edge = float(args[2]) if len(args) > 2 else 2.0
    frame_thickness = float(args[3]) if len(args) > 3 else 0.12
    board_depth = float(args[4]) if len(args) > 4 else 0.06
    frame_depth = float(args[5]) if len(args) > 5 else 0.10
    image_orientation = args[6] if len(args) > 6 else "landscape"

    return {
        "input_image": input_image,
        "output_glb": output_glb,
        "artwork_long_edge": artwork_long_edge,
        "frame_thickness": frame_thickness,
        "board_depth": board_depth,
        "frame_depth": frame_depth,
        "image_orientation": image_orientation,
    }


def main():
    if "--" not in sys.argv:
        raise ValueError("Missing '--' separator for Blender script arguments.")

    config = parse_args(sys.argv[sys.argv.index("--") + 1 :])
    if not config["input_image"].exists():
        raise FileNotFoundError(f"Input image not found: {config['input_image']}")

    mcp_port = os.getenv("BLENDER_MCP_PORT")
    if mcp_port:
        print(f"[info] BLENDER_MCP_PORT={mcp_port}")

    create_frame_from_image(
        image_path=str(config["input_image"]),
        output_path=str(config["output_glb"]),
        artwork_long_edge=config["artwork_long_edge"],
        frame_thickness=config["frame_thickness"],
        board_depth=config["board_depth"],
        frame_depth=config["frame_depth"],
        image_orientation=config["image_orientation"],
    )


if __name__ == "__main__":
    main()
