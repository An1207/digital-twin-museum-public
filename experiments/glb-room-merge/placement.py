from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ModelPlacement:
    key: str
    filename: str
    position: tuple[float, float, float]
    rotation: tuple[float, float, float]


@dataclass(frozen=True)
class RelaxSettings:
    wall_normal_threshold: float
    laplacian_repeat: int
    laplacian_lambda_factor: float
    laplacian_lambda_border: float
    preserve_volume: bool
    use_x: bool
    use_y: bool
    use_z: bool


REPO_ROOT = Path(__file__).resolve().parents[2]
EXPERIMENT_ROOT = Path(__file__).resolve().parent
WORKSPACE_ROOT = EXPERIMENT_ROOT / "workspace"
SOURCE_DIR = WORKSPACE_ROOT / "source"
PUBLIC_EXPERIMENT_DIR = REPO_ROOT / "frontend" / "public" / "experiments" / "glb-room-merge"
PUBLIC_OUTPUT_PATH = PUBLIC_EXPERIMENT_DIR / "room_merge.glb"
SOURCE_MODEL_DIR = REPO_ROOT / "frontend" / "public" / "models"
RELAX_SETTINGS = RelaxSettings(
    wall_normal_threshold=0.45,
    laplacian_repeat=4,
    laplacian_lambda_factor=0.35,
    laplacian_lambda_border=0.55,
    preserve_volume=True,
    use_x=True,
    use_y=True,
    use_z=True,
)

MODEL_PLACEMENTS: tuple[ModelPlacement, ...] = (
    ModelPlacement(
        key="room1",
        filename="room1.glb",
        position=(5.0, 0.0, 12.2),
        rotation=(0.0, 1.5707963267948966, 0.0),
    ),
    ModelPlacement(
        key="room2",
        filename="room2.glb",
        position=(5.0, 0.0, 3.3),
        rotation=(0.0, 3.141592653589793, 0.0),
    ),
    ModelPlacement(
        key="room3",
        filename="room3.glb",
        position=(5.0, 0.0, -7.3),
        rotation=(0.0, -1.5707963267948966, 0.0),
    ),
    ModelPlacement(
        key="center",
        filename="center.glb",
        position=(13.5, 0.0, 6.3),
        rotation=(0.0, 0.0, 0.0),
    ),
)
