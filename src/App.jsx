import { useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { createGame } from './game/game';
import World from './components/World';
import Car from './components/Car';
import Hud from './components/Hud';
import { CameraRig, Cones, Simulation, Skidmarks, SunLight } from './components/Scene';

export default function App() {
  const game = useMemo(createGame, []);
  useEffect(() => {
    if (import.meta.env.DEV) window.__game = game; // inspeção no console durante o desenvolvimento
    return () => game.input.dispose();
  }, [game]);

  return (
    <>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ fov: 60, near: 0.1, far: 4000, position: [0, 5, 10] }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
      >
        <Simulation game={game} />
        <World game={game} />
        <SunLight game={game} />
        <Skidmarks game={game} />
        <Cones game={game} />
        <Car game={game} />
        <CameraRig game={game} />
      </Canvas>
      <Hud game={game} />
    </>
  );
}
