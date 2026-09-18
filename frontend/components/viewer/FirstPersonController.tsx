import { useEffect, useRef, useState, useCallback } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import type { PointerLockControls as PointerLockControlsImpl } from 'three-stdlib';
import { Vector3 } from 'three';
import { isArrowNavigationCode, shouldIgnoreKeyboardNavigation } from '../../lib/navigationKeyboard';

// ============================================================
// Types
// ============================================================
interface CameraPos {
  x: number;
  z: number;
  dir: { x: number; z: number };
}

interface FirstPersonControllerProps {
  enabled?: boolean;
  moveSpeed?: number;
  eyeHeight?: number;
  useBounds?: boolean;
  selector?: string;
  bounds?: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  onPositionChange?: (pos: CameraPos) => void;
  onLockChange?: (locked: boolean) => void;
}

declare global {
  interface Window {
    __galleryCameraPos?: CameraPos;
  }
}

// ============================================================
// First Person Controller
// ============================================================
export const FirstPersonController = ({
  enabled = true,
  moveSpeed = 8,
  eyeHeight = 0.6,
  useBounds = true,
  selector,
  bounds = {
    minX: -24,
    maxX: 24,
    minZ: -24,
    maxZ: 24,
  },
  onPositionChange,
  onLockChange,
}: FirstPersonControllerProps) => {
  const { camera, gl: renderer } = useThree();
  const controlsRef = useRef<PointerLockControlsImpl | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [canRequestLock, setCanRequestLock] = useState(true);
  const unlockCooldownRef = useRef<number | null>(null);

  const moveState = useRef({
    forward: false,
    backward: false,
    left: false,
    right: false,
  });

  const velocity = useRef(new Vector3());
  const direction = useRef(new Vector3());

  // Handle keyboard input
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isLocked || !isArrowNavigationCode(e.code) || shouldIgnoreKeyboardNavigation(e)) return;
      e.preventDefault();
      switch (e.code) {
        case 'ArrowUp':
          moveState.current.forward = true;
          break;
        case 'ArrowDown':
          moveState.current.backward = true;
          break;
        case 'ArrowLeft':
          moveState.current.left = true;
          break;
        case 'ArrowRight':
          moveState.current.right = true;
          break;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!isArrowNavigationCode(e.code)) return;
      switch (e.code) {
        case 'ArrowUp':
          moveState.current.forward = false;
          break;
        case 'ArrowDown':
          moveState.current.backward = false;
          break;
        case 'ArrowLeft':
          moveState.current.left = false;
          break;
        case 'ArrowRight':
          moveState.current.right = false;
          break;
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, [enabled, isLocked]);

  // Update position on lock/unlock
  const handleLock = useCallback(() => {
    setIsLocked(true);
    onLockChange?.(true);
  }, [onLockChange]);

  const handleUnlock = useCallback(() => {
    // Delay state reset to avoid context lost conflict with WebGL
    setTimeout(() => {
      setIsLocked(false);
      onLockChange?.(false);
      // Reset move state when unlocked
      moveState.current = {
        forward: false,
        backward: false,
        left: false,
        right: false,
      };
    }, 100);

    if (unlockCooldownRef.current !== null) {
      window.clearTimeout(unlockCooldownRef.current);
    }
    setCanRequestLock(false);
    unlockCooldownRef.current = window.setTimeout(() => {
      setCanRequestLock(true);
      unlockCooldownRef.current = null;
    }, 250);
  }, [onLockChange]);

  useEffect(() => {
    return () => {
      if (unlockCooldownRef.current !== null) {
        window.clearTimeout(unlockCooldownRef.current);
      }
    };
  }, []);

  // Frame update for movement
  useFrame((_, delta) => {
    // Guard: check if WebGL context is still valid
    if (!enabled || !isLocked || !controlsRef.current?.isLocked) return;

    // Additional context validity check
    const gl = renderer?.getContext();
    if (!gl || gl.isContextLost()) return;

    const { forward, backward, left, right } = moveState.current;
    const damping = 10;

    direction.current.z = Number(forward) - Number(backward);
    direction.current.x = Number(right) - Number(left);
    direction.current.normalize();

    // Apply damping
    velocity.current.x -= velocity.current.x * damping * delta;
    velocity.current.z -= velocity.current.z * damping * delta;

    // Apply acceleration
    if (forward || backward) {
      velocity.current.z += direction.current.z * moveSpeed * delta;
    }
    if (left || right) {
      velocity.current.x += direction.current.x * moveSpeed * delta;
    }

    // Get camera's forward/right vectors (horizontal only)
    const forwardVec = new Vector3();
    camera.getWorldDirection(forwardVec);
    forwardVec.y = 0;
    forwardVec.normalize();

    const rightVec = new Vector3();
    rightVec.crossVectors(forwardVec, new Vector3(0, 1, 0));

    // Calculate movement
    const moveX = rightVec.x * velocity.current.x * delta * 2 + forwardVec.x * velocity.current.z * delta * 2;
    const moveZ = rightVec.z * velocity.current.x * delta * 2 + forwardVec.z * velocity.current.z * delta * 2;

    // Allow temporary free-fly inspection by bypassing bounds clamping.
    const nextX = camera.position.x + moveX;
    const nextZ = camera.position.z + moveZ;
    const newX = useBounds ? Math.max(bounds.minX, Math.min(bounds.maxX, nextX)) : nextX;
    const newZ = useBounds ? Math.max(bounds.minZ, Math.min(bounds.maxZ, nextZ)) : nextZ;

    camera.position.x = newX;
    camera.position.z = newZ;

    // Keep camera at eye height.
    camera.position.y = eyeHeight;

    // Update global position for HUD
    const dir = forwardVec.clone();
    window.__galleryCameraPos = {
      x: camera.position.x,
      z: camera.position.z,
      dir: { x: dir.x, z: dir.z },
    };

    // Notify parent
    onPositionChange?.(window.__galleryCameraPos);
  });

  if (!enabled || !canRequestLock) return null;

  return (
    <PointerLockControls
      selector={selector}
      ref={controlsRef}
      pointerSpeed={0.8}
      onLock={handleLock}
      onUnlock={handleUnlock}
    />
  );
};

export default FirstPersonController;
