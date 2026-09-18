import { Component, Suspense, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Html, OrbitControls, useGLTF } from '@react-three/drei';
import { Box3, MathUtils, Mesh, Object3D, Vector3 } from 'three';
import { apiService } from '../../lib/api';

const PREVIEW_CAMERA_FOV = 35;
const PREVIEW_SCENE_COORDS = {
  cameraInitialPosition: [0, 0.001, 5.25] as const,
  cameraLookAt: [0, 0, 0] as const,
  orbitTarget: [0, 0, 0] as const,
  keyLightPosition: [4, 6, 8] as const,
  fillLightPosition: [-4, 3, -3] as const,
  gridFallbackY: -1.55,
};
const PREVIEW_SCENE_GEOMETRY = {
  normalizedMaxAxis: 3.1,
  depthFitMultiplier: 3.5,
  cameraPadding: 0.35,
  gridYOffset: 0.08,
};
const PREVIEW_SCENE_DISTANCE = {
  minDistanceFloor: 1.8,
  minDistanceRatio: 0.65,
  maxDistanceRatio: 2.2,
  minDistanceFallback: 2,
  maxDistanceFallback: 9,
};
// Legacy assets were generated before the rotation fix was baked into the GLB.
const PREVIEW_MODEL_ROTATION_FIX: [number, number, number] = [
  -Math.PI / 2,
  -Math.PI / 2,
  Math.PI,
];
const PREVIEW_MODEL_FRONT_TILT = Math.PI / 2;

type PreparedPreview = {
  object: Object3D;
  cameraDistance: number;
  minDistance: number;
  maxDistance: number;
  gridY: number;
};

const PreviewLoader = () => (
  <Html center>
    <div className="rounded-xl border border-white/10 bg-black/75 px-4 py-3 text-sm text-stone-200 shadow-2xl backdrop-blur">
      GLB loading...
    </div>
  </Html>
);

class PreviewErrorBoundary extends Component<
  {
    assetUrl: string;
    children: ReactNode;
  },
  {
    hasError: boolean;
    message: string | null;
  }
> {
  state = {
    hasError: false,
    message: null as string | null,
  };

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || 'GLB preview failed to load.',
    };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {}

  componentDidUpdate(prevProps: Readonly<{ assetUrl: string; children: ReactNode }>) {
    if (prevProps.assetUrl !== this.props.assetUrl && this.state.hasError) {
      this.setState({ hasError: false, message: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-[320px] items-center justify-center rounded-2xl border border-red-400/20 bg-red-500/10 p-6 text-sm text-red-100">
          {this.state.message}
        </div>
      );
    }
    return this.props.children;
  }
}

const PreviewModel = ({
  assetUrl,
  onPrepared,
  applyLegacyRotationFix,
}: {
  assetUrl: string;
  onPrepared: (preview: PreparedPreview) => void;
  applyLegacyRotationFix: boolean;
}) => {
  const { scene } = useGLTF(assetUrl, true, true, (loader) => loader.setRequestHeader(apiService.getAssetHeaders(assetUrl))) as { scene: Object3D };

  const prepared = useMemo(() => {
    const clonedScene = scene.clone(true);
    clonedScene.updateMatrixWorld(true);

    const box = new Box3().setFromObject(clonedScene);
    const size = new Vector3();
    const center = new Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxAxis = Math.max(size.x, size.y, size.z) || 1;
    const scale = PREVIEW_SCENE_GEOMETRY.normalizedMaxAxis / maxAxis;
    clonedScene.scale.setScalar(scale);
    clonedScene.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    clonedScene.rotation.x += PREVIEW_MODEL_FRONT_TILT;
    if (applyLegacyRotationFix) {
      clonedScene.rotation.set(...PREVIEW_MODEL_ROTATION_FIX);
      clonedScene.rotation.x += PREVIEW_MODEL_FRONT_TILT;
    }
    clonedScene.updateMatrixWorld(true);
    const fittedBox = new Box3().setFromObject(clonedScene);
    const fittedSize = new Vector3();
    fittedBox.getSize(fittedSize);
    const fitHeightDistance = (fittedSize.y / 2) / Math.tan(MathUtils.degToRad(PREVIEW_CAMERA_FOV / 2));
    const fitWidthDistance = (fittedSize.x / 2) / Math.tan(MathUtils.degToRad(PREVIEW_CAMERA_FOV / 2));
    const cameraDistance = Math.max(
      fitHeightDistance,
      fitWidthDistance,
      fittedSize.z * PREVIEW_SCENE_GEOMETRY.depthFitMultiplier,
    ) + PREVIEW_SCENE_GEOMETRY.cameraPadding;
    clonedScene.traverse((object) => {
      if (object instanceof Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false;
      }
    });

    return {
      object: clonedScene,
      cameraDistance,
      minDistance: Math.max(
        PREVIEW_SCENE_DISTANCE.minDistanceFloor,
        cameraDistance * PREVIEW_SCENE_DISTANCE.minDistanceRatio,
      ),
      maxDistance: cameraDistance * PREVIEW_SCENE_DISTANCE.maxDistanceRatio,
      gridY: fittedBox.min.y - PREVIEW_SCENE_GEOMETRY.gridYOffset,
    };
  }, [applyLegacyRotationFix, scene]);

  useEffect(() => {
    onPrepared(prepared);
  }, [onPrepared, prepared]);

  return <primitive object={prepared.object} />;
};

const PreviewCamera = ({ distance, resetKey }: { distance: number; resetKey: number }) => {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(...PREVIEW_SCENE_COORDS.cameraInitialPosition);
    camera.position.z = distance;
    camera.position.y = PREVIEW_SCENE_COORDS.cameraInitialPosition[1];
    camera.lookAt(...PREVIEW_SCENE_COORDS.cameraLookAt);
    camera.updateProjectionMatrix();
  }, [camera, distance, resetKey]);

  return null;
};

export const FramedGlbPreviewSurface = ({
  assetUrl,
  applyLegacyRotationFix,
  className,
}: {
  assetUrl: string;
  applyLegacyRotationFix: boolean;
  className?: string;
}) => {
  const [prepared, setPrepared] = useState<PreparedPreview | null>(null);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    setPrepared(null);
    setResetKey(0);
  }, [assetUrl, applyLegacyRotationFix]);

  return (
    <div className={`relative w-full overflow-hidden min-h-0 ${className ?? ''}`}>
      <PreviewErrorBoundary assetUrl={assetUrl}>
        <div className="relative h-full min-h-0">
          <Canvas
            key={`${assetUrl}-${resetKey}`}
            className="h-full w-full"
            camera={{ position: [...PREVIEW_SCENE_COORDS.cameraInitialPosition], fov: PREVIEW_CAMERA_FOV, near: 0.1, far: 100 }}
            shadows
          >
            <color attach="background" args={['#0c0a09']} />
            <ambientLight intensity={1.15} />
            <directionalLight position={[...PREVIEW_SCENE_COORDS.keyLightPosition]} intensity={1.4} castShadow />
            <directionalLight position={[...PREVIEW_SCENE_COORDS.fillLightPosition]} intensity={0.65} />
            <gridHelper args={[10, 10, '#44403c', '#1c1917']} position={[0, prepared?.gridY ?? PREVIEW_SCENE_COORDS.gridFallbackY, 0]} />
            {prepared ? <PreviewCamera distance={prepared.cameraDistance} resetKey={resetKey} /> : null}
            <Suspense fallback={<PreviewLoader />}>
              <PreviewModel assetUrl={assetUrl} onPrepared={setPrepared} applyLegacyRotationFix={applyLegacyRotationFix} />
            </Suspense>
            <OrbitControls
              makeDefault
              enablePan
              enableZoom
              minDistance={prepared?.minDistance ?? PREVIEW_SCENE_DISTANCE.minDistanceFallback}
              maxDistance={prepared?.maxDistance ?? PREVIEW_SCENE_DISTANCE.maxDistanceFallback}
              minPolarAngle={0}
              maxPolarAngle={Math.PI}
              target={[...PREVIEW_SCENE_COORDS.orbitTarget]}
            />
          </Canvas>
          <div className="pointer-events-none absolute left-4 top-4 rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-xs text-stone-300 backdrop-blur">
            마우스 드래그로 360도 회전, 휠로 확대/축소
          </div>
          <button
            type="button"
            onClick={() => setResetKey((value) => value + 1)}
            className="absolute right-4 top-4 rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-xs text-stone-200 backdrop-blur transition hover:border-white/20 hover:bg-black/75"
          >
            Reset View
          </button>
        </div>
      </PreviewErrorBoundary>
    </div>
  );
};
