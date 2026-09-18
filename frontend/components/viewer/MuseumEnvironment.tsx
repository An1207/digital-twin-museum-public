import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
} from 'three';

// ============================================================
// Pillar Grid - Using InstancedMesh for Performance
// ============================================================
interface PillarProps {
  positions: [number, number, number][];
  radius?: number;
  height?: number;
}

const PillarGrid = ({ positions, radius = 0.4, height = 6 }: PillarProps) => {
  const baseRef = useRef<InstancedMesh>(null);
  const shaftRef = useRef<InstancedMesh>(null);
  const capitalRef = useRef<InstancedMesh>(null);

  const count = positions.length;

  // Geometries
  const baseGeometry = useMemo(() => new BoxGeometry(radius * 2.2, 0.3, radius * 2.2), [radius]);
  const shaftGeometry = useMemo(() => new CylinderGeometry(radius, radius * 1.05, height - 0.6, 16), [radius, height]);
  const capitalGeometry = useMemo(() => new BoxGeometry(radius * 2.5, 0.4, radius * 2.5), [radius]);

  // Materials
  const material = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#d4cfc8',
        roughness: 0.6,
        metalness: 0.1,
      }),
    []
  );

  // Set instance matrices
  useMemo(() => {
    const baseMatrix = new Matrix4();
    const shaftMatrix = new Matrix4();
    const capitalMatrix = new Matrix4();

    positions.forEach((pos, i) => {
      // Base
      baseMatrix.makeTranslation(pos[0], pos[1] + 0.15, pos[2]);
      baseRef.current?.setMatrixAt(i, baseMatrix);

      // Shaft
      shaftMatrix.makeTranslation(pos[0], pos[1] + 0.3 + (height - 0.6) / 2, pos[2]);
      shaftRef.current?.setMatrixAt(i, shaftMatrix);

      // Capital
      capitalMatrix.makeTranslation(pos[0], pos[1] + height - 0.2, pos[2]);
      capitalRef.current?.setMatrixAt(i, capitalMatrix);
    });

    if (baseRef.current) baseRef.current.instanceMatrix.needsUpdate = true;
    if (shaftRef.current) shaftRef.current.instanceMatrix.needsUpdate = true;
    if (capitalRef.current) capitalRef.current.instanceMatrix.needsUpdate = true;
  }, [positions, height]);

  return (
    <group>
      <instancedMesh ref={baseRef} args={[baseGeometry, material, count]} castShadow receiveShadow />
      <instancedMesh ref={shaftRef} args={[shaftGeometry, material, count]} castShadow receiveShadow />
      <instancedMesh ref={capitalRef} args={[capitalGeometry, material, count]} castShadow receiveShadow />
    </group>
  );
};

// ============================================================
// Mirror Pond with Reflector
// ============================================================
const MirrorPond = ({ position = [0, 0.05, 0], radius = 4 }: { position?: [number, number, number]; radius?: number }) => {
  const waterRef = useRef<Mesh>(null);

  useFrame((state) => {
    if (waterRef.current) {
      // Subtle ripple animation
      waterRef.current.position.y =
        position[1] + Math.sin(state.clock.elapsedTime * 0.5) * 0.01;
    }
  });

  return (
    <group position={position}>
      {/* Reflective water surface */}
      <mesh ref={waterRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <circleGeometry args={[radius, 64]} />
        <meshStandardMaterial
          color="#4a6670"
          transparent
          opacity={0.7}
          roughness={0.1}
          metalness={0.3}
        />
      </mesh>

      {/* Outer rim */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <ringGeometry args={[radius, radius + 0.3, 64]} />
        <meshStandardMaterial color="#78716c" roughness={0.8} />
      </mesh>

      {/* Water reflection effect */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[radius - 0.1, 64]} />
        <meshBasicMaterial color="#6ba3be" transparent opacity={0.15} />
      </mesh>
    </group>
  );
};

// ============================================================
// Building Component
// ============================================================
interface BuildingProps {
  position: [number, number, number];
  size: [number, number, number];
  color?: string;
  rotationY?: number;
}

const Building = ({
  position,
  size,
  color = '#e7e5e4',
  rotationY = 0,
}: BuildingProps) => {
  const [width, height, depth] = size;

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Main structure */}
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={color} roughness={0.85} metalness={0.05} />
      </mesh>

      {/* Roof accent */}
      <mesh position={[0, height + 0.1, 0]}>
        <boxGeometry args={[width + 0.2, 0.2, depth + 0.2]} />
        <meshStandardMaterial color="#a8a29e" roughness={0.7} />
      </mesh>

      {/* Base/foundation */}
      <mesh position={[0, 0.1, 0]}>
        <boxGeometry args={[width + 0.5, 0.2, depth + 0.5]} />
        <meshStandardMaterial color="#78716c" roughness={0.8} />
      </mesh>
    </group>
  );
};

// ============================================================
// Room Component (Interior walls for indoor feel)
// ============================================================
interface RoomProps {
  position: [number, number, number];
  size: [number, number, number];
  rotationY?: number;
  wallColor?: string;
  floorColor?: string;
}

const Room = ({
  position,
  size,
  rotationY = 0,
  wallColor = '#f5f5f0',
  floorColor = '#e8e4df',
}: RoomProps) => {
  const [width, height, depth] = size;
  const wallThickness = 0.15;

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Floor - raised to avoid clipping */}
      <mesh position={[0, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width - wallThickness * 2, depth - wallThickness * 2]} />
        <meshStandardMaterial color={floorColor} roughness={0.8} side={DoubleSide} />
      </mesh>

      {/* Note: Ceiling is rendered separately as ceiling highlight mesh */}

      {/* Back Wall */}
      <mesh position={[0, height / 2, -depth / 2 + wallThickness / 2]} receiveShadow>
        <boxGeometry args={[width, height, wallThickness]} />
        <meshStandardMaterial color={wallColor} roughness={0.9} />
      </mesh>

      {/* Front Wall (with opening) */}
      <mesh position={[0, height / 2, depth / 2 - wallThickness / 2]} receiveShadow>
        <boxGeometry args={[width, height, wallThickness]} />
        <meshStandardMaterial color={wallColor} roughness={0.9} />
      </mesh>

      {/* Left Wall */}
      <mesh position={[-width / 2 + wallThickness / 2, height / 2, 0]} receiveShadow>
        <boxGeometry args={[wallThickness, height, depth]} />
        <meshStandardMaterial color={wallColor} roughness={0.9} />
      </mesh>

      {/* Right Wall */}
      <mesh position={[width / 2 - wallThickness / 2, height / 2, 0]} receiveShadow>
        <boxGeometry args={[wallThickness, height, depth]} />
        <meshStandardMaterial color={wallColor} roughness={0.9} />
      </mesh>

      {/* Wall Grid Lines - Back Wall */}
      {Array.from({ length: Math.floor(height / 0.8) + 1 }).map((_, i) => (
        <line key={`back-h-${i}`}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[new Float32Array([width / 2, i * 0.8, 0, -width / 2, i * 0.8, 0]), 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial color="#a8a29e" linewidth={1} />
        </line>
      ))}

      {/* Wall Grid Lines - Left Wall (vertical) */}
      {Array.from({ length: Math.floor(depth / 0.8) + 1 }).map((_, i) => (
        <line key={`left-v-${i}`}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[new Float32Array([0, 0, i * 0.8 - depth / 2, 0, height, i * 0.8 - depth / 2]), 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial color="#a8a29e" linewidth={1} />
        </line>
      ))}
    </group>
  );
};

// ============================================================
// Main Museum Environment
// ============================================================
export const MuseumEnvironment = () => {
  // Pillar positions around the mirror pond and pathways
  const pillarPositions: [number, number, number][] = useMemo(
    () => [
      // South entrance pillars
      [-3, 0, 8],
      [3, 0, 8],
      // East side pillars
      [10, 0, 0],
      [10, 0, 5],
      [10, 0, -5],
      // West side pillars
      [-10, 0, 0],
      [-10, 0, 5],
      [-10, 0, -5],
      // North side pillars
      [-5, 0, -10],
      [5, 0, -10],
      // Additional decorative pillars
      [8, 0, 10],
      [-8, 0, 10],
    ],
    []
  );

  return (
    <>
      {/* Environment for reflections */}
      <Environment preset="warehouse" background={false} />

      {/* Ground Plane with Marble-like finish */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#d4cfc8" roughness={0.7} metalness={0.1} />
      </mesh>

      {/* Ground Grid for visual reference */}
      <gridHelper args={[60, 30, '#a8a29e', '#78716c']} position={[0, 0.01, 0]} />




      {/* Central Mirror Pond */}
      <MirrorPond position={[0, 0.05, 0]} radius={4} />

      {/* ================================================ */}
      {/* Main Museum Building with 4 Rectangular Rooms */}
      {/* ================================================ */}

      {/* Main Building Shell */}
      <Building
        position={[0, 3.75, -6]}
        size={[40, 7.5, 30]}
        color="#d6d3d1"
        rotationY={0}
      />

      {/* Room 1 - Northwest */}
      <Room
        position={[-10, 0, -16]}
        size={[16, 7.2, 12]}
        wallColor="#f0ebe0"
        floorColor="#e0d8cc"
      />

      {/* Room 2 - Northeast */}
      <Room
        position={[10, 0, -16]}
        size={[16, 7.2, 12]}
        wallColor="#e8e4de"
        floorColor="#d8d0c4"
      />

      {/* Room 3 - Southwest */}
      <Room
        position={[-10, 0, 4]}
        size={[16, 7.2, 12]}
        wallColor="#e8e4de"
        floorColor="#d8d0c4"
      />

      {/* Room 4 - Southeast */}
      <Room
        position={[10, 0, 4]}
        size={[16, 7.2, 12]}
        wallColor="#f0ebe0"
        floorColor="#e0d8cc"
      />

      {/* South Entrance Structure */}
      <Building
        position={[0, 2.25, 14]}
        size={[12, 4.5, 4]}
        color="#e7e5e4"
        rotationY={0}
      />

      {/* Entrance Hall Interior */}
      <Room
        position={[0, 0, 14]}
        size={[10, 4.2, 2.5]}
        wallColor="#f5f5f0"
        floorColor="#e8e4df"
      />

      {/* Pillars */}
      <PillarGrid positions={pillarPositions} radius={0.35} height={9} />

      {/* Pathways - removed for artwork visibility */}
      {/* <Path points={mainPathPoints} width={3} /> */}
      {/* <Path points={eastPathPoints} width={2.5} /> */}
      {/* <Path points={westPathPoints} width={2.5} /> */}

      {/* Lighting - Warm museum atmosphere */}
      <ambientLight intensity={0.35} color="#FFF5E6" />

      <directionalLight
        position={[15, 20, 10]}
        intensity={0.8}
        color="#FFFAF0"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={50}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-bias={-0.0001}
      />

      {/* Interior lights for North Hall */}
      <spotLight position={[0, 6, -18]} angle={0.8} penumbra={1} intensity={0.8} color="#FFF8F0" />
      <spotLight position={[-8, 6, -20]} angle={0.6} penumbra={1} intensity={0.5} color="#FFF8F0" />
      <spotLight position={[8, 6, -20]} angle={0.6} penumbra={1} intensity={0.5} color="#FFF8F0" />

      {/* Interior lights for East Building */}
      <spotLight position={[18, 5, 0]} angle={0.7} penumbra={1} intensity={0.6} color="#FFF8F0" />

      {/* Interior lights for West Pavilion */}
      <spotLight position={[-16, 4, 8]} angle={0.6} penumbra={1} intensity={0.5} color="#FFF8F0" />

      {/* Main spotlight over mirror pond */}
      <spotLight
        position={[0, 16, 0]}
        angle={0.6}
        penumbra={0.8}
        intensity={1.2}
        color="#FFE4B5"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />

      {/* Accent lights near buildings */}
      <pointLight position={[-15, 4.5, 8]} intensity={0.5} color="#FFF0D4" distance={15} />
      <pointLight position={[18, 4.5, 0]} intensity={0.5} color="#FFF0D4" distance={15} />
      <pointLight position={[0, 4.5, -18]} intensity={0.5} color="#FFF0D4" distance={15} />
    </>
  );
};

export default MuseumEnvironment;
