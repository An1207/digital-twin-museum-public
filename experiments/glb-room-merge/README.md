# GLB Room Merge Experiment

This branch-scoped experiment copies the current split museum room assets and exposes them in a browser-based assembly viewer so the room positions can be adjusted directly with the mouse.

## Inputs

- `frontend/public/models/room1.glb`
- `frontend/public/models/room2.glb`
- `frontend/public/models/room3.glb`
- `frontend/public/models/center.glb`

## Outputs

- Copied working inputs: `experiments/glb-room-merge/workspace/source/`
- Exported merged GLB: `frontend/public/experiments/glb-room-merge/room_merge.glb`
- Viewer route: `#/debug/glb-room-merge-experiment`
- In-viewer coordinate inspector with `Reset all` and `Copy positions`

## Run

```bash
backend/.venv/bin/python experiments/glb-room-merge/run_merge.py --force --emit-stdout
```

## Notes

- The experiment uses copied source GLBs so the production assets under `frontend/public/models/` stay untouched.
- The viewer starts from the current web placement values and lets you drag each room independently with the transform gizmo.
- The merged GLB export remains available as an experiment artifact, but the browser page is now the primary place to tune the positions.
- Blender relax smoothing runs on the copied wall surfaces before export, using only the experiment workspace copies.
