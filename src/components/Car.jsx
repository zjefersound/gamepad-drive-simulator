import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { CAR } from '../game/carPhysics';

const WHEEL_X = [CAR.cgToFront, -CAR.cgToRear];
const R = CAR.wheelRadius;

function Wheel({ spinRef, steerRef, position }) {
  return (
    <group position={position} ref={steerRef}>
      <group ref={spinRef}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[R, R, 0.26, 20]} />
          <meshStandardMaterial color="#141414" roughness={0.9} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[R * 0.62, R * 0.62, 0.27, 12]} />
          <meshStandardMaterial color="#c9ccd1" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh>
          <boxGeometry args={[R * 1.15, 0.07, 0.28]} />
          <meshStandardMaterial color="#8d9096" metalness={0.7} roughness={0.35} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <boxGeometry args={[R * 1.15, 0.07, 0.28]} />
          <meshStandardMaterial color="#8d9096" metalness={0.7} roughness={0.35} />
        </mesh>
      </group>
    </group>
  );
}

function Box({ args, position, rotation, color, ...mat }) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} {...mat} />
    </mesh>
  );
}

export default function Car({ game }) {
  const root = useRef();
  const body = useRef();
  const brakeMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7a0000', emissive: '#ff1a1a', emissiveIntensity: 0.6 }), []);
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
    brakeMat.emissiveIntensity = car.brake > 0.05 || car.handbrake > 0.1 ? 3 : 0.6;
    reverseMat.emissiveIntensity = car.gear === -1 ? 2.5 : 0;
  });

  const body_color = '#c8102e';
  return (
    <group ref={root}>
      <group ref={body}>
        {/* Carroceria */}
        <Box args={[4.3, 0.5, 1.8]} position={[0, 0.62, 0]} color={body_color} metalness={0.45} roughness={0.3} />
        <Box args={[1.5, 0.12, 1.72]} position={[1.3, 0.92, 0]} rotation={[0, 0, -0.06]} color={body_color} metalness={0.45} roughness={0.3} />
        <Box args={[2.0, 0.46, 1.52]} position={[-0.35, 1.1, 0]} color="#2c3a4e" metalness={0.5} roughness={0.12} />
        <Box args={[1.55, 0.07, 1.5]} position={[-0.4, 1.36, 0]} color={body_color} metalness={0.45} roughness={0.3} />
        <Box args={[0.62, 0.05, 1.46]} position={[0.82, 1.1, 0]} rotation={[0, 0, -0.75]} color="#223047" metalness={0.7} roughness={0.08} />
        <Box args={[0.6, 0.05, 1.46]} position={[-1.52, 1.1, 0]} rotation={[0, 0, 0.8]} color="#223047" metalness={0.7} roughness={0.08} />
        {/* Para-choques e saias */}
        <Box args={[0.25, 0.32, 1.84]} position={[2.18, 0.48, 0]} color="#2b2d31" roughness={0.6} />
        <Box args={[0.25, 0.32, 1.84]} position={[-2.18, 0.48, 0]} color="#2b2d31" roughness={0.6} />
        <Box args={[2.3, 0.14, 1.86]} position={[0, 0.36, 0]} color="#2b2d31" roughness={0.6} />
        {/* Aerofólio */}
        <Box args={[0.08, 0.28, 0.08]} position={[-1.95, 1.0, 0.55]} color="#111" />
        <Box args={[0.08, 0.28, 0.08]} position={[-1.95, 1.0, -0.55]} color="#111" />
        <Box args={[0.45, 0.05, 1.75]} position={[-2.0, 1.16, 0]} rotation={[0, 0, 0.08]} color="#111" />
        {/* Faixa esportiva */}
        <Box args={[4.31, 0.02, 0.28]} position={[0, 0.875, 0]} color="#f5f5f5" roughness={0.4} />
        {/* Faróis */}
        {[0.62, -0.62].map((z) => (
          <mesh key={z} position={[2.16, 0.72, z]}>
            <boxGeometry args={[0.06, 0.14, 0.42]} />
            <meshStandardMaterial color="#fffbe8" emissive="#fffbe8" emissiveIntensity={1.5} />
          </mesh>
        ))}
        {/* Lanternas */}
        {[0.62, -0.62].map((z) => (
          <mesh key={z} position={[-2.16, 0.74, z]} material={brakeMat}>
            <boxGeometry args={[0.06, 0.13, 0.44]} />
          </mesh>
        ))}
        <mesh position={[-2.16, 0.74, 0]} material={reverseMat}>
          <boxGeometry args={[0.06, 0.1, 0.3]} />
        </mesh>
      </group>

      <Wheel position={[WHEEL_X[0], R, CAR.halfTrack]} steerRef={steer[0]} spinRef={spin[0]} />
      <Wheel position={[WHEEL_X[0], R, -CAR.halfTrack]} steerRef={steer[1]} spinRef={spin[1]} />
      <Wheel position={[WHEEL_X[1], R, CAR.halfTrack]} spinRef={spin[2]} />
      <Wheel position={[WHEEL_X[1], R, -CAR.halfTrack]} spinRef={spin[3]} />
    </group>
  );
}
