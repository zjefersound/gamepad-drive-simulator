import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { CAR } from '../game/carPhysics';
import GolBola from './GolBola';

const WHEEL_X = [CAR.cgToFront, -CAR.cgToRear];
const R = CAR.wheelRadius;
const TIRE_W = 0.18; // pneu 175/70 R13

// Roda de aço com calota, estilo Gol dos anos 90
function Wheel({ spinRef, steerRef, position, side }) {
  return (
    <group position={position} ref={steerRef}>
      <group ref={spinRef}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[R, R, TIRE_W, 24]} />
          <meshStandardMaterial color="#151515" roughness={0.92} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, side * 0.005]}>
          <cylinderGeometry args={[R * 0.66, R * 0.66, TIRE_W + 0.01, 20]} />
          <meshStandardMaterial color="#c3c7cd" metalness={0.8} roughness={0.3} />
        </mesh>
        {/* furos da calota para dar leitura de giro */}
        {[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * R * 0.42, Math.sin(a) * R * 0.42, side * (TIRE_W / 2 + 0.008)]}>
              <boxGeometry args={[0.05, 0.05, 0.01]} />
              <meshStandardMaterial color="#3a3d42" />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

export default function Car({ game }) {
  const root = useRef();
  const body = useRef();
  const brakeMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8a0008', emissive: '#ff0010', emissiveIntensity: 0.5 }), []);
  const reverseMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#dddddd', emissive: '#ffffff', emissiveIntensity: 0 }), []);
  const steer = [useRef(), useRef()];
  const spin = [useRef(), useRef(), useRef(), useRef()];

  useFrame(() => {
    const car = game.car;
    root.current.position.set(car.x, 0, -car.y);
    root.current.rotation.y = car.heading;
    body.current.rotation.set(car.roll, 0, car.pitch);
    body.current.position.y = -Math.abs(car.pitch) * 0.6;
    steer[0].current.rotation.y = car.steer;
    steer[1].current.rotation.y = car.steer;
    spin[0].current.rotation.z = -car.wheelAngF;
    spin[1].current.rotation.z = -car.wheelAngF;
    spin[2].current.rotation.z = -car.wheelAngR;
    spin[3].current.rotation.z = -car.wheelAngR;
    brakeMat.emissiveIntensity = car.brake > 0.05 || car.handbrake > 0.1 ? 1.5 : 0.5;
    reverseMat.emissiveIntensity = car.gear === -1 ? 2.5 : 0;
  });

  return (
    <group ref={root}>
      <group ref={body}>
        <GolBola brakeMat={brakeMat} reverseMat={reverseMat} />
      </group>

      <Wheel position={[WHEEL_X[0], R, CAR.halfTrack]} side={1} steerRef={steer[0]} spinRef={spin[0]} />
      <Wheel position={[WHEEL_X[0], R, -CAR.halfTrack]} side={-1} steerRef={steer[1]} spinRef={spin[1]} />
      <Wheel position={[WHEEL_X[1], R, CAR.halfTrack]} side={1} spinRef={spin[2]} />
      <Wheel position={[WHEEL_X[1], R, -CAR.halfTrack]} side={-1} spinRef={spin[3]} />
    </group>
  );
}
