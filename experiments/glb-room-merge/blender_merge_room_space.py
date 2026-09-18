from __future__ import annotations

import builtins
import bmesh
import logging
import os
import sys
from pathlib import Path

import bpy
from mathutils import Euler

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from placement import MODEL_PLACEMENTS, RELAX_SETTINGS


JOIN_SEAM_DISTANCE = 0.0001
STDOUT_EXPORT_PATH = Path("/tmp/glb-room-merge-export.glb")


class _StdoutBinarySink:
    def __init__(self, buffer):
        self._buffer = buffer

    def write(self, data):
        return self._buffer.write(data)

    def flush(self):
        return self._buffer.flush()

    def close(self):
        return None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def _silence_text_logs() -> tuple[object, object, object]:
    devnull = open(os.devnull, "w")
    original_stdout = sys.stdout
    original_stderr = sys.stderr
    sys.stdout = devnull
    sys.stderr = devnull
    for handler in logging.getLogger().handlers:
        if hasattr(handler, "stream"):
            handler.stream = devnull
    return original_stdout, original_stderr, devnull


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def import_model(filepath: Path) -> set[str]:
    before_names = {obj.name for obj in bpy.context.scene.objects}
    bpy.ops.import_scene.gltf(filepath=str(filepath))
    return {obj.name for obj in bpy.context.scene.objects if obj.name not in before_names}


def attach_asset_root(asset_key: str, imported_names: set[str], position: tuple[float, float, float], rotation: tuple[float, float, float]) -> None:
    root = bpy.data.objects.new(f"{asset_key}_root", None)
    bpy.context.scene.collection.objects.link(root)
    root.location = position
    root.rotation_euler = Euler(rotation, "XYZ")

    imported_objects = [
        obj
        for obj in bpy.context.scene.objects
        if obj.name in imported_names and (obj.parent is None or obj.parent.name not in imported_names)
    ]
    for obj in imported_objects:
        obj.parent = root
        obj.matrix_parent_inverse = root.matrix_world.inverted()


def relax_wall_surface(mesh_object: bpy.types.Object) -> None:
    mesh = mesh_object.data
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bm.normal_update()

        wall_faces = [face for face in bm.faces if abs(face.normal.z) <= RELAX_SETTINGS.wall_normal_threshold]
        if wall_faces:
            target_verts = {vert for face in wall_faces for vert in face.verts}
        else:
            target_verts = set(bm.verts)

        if target_verts:
            bmesh.ops.smooth_laplacian_vert(
                bm,
                verts=list(target_verts),
                lambda_factor=RELAX_SETTINGS.laplacian_lambda_factor,
                lambda_border=RELAX_SETTINGS.laplacian_lambda_border,
                use_x=RELAX_SETTINGS.use_x,
                use_y=RELAX_SETTINGS.use_y,
                use_z=RELAX_SETTINGS.use_z,
                preserve_volume=RELAX_SETTINGS.preserve_volume,
            )
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.to_mesh(mesh)
            mesh.update()
    finally:
        bm.free()


def merge_scene_meshes() -> bpy.types.Object:
    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not mesh_objects:
        raise RuntimeError("No mesh objects were imported.")

    for obj in mesh_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_objects[0]
    bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def cleanup_scene(joined_object: bpy.types.Object) -> None:
    mesh = joined_object.data
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=JOIN_SEAM_DISTANCE)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
    finally:
        bm.free()

    for obj in list(bpy.context.scene.objects):
        if obj.name != joined_object.name and obj.type != "MESH":
            bpy.data.objects.remove(obj, do_unlink=True)


def export_glb(output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    result = bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        check_existing=False,
        export_format="GLB",
        use_selection=True,
        use_visible=False,
        use_renderable=False,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_apply=True,
    )
    if result != {"FINISHED"}:
        raise RuntimeError(f"glTF export failed: {result}")
    if not output_path.exists():
        raise FileNotFoundError(f"glTF export reported success but file was not created: {output_path}")


def export_glb_to_stdout(original_stdout) -> None:
    original_open = builtins.open
    try:
        stdout_buffer = original_stdout.buffer

        def intercepted_open(path, *args, **kwargs):
            if Path(path) == STDOUT_EXPORT_PATH:
                return _StdoutBinarySink(stdout_buffer)
            return original_open(path, *args, **kwargs)

        builtins.open = intercepted_open
        result = bpy.ops.export_scene.gltf(
            filepath=str(STDOUT_EXPORT_PATH),
            check_existing=False,
            export_format="GLB",
            use_selection=True,
            use_visible=False,
            use_renderable=False,
            export_texcoords=True,
            export_normals=True,
            export_materials="EXPORT",
            export_image_format="AUTO",
            export_apply=True,
        )
        if result != {"FINISHED"}:
            raise RuntimeError(f"glTF export failed: {result}")
    finally:
        builtins.open = original_open


def main() -> None:
    if "--" not in sys.argv:
        raise ValueError("Missing '--' separator for Blender script arguments.")

    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) < 2:
        raise ValueError("Expected source_dir and output_path after '--'.")

    source_dir = Path(args[0]).resolve()
    output_path = Path(args[1]).resolve()
    emit_stdout = "--emit-stdout" in args

    original_stdout = original_stderr = devnull = None
    if emit_stdout:
        original_stdout, original_stderr, devnull = _silence_text_logs()

    try:
        clear_scene()

        for placement in MODEL_PLACEMENTS:
            source_path = source_dir / placement.filename
            if not source_path.exists():
                raise FileNotFoundError(f"Missing copied source GLB: {source_path}")
            imported_names = import_model(source_path)
            for obj in [
                obj
                for obj in bpy.context.scene.objects
                if obj.name in imported_names and obj.type == "MESH"
            ]:
                relax_wall_surface(obj)
            attach_asset_root(placement.key, imported_names, placement.position, placement.rotation)

        joined_object = merge_scene_meshes()
        cleanup_scene(joined_object)
        if emit_stdout:
            export_glb_to_stdout(original_stdout)
        else:
            export_glb(output_path)
            print(f"[done] exported {output_path}")
    finally:
        if emit_stdout and original_stdout is not None and original_stderr is not None and devnull is not None:
            sys.stdout = original_stdout
            sys.stderr = original_stderr
            devnull.close()


if __name__ == "__main__":
    main()
