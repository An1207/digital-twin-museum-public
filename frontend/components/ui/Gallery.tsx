import React, { useEffect, useMemo, useRef, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import {
  DoubleSide,
  Euler,
  Group,
  MathUtils,
  SRGBColorSpace,
  Texture,
  Vector3,
} from 'three';
import { motion } from 'framer-motion';
import GlassButton from './GlassButton';
import GhostCursor from './GhostCursor';
import BlurText from './BlurText';

const ARTWORK_IMAGES = [
  '/images/artworks/museum_cma_001_katsushika-hokusai-japanese-17601849_south-wind-clear-sky-from-thirty-six-views-of-mount-fuji.jpg',
  '/images/artworks/museum_cma_004_pierre-auguste-renoir-french-18411919_roses-in-a-vase.jpg',
  '/images/artworks/museum_cma_009_vincent-van-gogh-dutch-18531890_dr-gachet.jpg',
  '/images/artworks/museum_cma_013_claude-monet-french-18401926_spring-flowers.jpg',
  '/images/artworks/museum_cma_018_vincent-van-gogh-dutch-18531890_adeline-ravoux.jpg',
  '/images/artworks/museum_cma_020_claude-monet-french-18401926_the-red-kerchief.jpg',
  '/images/artworks/museum_cma_025_claude-monet-french-18401926_water-lilies-agapanthus.jpg',
  '/images/artworks/museum_cma_032_rembrandt-van-rijn-dutch-16061669_the-strolling-musicians.jpg',
  '/images/artworks/museum_cma_046_frederic-bazille-french-18411870_portrait-of-renoir.jpg',
  '/images/artworks/museum_cma_053_claude-monet-french-18401926_gardeners-house-at-antibes.jpg',
  '/images/artworks/museum_cma_064_edvard-munch-norwegian-18631944_evening-melancholy-i.jpg',
  '/images/artworks/museum_cma_072_mary-cassatt-american-18441926_after-the-bath.jpg',
  '/images/artworks/museum_cma_083_diego-velazquez-spanish-15991660_portrait-of-the-jester-calabazas.jpg',
  '/images/artworks/museum_cma_108_jean-auguste-dominique-ingres-french-17801867_odalisque.jpg',
  '/images/artworks/museum_cma_121_theodore-chasseriau-french-18191856_venus-anadyomene.jpg',
  '/images/artworks/museum_cma_134_camille-pissarro-french-18301903_self-portrait.jpg',
] as const;

// --- 1. R3F component managing floating frames in 3D space ---
interface FloatingFramesProps {
  images: readonly string[];
}

const FloatingFrames: React.FC<FloatingFramesProps> = ({ images }) => {
  const groupRef = useRef<Group>(null);
  const texturePaths = useMemo(() => [...images], [images]);

  // Load images using drei's useTexture (requires Suspense)
  const textureList = useTexture(texturePaths) as Texture[];

  // Pre-calculate 50 frame positions/rotations once (performance optimization)
  const frames = useMemo(() => {
    return Array.from({ length: 50 }).map((_, i) => {
      const width = 2.2 + Math.random() * 1.4;
      const height = width * (0.68 + Math.random() * 0.28);

      return {
        position: new Vector3(
          (Math.random() - 0.5) * 40,
          (Math.random() - 0.5) * 40,
          (Math.random() - 1) * 30 - 2 // Deeper Z-axis placement
        ),
        rotation: new Euler(
          (Math.random() - 0.5) * 0.2,
          (Math.random() - 0.5) * 0.2,
          0
        ),
        textureIndex: i % textureList.length,
        size: [width, height] as [number, number],
      };
    });
  }, [textureList.length]);

  useEffect(() => {
    textureList.forEach((texture) => {
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = 8;
      texture.needsUpdate = true;
    });
  }, [textureList]);

  // Animation loop running every frame (mouse parallax)
  useFrame((state) => {
    if (groupRef.current) {
      // Slow group rotation
      groupRef.current.rotation.y += 0.001;
    }

    // state.pointer provides normalized mouse coords (-1 ~ 1) from R3F
    const targetX = state.pointer.x * 2;
    const targetY = state.pointer.y * 2;

    // Smooth camera movement (Lerp)
    state.camera.position.x = MathUtils.lerp(state.camera.position.x, targetX * 2.5, 0.05);
    state.camera.position.y = MathUtils.lerp(state.camera.position.y, targetY * 2.5, 0.05);
    state.camera.lookAt(0, 0, 0);
  });

  return (
    <group ref={groupRef}>
      {frames.map((frame, i) => (
        <mesh key={i} position={frame.position} rotation={frame.rotation}>
          <planeGeometry args={frame.size} />
          <meshBasicMaterial
            map={textureList[frame.textureIndex]}
            side={DoubleSide}
            transparent
            opacity={0.92}
          />
        </mesh>
      ))}
    </group>
  );
};

// --- 2. Loading component (reusing ThreeDViewer pattern) ---
const Loader = () => (
  <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-4">
      <div className="h-16 w-16 animate-spin rounded-full border-4 border-[#7f9b5a] border-t-transparent" />
      <p className="font-sans font-light leading-relaxed text-[#d8cbbb]">Loading 3D Assets...</p>
    </div>
  </div>
);

// --- 3. Main page (UI + 3D Canvas integration) ---
interface GalleryProps {
  onStartExhibition: () => void;
}

export default function Gallery({
  onStartExhibition,
}: GalleryProps) {
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#14130c] text-[#f4efe7]">

      {/* 3D R3F Canvas area (z-index 0) */}
      <div className="absolute inset-0 z-0">
        <Suspense fallback={<Loader />}>
          <Canvas camera={{ position: [0, 0, 5], fov: 75 }}>
            {/* Background color and fog for depth */}
            <color attach="background" args={['#14130c']} />
            <fog attach="fog" args={['#14130c', 0.02]} />
            <FloatingFrames images={ARTWORK_IMAGES} />
          </Canvas>
        </Suspense>
      </div>

      <GhostCursor
        className="z-[5]"
        color="#755717"
        scaleMultiplier={0.7}
        brightness={1.1}
        edgeIntensity={0.08}
        trailLength={56}
        inertia={0.52}
        grainIntensity={0.04}
        bloomStrength={0.14}
        bloomRadius={1.1}
        bloomThreshold={0.02}
        fadeDelayMs={850}
        fadeDurationMs={1200}
        mixBlendMode="screen"
      />

      {/* HTML UI overlay area (z-index 10) - Framer Motion animations */}
      <div className="absolute inset-0 z-10 pointer-events-none">
        <div className="mx-auto flex h-full w-full max-w-7xl flex-col justify-between px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="flex flex-1 flex-col items-center justify-center">
            <h1 className="font-abril mb-4 text-center text-5xl font-light tracking-normal leading-tight text-[#f4efe7] drop-shadow-2xl md:text-7xl">
              <BlurText
                text="Digital Twin Museum"
                animateBy="words"
                direction="top"
                delay={90}
                stepDuration={0.28}
                className="justify-center"
              />
            </h1>

            <p className="font-abril mb-8 text-center text-lg font-light leading-relaxed tracking-wide text-[#d8cbbb] md:text-xl">
              <BlurText
                text="Experience art curated just for you in a 3D gallery"
                animateBy="words"
                direction="top"
                delay={70}
                stepDuration={0.22}
                className="justify-center"
              />
            </p>

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 1 }}
              className="pointer-events-auto flex flex-col gap-3 sm:flex-row"
            >
                <GlassButton size="lg" onClick={onStartExhibition} data-testid="home-start-exhibition">
                  <span className="font-mapo-bold text-[1.02em] tracking-[0.02em]">
                    <BlurText
                      text="3D 공간 라이브러리 진입"
                      animateBy="words"
                      direction="top"
                      delay={60}
                      stepDuration={0.2}
                      className="justify-center"
                    />
                  </span>
                </GlassButton>
            </motion.div>
          </div>

        </div>
      </div>

      {/* Footer */}
      <footer className="absolute bottom-6 z-10 pointer-events-none text-center text-sm text-[#b29e8d]">
        Interactive Digital Twin Museum · Capstone Design
      </footer>
    </div>
  );
}
