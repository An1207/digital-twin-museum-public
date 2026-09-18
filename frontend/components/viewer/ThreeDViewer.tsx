import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Html, PerspectiveCamera, useGLTF, useProgress, useTexture } from '@react-three/drei';
import { Box3, DoubleSide, Group, Mesh, SRGBColorSpace, Texture, Vector3 } from 'three';
import type { Artwork, CuratorSpaceComponent, Placement, SpaceVector3 } from '../../types/curation';
import { FirstPersonController } from './FirstPersonController';
import { resolveArtworkImageUrl } from '../../lib/imagePaths';
import { useModalPointerPolicy } from '../../lib/useModalPointerPolicy';
import { shouldIgnoreKeyboardNavigation } from '../../lib/navigationKeyboard';
import { apiService } from '../../lib/api';

interface CameraPos {
  x: number;
  z: number;
  dir: { x: number; z: number };
}

interface GalleryNavigationTarget {
  key: string;
  label: string;
  x: number;
  z: number;
  dir: CameraPos['dir'];
}

declare global {
  interface Window {
    __galleryCameraPos?: CameraPos;
  }
}

interface ThreeDViewerProps {
  placements: Placement[];
  spaceComponents?: CuratorSpaceComponent[];
  entrySlotNumber?: number;
  presentationMode?: 'immediate' | 'sequential';
  onArtworkClick?: (artwork: Artwork) => void;
  suppressSpeedPrompt?: boolean;
}

type MuseumModelKind = 'room' | 'center';

interface SplitMuseumModelConfig {
  key: string;
  path: string;
  position: [number, number, number];
  rotation: [number, number, number];
  enabled: boolean;
  kind: MuseumModelKind;
}

const LEGACY_MODEL_PATH = '/models/base_3d_model.glb';
const LEGACY_MODEL_POSITION: [number, number, number] = [0, 0.2, 0];
const DEFAULT_EYE_HEIGHT = 0.1;
const HEIGHT_STEP = 0.2;
const MIN_EYE_HEIGHT = 0.1;
const MAX_EYE_HEIGHT = 1.9;
const CENTER_NAVIGATION_TARGET: GalleryNavigationTarget = {
  key: 'center',
  label: 'Center',
  x: 13.3,
  z: 19.4,
  dir: { x: 0, z: -1 },
};
const GALLERY_NAVIGATION_TARGETS: GalleryNavigationTarget[] = [
  CENTER_NAVIGATION_TARGET,
  { key: 'room1', label: 'Room 1', x: 8.2, z: 9.5, dir: { x: -1, z: 0 } },
  { key: 'room2', label: 'Room 2', x: 8.5, z: 6.9, dir: { x: 0, z: -1 } },
  { key: 'room3', label: 'Room 3', x: 9.3, z: -5.1, dir: { x: -1, z: 0 } },
];
const CAMERA_START_XZ: [number, number] = [CENTER_NAVIGATION_TARGET.x, CENTER_NAVIGATION_TARGET.z];
const CAMERA_LOOK_AT_XZ: [number, number] = [
  CENTER_NAVIGATION_TARGET.x + CENTER_NAVIGATION_TARGET.dir.x,
  CENTER_NAVIGATION_TARGET.z + CENTER_NAVIGATION_TARGET.dir.z,
];
const MUSEUM_BOUNDS = {
  minX: -9,
  maxX: 9,
  minZ: -17,
  maxZ: 17,
};

const ROOM_MODEL_CONFIGS: SplitMuseumModelConfig[] = [
  {
    key: 'room1',
    path: '/models/room1.glb',
    position: [5, 0, 12.2],
    rotation: [0, Math.PI / 2, 0],
    enabled: true,
    kind: 'room',
  },
  {
    key: 'room2',
    path: '/models/room2.glb',
    position: [5, 0, 3.3],
    rotation: [0, Math.PI, 0],
    enabled: true,
    kind: 'room',
  },
  {
    key: 'room3',
    path: '/models/room3.glb',
    position: [5, 0, -7.3],
    rotation: [0, -Math.PI / 2, 0],
    enabled: true,
    kind: 'room',
  },
];

const CENTER_MODEL_CONFIGS: SplitMuseumModelConfig[] = [
  {
    key: 'center',
    path: '/models/center.glb',
    position: [13.5, 0, 6.3],
    rotation: [0, 0, 0],
    enabled: true,
    kind: 'center',
  },
];

const SPLIT_MODEL_CONFIGS = [...ROOM_MODEL_CONFIGS, ...CENTER_MODEL_CONFIGS];

const Loader = () => {
  const { progress } = useProgress();

  return (
    <Html center>
      <div className="flex flex-col items-center gap-4">
        <div className="w-16 h-16 border-4 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-white font-medium">로딩 중... {progress.toFixed(0)}%</p>
      </div>
    </Html>
  );
};

interface MuseumModelProps {
  path: string;
  position: [number, number, number];
  rotation?: [number, number, number];
}

const MuseumModel = ({ path, position, rotation = [0, 0, 0] }: MuseumModelProps) => {
  const { scene } = useGLTF(path);

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

  return (
    <group position={position} rotation={rotation}>
      <primitive object={model} />
    </group>
  );
};

const LegacyFullMuseumModel = () => (
  <MuseumModel path={LEGACY_MODEL_PATH} position={LEGACY_MODEL_POSITION} />
);

const SpaceComponentModel = ({ component }: { component: CuratorSpaceComponent }) => {
  const fileUrl = component.file?.fileUrl ?? '';
  const { scene } = useGLTF(fileUrl, true, true, (loader) => loader.setRequestHeader(apiService.getAssetHeaders(fileUrl)));

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

  return (
    <group
      position={[component.position.x, component.position.y, component.position.z]}
      rotation={[component.rotation.x, component.rotation.y, component.rotation.z]}
      scale={[component.scale.x, component.scale.y, component.scale.z]}
    >
      <primitive object={model} />
    </group>
  );
};

const SpaceComponentAssembly = ({ components }: { components: CuratorSpaceComponent[] }) => {
  const orderedComponents = useMemo(
    () => [...components].sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id),
    [components]
  );

  return (
    <>
      {orderedComponents.map((component) => {
        if (!component.file?.fileUrl) return null;
        return <SpaceComponentModel key={component.id} component={component} />;
      })}
    </>
  );
};

const SplitMuseumAssembly = () => (
  <>
    {SPLIT_MODEL_CONFIGS.filter((config) => config.enabled).map((config) => (
      <MuseumModel
        key={config.key}
        path={config.path}
        position={config.position}
        rotation={config.rotation}
      />
    ))}
  </>
);

const CameraInitialPosition = ({ eyeHeight }: { eyeHeight: number }) => {
  const { camera } = useThree();
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    camera.position.set(CAMERA_START_XZ[0], eyeHeight, CAMERA_START_XZ[1]);
    camera.lookAt(CAMERA_LOOK_AT_XZ[0], eyeHeight - 0.2, CAMERA_LOOK_AT_XZ[1]);
    window.__galleryCameraPos = {
      x: CAMERA_START_XZ[0],
      z: CAMERA_START_XZ[1],
      dir: CENTER_NAVIGATION_TARGET.dir,
    };
  }, [camera, eyeHeight]);

  useEffect(() => {
    if (!initialized.current) return;
    camera.position.y = eyeHeight;
  }, [camera, eyeHeight]);

  return null;
};

const CameraNavigationTarget = ({
  target,
  eyeHeight,
}: {
  target: GalleryNavigationTarget | null;
  eyeHeight: number;
}) => {
  const { camera } = useThree();
  const lastAppliedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!target || lastAppliedKey.current === target.key) return;

    lastAppliedKey.current = target.key;
    camera.position.set(target.x, eyeHeight, target.z);
    camera.lookAt(target.x + target.dir.x, eyeHeight - 0.15, target.z + target.dir.z);
    window.__galleryCameraPos = {
      x: target.x,
      z: target.z,
      dir: target.dir,
    };
  }, [camera, eyeHeight, target]);

  return null;
};

interface SceneProps {
  placements: Placement[];
  spaceComponents: CuratorSpaceComponent[];
  fpsEnabled: boolean;
  onLockChange: (locked: boolean) => void;
  lockSelector?: string;
  moveSpeed: number;
  showBaseModel: boolean;
  eyeHeight: number;
  navigationTarget: GalleryNavigationTarget | null;
  onArtworkClick?: (artwork: Artwork) => void;
  onFocusedArtworkChange: (placement: Placement | null) => void;
  onAssetLoadProgress?: (progress: number) => void;
}

const ARTWORK_BASE_HEIGHT = 1.55;
const ARTWORK_HITBOX_PADDING = 0.42;
const ARTWORK_FOCUS_SCALE = 1.08;
const ARTWORK_FOCUS_ROTATION_OFFSET = 0.02;
const ARTWORK_PROXIMITY_ENTER_DISTANCE = 2.1;
const ARTWORK_PROXIMITY_EXIT_DISTANCE = 2.3;
const DEFAULT_FRAMED_GLB_SIZE = { width: 1.3, height: 1.55, depth: 0.18 };

const getArtworkNumericId = (artwork: Artwork) => {
  const parsed = Number(artwork.id);
  return Number.isFinite(parsed) ? parsed : null;
};

const getPlacementRenderScale = (placement: Placement, frameWidth: number, frameHeight: number) => {
  const slotWidth = placement.slotSize?.width ?? frameWidth;
  const slotHeight = placement.slotSize?.height ?? frameHeight;
  const widthScale = slotWidth / frameWidth;
  const heightScale = slotHeight / frameHeight;
  const slotScale = Math.min(widthScale, heightScale);
  return Number.isFinite(slotScale) && slotScale > 0 ? slotScale : 1;
};

const getPlacementRotation = (placement: Placement): SpaceVector3 => {
  const rotation = placement.position.rotation;
  if (rotation) {
    return rotation;
  }

  return {
    x: 0,
    y: placement.position.rotationY,
    z: 0,
  };
};

const ArtworkTextureMarker = ({
  placement,
  focused,
  registerHitbox,
}: {
  placement: Placement;
  focused: boolean;
  registerHitbox: (artworkId: number, mesh: Mesh | null) => void;
}) => {
  const textureUrl = placement.artwork.imagePath ? resolveArtworkImageUrl(placement.artwork.imagePath) : '';
  const texture = useTexture(textureUrl) as Texture;
  const hitboxRef = useRef<Mesh | null>(null);

  useEffect(() => {
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
  }, [texture]);

  useEffect(() => {
    const artworkId = getArtworkNumericId(placement.artwork);
    if (artworkId === null) return;

    registerHitbox(artworkId, hitboxRef.current);
    return () => registerHitbox(artworkId, null);
  }, [placement.artwork, registerHitbox]);

  const image = texture.image as { width?: number; height?: number } | undefined;
  const aspectRatio = image?.width && image?.height ? image.width / image.height : 0.74;
  const height = ARTWORK_BASE_HEIGHT;
  const width = Math.max(0.95, height * aspectRatio);
  const frameWidth = width + ARTWORK_HITBOX_PADDING;
  const frameHeight = height + ARTWORK_HITBOX_PADDING;
  const artworkScale = focused ? ARTWORK_FOCUS_SCALE : 1;
  const depthOffset = focused ? ARTWORK_FOCUS_ROTATION_OFFSET : 0;
  const slotScale = getPlacementRenderScale(placement, frameWidth, frameHeight);
  const rotation = getPlacementRotation(placement);

  return (
    <group
      position={[placement.position.x, placement.position.y, placement.position.z]}
      rotation={[rotation.x, rotation.y, rotation.z]}
      scale={artworkScale * slotScale}
    >
      <mesh
        ref={hitboxRef}
        userData={{ artworkId: getArtworkNumericId(placement.artwork) }}
        position={[0, 0, depthOffset]}
      >
        <boxGeometry args={[frameWidth, frameHeight, 0.35]} />
        <meshBasicMaterial transparent opacity={0.01} depthWrite={false} />
      </mesh>

      <mesh position={[0, 0, -0.03]}>
        <planeGeometry args={[frameWidth, frameHeight]} />
        <meshBasicMaterial
          color={focused ? '#0f172a' : '#111111'}
          transparent
          opacity={focused ? 0.82 : 0.54}
          side={DoubleSide}
        />
      </mesh>

      <mesh position={[0, 0, 0.01]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={texture} side={DoubleSide} toneMapped={false} />
      </mesh>

      {focused ? (
        <mesh position={[0, 0, 0.04]}>
          <planeGeometry args={[frameWidth * 1.03, frameHeight * 1.03]} />
          <meshBasicMaterial
            color="#fbbf24"
            transparent
            opacity={0}
            side={DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ) : null}
    </group>
  );
};

const ArtworkFallbackMarker = ({
  placement,
  focused,
  registerHitbox,
}: {
  placement: Placement;
  focused: boolean;
  registerHitbox: (artworkId: number, mesh: Mesh | null) => void;
}) => {
  const hitboxRef = useRef<Mesh | null>(null);
  const artworkId = getArtworkNumericId(placement.artwork);
  const slotScale = getPlacementRenderScale(placement, 1.3 + ARTWORK_HITBOX_PADDING, ARTWORK_BASE_HEIGHT + ARTWORK_HITBOX_PADDING);
  const rotation = getPlacementRotation(placement);

  useEffect(() => {
    if (artworkId === null) return;
    registerHitbox(artworkId, hitboxRef.current);
    return () => registerHitbox(artworkId, null);
  }, [artworkId, registerHitbox]);

  return (
    <group
      position={[placement.position.x, placement.position.y, placement.position.z]}
      rotation={[rotation.x, rotation.y, rotation.z]}
      scale={(focused ? ARTWORK_FOCUS_SCALE : 1) * slotScale}
    >
      <mesh ref={hitboxRef} userData={{ artworkId }} position={[0, 0, focused ? ARTWORK_FOCUS_ROTATION_OFFSET : 0]}>
        <boxGeometry args={[1.3 + ARTWORK_HITBOX_PADDING, ARTWORK_BASE_HEIGHT + ARTWORK_HITBOX_PADDING, 0.35]} />
        <meshBasicMaterial transparent opacity={0.01} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0, -0.03]}>
        <planeGeometry args={[1.3 + ARTWORK_HITBOX_PADDING, ARTWORK_BASE_HEIGHT + ARTWORK_HITBOX_PADDING]} />
        <meshBasicMaterial
          color={focused ? '#1f2937' : '#111111'}
          transparent
          opacity={focused ? 0.82 : 0.5}
          side={DoubleSide}
        />
      </mesh>
      <mesh position={[0, 0, 0.01]}>
        <planeGeometry args={[1.3, ARTWORK_BASE_HEIGHT]} />
        <meshBasicMaterial color={focused ? '#93c5fd' : '#64748b'} side={DoubleSide} />
      </mesh>
      {focused ? (
        <mesh position={[0, 0, 0.04]}>
          <planeGeometry args={[1.3 + ARTWORK_HITBOX_PADDING * 1.1, ARTWORK_BASE_HEIGHT + ARTWORK_HITBOX_PADDING * 1.1]} />
          <meshBasicMaterial color="#fbbf24" transparent opacity={0} side={DoubleSide} />
        </mesh>
      ) : null}
    </group>
  );
};

const ArtworkGlbMarker = ({
  placement,
  focused,
  registerHitbox,
}: {
  placement: Placement;
  focused: boolean;
  registerHitbox: (artworkId: number, mesh: Mesh | null) => void;
}) => {
  const glbUrl = placement.artwork.framedGlbUrl ?? '';
  const { scene } = useGLTF(glbUrl);
  const hitboxRef = useRef<Mesh | null>(null);
  const artworkId = getArtworkNumericId(placement.artwork);
  const rotation = getPlacementRotation(placement);
  const modelGroup = useMemo(() => {
    const clonedScene = scene.clone(true);
    clonedScene.traverse((object) => {
      if (object instanceof Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false;
      }
    });

    // Framed GLBs are generated with the face pointing +Y (lying flat).
    // Rotate +π/2 around X so the face points +Z, matching the slot orientation convention
    // used in the curator's slot editor (where rotation_y alone controls facing direction).
    clonedScene.rotation.x = Math.PI / 2;
    clonedScene.updateMatrixWorld(true);

    const bounds = new Box3().setFromObject(clonedScene);
    const size = new Vector3();
    const center = new Vector3();
    bounds.getSize(size);
    bounds.getCenter(center);

    const group = new Group();
    clonedScene.position.set(-center.x, -center.y, -center.z);
    group.add(clonedScene);

    return {
      group,
      size: {
        width: size.x > 0 ? size.x : DEFAULT_FRAMED_GLB_SIZE.width,
        height: size.y > 0 ? size.y : DEFAULT_FRAMED_GLB_SIZE.height,
        depth: size.z > 0 ? size.z : DEFAULT_FRAMED_GLB_SIZE.depth,
      },
    };
  }, [scene]);

  useEffect(() => {
    if (artworkId === null) return;
    registerHitbox(artworkId, hitboxRef.current);
    return () => registerHitbox(artworkId, null);
  }, [artworkId, registerHitbox]);

  const frameWidth = Math.max(modelGroup.size.width, DEFAULT_FRAMED_GLB_SIZE.width) + ARTWORK_HITBOX_PADDING;
  const frameHeight = Math.max(modelGroup.size.height, DEFAULT_FRAMED_GLB_SIZE.height) + ARTWORK_HITBOX_PADDING;
  const frameDepth = Math.max(modelGroup.size.depth, DEFAULT_FRAMED_GLB_SIZE.depth) + ARTWORK_HITBOX_PADDING;
  const slotScale = getPlacementRenderScale(placement, frameWidth, frameHeight);
  const focusScale = focused ? ARTWORK_FOCUS_SCALE : 1;

  return (
    <group
      position={[placement.position.x, placement.position.y, placement.position.z]}
      rotation={[rotation.x, rotation.y, rotation.z]}
      scale={focusScale * slotScale}
    >
      <mesh ref={hitboxRef} userData={{ artworkId }} position={[0, 0, focused ? ARTWORK_FOCUS_ROTATION_OFFSET : 0]}>
        <boxGeometry args={[frameWidth, frameHeight, frameDepth]} />
        <meshBasicMaterial transparent opacity={0.01} depthWrite={false} />
      </mesh>
      <primitive object={modelGroup.group} />
      {focused ? (
        <mesh position={[0, 0, frameDepth / 2 + 0.04]}>
          <planeGeometry args={[frameWidth * 1.05, frameHeight * 1.05]} />
          <meshBasicMaterial color="#fbbf24" transparent opacity={0} side={DoubleSide} depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  );
};

const ArtworkMarker = ({
  placement,
  focused,
  registerHitbox,
}: {
  placement: Placement;
  focused: boolean;
  registerHitbox: (artworkId: number, mesh: Mesh | null) => void;
}) => {
  if (placement.artwork.framedGlbUrl) {
    return <ArtworkGlbMarker placement={placement} focused={focused} registerHitbox={registerHitbox} />;
  }

  if (placement.artwork.imagePath) {
    return <ArtworkTextureMarker placement={placement} focused={focused} registerHitbox={registerHitbox} />;
  }

  return <ArtworkFallbackMarker placement={placement} focused={focused} registerHitbox={registerHitbox} />;
};

const ArtworkInteractionLayer = ({
  placements,
  onArtworkClick,
  onFocusedArtworkChange,
}: {
  placements: Placement[];
  onArtworkClick?: (artwork: Artwork) => void;
  onFocusedArtworkChange: (placement: Placement | null) => void;
}) => {
  const { camera } = useThree();
  const orderedPlacements = useMemo(
    () => [...placements].sort((left, right) => left.slotNumber - right.slotNumber || left.sortValue - right.sortValue),
    [placements]
  );
  const hitboxRefs = useRef(new Map<number, Mesh>());
  const focusedArtworkIdRef = useRef<number | null>(null);
  const [focusedArtworkId, setFocusedArtworkId] = useState<number | null>(null);
  const focusedPlacement = useMemo(
    () => orderedPlacements.find((placement) => getArtworkNumericId(placement.artwork) === focusedArtworkId) ?? null,
    [focusedArtworkId, orderedPlacements]
  );

  const registerHitbox = useCallback((artworkId: number, mesh: Mesh | null) => {
    if (mesh) {
      hitboxRefs.current.set(artworkId, mesh);
      return;
    }
    hitboxRefs.current.delete(artworkId);
  }, []);

  useEffect(() => {
    onFocusedArtworkChange(focusedPlacement);
  }, [focusedPlacement, onFocusedArtworkChange]);

  useEffect(() => {
    const activateFocusedArtwork = () => {
      const placement = orderedPlacements.find((item) => getArtworkNumericId(item.artwork) === focusedArtworkIdRef.current);
      if (!placement || !onArtworkClick) return;
      onArtworkClick(placement.artwork);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Enter') return;
      if (shouldIgnoreKeyboardNavigation(event)) return;
      if (focusedArtworkIdRef.current === null) return;
      event.preventDefault();
      activateFocusedArtwork();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onArtworkClick, orderedPlacements]);

  useFrame(() => {
    if (!orderedPlacements.length) {
      if (focusedArtworkIdRef.current !== null) {
        focusedArtworkIdRef.current = null;
        setFocusedArtworkId(null);
        onFocusedArtworkChange(null);
      }
      return;
    }

    let nearestPlacement: Placement | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const placement of orderedPlacements) {
      const artworkId = getArtworkNumericId(placement.artwork);
      if (artworkId === null) continue;

      const distance = Math.hypot(
        placement.position.x - camera.position.x,
        placement.position.z - camera.position.z
      );
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPlacement = placement;
      }
    }

    const currentFocusedPlacement = focusedArtworkIdRef.current === null
      ? null
      : orderedPlacements.find((placement) => getArtworkNumericId(placement.artwork) === focusedArtworkIdRef.current) ?? null;

    let nextPlacement: Placement | null = null;

    if (nearestPlacement && nearestDistance <= ARTWORK_PROXIMITY_ENTER_DISTANCE) {
      nextPlacement = nearestPlacement;
    } else if (currentFocusedPlacement) {
      const currentDistance = Math.hypot(
        currentFocusedPlacement.position.x - camera.position.x,
        currentFocusedPlacement.position.z - camera.position.z
      );

      if (currentDistance <= ARTWORK_PROXIMITY_EXIT_DISTANCE) {
        nextPlacement = currentFocusedPlacement;
      }
    }

    const nextArtworkId = nextPlacement ? getArtworkNumericId(nextPlacement.artwork) : null;
    if (nextArtworkId === focusedArtworkIdRef.current) {
      return;
    }

    focusedArtworkIdRef.current = nextArtworkId;
    setFocusedArtworkId(nextArtworkId);
    onFocusedArtworkChange(nextPlacement);
  });

  return (
    <>
      {orderedPlacements.map((placement) => (
        <ArtworkMarker
          key={`${placement.slotNumber}-${placement.artwork.id}`}
          placement={placement}
          focused={getArtworkNumericId(placement.artwork) === focusedArtworkIdRef.current}
          registerHitbox={registerHitbox}
        />
      ))}
    </>
  );
};

const Scene = ({
  placements,
  spaceComponents,
  fpsEnabled,
  onLockChange,
  lockSelector,
  moveSpeed,
  showBaseModel,
  eyeHeight,
  navigationTarget,
  onArtworkClick,
  onFocusedArtworkChange,
  onAssetLoadProgress,
}: SceneProps) => {
  const orderedPlacements = useMemo(
    () => [...placements].sort((left, right) => left.slotNumber - right.slotNumber || left.sortValue - right.sortValue),
    [placements]
  );
  const hasCustomSpaceComponents = spaceComponents.length > 0;

  return (
    <>
      <PerspectiveCamera makeDefault fov={55} position={[CAMERA_START_XZ[0], eyeHeight, CAMERA_START_XZ[1]]} near={0.1} far={80} />
      <CameraInitialPosition eyeHeight={eyeHeight} />
      <CameraNavigationTarget target={navigationTarget} eyeHeight={eyeHeight} />

      <ambientLight intensity={0.65} color="#ffffff" />
      <directionalLight
        position={[6, 10, 8]}
        intensity={0.7}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <Environment preset="warehouse" background={false} />

      {hasCustomSpaceComponents ? (
        <>
          {showBaseModel ? <LegacyFullMuseumModel /> : null}
          <SpaceComponentAssembly components={spaceComponents} />
        </>
      ) : (
        <>
          {showBaseModel ? <LegacyFullMuseumModel /> : null}
          <SplitMuseumAssembly />
        </>
      )}
      <ArtworkInteractionLayer
        placements={orderedPlacements}
        onArtworkClick={onArtworkClick}
        onFocusedArtworkChange={onFocusedArtworkChange}
      />
      {onAssetLoadProgress ? <SceneLoadTelemetry onAssetLoadProgress={onAssetLoadProgress} /> : null}

      <FirstPersonController
        enabled={fpsEnabled}
        moveSpeed={moveSpeed}
        eyeHeight={eyeHeight}
        selector={lockSelector}
        useBounds={false}
        bounds={MUSEUM_BOUNDS}
        onLockChange={onLockChange}
      />

      <fog attach="fog" args={['#111111', 28, 70]} />
    </>
  );
};

const SceneLoadTelemetry = ({ onAssetLoadProgress }: { onAssetLoadProgress: (progress: number) => void }) => {
  const { progress, active } = useProgress();

  useEffect(() => {
    onAssetLoadProgress(progress);
  }, [onAssetLoadProgress, progress, active]);

  return null;
};

interface DirectionArrowProps {
  dir: { x: number; z: number };
}

const DirectionArrow = ({ dir }: DirectionArrowProps) => {
  const angle = Math.atan2(dir.x, dir.z) * (180 / Math.PI);

  return (
    <div style={{ transform: `rotate(${angle}deg)`, transition: 'transform 0.15s' }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M12 4L8 12H11V20H13V12H16L12 4Z" fill="#00D4FF" />
      </svg>
    </div>
  );
};

const DigitalTwinHUD = () => {
  const [camPos, setCamPos] = useState<CameraPos>({
    x: CAMERA_START_XZ[0],
    z: CAMERA_START_XZ[1],
    dir: CENTER_NAVIGATION_TARGET.dir,
  });

  useEffect(() => {
    const update = () => {
      if (window.__galleryCameraPos) {
        setCamPos(window.__galleryCameraPos);
      }
    };
    const interval = setInterval(update, 50);
    return () => clearInterval(interval);
  }, []);

  const angle = Math.atan2(camPos.dir.x, camPos.dir.z) * (180 / Math.PI);
  const getDirection = () => {
    if (angle >= -45 && angle < 45) return 'N';
    if (angle >= 45 && angle < 135) return 'E';
    if (angle >= -135 && angle < -45) return 'W';
    return 'S';
  };

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 28,
        right: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 170,
        userSelect: 'none',
      }}
    >
      <div className="relative overflow-hidden rounded-2xl border border-cyan-400/20 bg-black/45 px-4 py-3 shadow-2xl backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 via-white/0 to-transparent" />
        <div
          style={{
            fontFamily: 'monospace',
            color: '#7dd3fc',
            fontSize: 12,
            lineHeight: 1.5,
            minWidth: 200,
            position: 'relative',
            zIndex: 1,
          }}
        >
        <div style={{ color: 'rgba(125, 211, 252, 0.58)', fontSize: 10, marginBottom: 6, letterSpacing: '0.22em' }}>
          DIGITAL TWIN COORD
        </div>
        <div className="flex items-center gap-3 text-[13px] font-semibold text-cyan-200">
          <span>X: {camPos.x.toFixed(1).padStart(5)}</span>
          <span>Z: {camPos.z.toFixed(1).padStart(5)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, borderTop: '1px solid rgba(125, 211, 252, 0.16)', paddingTop: 8 }}>
          <DirectionArrow dir={camPos.dir} />
          <span style={{ fontWeight: 'bold', fontSize: 15, letterSpacing: '0.16em' }}>{getDirection()}</span>
        </div>
        </div>
      </div>
    </div>
  );
};

const SpeedOptionButton = ({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) => {
  if (selected) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-2xl border border-amber-400/35 bg-amber-500/20 px-5 py-3 text-base font-semibold text-amber-100 shadow-[0_12px_24px_rgba(245,158,11,0.18)] transition hover:bg-amber-500/25"
      >
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-stone-200 transition hover:bg-white/10 hover:border-white/20"
    >
      {label}
    </button>
  );
};

interface HeightControlPadProps {
  eyeHeight: number;
  onIncrease: () => void;
  onDecrease: () => void;
  floating?: boolean;
}

const HeightControlPad = ({ eyeHeight, onIncrease, onDecrease, floating = true }: HeightControlPadProps) => {
  const content = (
    <div className="rounded-2xl border border-white/15 bg-black/45 p-3 backdrop-blur-md shadow-2xl">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
        Height
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDecrease}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-stone-100 transition hover:bg-white/10"
        >
          아래
        </button>
        <span className="min-w-[52px] text-center text-sm font-semibold text-cyan-100">
          {eyeHeight.toFixed(1)}
        </span>
        <button
          type="button"
          onClick={onIncrease}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-stone-100 transition hover:bg-white/10"
        >
          위
        </button>
      </div>
    </div>
  );

  if (!floating) {
    return content;
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 88,
        left: 24,
        zIndex: 170,
        userSelect: 'none',
      }}
    >
      {content}
    </div>
  );
};

interface BaseModelToggleProps {
  enabled: boolean;
  onToggle: () => void;
  floating?: boolean;
}

const BaseModelToggle = ({ enabled, onToggle, floating = true }: BaseModelToggleProps) => {
  const content = (
    <button
      type="button"
      onClick={onToggle}
      className={`rounded-xl border px-4 py-2 text-sm font-semibold backdrop-blur-md transition ${
        enabled
          ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30'
          : 'border-white/15 bg-black/45 text-stone-200 hover:bg-black/60'
      }`}
    >
      {enabled ? 'Base Model ON' : 'Base Model OFF'}
    </button>
  );

  if (!floating) {
    return content;
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 88,
        right: 24,
        zIndex: 170,
        userSelect: 'none',
      }}
    >
      {content}
    </div>
  );
};

interface SpaceNavigationPadProps {
  selectedKey: string;
  onSelect: (target: GalleryNavigationTarget) => void;
  floating?: boolean;
}

const SpaceNavigationPad = ({ selectedKey, onSelect, floating = true }: SpaceNavigationPadProps) => {
  const content = (
    <div className="rounded-2xl border border-white/15 bg-black/45 p-3 shadow-2xl backdrop-blur-md">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
        Space
      </p>
      <div className="grid grid-cols-2 gap-2">
        {GALLERY_NAVIGATION_TARGETS.map((target) => {
          const selected = selectedKey === target.key;
          return (
            <button
              key={target.key}
              type="button"
              onClick={() => onSelect(target)}
              className={`min-w-[82px] rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                selected
                  ? 'border-cyan-300/60 bg-cyan-400/20 text-cyan-50 shadow-[0_10px_24px_rgba(34,211,238,0.14)]'
                  : 'border-white/10 bg-white/5 text-stone-200 hover:border-white/20 hover:bg-white/10'
              }`}
            >
              {target.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  if (!floating) {
    return content;
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 184,
        left: 24,
        zIndex: 170,
        userSelect: 'none',
      }}
    >
      {content}
    </div>
  );
};

const ArtworkTargetHUD = ({
  placement,
}: {
  placement: Placement | null;
}) => {
  const hasTarget = Boolean(placement);
  if (!hasTarget) {
    return null;
  }

  return (
    <div
      data-testid="viewer-artwork-prompt"
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 96,
        transform: 'translateX(-50%)',
        zIndex: 90,
        userSelect: 'none',
        pointerEvents: 'none',
      }}
    >
      <div
        className="pointer-events-none w-[min(420px,calc(100vw-2rem))] rounded-[24px] border border-amber-300/40 bg-black/82 px-5 py-4 text-center shadow-[0_24px_70px_rgba(0,0,0,0.52)] backdrop-blur-2xl transition-all"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-stone-400">
          작품 설명 안내
        </p>
        <h3 className="mt-2 text-[18px] font-semibold text-stone-100 md:text-[20px]">
          {placement?.artwork.title ?? '작품 설명'}
        </h3>
        <p className="mt-2 text-sm text-stone-300">
          {placement
            ? `${placement.artwork.artist} · ${placement.artwork.originPeriod}`
            : null}
        </p>
        <div className="mt-4 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-100">
          <span className="rounded-full border border-amber-300/30 bg-amber-500/15 px-3 py-1">
            Enter
          </span>
          <span>상세 설명 열기</span>
        </div>
      </div>
    </div>
  );
};

const ControlSectionCard = ({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) => (
  <section className="relative overflow-hidden rounded-[24px] border border-white/12 bg-black/42 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.3)] backdrop-blur-2xl">
    <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/8 via-white/0 to-transparent" />
    <div className="relative z-10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-300">
        {eyebrow}
      </p>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold text-stone-100">{title}</h3>
          <p className="mt-1 text-sm text-stone-400">{description}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  </section>
);

const ControlHubOverlay = ({
  visible,
  moveSpeed,
  speedOptions,
  onSpeedSelect,
  eyeHeight,
  onIncreaseHeight,
  onDecreaseHeight,
  showBaseModel,
  onToggleBaseModel,
  selectedSpaceKey,
  onSelectSpace,
  onClose,
}: {
  visible: boolean;
  moveSpeed: number;
  speedOptions: { label: string; value: number }[];
  onSpeedSelect: (speed: number) => void;
  eyeHeight: number;
  onIncreaseHeight: () => void;
  onDecreaseHeight: () => void;
  showBaseModel: boolean;
  onToggleBaseModel: () => void;
  selectedSpaceKey: string;
  onSelectSpace: (target: GalleryNavigationTarget) => void;
  onClose: () => void;
}) => {
  if (!visible) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-[100] flex items-center justify-center px-4 py-6" style={{ backgroundColor: 'rgba(0,0,0,0.5)', pointerEvents: 'auto' }}>
      <button
        type="button"
        aria-label="Close viewer controls"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />

      <div className="relative z-10 w-full max-w-[min(1100px,calc(100vw-1.5rem))] overflow-hidden rounded-[32px] border border-white/12 bg-black/48 shadow-[0_30px_90px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 via-white/0 to-transparent" />
        <div className="relative z-10 flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-300">
              Explorer Control
            </p>
            <h3 className="mt-1 text-3xl font-semibold text-stone-100">이동 속도 선택</h3>
            <p className="mt-2 text-sm text-stone-400">
              속도, 시점, 공간 이동, 뷰어 모드를 한 곳에서 조작합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-stone-200 transition hover:bg-white/10 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="relative z-10 max-h-[calc(100vh-9rem)] overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              <ControlSectionCard
                eyebrow="Explorer Control"
                title="이동 속도 선택"
                description="선택 즉시 탐색 모드로 복귀합니다."
              >
                <div className="flex flex-wrap gap-3">
                  {speedOptions.map((opt) => (
                    <SpeedOptionButton
                      key={opt.value}
                      label={opt.label}
                      selected={moveSpeed === opt.value}
                      onClick={() => onSpeedSelect(opt.value)}
                    />
                  ))}
                </div>
              </ControlSectionCard>

              <ControlSectionCard
                eyebrow="View Control"
                title="시점 조정"
                description="카메라 높이와 기본 모델 표시를 조정합니다."
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <HeightControlPad
                    floating={false}
                    eyeHeight={eyeHeight}
                    onIncrease={onIncreaseHeight}
                    onDecrease={onDecreaseHeight}
                  />
                  <div className="flex items-center justify-start">
                    <BaseModelToggle
                      floating={false}
                      enabled={showBaseModel}
                      onToggle={onToggleBaseModel}
                    />
                  </div>
                </div>
              </ControlSectionCard>

              <ControlSectionCard
                eyebrow="Navigation"
                title="공간 이동"
                description="중앙과 각 룸으로 즉시 이동합니다."
              >
                <SpaceNavigationPad
                  floating={false}
                  selectedKey={selectedSpaceKey}
                  onSelect={onSelectSpace}
                />
              </ControlSectionCard>
            </div>

            <div className="space-y-4">
              <ControlSectionCard
                eyebrow="Quick Status"
                title="현재 상태"
                description="모달 밖에서 필요한 최소 상태만 확인합니다."
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">Speed</p>
                    <p className="mt-2 text-2xl font-semibold text-stone-100">
                      {speedOptions.find((opt) => opt.value === moveSpeed)?.label ?? 'Unknown'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-300">Space</p>
                    <p className="mt-2 text-2xl font-semibold text-stone-100">
                      {GALLERY_NAVIGATION_TARGETS.find((target) => target.key === selectedSpaceKey)?.label ?? 'Unknown'}
                    </p>
                  </div>
                </div>
              </ControlSectionCard>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ThreeDViewer = ({
  placements,
  spaceComponents = [],
  onArtworkClick,
  presentationMode = 'immediate',
  suppressSpeedPrompt = false,
}: ThreeDViewerProps) => {
  const [fpsEnabled] = useState(true);
  const [moveSpeed, setMoveSpeed] = useState(48);
  const [showSpeedControl, setShowSpeedControl] = useState(false);
  const [showBaseModel, setShowBaseModel] = useState(false);
  const [eyeHeight, setEyeHeight] = useState(DEFAULT_EYE_HEIGHT);
  const [selectedSpaceKey, setSelectedSpaceKey] = useState(CENTER_NAVIGATION_TARGET.key);
  const [navigationTarget, setNavigationTarget] = useState<GalleryNavigationTarget | null>(null);
  const [focusedPlacement, setFocusedPlacement] = useState<Placement | null>(null);
  const [visiblePlacementCount, setVisiblePlacementCount] = useState(() =>
    presentationMode === 'sequential' ? 0 : placements.length
  );
  const shellMarkedRef = useRef(false);
  const assetReadyMarkedRef = useRef(false);
  useModalPointerPolicy(showSpeedControl);

  const markPerformance = useCallback((markName: string) => {
    if (typeof window === 'undefined' || !window.performance?.mark) {
      return;
    }
    if (window.performance.getEntriesByName(markName).length === 0) {
      window.performance.mark(markName);
    }
  }, []);

  useEffect(() => {
    markPerformance('viewer-entry');
    if (!shellMarkedRef.current) {
      shellMarkedRef.current = true;
      markPerformance('viewer-shell-ready');
    }
  }, [markPerformance]);

  const handleAssetLoadProgress = useCallback((progress: number) => {
    if (progress >= 100 && !assetReadyMarkedRef.current) {
      assetReadyMarkedRef.current = true;
      markPerformance('viewer-asset-ready');
    }
  }, [markPerformance]);

  const handleLockChange = useCallback((locked: boolean) => {
    if (!locked) {
      if (!suppressSpeedPrompt) {
        setShowSpeedControl(true);
      }
    }
  }, [suppressSpeedPrompt]);

  const handleDismissControls = () => {
    setShowSpeedControl(false);
  };

  const handleSpeedSelect = (speed: number) => {
    setMoveSpeed(speed);
    setShowSpeedControl(false);
  };

  useEffect(() => {
    if (!showSpeedControl) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      handleDismissControls();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSpeedControl]);

  const handleArtworkActivate = useCallback((artwork: Artwork) => {
    onArtworkClick?.(artwork);
  }, [onArtworkClick]);

  useEffect(() => {
    setSelectedSpaceKey(CENTER_NAVIGATION_TARGET.key);
    setNavigationTarget(null);
    setFocusedPlacement(null);

    if (presentationMode !== 'sequential') {
      setVisiblePlacementCount(placements.length);
      return;
    }

    if (placements.length === 0) {
      setVisiblePlacementCount(0);
      return;
    }

    let cancelled = false;
    setVisiblePlacementCount(1);

    const intervalId = window.setInterval(() => {
      if (cancelled) return;
      setVisiblePlacementCount((current) => {
        if (current >= placements.length) {
          window.clearInterval(intervalId);
          return current;
        }

        return current + 1;
      });
    }, 90);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [placements.length, presentationMode]);

  const visiblePlacements = useMemo(
    () => placements.slice(0, Math.max(0, Math.min(visiblePlacementCount, placements.length))),
    [placements, visiblePlacementCount]
  );

  const handleSpaceSelect = useCallback((target: GalleryNavigationTarget) => {
    setSelectedSpaceKey(target.key);
    setNavigationTarget({ ...target, key: `${target.key}-${Date.now()}` });
  }, []);

  useEffect(() => {
    const targetByKey = new Map(
      GALLERY_NAVIGATION_TARGETS.map((target) => [target.key, target])
    );
    const shortcutTargets: Record<string, GalleryNavigationTarget | undefined> = {
      Digit1: targetByKey.get('center'),
      Numpad1: targetByKey.get('center'),
      Digit2: targetByKey.get('room1'),
      Numpad2: targetByKey.get('room1'),
      Digit3: targetByKey.get('room2'),
      Numpad3: targetByKey.get('room2'),
      Digit4: targetByKey.get('room3'),
      Numpad4: targetByKey.get('room3'),
    };

    const isTextInputActive = () => {
      const activeElement = document.activeElement;
      if (!(activeElement instanceof HTMLElement)) return false;
      const tagName = activeElement.tagName.toLowerCase();
      return (
        tagName === 'input'
        || tagName === 'textarea'
        || tagName === 'select'
        || activeElement.isContentEditable
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = shortcutTargets[event.code];
      if (!target || isTextInputActive()) return;

      event.preventDefault();
      handleSpaceSelect(target);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSpaceSelect]);

  const speedOptions = [
    { label: '느림', value: 4 },
    { label: '보통', value: 8 },
    { label: '빠름', value: 48 },
    { label: '최고속', value: 72 },
  ];

  return (
    <div className="w-full h-full relative" style={{ pointerEvents: showSpeedControl ? 'none' : 'auto' }}>
      <Canvas
        id="viewer-canvas"
        shadows
        className="bg-background-surface"
        onCreated={({ gl }) => {
          gl.setClearColor('#111111');
        }}
      >
        <Suspense fallback={<Loader />}>
          <Scene
            placements={visiblePlacements}
            spaceComponents={spaceComponents}
            fpsEnabled={fpsEnabled}
            onLockChange={handleLockChange}
            lockSelector="#viewer-canvas"
            moveSpeed={moveSpeed}
            showBaseModel={showBaseModel}
            eyeHeight={eyeHeight}
            navigationTarget={navigationTarget}
            onArtworkClick={handleArtworkActivate}
            onFocusedArtworkChange={setFocusedPlacement}
            onAssetLoadProgress={handleAssetLoadProgress}
          />
        </Suspense>
      </Canvas>

      <ControlHubOverlay
        visible={showSpeedControl}
        moveSpeed={moveSpeed}
        speedOptions={speedOptions}
        onSpeedSelect={handleSpeedSelect}
        eyeHeight={eyeHeight}
        onIncreaseHeight={() => setEyeHeight((current) => Math.min(MAX_EYE_HEIGHT, Number((current + HEIGHT_STEP).toFixed(1))))}
        onDecreaseHeight={() => setEyeHeight((current) => Math.max(MIN_EYE_HEIGHT, Number((current - HEIGHT_STEP).toFixed(1))))}
        showBaseModel={showBaseModel}
        onToggleBaseModel={() => setShowBaseModel((current) => !current)}
        selectedSpaceKey={selectedSpaceKey}
        onSelectSpace={handleSpaceSelect}
        onClose={handleDismissControls}
      />

      <DigitalTwinHUD />
      <ArtworkTargetHUD
        placement={focusedPlacement}
      />
    </div>
  );
};
