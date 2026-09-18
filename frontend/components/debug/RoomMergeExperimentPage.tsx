import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, TransformControls, useGLTF } from '@react-three/drei';
import { Group, Mesh, Quaternion, Vector3, type Object3D } from 'three';
import { apiService } from '../../lib/api';
import {
  cacheRoomMergePreset,
  readCachedRoomMergePreset,
} from '../../lib/roomMergePresetCache';
import { isArrowNavigationCode, shouldIgnoreKeyboardNavigation } from '../../lib/navigationKeyboard';
import type {
  ArtworkSlot,
  CuratorSpaceDetail,
  CuratorSpaceFile,
  CuratorSpaceSummary,
  RoomMergeAssemblySnapshot,
  RoomMergeExperimentSnapshotResponse,
  RoomMergePresetResponse,
  SpaceVector3,
} from '../../types/curation';
import type { MutableRefObject } from 'react';

type AssemblyPieceConfig = {
  key: string;
  label: string;
  path: string;
  entityTypeId: 1;
  position: [number, number, number];
  rotation: [number, number, number];
};

type TransformSnapshot = Record<
  string,
  {
    position: [number, number, number];
    rotation: [number, number, number];
  }
>;

type AxisKey = 'x' | 'y' | 'z';
type LockedAxesState = Record<AxisKey, boolean>;
type EditKind = 'position' | 'rotation' | 'transform';
type EditingTargetMode = 'artwork-slots' | 'artwork-space';
type HistorySession = {
  kind: EditKind;
  before: RoomMergeAssemblySnapshot;
} | null;
type RoomMergeComparisonTarget = RoomMergeExperimentSnapshotResponse | RoomMergePresetResponse | null;
type SlotTransformMode = 'translate' | 'rotate';
type SlotDraft = {
  entityTypeId: 2;
  slotKey: string;
  name: string;
  sizePreset: 'small' | 'medium' | 'large';
  width: number;
  height: number;
  depth: number;
  position: SpaceVector3;
  rotation: SpaceVector3;
  status: string;
  sortOrder: number;
  artworkId: number | null;
};

const ARTWORK_SLOT_SIZE_PRESET_DIMENSIONS: Record<SlotDraft['sizePreset'], [number, number, number]> = {
  small: [1.2, 0.9, 0.12],
  medium: [1.6, 1.2, 0.14],
  large: [2.0, 1.5, 0.16],
};

const CAMERA_POSITION: [number, number, number] = [17, 13, 20];
const CAMERA_TARGET: [number, number, number] = [7, 0, 4];
const INITIAL_GRID_Y = -0.02;
const EXPERIMENT_KEY = 'glb-room-merge-experiment';
const WORLD_UP = new Vector3(0, 1, 0);
const EMPTY_ASSEMBLY_PIECES: AssemblyPieceConfig[] = [];
const EDITING_TARGET_LABELS: Record<EditingTargetMode, string> = {
  'artwork-slots': 'Slot editor window',
  'artwork-space': 'Space editor window',
};

const EDITOR_PANEL_WIDTH_CLASS = 'w-[20rem] max-w-[calc(100vw-2.5rem)]';
const EDITOR_SELECTOR_WIDTH_CLASS = 'w-[10rem] max-w-[calc(100vw-2.5rem)]';

const DEFAULT_ASSEMBLY_POSITIONS: Array<[number, number, number]> = [
  [5.0, 0.0, 12.2],
  [5.0, 0.0, 3.3],
  [5.0, 0.0, -7.3],
  [13.5, 0.0, 6.3],
  [15.5, 0.0, -2.5],
];

const DEFAULT_ASSEMBLY_ROTATIONS: Array<[number, number, number]> = [
  [0.0, Math.PI / 2, 0.0],
  [0.0, Math.PI, 0.0],
  [0.0, -Math.PI / 2, 0.0],
  [0.0, 0.0, 0.0],
  [0.0, Math.PI / 4, 0.0],
];

const buildAssemblyPiecesFromFiles = (files: CuratorSpaceFile[]): AssemblyPieceConfig[] => {
  return files.slice(0, 5).map((file, index) => ({
    key: `file-${file.id}`,
    label: file.originalFileName,
    path: file.fileUrl,
    entityTypeId: 1,
    position: DEFAULT_ASSEMBLY_POSITIONS[index] ?? [index * 2.4, 0.0, 0.0],
    rotation: DEFAULT_ASSEMBLY_ROTATIONS[index] ?? [0.0, 0.0, 0.0],
  }));
};

const parseExperimentRoute = () => {
  const [, queryString = ''] = window.location.hash.split('?');
  const params = new URLSearchParams(queryString);
  const parseId = (value: string | null) => {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    spaceId: parseId(params.get('spaceId')),
    presetId: parseId(params.get('presetId')),
  };
};

const buildExperimentHash = (context: { spaceId?: number | null; presetId?: number | null }) => {
  const params = new URLSearchParams();

  if (context.spaceId != null) {
    params.set('spaceId', String(context.spaceId));
  }

  if (context.presetId != null) {
    params.set('presetId', String(context.presetId));
  }

  const query = params.toString();
  return query ? `#/experiment?${query}` : '#/experiment';
};

const Loader = () => (
  <Html center>
    <div className="rounded-xl border border-white/10 bg-black/75 px-4 py-3 text-sm text-stone-200 shadow-2xl backdrop-blur">
      Room assembly loading...
    </div>
  </Html>
);

class ErrorBoundary extends Component<
  { assetLabel: string; children: ReactNode },
  { hasError: boolean; message: string | null }
> {
  state = {
    hasError: false,
    message: null as string | null,
  };

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || 'Room assembly preview failed to load.',
    };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {}

  componentDidUpdate(prevProps: Readonly<{ assetLabel: string; children: ReactNode }>) {
    if (prevProps.assetLabel !== this.props.assetLabel && this.state.hasError) {
      this.setState({ hasError: false, message: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center rounded-2xl border border-red-400/20 bg-red-500/10 p-6 text-sm text-red-100">
          {this.state.message}
        </div>
      );
    }

    return this.props.children;
  }
}

const CameraRig = () => {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(CAMERA_POSITION[0], CAMERA_POSITION[1], CAMERA_POSITION[2]);
    camera.lookAt(CAMERA_TARGET[0], CAMERA_TARGET[1], CAMERA_TARGET[2]);
    camera.updateProjectionMatrix();
  }, [camera]);

  return null;
};

const CameraKeyboardPan = ({
  enabled,
  orbitControlsRef,
}: {
  enabled: boolean;
  orbitControlsRef: MutableRefObject<any>;
}) => {
  const { camera } = useThree();
  const panState = useRef({
    up: false,
    down: false,
    left: false,
    right: false,
  });
  const panDirection = useRef(new Vector3());
  const panForward = useRef(new Vector3());
  const panRight = useRef(new Vector3());
  const panOffset = useRef(new Vector3());

  useEffect(() => {
    if (!enabled) {
      panState.current = {
        up: false,
        down: false,
        left: false,
        right: false,
      };
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isArrowNavigationCode(event.code) || shouldIgnoreKeyboardNavigation(event)) {
        return;
      }

      event.preventDefault();
      switch (event.code) {
        case 'ArrowUp':
          panState.current.up = true;
          break;
        case 'ArrowDown':
          panState.current.down = true;
          break;
        case 'ArrowLeft':
          panState.current.left = true;
          break;
        case 'ArrowRight':
          panState.current.right = true;
          break;
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!isArrowNavigationCode(event.code)) {
        return;
      }

      switch (event.code) {
        case 'ArrowUp':
          panState.current.up = false;
          break;
        case 'ArrowDown':
          panState.current.down = false;
          break;
        case 'ArrowLeft':
          panState.current.left = false;
          break;
        case 'ArrowRight':
          panState.current.right = false;
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [enabled]);

  useFrame((_, delta) => {
    if (!enabled) {
      return;
    }

    const controls = orbitControlsRef.current;
    if (!controls) {
      return;
    }

    const { up, down, left, right } = panState.current;
    if (!up && !down && !left && !right) {
      return;
    }

    const panSpeed = 10;
    camera.getWorldDirection(panForward.current);
    panForward.current.y = 0;
    panForward.current.normalize();
    panRight.current.crossVectors(panForward.current, WORLD_UP).normalize();

    panOffset.current.set(0, 0, 0);
    if (left) {
      panOffset.current.addScaledVector(panRight.current, -panSpeed * delta);
    }
    if (right) {
      panOffset.current.addScaledVector(panRight.current, panSpeed * delta);
    }
    if (up) {
      panOffset.current.y += panSpeed * delta;
    }
    if (down) {
      panOffset.current.y -= panSpeed * delta;
    }

    panDirection.current.copy(panOffset.current);
    camera.position.add(panDirection.current);
    if (typeof controls.target?.add === 'function') {
      controls.target.add(panDirection.current);
    }
    if (typeof controls.update === 'function') {
      controls.update();
    }
  });

  return null;
};

type CameraLockSnapshot = {
  position: Vector3;
  quaternion: Quaternion;
  target: Vector3;
  zoom: number;
};

const CameraTransformLock = ({
  active,
  orbitControlsRef,
}: {
  active: boolean;
  orbitControlsRef: MutableRefObject<any>;
}) => {
  const { camera } = useThree();
  const snapshotRef = useRef<CameraLockSnapshot | null>(null);

  useEffect(() => {
    if (!active) {
      snapshotRef.current = null;
      return;
    }

    const controls = orbitControlsRef.current;
    snapshotRef.current = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      target: controls?.target?.clone?.() ?? new Vector3(),
      zoom: camera.zoom,
    };

    if (controls) {
      controls.enabled = false;
    }
  }, [active, camera, orbitControlsRef]);

  useFrame(() => {
    if (!active || !snapshotRef.current) {
      return;
    }

    const controls = orbitControlsRef.current;
    camera.position.copy(snapshotRef.current.position);
    camera.quaternion.copy(snapshotRef.current.quaternion);
    camera.zoom = snapshotRef.current.zoom;
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    if (controls?.target?.copy) {
      controls.target.copy(snapshotRef.current.target);
    }
    if (controls) {
      controls.enabled = false;
      if (typeof controls.update === 'function') {
        controls.update();
      }
    }
  });

  return null;
};

const isAssemblyPieceKey = (key: string | null, pieces: AssemblyPieceConfig[]): key is string => {
  return key !== null && pieces.some((piece) => piece.key === key);
};

const formatCoordinate = (value: number) => value.toFixed(2);

const formatDelta = (value: number) => {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
};

const formatTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const emptySpaceVector = (x = 0, y = 0, z = 0): SpaceVector3 => ({ x, y, z });

const createSlotDraft = (index: number, spaceId?: number): SlotDraft => ({
  entityTypeId: 2,
  slotKey: `slot-${spaceId ?? 'draft'}-${index + 1}`,
  name: `Artwork Slot ${index + 1}`,
  sizePreset: 'medium',
  width: ARTWORK_SLOT_SIZE_PRESET_DIMENSIONS.medium[0],
  height: ARTWORK_SLOT_SIZE_PRESET_DIMENSIONS.medium[1],
  depth: ARTWORK_SLOT_SIZE_PRESET_DIMENSIONS.medium[2],
  position: emptySpaceVector(index * 1.8, 1.4, 0),
  rotation: emptySpaceVector(),
  status: 'draft',
  sortOrder: index,
  artworkId: null,
});

const normalizeSlotDraft = (slot: ArtworkSlot): SlotDraft => ({
  entityTypeId: 2,
  slotKey: slot.slotKey,
  name: slot.name,
  sizePreset: slot.sizePreset === 'small' || slot.sizePreset === 'large' ? slot.sizePreset : 'medium',
  width: slot.width,
  height: slot.height,
  depth: slot.depth,
  position: {
    x: slot.position.x,
    y: slot.position.y,
    z: slot.position.z,
  },
  rotation: {
    x: slot.rotation.x,
    y: slot.rotation.y,
    z: slot.rotation.z,
  },
  status: slot.status,
  sortOrder: slot.sortOrder,
  artworkId: slot.artworkId ?? null,
});

const slotDraftToRequest = (slot: SlotDraft) => ({
  slotKey: slot.slotKey,
  name: slot.name,
  sizePreset: slot.sizePreset,
  width: slot.width,
  height: slot.height,
  depth: slot.depth,
  position: slot.position,
  rotation: slot.rotation,
  status: slot.status,
  sortOrder: slot.sortOrder,
  artworkId: slot.artworkId,
});

const formatVector = (vector: SpaceVector3) => `${formatCoordinate(vector.x)} / ${formatCoordinate(vector.y)} / ${formatCoordinate(vector.z)}`;

const NumberField = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) => (
  <label className="space-y-1">
    <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500">{label}</div>
    <input
      type="number"
      step="0.01"
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="w-full rounded-2xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-stone-100 outline-none transition focus:border-fuchsia-300/40"
    />
  </label>
);

const emptyAssemblySnapshot = (pieces: AssemblyPieceConfig[]): RoomMergeAssemblySnapshot => ({
  selectedKey: pieces[0]?.key ?? null,
  pieces: pieces.reduce<RoomMergeAssemblySnapshot['pieces']>((accumulator, config) => {
    accumulator[config.key] = {
      position: config.position,
      rotation: config.rotation,
    };
    return accumulator;
  }, {}),
});

const cloneAssemblySnapshot = (
  snapshot: RoomMergeAssemblySnapshot,
  pieces: AssemblyPieceConfig[],
): RoomMergeAssemblySnapshot => ({
  selectedKey: snapshot.selectedKey,
  pieces: pieces.reduce<RoomMergeAssemblySnapshot['pieces']>((accumulator, config) => {
    const entry = snapshot.pieces[config.key] ?? {
      position: config.position,
      rotation: config.rotation,
    };
    accumulator[config.key] = {
      position: [...entry.position] as [number, number, number],
      rotation: [...entry.rotation] as [number, number, number],
    };
    return accumulator;
  }, {}),
});

const normalizeAssemblySnapshot = (
  snapshot: RoomMergeAssemblySnapshot,
  pieces: AssemblyPieceConfig[],
): RoomMergeAssemblySnapshot => {
  return {
    selectedKey: snapshot.selectedKey,
    pieces: pieces.reduce<RoomMergeAssemblySnapshot['pieces']>((accumulator, config) => {
      const entry = snapshot.pieces[config.key];
      accumulator[config.key] = {
        position: entry ? [...entry.position] as [number, number, number] : config.position,
        rotation: entry ? [...entry.rotation] as [number, number, number] : config.rotation,
      };
      return accumulator;
    }, {}),
  };
};

const snapshotsEqual = (left: RoomMergeAssemblySnapshot, right: RoomMergeAssemblySnapshot) => {
  return JSON.stringify(left) === JSON.stringify(right);
};

type SnapshotDiffItem = {
  key: string;
  label: string;
  positionDelta: [number, number, number];
  rotationDelta: [number, number, number];
};

const buildSnapshotDiff = (
  current: RoomMergeAssemblySnapshot,
  baseline: RoomMergeAssemblySnapshot,
  pieces: AssemblyPieceConfig[],
) => {
  return pieces.flatMap((config): SnapshotDiffItem[] => {
    const currentEntry = current.pieces[config.key] ?? {
      position: config.position,
      rotation: config.rotation,
    };
    const baselineEntry = baseline.pieces[config.key] ?? {
      position: config.position,
      rotation: config.rotation,
    };

    const positionDelta: [number, number, number] = [
      currentEntry.position[0] - baselineEntry.position[0],
      currentEntry.position[1] - baselineEntry.position[1],
      currentEntry.position[2] - baselineEntry.position[2],
    ];
    const rotationDelta: [number, number, number] = [
      currentEntry.rotation[0] - baselineEntry.rotation[0],
      currentEntry.rotation[1] - baselineEntry.rotation[1],
      currentEntry.rotation[2] - baselineEntry.rotation[2],
    ];

    const hasPositionDelta = positionDelta.some((value) => Math.abs(value) > 0.0001);
    const hasRotationDelta = rotationDelta.some((value) => Math.abs(value) > 0.0001);

    if (!hasPositionDelta && !hasRotationDelta) {
      return [];
    }

    return [
      {
        key: config.key,
        label: config.label,
        positionDelta,
        rotationDelta,
      },
    ];
  });
};

const buildSnapshotFromObjects = (
  objectRefs: MutableRefObject<Record<string, Group | null>>,
  pieces: AssemblyPieceConfig[],
) => {
  return pieces.reduce<TransformSnapshot>((accumulator, config) => {
    const object = objectRefs.current[config.key];
    const position = object?.position ?? null;
    const rotation = object?.rotation ?? null;

    accumulator[config.key] = {
      position: position
        ? [position.x, position.y, position.z]
        : config.position,
      rotation: rotation
        ? [rotation.x, rotation.y, rotation.z]
        : config.rotation,
    };
    return accumulator;
  }, {});
};

const applySnapshotToObjects = (
  objectRefs: MutableRefObject<Record<string, Group | null>>,
  snapshot: RoomMergeAssemblySnapshot,
  pieces: AssemblyPieceConfig[],
) => {
  const snapshotPieces = snapshot.pieces;

  pieces.forEach((config) => {
    const object = objectRefs.current[config.key];
    const entry = snapshotPieces[config.key];
    if (!object || !entry) return;

    object.position.set(entry.position[0], entry.position[1], entry.position[2]);
    object.rotation.set(entry.rotation[0], entry.rotation[1], entry.rotation[2]);
    object.updateMatrixWorld(true);
  });
};

const AssemblyPiece = ({
  config,
  selected,
  isInteractive,
  lockedAxes,
  onSelect,
  registerObject,
  orbitControlsRef,
  onTransformStart,
  onTransformEnd,
  onObjectChange,
}: {
  config: AssemblyPieceConfig;
  selected: boolean;
  isInteractive: boolean;
  lockedAxes: LockedAxesState;
  onSelect: (key: string) => void;
  registerObject: (key: string, object: Group | null) => void;
  orbitControlsRef: MutableRefObject<any>;
  onTransformStart: () => void;
  onTransformEnd: () => void;
  onObjectChange: () => void;
}) => {
  const { scene } = useGLTF(config.path, true, true, (loader) => loader.setRequestHeader(apiService.getAssetHeaders(config.path))) as { scene: Object3D };
  const groupRef = useRef<Group | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  const model = useMemo(() => {
    const clonedScene = scene.clone(true);
    clonedScene.traverse((object) => {
      if (object instanceof Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false;
      }
    });
    return clonedScene;
  }, [scene]);

  useEffect(() => {
    registerObject(config.key, groupRef.current);
    return () => registerObject(config.key, null);
  }, [config.key, registerObject]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  return (
    <>
      <group
        ref={groupRef}
        position={config.position}
        rotation={config.rotation}
        onPointerDown={
          isInteractive
            ? (event) => {
                event.stopPropagation();
                onSelect(config.key);
              }
            : undefined
        }
      >
        <primitive object={model} />
        <HtmlLabel selected={selected} label={config.label} />
      </group>
      {selected && isInteractive && isMounted ? (
        <TransformControls
          object={groupRef.current ?? undefined}
          mode="translate"
          space="world"
          showX={!lockedAxes.x}
          showY={!lockedAxes.y}
          showZ={!lockedAxes.z}
          size={1.1}
          onMouseDown={(event: any) => {
            event?.stopPropagation?.();
            onTransformStart();
            if (orbitControlsRef.current) {
              orbitControlsRef.current.enabled = false;
            }
          }}
          onMouseUp={(event: any) => {
            event?.stopPropagation?.();
            onTransformEnd();
            onObjectChange();
            if (orbitControlsRef.current) {
              orbitControlsRef.current.enabled = true;
            }
          }}
          onObjectChange={onObjectChange}
        />
      ) : null}
    </>
  );
};

class AssemblyPieceBoundary extends Component<
  {
    pieceKey: string;
    pieceLabel: string;
    onError: (pieceLabel: string, message: string) => void;
    children: ReactNode;
  },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(this.props.pieceLabel, error.message || 'Failed to load GLB asset.');
  }

  componentDidUpdate(prevProps: Readonly<{ pieceKey: string; pieceLabel: string; onError: (pieceLabel: string, message: string) => void; children: ReactNode }>) {
    if (prevProps.pieceKey !== this.props.pieceKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return null;
    }

    return this.props.children;
  }
}

const HtmlLabel = ({ selected, label }: { selected: boolean; label: string }) => (
  <Html
    position={[0, 0.05, 0]}
    center
    transform
    distanceFactor={14}
    style={{ pointerEvents: 'none' }}
  >
    <div
      className={[
        'rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.22em] backdrop-blur',
        selected
          ? 'border-cyan-300/60 bg-cyan-300/15 text-cyan-100'
          : 'border-white/10 bg-black/40 text-stone-300',
      ].join(' ')}
    >
      {label}
    </div>
  </Html>
);

const EditorWindowToggle = ({
  value,
  onChange,
}: {
  value: EditingTargetMode;
  onChange: (mode: EditingTargetMode) => void;
}) => (
  <div className={`pointer-events-auto flex ${EDITOR_PANEL_WIDTH_CLASS} rounded-2xl border border-white/15 bg-black/55 p-1 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-2xl`}>
    {(['artwork-space', 'artwork-slots'] as const).map((mode) => {
      const active = value === mode;
      return (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={[
            'flex-1 rounded-[1rem] px-4 py-2 text-xs font-medium transition',
            active ? 'bg-fuchsia-300/15 text-fuchsia-50' : 'text-stone-300 hover:bg-white/10 hover:text-stone-100',
          ].join(' ')}
        >
          {mode === 'artwork-space' ? 'Space editor' : 'Slot editor'}
        </button>
      );
    })}
  </div>
);

const AssemblyScene = ({
  assemblyPieces,
  selectedKey,
  isInteractive,
  onSelectKey,
  registerObject,
  lockedAxes,
  orbitControlsRef,
  orbitEnabled,
  cameraLockActive,
  onTransformStart,
  onTransformEnd,
  onObjectChange,
  onPieceError,
}: {
  assemblyPieces: AssemblyPieceConfig[];
  selectedKey: string | null;
  isInteractive: boolean;
  onSelectKey: (key: string) => void;
  registerObject: (key: string, object: Group | null) => void;
  lockedAxes: LockedAxesState;
  orbitControlsRef: MutableRefObject<any>;
  orbitEnabled: boolean;
  cameraLockActive: boolean;
  onTransformStart: () => void;
  onTransformEnd: () => void;
  onObjectChange: () => void;
  onPieceError: (pieceLabel: string, message: string) => void;
}) => (
  <>
    <CameraRig />
    <CameraTransformLock active={cameraLockActive} orbitControlsRef={orbitControlsRef} />
    <color attach="background" args={['#0c0a09']} />
    <ambientLight intensity={1.1} />
    <directionalLight position={[6, 10, 8]} intensity={1.35} castShadow />
    <directionalLight position={[-5, 4, -4]} intensity={0.55} />
    <gridHelper args={[30, 30, '#44403c', '#1c1917']} position={[0, INITIAL_GRID_Y, 0]} />
    <axesHelper args={[4]} />

    {assemblyPieces.map((config) => (
      <AssemblyPieceBoundary
        key={config.key}
        pieceKey={config.key}
        pieceLabel={config.label}
        onError={onPieceError}
      >
        <AssemblyPiece
          config={config}
          selected={isInteractive && selectedKey === config.key}
          isInteractive={isInteractive}
          lockedAxes={lockedAxes}
          onSelect={onSelectKey}
          registerObject={registerObject}
          orbitControlsRef={orbitControlsRef}
          onTransformStart={onTransformStart}
          onTransformEnd={onTransformEnd}
          onObjectChange={onObjectChange}
        />
      </AssemblyPieceBoundary>
    ))}

    <OrbitControls
      ref={orbitControlsRef}
      makeDefault
      enabled={orbitEnabled}
      enablePan
      enableZoom
      minDistance={6}
      maxDistance={60}
      target={CAMERA_TARGET}
    />
    <CameraKeyboardPan enabled={orbitEnabled} orbitControlsRef={orbitControlsRef} />
  </>
);

const ToastBanner = ({
  tone,
  title,
  message,
  onDismiss,
  placement,
}: {
  tone: 'success' | 'error';
  title: string;
  message: string;
  onDismiss: () => void;
  placement: 'top-right' | 'bottom-right';
}) => {
  const toneStyles =
    tone === 'success'
      ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-50'
      : 'border-rose-300/30 bg-rose-400/10 text-rose-50';

  const placementStyles =
    placement === 'top-right' ? 'top-5 right-5' : 'bottom-5 right-5';

  return (
    <div className={`pointer-events-none fixed ${placementStyles} z-[60]`}>
      <div className={`pointer-events-auto w-[19rem] rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl ${toneStyles}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] opacity-80">{title}</p>
            <p className="mt-1 text-sm leading-5">{message}</p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-stone-100 transition hover:bg-white/15"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const RoomMergeOverlay = ({
  open,
  editingTargetMode,
  onEditingTargetModeChange,
  selectedKey,
  snapshot,
  positionDraft,
  rotationDraft,
  lockedAxes,
  memoDraft,
  presetNameDraft,
  presetMemoDraft,
  loadState,
  loadError,
  historySnapshots,
  presetSnapshots,
  historyError,
  presetError,
  compareSnapshot,
  comparisonRows,
  canUndo,
  canRedo,
  isSaving,
  onToggleOpen,
  onSelectPiece,
  onPositionChange,
  onRotationChange,
  onPositionFocus,
  onPositionBlur,
  onRotationFocus,
  onRotationBlur,
  onResetAll,
  onCopyPositions,
  onReturnToProfile,
  onSave,
  onUndo,
  onRedo,
  onToggleAxisLock,
  onMemoChange,
  onPresetNameChange,
  onPresetMemoChange,
  onSavePreset,
  onApplySnapshot,
  onCompareSnapshot,
  onApplyPreset,
  assemblyPieces,
}: {
  open: boolean;
  editingTargetMode: EditingTargetMode;
  onEditingTargetModeChange: (mode: EditingTargetMode) => void;
  selectedKey: string | null;
  snapshot: TransformSnapshot;
  positionDraft: { x: string; y: string; z: string };
  rotationDraft: { x: string; y: string; z: string };
  lockedAxes: LockedAxesState;
  memoDraft: string;
  presetNameDraft: string;
  presetMemoDraft: string;
  loadState: 'loading' | 'ready' | 'empty' | 'error';
  loadError: string | null;
  historySnapshots: RoomMergeExperimentSnapshotResponse[];
  presetSnapshots: RoomMergePresetResponse[];
  historyError: string | null;
  presetError: string | null;
  compareSnapshot: RoomMergeComparisonTarget;
  comparisonRows: SnapshotDiffItem[];
  canUndo: boolean;
  canRedo: boolean;
  isSaving: boolean;
  onToggleOpen: () => void;
  onSelectPiece: (key: string) => void;
  onPositionChange: (axis: 'x' | 'y' | 'z', value: string) => void;
  onRotationChange: (axis: 'x' | 'y' | 'z', value: string) => void;
  onPositionFocus: () => void;
  onPositionBlur: () => void;
  onRotationFocus: () => void;
  onRotationBlur: () => void;
  onResetAll: () => void;
  onCopyPositions: () => void;
  onReturnToProfile: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleAxisLock: (axis: AxisKey) => void;
  onMemoChange: (value: string) => void;
  onPresetNameChange: (value: string) => void;
  onPresetMemoChange: (value: string) => void;
  onSavePreset: () => void;
  onApplySnapshot: (snapshot: RoomMergeExperimentSnapshotResponse) => void;
  onCompareSnapshot: (snapshot: RoomMergeComparisonTarget) => void;
  onApplyPreset: (snapshot: RoomMergePresetResponse) => void;
  assemblyPieces: AssemblyPieceConfig[];
}) => {
  const isSpaceMode = editingTargetMode === 'artwork-space';
  const selectedPiece = selectedKey
    ? assemblyPieces.find((piece) => piece.key === selectedKey) ?? null
    : null;
  const comparisonLabel = compareSnapshot
    ? 'presetName' in compareSnapshot && compareSnapshot.presetName
      ? compareSnapshot.presetName
      : compareSnapshot.memo || 'No memo'
    : '';
  const triggerPointerState = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    moved: boolean;
  }>({
    pointerId: null,
    startX: 0,
    startY: 0,
    moved: false,
  });

  const resetTriggerPointerState = useCallback(() => {
    triggerPointerState.current.pointerId = null;
    triggerPointerState.current.moved = false;
  }, []);

  const handleRoomControlsToggle = useCallback(() => {
    if (triggerPointerState.current.moved) {
      resetTriggerPointerState();
      return;
    }

    onToggleOpen();
    resetTriggerPointerState();
  }, [onToggleOpen, resetTriggerPointerState]);

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      <div className="absolute left-5 top-5 flex flex-col gap-3" data-keyboard-navigation="ignore">
        <EditorWindowToggle value={editingTargetMode} onChange={onEditingTargetModeChange} />
        <div className={`flex ${EDITOR_PANEL_WIDTH_CLASS} flex-col gap-3`}>
        <button
          type="button"
          onPointerDown={(event) => {
            triggerPointerState.current.pointerId = event.pointerId;
            triggerPointerState.current.startX = event.clientX;
            triggerPointerState.current.startY = event.clientY;
            triggerPointerState.current.moved = false;
          }}
          onPointerMove={(event) => {
            if (triggerPointerState.current.pointerId !== event.pointerId) {
              return;
            }

            const deltaX = Math.abs(event.clientX - triggerPointerState.current.startX);
            const deltaY = Math.abs(event.clientY - triggerPointerState.current.startY);
            if (deltaX > 6 || deltaY > 6) {
              triggerPointerState.current.moved = true;
            }
          }}
          onPointerLeave={() => {
            resetTriggerPointerState();
          }}
          onPointerCancel={() => {
            resetTriggerPointerState();
          }}
          onClick={handleRoomControlsToggle}
          className={[
            `pointer-events-auto inline-flex min-h-12 ${EDITOR_SELECTOR_WIDTH_CLASS} items-center gap-2 rounded-2xl border px-4 py-2 text-left text-sm font-medium text-stone-100`,
            'border-white/20 bg-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-2xl',
            'transition duration-300 hover:bg-white/15 hover:border-white/30 active:scale-[0.98]',
          ].join(' ')}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/10 text-base text-cyan-100">
            {open ? '−' : '+'}
          </span>
          <span className="flex min-w-0 flex-col">
            <span>Space editor</span>
            <span className="truncate text-[11px] font-normal text-stone-300">
              {isSpaceMode ? selectedPiece?.label ?? 'No selection' : 'Locked in artwork slots mode'}
            </span>
          </span>
        </button>

        <div
          className={[
            `pointer-events-auto ${EDITOR_PANEL_WIDTH_CLASS} overflow-hidden rounded-3xl border`,
            'border-white/15 bg-black/55 p-4 text-sm text-stone-200 shadow-[0_24px_90px_rgba(0,0,0,0.5)] backdrop-blur-2xl',
            'transition-all duration-300',
            open ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0',
          ].join(' ')}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Experiment</p>
              <p className="mt-1 text-lg font-medium text-stone-50">Space editor window</p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-stone-500">
                Active mode {EDITING_TARGET_LABELS[editingTargetMode]}
              </p>
            </div>
            <div className="text-right text-[11px] text-stone-400">
              <div>{loadState === 'loading' ? 'Loading snapshot...' : loadState === 'ready' ? 'Snapshot loaded' : 'Live editing'}</div>
              <div className="mt-1 text-stone-500">
                {historySnapshots.length} saved
              </div>
              <div className="mt-1 text-stone-500">
                {presetSnapshots.length} presets
              </div>
            </div>
          </div>

          <p className="mt-3 text-xs leading-5 text-stone-400">
            Orbit the scene freely. Use the panel only for room selection, precise x/y/z editing, and named layout save.
            Arrow keys pan the camera for finer inspection without changing the mouse orbit behavior.
          </p>
          {!isSpaceMode ? (
            <div className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
              Artwork slots mode is active, so room pieces are fixed. Switch to artwork space to move or save the space layout.
            </div>
          ) : null}

          <div className={!isSpaceMode ? 'pointer-events-none select-none opacity-50' : undefined}>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-stone-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-stone-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Redo
            </button>
            <button
              type="button"
              onClick={onResetAll}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-stone-100 transition hover:bg-white/10"
            >
              Reset all
            </button>
            <button
              type="button"
              onClick={onCopyPositions}
              className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs font-medium text-cyan-100 transition hover:bg-cyan-300/15"
            >
              Copy positions
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs font-medium text-emerald-100 transition hover:bg-emerald-300/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onReturnToProfile}
              className="rounded-full border border-[#7f9b5a]/20 bg-[#7f9b5a]/10 px-3 py-2 text-xs font-medium text-[#e8f0d5] transition hover:bg-[#7f9b5a]/15"
            >
              프로필로 돌아가기
            </button>
          </div>

          {loadError ? (
            <div className="mt-3 rounded-2xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-100">
              {loadError}
            </div>
          ) : null}

          {historyError ? (
            <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
              {historyError}
            </div>
          ) : null}

          {presetError ? (
            <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
              {presetError}
            </div>
          ) : null}

          <div className="mt-4 rounded-2xl border border-white/10 bg-black/35 p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Selected</p>
            <p className="mt-1 text-sm font-medium text-stone-100">
              {selectedPiece?.label ?? 'None'}
            </p>
            {selectedPiece ? (
              <p className="mt-1 break-all text-[11px] text-stone-500">{selectedPiece.path}</p>
            ) : null}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {(['x', 'y', 'z'] as const).map((axis) => (
              <label key={axis} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-stone-500">{axis}</span>
                  <button
                    type="button"
                    onClick={() => onToggleAxisLock(axis)}
                    className={[
                      'rounded-full border px-2 py-0.5 text-[10px] transition',
                      lockedAxes[axis]
                        ? 'border-amber-300/30 bg-amber-300/15 text-amber-100'
                        : 'border-white/10 bg-white/5 text-stone-400 hover:bg-white/10',
                    ].join(' ')}
                  >
                    {lockedAxes[axis] ? 'Locked' : 'Free'}
                  </button>
                </div>
                <input
                  type="number"
                  step="0.01"
                  value={positionDraft[axis]}
                  onChange={(event) => onPositionChange(axis, event.target.value)}
                  onFocus={onPositionFocus}
                  onBlur={onPositionBlur}
                  disabled={lockedAxes[axis]}
                  className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-stone-100 outline-none transition focus:border-cyan-300/40 focus:bg-black/55"
                />
              </label>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {(['x', 'y', 'z'] as const).map((axis) => (
              <label key={axis} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-stone-500">
                    rot {axis}
                  </span>
                  <button
                    type="button"
                    onClick={() => onToggleAxisLock(axis)}
                    className={[
                      'rounded-full border px-2 py-0.5 text-[10px] transition',
                      lockedAxes[axis]
                        ? 'border-amber-300/30 bg-amber-300/15 text-amber-100'
                        : 'border-white/10 bg-white/5 text-stone-400 hover:bg-white/10',
                    ].join(' ')}
                  >
                    {lockedAxes[axis] ? 'Locked' : 'Free'}
                  </button>
                </div>
                <input
                  type="number"
                  step="0.01"
                  value={rotationDraft[axis]}
                  onChange={(event) => onRotationChange(axis, event.target.value)}
                  onFocus={onRotationFocus}
                  onBlur={onRotationBlur}
                  disabled={lockedAxes[axis]}
                  className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-stone-100 outline-none transition focus:border-cyan-300/40 focus:bg-black/55"
                />
              </label>
            ))}
          </div>

          <label className="mt-4 block space-y-1">
            <span className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Layout description</span>
            <textarea
              value={memoDraft}
              onChange={(event) => onMemoChange(event.target.value)}
              rows={3}
              className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-stone-100 outline-none transition focus:border-cyan-300/40 focus:bg-black/55"
              placeholder="Why did you make this layout?"
            />
          </label>

          <div className="mt-4 grid gap-2">
            <input
              type="text"
              value={presetNameDraft}
              onChange={(event) => onPresetNameChange(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-stone-100 outline-none transition focus:border-cyan-300/40 focus:bg-black/55"
              placeholder="Layout name"
            />
            <textarea
              value={presetMemoDraft}
              onChange={(event) => onPresetMemoChange(event.target.value)}
              rows={2}
              className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-stone-100 outline-none transition focus:border-cyan-300/40 focus:bg-black/55"
              placeholder="Layout description"
            />
            <button
              type="button"
              onClick={onSavePreset}
              className="rounded-full border border-fuchsia-300/20 bg-fuchsia-300/10 px-3 py-2 text-xs font-medium text-fuchsia-100 transition hover:bg-fuchsia-300/15"
            >
              Save layout
            </button>
          </div>

          {compareSnapshot ? (
            <div className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-cyan-200">Comparison</p>
                  <p className="mt-1 text-sm font-medium text-cyan-50">
                    Comparing with #{compareSnapshot.id}
                  </p>
                  <p className="mt-1 text-[11px] text-cyan-100/80">
                    {comparisonLabel}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onCompareSnapshot(null)}
                  className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-stone-100 transition hover:bg-white/15"
                >
                  Clear
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {comparisonRows.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-stone-200">
                    No differences against current state.
                  </div>
                ) : (
                  comparisonRows.map((row) => (
                    <div
                      key={row.key}
                      className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-stone-200"
                    >
                      <div className="font-medium text-stone-50">{row.label}</div>
                      <div className="mt-1 space-y-1">
                        <div>pos {row.positionDelta.map(formatDelta).join(' / ')}</div>
                        <div>rot {row.rotationDelta.map(formatDelta).join(' / ')}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}

          <div className="mt-4 max-h-[36vh] space-y-2 overflow-y-auto pr-1">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Live pieces</p>
              <p className="mt-1 text-xs text-stone-400">
                Current state is still editable below.
              </p>
            </div>
            {assemblyPieces.map((config) => {
              const entry = snapshot[config.key];
              const isSelected = selectedKey === config.key;

              return (
                <button
                  key={config.key}
                  type="button"
                  onClick={() => onSelectPiece(config.key)}
                  className={[
                    'flex w-full items-center justify-between rounded-2xl border px-3 py-2 text-left transition',
                    isSelected
                      ? 'border-cyan-300/40 bg-cyan-300/10'
                      : 'border-white/10 bg-white/5 hover:bg-white/8',
                  ].join(' ')}
                >
                  <div>
                    <p className="text-sm font-medium text-stone-100">{config.label}</p>
                    <p className="mt-1 text-[11px] text-stone-500">{config.path}</p>
                  </div>
                  <div className="ml-3 text-right text-[11px] text-stone-300">
                    <div>x {formatCoordinate(entry.position[0])}</div>
                    <div>y {formatCoordinate(entry.position[1])}</div>
                    <div>z {formatCoordinate(entry.position[2])}</div>
                  </div>
                </button>
              );
            })}

            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Snapshot history</p>
              <p className="mt-1 text-xs text-stone-400">
                Load returns the scene to that exact state. Compare keeps the current scene and shows diffs.
              </p>
            </div>
            {historySnapshots.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-xs text-stone-400">
                No saved snapshots yet.
              </div>
            ) : null}
            {historySnapshots.map((item) => {
              const pieceCount = Object.keys(item.snapshot.pieces).length;
              return (
                <div
                  key={item.id}
                  className="rounded-2xl border border-white/10 bg-stone-950/40 px-3 py-3 text-left transition"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-100">
                      #{item.id} · {item.selectedKey ?? 'None'}
                    </p>
                    <p className="mt-1 text-[11px] text-stone-500">
                      {formatTimestamp(item.createdAt)} · {pieceCount} pieces
                    </p>
                    <p className="mt-1 break-all text-[11px] text-stone-500">
                      {item.memo || 'No memo'} · session {item.sessionId}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onApplySnapshot(item)}
                      className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-[11px] text-cyan-100 transition hover:bg-cyan-300/15"
                    >
                      Load
                    </button>
                    <button
                      type="button"
                      onClick={() => onCompareSnapshot(item)}
                      className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-stone-100 transition hover:bg-white/10"
                    >
                      Compare
                    </button>
                  </div>
                </div>
              );
            })}

            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Presets</p>
              <p className="mt-1 text-xs text-stone-400">
                Reusable curator starting points saved by name.
              </p>
            </div>
            {presetSnapshots.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-xs text-stone-400">
                No presets saved yet.
              </div>
            ) : null}
            {presetSnapshots.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-white/10 bg-stone-950/40 px-3 py-3 text-left transition"
              >
                <p className="text-sm font-medium text-stone-100">{item.presetName}</p>
                <p className="mt-1 text-[11px] text-stone-500">
                  {formatTimestamp(item.updatedAt)} · {item.memo || 'No memo'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onApplyPreset(item)}
                    className="rounded-full border border-fuchsia-300/20 bg-fuchsia-300/10 px-2 py-1 text-[11px] text-fuchsia-100 transition hover:bg-fuchsia-300/15"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => onCompareSnapshot(item)}
                    className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-stone-100 transition hover:bg-white/10"
                  >
                    Compare
                  </button>
                </div>
              </div>
            ))}
          </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};

const SlotObject = ({
  slot,
  selected,
  isInteractive,
  mode,
  registerObject,
  onSelect,
  orbitControlsRef,
  onTransformStart,
  onTransformEnd,
  onObjectChange,
}: {
  slot: SlotDraft;
  selected: boolean;
  isInteractive: boolean;
  mode: SlotTransformMode;
  registerObject: (key: string, object: Group | null) => void;
  onSelect: (key: string) => void;
  orbitControlsRef: MutableRefObject<any>;
  onTransformStart: () => void;
  onTransformEnd: () => void;
  onObjectChange: () => void;
}) => {
  const groupRef = useRef<Group | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    registerObject(slot.slotKey, groupRef.current);
    return () => registerObject(slot.slotKey, null);
  }, [registerObject, slot.slotKey]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  return (
    <>
      <group
        ref={groupRef}
        position={[slot.position.x, slot.position.y, slot.position.z]}
        rotation={[slot.rotation.x, slot.rotation.y, slot.rotation.z]}
        onPointerDown={
          isInteractive
            ? (event) => {
                event.stopPropagation();
                onSelect(slot.slotKey);
              }
            : undefined
        }
      >
        <mesh castShadow receiveShadow>
          <boxGeometry args={[slot.width, slot.height, slot.depth]} />
          <meshStandardMaterial
            color={selected ? '#38bdf8' : '#2563eb'}
            emissive={selected ? '#0ea5e9' : '#1d4ed8'}
            emissiveIntensity={selected ? 0.45 : 0.28}
            transparent
            opacity={0.82}
            roughness={0.32}
            metalness={0.14}
          />
        </mesh>
        <HtmlLabel selected={selected} label={slot.name} />
      </group>
      {selected && isInteractive && isMounted ? (
        <TransformControls
          object={groupRef.current ?? undefined}
          mode={mode}
          space="world"
          size={1.1}
          onMouseDown={(event: any) => {
            event?.stopPropagation?.();
            onTransformStart();
            if (orbitControlsRef.current) {
              orbitControlsRef.current.enabled = false;
            }
          }}
          onMouseUp={(event: any) => {
            event?.stopPropagation?.();
            if (orbitControlsRef.current) {
              orbitControlsRef.current.enabled = true;
            }
            onTransformEnd();
            onObjectChange();
          }}
          onObjectChange={onObjectChange}
        />
      ) : null}
    </>
  );
};

const SlotScene = ({
  slots,
  selectedSlotKey,
  isInteractive,
  mode,
  registerObject,
  onSelectSlot,
  orbitControlsRef,
  orbitEnabled,
  cameraLockActive,
  onTransformStart,
  onTransformEnd,
  onObjectChange,
}: {
  slots: SlotDraft[];
  selectedSlotKey: string | null;
  isInteractive: boolean;
  mode: SlotTransformMode;
  registerObject: (key: string, object: Group | null) => void;
  onSelectSlot: (key: string) => void;
  orbitControlsRef: MutableRefObject<any>;
  orbitEnabled: boolean;
  cameraLockActive: boolean;
  onTransformStart: () => void;
  onTransformEnd: () => void;
  onObjectChange: () => void;
}) => (
  <>
    <ambientLight intensity={0.95} />
    <CameraTransformLock active={cameraLockActive} orbitControlsRef={orbitControlsRef} />
    <directionalLight position={[8, 12, 10]} intensity={1.15} castShadow />
    <directionalLight position={[-8, 6, -6]} intensity={0.45} />
    <gridHelper args={[30, 30, '#3f3f46', '#1f2937']} position={[0, INITIAL_GRID_Y, 0]} />

    {slots.map((slot) => (
      <SlotObject
        key={slot.slotKey}
        slot={slot}
        selected={isInteractive && selectedSlotKey === slot.slotKey}
        isInteractive={isInteractive}
        mode={mode}
        registerObject={registerObject}
        onSelect={onSelectSlot}
        orbitControlsRef={orbitControlsRef}
        onTransformStart={onTransformStart}
        onTransformEnd={onTransformEnd}
        onObjectChange={onObjectChange}
      />
    ))}

    <OrbitControls
      ref={orbitControlsRef}
      makeDefault
      enabled={orbitEnabled}
      enablePan
      enableZoom
      minDistance={5}
      maxDistance={60}
      target={CAMERA_TARGET}
    />
    <CameraKeyboardPan enabled={orbitEnabled} orbitControlsRef={orbitControlsRef} />
  </>
);

const SlotEditorOverlay = ({
  open,
  editingTargetMode,
  spaces,
  selectedSpace,
  selectedSpaceId,
  slotDrafts,
  selectedSlotKey,
  slotTransformMode,
  slotLoadState,
  slotLoadError,
  slotSaving,
  slotError,
  slotToast,
  onEditingTargetModeChange,
  onToggleOpen,
  onSelectSpace,
  onCreateSpaceShortcut,
  onReloadSpace,
  onAddSlot,
  onRemoveSlot,
  onSelectSlot,
  onSlotChange,
  onModeChange,
  onSaveSlots,
  onReturnToProfile,
}: {
  open: boolean;
  editingTargetMode: EditingTargetMode;
  spaces: CuratorSpaceSummary[];
  selectedSpace: CuratorSpaceDetail | null;
  selectedSpaceId: number | null;
  slotDrafts: SlotDraft[];
  selectedSlotKey: string | null;
  slotTransformMode: SlotTransformMode;
  slotLoadState: 'idle' | 'loading' | 'ready' | 'empty' | 'error';
  slotLoadError: string | null;
  slotSaving: boolean;
  slotError: string | null;
  slotToast: string | null;
  onEditingTargetModeChange: (mode: EditingTargetMode) => void;
  onToggleOpen: () => void;
  onSelectSpace: (spaceId: number) => void;
  onCreateSpaceShortcut: () => void;
  onReloadSpace: () => void;
  onAddSlot: () => void;
  onRemoveSlot: () => void;
  onSelectSlot: (slotKey: string) => void;
  onSlotChange: (slotKey: string, patch: Partial<SlotDraft>) => void;
  onModeChange: (mode: SlotTransformMode) => void;
  onSaveSlots: () => void;
  onReturnToProfile: () => void;
}) => {
  const isSlotMode = editingTargetMode === 'artwork-slots';
  const selectedSlot = selectedSlotKey ? slotDrafts.find((slot) => slot.slotKey === selectedSlotKey) ?? null : null;
  const selectedSpaceLabel = selectedSpace?.name ?? 'No space selected';
  const selectedSpaceStatus = selectedSpace?.status ?? 'idle';
  const slotCountLabel = `${slotDrafts.length.toString().padStart(2, '0')} / 50`;
  const modeLabel = slotTransformMode === 'translate' ? 'Move' : 'Rotate';

  return (
    <div className="pointer-events-none fixed inset-0 z-[55]">
      <div className={`absolute left-5 top-5 flex ${EDITOR_PANEL_WIDTH_CLASS} flex-col gap-3`}>
        {slotToast ? (
          <div className="pointer-events-none rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-50 shadow-2xl backdrop-blur-xl">
            {slotToast}
          </div>
        ) : null}
        <EditorWindowToggle value={editingTargetMode} onChange={onEditingTargetModeChange} />

        <button
          type="button"
          onClick={onToggleOpen}
          className={[
            `pointer-events-auto inline-flex min-h-12 ${EDITOR_SELECTOR_WIDTH_CLASS} items-center gap-2 rounded-2xl border px-4 py-2 text-left text-sm font-medium text-stone-100`,
            'border-white/20 bg-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-2xl',
            'transition duration-300 hover:bg-white/15 hover:border-white/30 active:scale-[0.98]',
          ].join(' ')}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/10 text-base text-cyan-100">
            {open ? '−' : '+'}
          </span>
          <span className="flex min-w-0 flex-col">
            <span>Slot editor</span>
            <span className="truncate text-[11px] font-normal text-stone-300">
              {isSlotMode ? selectedSlot?.name ?? selectedSpaceLabel : 'Locked in artwork space mode'}
            </span>
          </span>
        </button>

        <div
          className={[
            `pointer-events-auto ${EDITOR_PANEL_WIDTH_CLASS} max-h-[calc(100vh-7rem)] overflow-y-auto overscroll-contain rounded-3xl border`,
            'border-white/15 bg-black/65 p-4 text-sm text-stone-200 shadow-[0_24px_90px_rgba(0,0,0,0.55)] backdrop-blur-2xl',
            'transition-all duration-300',
            open ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0',
          ].join(' ')}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-fuchsia-300">Experiment</p>
              <p className="mt-1 text-lg font-medium text-stone-50">Slot editor window</p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-stone-500">
                Active mode {EDITING_TARGET_LABELS[editingTargetMode]}
              </p>
              <p className="mt-1 text-xs text-stone-400">
                Pin the panel, pick a slot, and keep the gizmo in sync with numeric edits.
              </p>
            </div>
            <button
              type="button"
              onClick={onToggleOpen}
              className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] text-stone-100 transition hover:bg-white/15"
            >
              {open ? 'Hide' : 'Show'}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-stone-300">
              <div className="uppercase tracking-[0.16em] text-stone-500">Space</div>
              <div className="mt-1 truncate text-sm text-stone-50">{selectedSpaceLabel}</div>
              <div className="mt-1 text-stone-500">{selectedSpaceStatus}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-stone-300">
              <div className="uppercase tracking-[0.16em] text-stone-500">Slots</div>
              <div className="mt-1 text-sm text-stone-50">{slotCountLabel}</div>
              <div className="mt-1 text-stone-500">draft slots</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-stone-300">
              <div className="uppercase tracking-[0.16em] text-stone-500">Mode</div>
              <div className="mt-1 text-sm text-stone-50">{modeLabel}</div>
              <div className="mt-1 text-stone-500">world gizmo</div>
            </div>
          </div>

          <p className="mt-3 text-xs leading-5 text-stone-400">
            Select a curator space, place up to 50 artwork slots, and save the draft back to the operational space model.
          </p>
          {!isSlotMode ? (
            <div className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
              Artwork space mode is active, so slots are fixed. Switch back to artwork slots to add, move, rotate, or save slots.
            </div>
          ) : null}

          <div className="mt-4 grid gap-2">
            <label className="space-y-1">
              <div className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Space</div>
              <select
                value={selectedSpaceId ?? ''}
                onChange={(event) => {
                  const nextValue = Number(event.target.value);
                  if (!Number.isNaN(nextValue)) {
                    onSelectSpace(nextValue);
                  }
                }}
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-stone-100 outline-none transition focus:border-fuchsia-300/40"
              >
                <option value="" disabled>
                  Select a curator space
                </option>
                {spaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name} · {space.status}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onCreateSpaceShortcut}
                className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs font-medium text-cyan-100 transition hover:bg-cyan-300/15"
              >
                New space
              </button>
              <button
                type="button"
                onClick={onReloadSpace}
                disabled={selectedSpaceId === null}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-stone-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reload
              </button>
              <button
                type="button"
                onClick={onAddSlot}
                disabled={slotDrafts.length >= 50}
                className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs font-medium text-emerald-100 transition hover:bg-emerald-300/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add slot
              </button>
              <button
                type="button"
                onClick={onSaveSlots}
                disabled={!selectedSpace || slotSaving || slotDrafts.length === 0}
                className="rounded-full border border-fuchsia-300/20 bg-fuchsia-300/10 px-3 py-2 text-xs font-medium text-fuchsia-100 transition hover:bg-fuchsia-300/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {slotSaving ? 'Saving...' : 'Save slots'}
              </button>
              <button
                type="button"
                onClick={onReturnToProfile}
                className="rounded-full border border-[#7f9b5a]/20 bg-[#7f9b5a]/10 px-3 py-2 text-xs font-medium text-[#e8f0d5] transition hover:bg-[#7f9b5a]/15"
              >
                프로필로 돌아가기
              </button>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Status</p>
              <p className="mt-1 text-sm text-stone-100">{selectedSpaceLabel}</p>
              <p className="mt-1 text-xs text-stone-500">
                {slotLoadState === 'loading'
                  ? 'Loading slots...'
                  : slotLoadState === 'ready'
                    ? `${slotDrafts.length} slots loaded`
                    : slotLoadState === 'empty'
                      ? 'No saved slots yet'
                      : slotLoadState === 'error'
                        ? 'Slot load failed'
                        : 'Waiting for selection'}
              </p>
            </div>
          </div>

          {slotLoadError ? (
            <div className="mt-3 rounded-2xl border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
              {slotLoadError}
            </div>
          ) : null}
          {slotError ? (
            <div className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
              {slotError}
            </div>
          ) : null}

          {open ? (
            <>
              <div className={!isSlotMode ? 'pointer-events-none select-none opacity-50' : undefined}>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onModeChange('translate')}
                  className={[
                    'rounded-full border px-3 py-2 text-xs font-medium transition',
                    slotTransformMode === 'translate'
                      ? 'border-fuchsia-300/30 bg-fuchsia-300/15 text-fuchsia-100'
                      : 'border-white/10 bg-white/5 text-stone-300 hover:bg-white/10',
                  ].join(' ')}
                >
                  Move
                </button>
                <button
                  type="button"
                  onClick={() => onModeChange('rotate')}
                  className={[
                    'rounded-full border px-3 py-2 text-xs font-medium transition',
                    slotTransformMode === 'rotate'
                      ? 'border-fuchsia-300/30 bg-fuchsia-300/15 text-fuchsia-100'
                      : 'border-white/10 bg-white/5 text-stone-300 hover:bg-white/10',
                  ].join(' ')}
                >
                  Rotate
                </button>
                <button
                  type="button"
                  onClick={onRemoveSlot}
                  disabled={!selectedSlotKey}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-stone-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove selected
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-stone-500">
                Move updates position live; rotate keeps the same slot size and changes orientation only.
              </p>

              <div className="mt-4 max-h-[36vh] space-y-2 overflow-y-auto pr-1">
                {slotDrafts.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-3 py-3 text-xs text-stone-400">
                    No slots yet. Add one to begin editing, then use the 3D gizmo to place it precisely.
                  </div>
                ) : null}
                {slotDrafts.map((slot) => {
                  const isSelected = selectedSlotKey === slot.slotKey;
                  return (
                    <button
                      key={slot.slotKey}
                      type="button"
                      onClick={() => onSelectSlot(slot.slotKey)}
                      className={[
                        'w-full rounded-2xl border px-3 py-3 text-left transition',
                        isSelected
                          ? 'border-fuchsia-300/30 bg-fuchsia-300/10'
                          : 'border-white/10 bg-white/5 hover:bg-white/10',
                      ].join(' ')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-stone-100">{slot.name}</p>
                          <p className="mt-1 break-all text-[11px] text-stone-500">{slot.slotKey}</p>
                        </div>
                        <div className="text-right text-[11px] text-stone-400">
                          <div>{slot.sizePreset}</div>
                          <div>order {slot.sortOrder}</div>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-stone-500">
                        <span>pos {formatVector(slot.position)}</span>
                        <span>size {slot.width.toFixed(2)} × {slot.height.toFixed(2)} × {slot.depth.toFixed(2)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/35 p-3">
                <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Selected slot</p>
                {selectedSlot ? (
                  <div className="mt-3 grid gap-3">
                    <input
                      value={selectedSlot.name}
                      onChange={(event) => onSlotChange(selectedSlot.slotKey, { name: event.target.value })}
                      className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-stone-100 outline-none transition focus:border-fuchsia-300/40"
                    />
                    <p className="text-[11px] leading-5 text-stone-500">
                      The 3D box and the numeric fields stay synchronized while you edit.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Size preset</div>
                        <select
                          value={selectedSlot.sizePreset}
                          onChange={(event) => {
                            const nextPreset = event.target.value as SlotDraft['sizePreset'];
                            const dimensions = ARTWORK_SLOT_SIZE_PRESET_DIMENSIONS[nextPreset];
                            onSlotChange(selectedSlot.slotKey, {
                              sizePreset: nextPreset,
                              width: dimensions[0],
                              height: dimensions[1],
                              depth: dimensions[2],
                            });
                          }}
                          className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-stone-100 outline-none transition focus:border-fuchsia-300/40"
                        >
                          <option value="small">small</option>
                          <option value="medium">medium</option>
                          <option value="large">large</option>
                        </select>
                      </label>
                      <NumberField
                        label="Sort order"
                        value={selectedSlot.sortOrder}
                        onChange={(value) => onSlotChange(selectedSlot.slotKey, { sortOrder: Number.isNaN(value) ? 0 : value })}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <NumberField
                        label="Width"
                        value={selectedSlot.width}
                        onChange={(value) => onSlotChange(selectedSlot.slotKey, { width: Number.isNaN(value) ? selectedSlot.width : value })}
                      />
                      <NumberField
                        label="Height"
                        value={selectedSlot.height}
                        onChange={(value) => onSlotChange(selectedSlot.slotKey, { height: Number.isNaN(value) ? selectedSlot.height : value })}
                      />
                      <NumberField
                        label="Depth"
                        value={selectedSlot.depth}
                        onChange={(value) => onSlotChange(selectedSlot.slotKey, { depth: Number.isNaN(value) ? selectedSlot.depth : value })}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <NumberField
                        label="Pos X"
                        value={selectedSlot.position.x}
                        onChange={(value) =>
                          onSlotChange(selectedSlot.slotKey, {
                            position: { ...selectedSlot.position, x: Number.isNaN(value) ? selectedSlot.position.x : value },
                          })
                        }
                      />
                      <NumberField
                        label="Pos Y"
                        value={selectedSlot.position.y}
                        onChange={(value) =>
                          onSlotChange(selectedSlot.slotKey, {
                            position: { ...selectedSlot.position, y: Number.isNaN(value) ? selectedSlot.position.y : value },
                          })
                        }
                      />
                      <NumberField
                        label="Pos Z"
                        value={selectedSlot.position.z}
                        onChange={(value) =>
                          onSlotChange(selectedSlot.slotKey, {
                            position: { ...selectedSlot.position, z: Number.isNaN(value) ? selectedSlot.position.z : value },
                          })
                        }
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <NumberField
                        label="Rot X"
                        value={selectedSlot.rotation.x}
                        onChange={(value) =>
                          onSlotChange(selectedSlot.slotKey, {
                            rotation: { ...selectedSlot.rotation, x: Number.isNaN(value) ? selectedSlot.rotation.x : value },
                          })
                        }
                      />
                      <NumberField
                        label="Rot Y"
                        value={selectedSlot.rotation.y}
                        onChange={(value) =>
                          onSlotChange(selectedSlot.slotKey, {
                            rotation: { ...selectedSlot.rotation, y: Number.isNaN(value) ? selectedSlot.rotation.y : value },
                          })
                        }
                      />
                      <NumberField
                        label="Rot Z"
                        value={selectedSlot.rotation.z}
                        onChange={(value) =>
                          onSlotChange(selectedSlot.slotKey, {
                            rotation: { ...selectedSlot.rotation, z: Number.isNaN(value) ? selectedSlot.rotation.z : value },
                          })
                        }
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Status</div>
                        <input
                          value={selectedSlot.status}
                          onChange={(event) => onSlotChange(selectedSlot.slotKey, { status: event.target.value })}
                          className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-stone-100 outline-none transition focus:border-fuchsia-300/40"
                        />
                      </label>
                      <NumberField
                        label="Artwork ID"
                        value={selectedSlot.artworkId ?? 0}
                        onChange={(value) =>
                          onSlotChange(selectedSlot.slotKey, {
                            artworkId: Number.isNaN(value) || value <= 0 ? null : value,
                          })
                        }
                      />
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-stone-500">Select a slot to edit its fields.</p>
                )}
              </div>
              <div className="h-6" />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const RoomMergeExperimentPage = () => {
  const objectRefs = useRef<Record<string, Group | null>>({});
  const slotObjectRefs = useRef<Record<string, Group | null>>({});
  const appliedSnapshotIdRef = useRef<number | null>(null);
  const pendingPresetRef = useRef<RoomMergePresetResponse | null>(null);
  const orbitControlsRef = useRef<any>(null);
  const [routeContext, setRouteContext] = useState(() => parseExperimentRoute());
  const [assemblyPieces, setAssemblyPieces] = useState<AssemblyPieceConfig[]>(EMPTY_ASSEMBLY_PIECES);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [orbitEnabled, setOrbitEnabled] = useState(true);
  const [cameraLockActive, setCameraLockActive] = useState(false);
  const [revision, setRevision] = useState(0);
  const [sceneReady, setSceneReady] = useState(false);
  const [latestSnapshot, setLatestSnapshot] = useState<RoomMergeExperimentSnapshotResponse | null>(null);
  const [historySnapshots, setHistorySnapshots] = useState<RoomMergeExperimentSnapshotResponse[]>([]);
  const [presetSnapshots, setPresetSnapshots] = useState<RoomMergePresetResponse[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [positionDraft, setPositionDraft] = useState({ x: '', y: '', z: '' });
  const [rotationDraft, setRotationDraft] = useState({ x: '', y: '', z: '' });
  const [memoDraft, setMemoDraft] = useState('');
  const [presetNameDraft, setPresetNameDraft] = useState('');
  const [presetMemoDraft, setPresetMemoDraft] = useState('');
  const [lockedAxes, setLockedAxes] = useState<LockedAxesState>({ x: false, y: false, z: false });
  const [undoStack, setUndoStack] = useState<RoomMergeAssemblySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<RoomMergeAssemblySnapshot[]>([]);
  const [compareSnapshot, setCompareSnapshot] = useState<RoomMergeComparisonTarget>(null);
  const [slotEditorOpen, setSlotEditorOpen] = useState(false);
  const [editingTargetMode, setEditingTargetMode] = useState<EditingTargetMode>('artwork-slots');
  const [slotTransformMode, setSlotTransformMode] = useState<SlotTransformMode>('translate');
  const [curatorSpaces, setCuratorSpaces] = useState<CuratorSpaceSummary[]>([]);
  const [selectedCuratorSpaceId, setSelectedCuratorSpaceId] = useState<number | null>(null);
  const [selectedCuratorSpace, setSelectedCuratorSpace] = useState<CuratorSpaceDetail | null>(null);
  const [slotDrafts, setSlotDrafts] = useState<SlotDraft[]>([]);
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(null);
  const [slotLoadState, setSlotLoadState] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle');
  const [slotLoadError, setSlotLoadError] = useState<string | null>(null);
  const [slotSaving, setSlotSaving] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [slotToast, setSlotToast] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [hasAuthToken, setHasAuthToken] = useState(() => apiService.hasAuthTokens());
  const historySessionRef = useRef<HistorySession>(null);

  const handleAssemblyPieceError = useCallback((pieceLabel: string, message: string) => {
    setErrorToast(`Failed to load ${pieceLabel}: ${message}`);
  }, []);

  const handleTransformStart = useCallback(() => {
    setCameraLockActive(true);
    setOrbitEnabled(false);
  }, []);

  const handleTransformEnd = useCallback(() => {
    setCameraLockActive(false);
    setOrbitEnabled(true);
  }, []);

  const handleEditingTargetModeChange = useCallback((mode: EditingTargetMode) => {
    setEditingTargetMode(mode);
    if (mode === 'artwork-space') {
      setPanelOpen(true);
      setSlotEditorOpen(false);
      setSelectedSlotKey(null);
      return;
    }

    setSlotEditorOpen(true);
    setPanelOpen(false);
    setSelectedKey(null);
  }, []);

  const bumpRevision = useCallback(() => {
    setRevision((value) => value + 1);
  }, []);

  const snapshot = useMemo<TransformSnapshot>(() => {
    return buildSnapshotFromObjects(objectRefs, assemblyPieces);
  }, [assemblyPieces, revision]);

  const selectedEntry = selectedKey ? snapshot[selectedKey] : null;
  const currentAssemblySnapshot = normalizeAssemblySnapshot({
    selectedKey,
    pieces: snapshot,
  } as RoomMergeAssemblySnapshot, assemblyPieces);
  const comparisonRows = useMemo(
    () => (compareSnapshot ? buildSnapshotDiff(currentAssemblySnapshot, compareSnapshot.snapshot, assemblyPieces) : []),
    [assemblyPieces, compareSnapshot, currentAssemblySnapshot]
  );
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;
  const captureSnapshot = useCallback(() => {
    return normalizeAssemblySnapshot({
      selectedKey,
      pieces: buildSnapshotFromObjects(objectRefs, assemblyPieces),
    }, assemblyPieces);
  }, [assemblyPieces, selectedKey]);

  const beginEditSession = useCallback((kind: EditKind) => {
    if (historySessionRef.current) {
      return;
    }

    historySessionRef.current = {
      kind,
      before: captureSnapshot(),
    };
  }, [captureSnapshot]);

  const finalizeEditSession = useCallback(() => {
    const session = historySessionRef.current;
    if (!session) return;

    const after = captureSnapshot();
    if (!snapshotsEqual(session.before, after)) {
      setUndoStack((current) => [cloneAssemblySnapshot(session.before, assemblyPieces), ...current].slice(0, 25));
      setRedoStack([]);
    }
    historySessionRef.current = null;
  }, [assemblyPieces, captureSnapshot]);

  useEffect(() => {
    if (!selectedKey || !selectedEntry) {
      return;
    }

    setPositionDraft({
      x: formatCoordinate(selectedEntry.position[0]),
      y: formatCoordinate(selectedEntry.position[1]),
      z: formatCoordinate(selectedEntry.position[2]),
    });
    setRotationDraft({
      x: formatCoordinate(selectedEntry.rotation[0]),
      y: formatCoordinate(selectedEntry.rotation[1]),
      z: formatCoordinate(selectedEntry.rotation[2]),
    });
  }, [selectedEntry, selectedKey, revision]);

  useEffect(() => {
    if (!successToast) return;
    const timeout = window.setTimeout(() => setSuccessToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [successToast]);

  useEffect(() => {
    if (!errorToast) return;
    const timeout = window.setTimeout(() => setErrorToast(null), 5200);
    return () => window.clearTimeout(timeout);
  }, [errorToast]);

  useEffect(() => {
    if (!slotToast) return;
    const timeout = window.setTimeout(() => setSlotToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [slotToast]);

  useEffect(() => {
    const handleAuthChange = () => {
      setHasAuthToken(apiService.hasAuthTokens());
    };

    window.addEventListener('digital-twin-auth-changed', handleAuthChange as EventListener);
    return () => {
      window.removeEventListener('digital-twin-auth-changed', handleAuthChange as EventListener);
    };
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      setRouteContext(parseExperimentRoute());
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  useEffect(() => {
    if (routeContext.spaceId === null) {
      return;
    }

    setSelectedCuratorSpaceId(routeContext.spaceId);
    setSlotEditorOpen(true);
  }, [routeContext.spaceId]);

  useEffect(() => {
    if (!hasAuthToken) {
      setCuratorSpaces([]);
      setSelectedCuratorSpace(null);
      setSelectedCuratorSpaceId(null);
      setSlotDrafts([]);
      setSelectedSlotKey(null);
      setSlotLoadState('idle');
      setSlotLoadError(null);
      return;
    }

    let active = true;

    const loadCuratorSpaces = async () => {
      try {
        const response = await apiService.listCuratorSpaces();
        if (!active) return;

        setCuratorSpaces(response.items);
        setSlotLoadError(null);

        const candidateId =
          routeContext.spaceId ?? selectedCuratorSpaceId ?? response.items[0]?.id ?? null;

        if (candidateId === null) {
          setSelectedCuratorSpace(null);
          setSelectedCuratorSpaceId(null);
          setSlotDrafts([]);
          setSelectedSlotKey(null);
          setSlotLoadState('empty');
          return;
        }

        if (candidateId !== selectedCuratorSpaceId) {
          setSelectedCuratorSpaceId(candidateId);
          return;
        }

        setSlotLoadState('loading');
        const detail = await apiService.getCuratorSpace(candidateId);
        if (!active) return;
        setSelectedCuratorSpace(detail);
        setAssemblyPieces(buildAssemblyPiecesFromFiles(detail.files ?? []));
        setSlotDrafts(detail.slots.map(normalizeSlotDraft));
        setSelectedSlotKey(detail.slots[0]?.slotKey ?? null);
        setSlotLoadState(detail.slots.length ? 'ready' : 'empty');
      } catch (error) {
        if (!active) return;
        setSlotLoadState('error');
        setSlotLoadError(error instanceof Error ? error.message : 'Failed to load curator spaces.');
      }
    };

    void loadCuratorSpaces();

    return () => {
      active = false;
    };
  }, [hasAuthToken, routeContext.spaceId, selectedCuratorSpaceId]);

  useEffect(() => {
    if (!hasAuthToken || selectedCuratorSpaceId === null) {
      return;
    }

    let active = true;
    const loadCuratorSpaceDetail = async () => {
      setSlotLoadState('loading');
      try {
        const detail = await apiService.getCuratorSpace(selectedCuratorSpaceId);
        if (!active) return;
        setSelectedCuratorSpace(detail);
        setAssemblyPieces(buildAssemblyPiecesFromFiles(detail.files ?? []));
        setSlotDrafts(detail.slots.map(normalizeSlotDraft));
        setSelectedSlotKey(detail.slots[0]?.slotKey ?? null);
        setSlotLoadState(detail.slots.length ? 'ready' : 'empty');
        setSlotLoadError(null);
      } catch (error) {
        if (!active) return;
        setSlotLoadState('error');
        setSlotLoadError(error instanceof Error ? error.message : 'Failed to load curator space detail.');
      }
    };

    void loadCuratorSpaceDetail();

    return () => {
      active = false;
    };
  }, [hasAuthToken, selectedCuratorSpaceId]);

  useEffect(() => {
    if (slotDrafts.length === 0) {
      setSelectedSlotKey(null);
      return;
    }

    if (selectedSlotKey && slotDrafts.some((slot) => slot.slotKey === selectedSlotKey)) {
      return;
    }

    setSelectedSlotKey(slotDrafts[0]?.slotKey ?? null);
  }, [selectedSlotKey, slotDrafts]);

  useEffect(() => {
    if (editingTargetMode === 'artwork-slots') {
      setSelectedKey(null);
      return;
    }

    setSelectedSlotKey(null);
  }, [editingTargetMode]);

  useEffect(() => {
    if (!hasAuthToken) {
      setLoadState('empty');
      setLoadError(null);
      setHistorySnapshots([]);
      setPresetSnapshots([]);
      setLatestSnapshot(null);
      return;
    }

    let active = true;

    const loadSnapshots = async () => {
      setLoadState('loading');
      try {
        const [latestResult, historyResult, presetResult] = await Promise.allSettled([
          apiService.getLatestRoomMergeSnapshot(EXPERIMENT_KEY),
          apiService.listRoomMergeSnapshots(EXPERIMENT_KEY, 12),
          apiService.listRoomMergePresets(EXPERIMENT_KEY, 20),
        ]);

        if (!active) return;

        if (latestResult.status === 'fulfilled') {
          if (latestResult.value.snapshot) {
            setLatestSnapshot(latestResult.value.snapshot);
            setLoadState('ready');
          } else {
            setLatestSnapshot(null);
            setLoadState('empty');
          }
          setLoadError(null);
        } else {
          setLatestSnapshot(null);
          setLoadState('error');
          setLoadError(
            latestResult.reason instanceof Error
              ? latestResult.reason.message
              : 'Failed to load room merge snapshot.'
          );
        }

        if (historyResult.status === 'fulfilled') {
          setHistorySnapshots(historyResult.value.items);
          setHistoryError(null);
        } else {
          setHistorySnapshots([]);
          setHistoryError(
            historyResult.reason instanceof Error
              ? historyResult.reason.message
              : 'Failed to load room merge snapshot history.'
          );
        }
        if (presetResult.status === 'fulfilled') {
          setPresetSnapshots(presetResult.value.items);
          setPresetError(null);
        } else {
          setPresetSnapshots([]);
          setPresetError(
            presetResult.reason instanceof Error
              ? presetResult.reason.message
              : 'Failed to load preset list.'
          );
        }
      } catch (error) {
        if (!active) return;
        setLatestSnapshot(null);
        setHistorySnapshots([]);
        setPresetSnapshots([]);
        setLoadState('error');
        setLoadError(error instanceof Error ? error.message : 'Failed to load room merge snapshot.');
      }
    };

    void loadSnapshots();

    return () => {
      active = false;
    };
  }, [hasAuthToken]);

  useEffect(() => {
    if (!sceneReady || !latestSnapshot) {
      return;
    }

    if (appliedSnapshotIdRef.current === latestSnapshot.id) {
      return;
    }

    applySnapshotToObjects(objectRefs, latestSnapshot.snapshot, assemblyPieces);

    const nextSelectedKey = isAssemblyPieceKey(latestSnapshot.selectedKey, assemblyPieces)
      ? latestSnapshot.selectedKey
      : isAssemblyPieceKey(latestSnapshot.snapshot.selectedKey, assemblyPieces)
        ? latestSnapshot.snapshot.selectedKey
        : assemblyPieces[0]?.key ?? null;

    if (nextSelectedKey !== selectedKey) {
      setSelectedKey(nextSelectedKey);
    }

    appliedSnapshotIdRef.current = latestSnapshot.id;
    bumpRevision();
  }, [assemblyPieces, bumpRevision, latestSnapshot, sceneReady, selectedKey]);

  const applyAssemblySnapshot = useCallback(
    (
      nextSnapshot: RoomMergeAssemblySnapshot,
      options?: {
        selectedKey?: string | null;
        recordHistory?: boolean;
        toast?: string;
      }
    ) => {
      const normalized = normalizeAssemblySnapshot(nextSnapshot, assemblyPieces);
      const currentSnapshot = captureSnapshot();

      if (options?.recordHistory !== false && !snapshotsEqual(currentSnapshot, normalized)) {
        setUndoStack((current) => [cloneAssemblySnapshot(currentSnapshot, assemblyPieces), ...current].slice(0, 25));
        setRedoStack([]);
      }

      applySnapshotToObjects(objectRefs, {
        selectedKey: normalized.selectedKey,
        pieces: normalized.pieces,
      }, assemblyPieces);

      const nextSelectedKey = isAssemblyPieceKey(options?.selectedKey ?? normalized.selectedKey, assemblyPieces)
        ? (options?.selectedKey ?? normalized.selectedKey)
        : assemblyPieces[0]?.key ?? null;

      setSelectedKey(nextSelectedKey);
      setPanelOpen(true);
      bumpRevision();
      if (options?.toast) {
        setSuccessToast(options.toast);
      }
    },
    [assemblyPieces, bumpRevision, captureSnapshot]
  );

  const applySnapshotToScene = useCallback(
    (snapshot: RoomMergeExperimentSnapshotResponse) => {
      applyAssemblySnapshot(snapshot.snapshot, {
        selectedKey: snapshot.selectedKey ?? snapshot.snapshot.selectedKey,
        toast: `Loaded snapshot #${snapshot.id}`,
      });
      appliedSnapshotIdRef.current = snapshot.id;
      setLatestSnapshot(snapshot);
      setCompareSnapshot(snapshot);
    },
    [applyAssemblySnapshot]
  );

  const applyPresetToScene = useCallback(
    (preset: RoomMergePresetResponse) => {
      applyAssemblySnapshot(preset.snapshot, {
        selectedKey: preset.selectedKey ?? preset.snapshot.selectedKey,
        toast: `Applied preset "${preset.presetName}"`,
      });
      setCompareSnapshot(preset);
    },
    [applyAssemblySnapshot]
  );

  useEffect(() => {
    const presetId = routeContext.presetId;
    if (!hasAuthToken || presetId === null) {
      return;
    }

    let active = true;

    const loadRoutePreset = async () => {
      try {
        const preset = await apiService.getRoomMergePreset(presetId);
        if (!active) return;

        cacheRoomMergePreset(preset);
        pendingPresetRef.current = preset;
        setSelectedCuratorSpaceId(preset.spaceId ?? null);
        setPresetNameDraft(preset.presetName);
        setPresetMemoDraft(preset.memo ?? '');
        setSlotEditorOpen(true);
      } catch (error) {
        if (!active) return;

        const cachedPreset = readCachedRoomMergePreset(presetId);
        if (cachedPreset) {
          pendingPresetRef.current = cachedPreset;
          setSelectedCuratorSpaceId(cachedPreset.spaceId ?? routeContext.spaceId ?? null);
          setPresetNameDraft(cachedPreset.presetName);
          setPresetMemoDraft(cachedPreset.memo ?? '');
          setSlotEditorOpen(true);
          setSuccessToast(`Loaded cached layout "${cachedPreset.presetName}"`);
          return;
        }

        setErrorToast(error instanceof Error ? error.message : 'Failed to load saved layout.');
        window.location.hash = buildExperimentHash({
          spaceId: routeContext.spaceId ?? null,
        });
      }
    };

    void loadRoutePreset();

    return () => {
      active = false;
    };
  }, [hasAuthToken, routeContext.presetId]);

  useEffect(() => {
    if (!sceneReady || pendingPresetRef.current === null) {
      return;
    }

    const preset = pendingPresetRef.current;
    pendingPresetRef.current = null;
    applyPresetToScene(preset);
  }, [applyPresetToScene, sceneReady]);

  useEffect(() => {
    if (!selectedCuratorSpace) {
      setAssemblyPieces(EMPTY_ASSEMBLY_PIECES);
      setSelectedKey(null);
      return;
    }

    const nextPieces = buildAssemblyPiecesFromFiles(selectedCuratorSpace.files ?? []);
    setAssemblyPieces(nextPieces);

    if (nextPieces.length === 0) {
      setSelectedKey(null);
      setPanelOpen(false);
      setErrorToast('업로드한 glb파일이 없습니다.');
      return;
    }

    setErrorToast(null);
    setSelectedKey((current) =>
      current && nextPieces.some((piece) => piece.key === current)
        ? current
        : nextPieces[0]?.key ?? null,
    );
  }, [selectedCuratorSpace]);

  const registerObject = useCallback((key: string, object: Group | null) => {
    objectRefs.current[key] = object;
    const allRegistered = assemblyPieces.length > 0 && assemblyPieces.every((piece) => objectRefs.current[piece.key] != null);
    setSceneReady(allRegistered);
  }, [assemblyPieces]);

  const selectPiece = useCallback((key: string) => {
    if (editingTargetMode !== 'artwork-space') {
      return;
    }
    setSelectedKey(key);
    setSelectedSlotKey(null);
  }, [editingTargetMode]);

  const mutatePiece = useCallback(
    (
      key: string,
      nextPosition?: [number, number, number],
      nextRotation?: [number, number, number]
    ) => {
      const object = objectRefs.current[key];
      if (!object) return false;

      if (nextPosition) {
        object.position.set(nextPosition[0], nextPosition[1], nextPosition[2]);
      }
      if (nextRotation) {
        object.rotation.set(nextRotation[0], nextRotation[1], nextRotation[2]);
      }
      object.updateMatrixWorld(true);
      bumpRevision();
      return true;
    },
    [bumpRevision]
  );

  const registerSlotObject = useCallback((key: string, object: Group | null) => {
    slotObjectRefs.current[key] = object;
  }, []);

  const syncSlotDraftFromObject = useCallback((slotKey: string) => {
    const object = slotObjectRefs.current[slotKey];
    if (!object) return;

    const nextPosition: SpaceVector3 = {
      x: object.position.x,
      y: object.position.y,
      z: object.position.z,
    };
    const nextRotation: SpaceVector3 = {
      x: object.rotation.x,
      y: object.rotation.y,
      z: object.rotation.z,
    };

    setSlotDrafts((current) =>
      current.map((slot) =>
        slot.slotKey === slotKey
          ? {
              ...slot,
              position: nextPosition,
              rotation: nextRotation,
            }
          : slot,
      ),
    );
  }, []);

  const selectSlot = useCallback(
    (slotKey: string) => {
      if (editingTargetMode !== 'artwork-slots') {
        return;
      }
      setSelectedSlotKey(slotKey);
      setSelectedKey(null);
    },
    [editingTargetMode],
  );

  const updateSlotDraft = useCallback((slotKey: string, patch: Partial<SlotDraft>) => {
    setSlotDrafts((current) =>
      current.map((slot) =>
        slot.slotKey === slotKey
          ? {
              ...slot,
              ...patch,
              position: patch.position ? { ...slot.position, ...patch.position } : slot.position,
              rotation: patch.rotation ? { ...slot.rotation, ...patch.rotation } : slot.rotation,
            }
          : slot,
      ),
    );
  }, []);

  const resetAll = useCallback(() => {
    applyAssemblySnapshot(emptyAssemblySnapshot(assemblyPieces), {
      selectedKey: assemblyPieces[0]?.key ?? null,
      toast: 'Reset all room transforms.',
    });
  }, [assemblyPieces, applyAssemblySnapshot]);

  const copyPositions = useCallback(async () => {
    try {
      const payload: RoomMergeAssemblySnapshot = {
        selectedKey,
        pieces: snapshot,
      };
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setSuccessToast('Copied current positions to clipboard.');
    } catch (error) {
      setErrorToast(error instanceof Error ? error.message : 'Failed to copy positions.');
    }
  }, [selectedKey, snapshot]);

  const saveSnapshot = useCallback(async () => {
    setIsSaving(true);
    setHistoryError(null);
    setErrorToast(null);

    try {
      const savePayload = {
        selectedKey,
        pieces: snapshot,
      };
      const response = await apiService.saveRoomMergeSnapshot({
        experimentKey: EXPERIMENT_KEY,
        spaceId: selectedCuratorSpaceId,
        selectedKey,
        memo: memoDraft || null,
        snapshot: {
          selectedKey: savePayload.selectedKey,
          pieces: savePayload.pieces,
        },
      });

      appliedSnapshotIdRef.current = response.snapshot.id;
      setLatestSnapshot(response.snapshot);
      setHistorySnapshots((current) => {
        const deduped = current.filter((item) => item.id !== response.snapshot.id);
        return [response.snapshot, ...deduped].slice(0, 12);
      });
      setLoadState('ready');
      setLoadError(null);
      setMemoDraft(response.snapshot.memo ?? memoDraft);
      setSuccessToast(`Saved snapshot #${response.snapshot.id}`);
    } catch (error) {
      setErrorToast(error instanceof Error ? error.message : 'Failed to save room merge snapshot.');
    } finally {
      setIsSaving(false);
    }
  }, [memoDraft, selectedCuratorSpaceId, selectedKey, snapshot]);

  const savePreset = useCallback(async () => {
    if (!presetNameDraft.trim()) {
      setErrorToast('Preset name is required.');
      return;
    }

    setIsSaving(true);
    setPresetError(null);
    setErrorToast(null);

    try {
      const response = await apiService.saveRoomMergePreset({
        experimentKey: EXPERIMENT_KEY,
        spaceId: selectedCuratorSpaceId,
        presetName: presetNameDraft.trim(),
        selectedKey,
        memo: presetMemoDraft || memoDraft || null,
        snapshot: {
          selectedKey,
          pieces: snapshot,
        },
      });

      setPresetSnapshots((current) => {
        const deduped = current.filter((item) => item.id !== response.id);
        return [response, ...deduped].slice(0, 20);
      });
      cacheRoomMergePreset(response);
      setSuccessToast(`Saved preset "${response.presetName}"`);
    } catch (error) {
      setErrorToast(error instanceof Error ? error.message : 'Failed to save preset.');
    } finally {
      setIsSaving(false);
    }
  }, [memoDraft, presetMemoDraft, presetNameDraft, selectedCuratorSpaceId, selectedKey, snapshot]);

  const undo = useCallback(() => {
    if (!undoStack.length) return;

    const target = undoStack[0];
    const currentSnapshot = captureSnapshot();
    setUndoStack((current) => current.slice(1));
    setRedoStack((current) => [cloneAssemblySnapshot(currentSnapshot, assemblyPieces), ...current].slice(0, 25));
    applySnapshotToObjects(objectRefs, target, assemblyPieces);
    setSelectedKey(isAssemblyPieceKey(target.selectedKey, assemblyPieces) ? target.selectedKey : assemblyPieces[0]?.key ?? null);
    bumpRevision();
    setSuccessToast('Undid last change.');
  }, [assemblyPieces, captureSnapshot, bumpRevision, undoStack]);

  const redo = useCallback(() => {
    if (!redoStack.length) return;

    const target = redoStack[0];
    const currentSnapshot = captureSnapshot();
    setRedoStack((current) => current.slice(1));
    setUndoStack((current) => [cloneAssemblySnapshot(currentSnapshot, assemblyPieces), ...current].slice(0, 25));
    applySnapshotToObjects(objectRefs, target, assemblyPieces);
    setSelectedKey(isAssemblyPieceKey(target.selectedKey, assemblyPieces) ? target.selectedKey : assemblyPieces[0]?.key ?? null);
    bumpRevision();
    setSuccessToast('Redid last change.');
  }, [assemblyPieces, captureSnapshot, bumpRevision, redoStack]);

  const toggleAxisLock = useCallback((axis: AxisKey) => {
    setLockedAxes((current) => ({
      ...current,
      [axis]: !current[axis],
    }));
  }, []);

  const handlePositionChange = useCallback(
    (axis: 'x' | 'y' | 'z', value: string) => {
      if (lockedAxes[axis]) return;
      setPositionDraft((current) => ({
        ...current,
        [axis]: value,
      }));

      if (!selectedKey) return;
      const currentEntry = snapshot[selectedKey];
      if (!currentEntry) return;

      const parsed = value === '' ? Number.NaN : Number(value);
      if (Number.isNaN(parsed)) {
        return;
      }

      const nextPosition: [number, number, number] = [...currentEntry.position] as [
        number,
        number,
        number,
      ];
      const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
      nextPosition[axisIndex] = parsed;
      mutatePiece(selectedKey, nextPosition, currentEntry.rotation);
    },
    [lockedAxes, mutatePiece, selectedKey, snapshot]
  );

  const handleRotationChange = useCallback(
    (axis: 'x' | 'y' | 'z', value: string) => {
      if (lockedAxes[axis]) return;
      setRotationDraft((current) => ({
        ...current,
        [axis]: value,
      }));

      if (!selectedKey) return;
      const currentEntry = snapshot[selectedKey];
      if (!currentEntry) return;

      const parsed = value === '' ? Number.NaN : Number(value);
      if (Number.isNaN(parsed)) {
        return;
      }

      const nextRotation: [number, number, number] = [...currentEntry.rotation] as [
        number,
        number,
        number,
      ];
      const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
      nextRotation[axisIndex] = parsed;
      mutatePiece(selectedKey, currentEntry.position, nextRotation);
    },
    [lockedAxes, mutatePiece, selectedKey, snapshot]
  );

  const handlePositionFocus = useCallback(() => {
    beginEditSession('position');
  }, [beginEditSession]);

  const handlePositionBlur = useCallback(() => {
    finalizeEditSession();
  }, [finalizeEditSession]);

  const handleRotationFocus = useCallback(() => {
    beginEditSession('rotation');
  }, [beginEditSession]);

  const handleRotationBlur = useCallback(() => {
    finalizeEditSession();
  }, [finalizeEditSession]);

  const refreshCuratorSpaces = useCallback(async () => {
    const response = await apiService.listCuratorSpaces();
    setCuratorSpaces(response.items);
    return response.items;
  }, []);

  const loadSelectedCuratorSpaceDetail = useCallback(
    async (spaceId: number) => {
      setSlotLoadState('loading');
      setSlotLoadError(null);
      const detail = await apiService.getCuratorSpace(spaceId);
      setSelectedCuratorSpace(detail);
      setAssemblyPieces(buildAssemblyPiecesFromFiles(detail.files ?? []));
      setSlotDrafts(detail.slots.map(normalizeSlotDraft));
      setSelectedSlotKey(detail.slots[0]?.slotKey ?? null);
      setSlotLoadState(detail.slots.length ? 'ready' : 'empty');
      return detail;
    },
    [],
  );

  const handleSelectCuratorSpace = useCallback(
    (spaceId: number) => {
      setSelectedCuratorSpaceId(spaceId);
      handleEditingTargetModeChange('artwork-slots');
    },
    [handleEditingTargetModeChange],
  );

  const handleReloadCuratorSpace = useCallback(() => {
    if (selectedCuratorSpaceId === null) {
      setSlotError('먼저 curator space를 선택하세요.');
      return;
    }

    void loadSelectedCuratorSpaceDetail(selectedCuratorSpaceId).catch((error: unknown) => {
      setSlotLoadState('error');
      setSlotLoadError(error instanceof Error ? error.message : 'Failed to reload curator space.');
    });
  }, [loadSelectedCuratorSpaceDetail, selectedCuratorSpaceId]);

  const handleCreateSpaceShortcut = useCallback(() => {
    window.location.hash = '#/debug/curator-space-management';
  }, []);

  const handleReturnToProfile = useCallback(() => {
    if (selectedCuratorSpaceId == null) {
      window.location.hash = '#/debug/curator-workspace';
      return;
    }

    window.location.hash = `#/debug/curator-workspace?spaceId=${selectedCuratorSpaceId}`;
  }, [selectedCuratorSpaceId]);

  const handleAddSlot = useCallback(() => {
    if (selectedCuratorSpaceId === null) {
      setSlotError('먼저 curator space를 선택하세요.');
      return;
    }

    if (slotDrafts.length >= 50) {
      setSlotError('Slot count cannot exceed 50.');
      return;
    }

    const nextSlot = createSlotDraft(slotDrafts.length, selectedCuratorSpaceId);
    setSlotDrafts((current) => [...current, nextSlot]);
    setSelectedSlotKey(nextSlot.slotKey);
    setSelectedKey(null);
    handleEditingTargetModeChange('artwork-slots');
    setSlotLoadState('ready');
  }, [handleEditingTargetModeChange, selectedCuratorSpaceId, slotDrafts.length]);

  const handleRemoveSlot = useCallback(() => {
    if (!selectedSlotKey) {
      setSlotError('삭제할 slot을 선택하세요.');
      return;
    }

    delete slotObjectRefs.current[selectedSlotKey];
    setSlotDrafts((current) => {
      const nextSlots = current.filter((slot) => slot.slotKey !== selectedSlotKey);
      setSelectedSlotKey(nextSlots[0]?.slotKey ?? null);
      setSlotLoadState(nextSlots.length ? 'ready' : 'empty');
      return nextSlots;
    });
  }, [selectedSlotKey]);

  const handleSaveSlots = useCallback(async () => {
    if (!selectedCuratorSpace) {
      setSlotError('먼저 curator space를 선택하세요.');
      return;
    }

    if (slotDrafts.length > 50) {
      setSlotError('Slot count cannot exceed 50.');
      return;
    }

    setSlotSaving(true);
    setSlotError(null);
    try {
      const detail = await apiService.saveCuratorSpaceSlots(selectedCuratorSpace.id, {
        slots: slotDrafts.map(slotDraftToRequest),
      });
      setSelectedCuratorSpace(detail);
      setSlotDrafts(detail.slots.map(normalizeSlotDraft));
      setSelectedSlotKey(detail.slots[0]?.slotKey ?? null);
      setSlotLoadState(detail.slots.length ? 'ready' : 'empty');
      await refreshCuratorSpaces();
      setSlotToast(`Saved ${detail.slots.length} slots.`);
    } catch (error) {
      setSlotError(error instanceof Error ? error.message : 'Failed to save curator slots.');
      setSlotLoadState('error');
    } finally {
      setSlotSaving(false);
    }
  }, [refreshCuratorSpaces, selectedCuratorSpace, slotDrafts]);

  const handleSlotChange = useCallback((slotKey: string, patch: Partial<SlotDraft>) => {
    updateSlotDraft(slotKey, patch);
    if (patch.position || patch.rotation) {
      const object = slotObjectRefs.current[slotKey];
      if (object) {
        if (patch.position) {
          object.position.set(
            patch.position.x ?? object.position.x,
            patch.position.y ?? object.position.y,
            patch.position.z ?? object.position.z,
          );
        }
        if (patch.rotation) {
          object.rotation.set(
            patch.rotation.x ?? object.rotation.x,
            patch.rotation.y ?? object.rotation.y,
            patch.rotation.z ?? object.rotation.z,
          );
        }
        object.updateMatrixWorld(true);
      }
    }
  }, [updateSlotDraft]);

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
        <div className="relative h-screen">
        <ErrorBoundary assetLabel="room-assembly">
          <Canvas
            className="h-full w-full"
            camera={{ position: CAMERA_POSITION, fov: 38, near: 0.1, far: 120 }}
            shadows
            onPointerMissed={() => {
              // No-op: selection is handled on the mesh pieces so background clicks stay free for orbit.
            }}
          >
            <Suspense fallback={<Loader />}>
              <AssemblyScene
                assemblyPieces={assemblyPieces}
                selectedKey={selectedKey}
                isInteractive={editingTargetMode === 'artwork-space'}
                onSelectKey={selectPiece}
                registerObject={registerObject}
                lockedAxes={lockedAxes}
                orbitControlsRef={orbitControlsRef}
                orbitEnabled={orbitEnabled}
                cameraLockActive={cameraLockActive}
                onTransformStart={handleTransformStart}
                onTransformEnd={handleTransformEnd}
                onObjectChange={bumpRevision}
                onPieceError={handleAssemblyPieceError}
              />
              {slotDrafts.length > 0 ? (
                <SlotScene
                  slots={slotDrafts}
                  selectedSlotKey={selectedSlotKey}
                  isInteractive={editingTargetMode === 'artwork-slots'}
                  mode={slotTransformMode}
                  registerObject={registerSlotObject}
                  onSelectSlot={selectSlot}
                  orbitControlsRef={orbitControlsRef}
                  orbitEnabled={orbitEnabled}
                  cameraLockActive={cameraLockActive}
                  onTransformStart={handleTransformStart}
                  onTransformEnd={handleTransformEnd}
                  onObjectChange={() => {
                    if (selectedSlotKey) {
                      syncSlotDraftFromObject(selectedSlotKey);
                    }
                  }}
                />
              ) : null}
            </Suspense>
          </Canvas>
        </ErrorBoundary>

        {editingTargetMode === 'artwork-space' ? (
          <RoomMergeOverlay
            open={panelOpen}
            editingTargetMode={editingTargetMode}
            onEditingTargetModeChange={handleEditingTargetModeChange}
            selectedKey={selectedKey}
            snapshot={snapshot}
            positionDraft={positionDraft}
            rotationDraft={rotationDraft}
            lockedAxes={lockedAxes}
            memoDraft={memoDraft}
            presetNameDraft={presetNameDraft}
            presetMemoDraft={presetMemoDraft}
            loadState={loadState}
            loadError={loadError}
            historySnapshots={historySnapshots}
            presetSnapshots={presetSnapshots}
            historyError={historyError}
            presetError={presetError}
            compareSnapshot={compareSnapshot}
            comparisonRows={comparisonRows}
            canUndo={canUndo}
            canRedo={canRedo}
            isSaving={isSaving}
            onToggleOpen={() => setPanelOpen((value) => !value)}
            onSelectPiece={selectPiece}
            onPositionChange={handlePositionChange}
            onRotationChange={handleRotationChange}
            onPositionFocus={handlePositionFocus}
            onPositionBlur={handlePositionBlur}
            onRotationFocus={handleRotationFocus}
            onRotationBlur={handleRotationBlur}
            onResetAll={resetAll}
            onCopyPositions={() => {
              void copyPositions();
            }}
            onReturnToProfile={handleReturnToProfile}
            onSave={() => {
              void saveSnapshot();
            }}
            onUndo={undo}
            onRedo={redo}
            onToggleAxisLock={toggleAxisLock}
            onMemoChange={setMemoDraft}
            onPresetNameChange={setPresetNameDraft}
            onPresetMemoChange={setPresetMemoDraft}
            onSavePreset={() => {
              void savePreset();
            }}
            onApplySnapshot={(snapshotItem) => {
              applySnapshotToScene(snapshotItem);
            }}
            onCompareSnapshot={(snapshotItem) => {
              setCompareSnapshot(snapshotItem);
            }}
            onApplyPreset={(snapshotItem) => {
              applyPresetToScene(snapshotItem);
            }}
            assemblyPieces={assemblyPieces}
          />
        ) : null}

        {editingTargetMode === 'artwork-slots' ? (
          <SlotEditorOverlay
            open={slotEditorOpen}
            editingTargetMode={editingTargetMode}
            spaces={curatorSpaces}
            selectedSpace={selectedCuratorSpace}
            selectedSpaceId={selectedCuratorSpaceId}
            slotDrafts={slotDrafts}
            selectedSlotKey={selectedSlotKey}
            slotTransformMode={slotTransformMode}
            slotLoadState={slotLoadState}
            slotLoadError={slotLoadError}
            slotSaving={slotSaving}
            slotError={slotError}
            slotToast={slotToast}
            onEditingTargetModeChange={handleEditingTargetModeChange}
            onToggleOpen={() => setSlotEditorOpen((value) => !value)}
            onSelectSpace={handleSelectCuratorSpace}
            onCreateSpaceShortcut={handleCreateSpaceShortcut}
            onReloadSpace={handleReloadCuratorSpace}
            onAddSlot={handleAddSlot}
            onRemoveSlot={handleRemoveSlot}
            onSelectSlot={selectSlot}
            onSlotChange={handleSlotChange}
            onModeChange={setSlotTransformMode}
            onSaveSlots={() => {
              void handleSaveSlots();
            }}
            onReturnToProfile={handleReturnToProfile}
          />
        ) : null}

        {successToast ? (
          <ToastBanner
            tone="success"
            title="Success"
            message={successToast}
            placement="top-right"
            onDismiss={() => setSuccessToast(null)}
          />
        ) : null}

        {errorToast ? (
          <ToastBanner
            tone="error"
            title="Failure"
            message={errorToast}
            placement="bottom-right"
            onDismiss={() => setErrorToast(null)}
          />
        ) : null}
      </div>
    </div>
  );
};

export default RoomMergeExperimentPage;
