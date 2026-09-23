import { Component, Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import GolBola, { GOL_FRONT_AXLE } from './GolBola';
import { prepareCarModel } from './carModel';
import { assetUrl } from '../data/cars';

// Roda de aço com calota (usada pelo modelo procedural)
function ProceduralWheel({ radius, side }) {
  const w = 0.18;
  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[radius, radius, w, 24]} />
        <meshStandardMaterial color="#151515" roughness={0.92} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, side * 0.005]}>
        <cylinderGeometry args={[radius * 0.66, radius * 0.66, w + 0.01, 20]} />
        <meshStandardMaterial color="#c3c7cd" metalness={0.8} roughness={0.3} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * radius * 0.42, Math.sin(a) * radius * 0.42, side * (w / 2 + 0.008)]}>
            <boxGeometry args={[0.05, 0.05, 0.01]} />
            <meshStandardMaterial color="#3a3d42" />
          </mesh>
        );
      })}
    </group>
  );
}

/** Estrutura comum: carroceria com suspensão + 4 rodas (dianteiras esterçam). */
function Rig({ rig, body, wheels }) {
  return (
    <>
      <group ref={rig.body}>{body}</group>
      {wheels.map((w, i) => (
        <group key={i} position={w.position} ref={i < 2 ? rig.steer[i] : undefined}>
          <group ref={rig.spin[i]}>{w.content}</group>
        </group>
      ))}
    </>
  );
}

function ProceduralCar({ spec, rig, lights }) {
  const R = spec.wheelRadius;
  const wheels = [
    [spec.cgToFront, spec.halfTrack, 1], [spec.cgToFront, -spec.halfTrack, -1],
    [-spec.cgToRear, spec.halfTrack, 1], [-spec.cgToRear, -spec.halfTrack, -1],
  ].map(([x, z, side]) => ({ position: [x, R, z], content: <ProceduralWheel radius={R} side={side} /> }));
  const body = (
    <group position={[spec.cgToFront - GOL_FRONT_AXLE, 0, 0]}>
      <GolBola brakeMat={lights.brake} reverseMat={lights.reverse} />
    </group>
  );
  return <Rig rig={rig} body={body} wheels={wheels} />;
}

function GltfCar({ asset, spec, rig, fallback }) {
  const gltf = useGLTF(assetUrl(asset.file));
  const model = useMemo(() => prepareCarModel(gltf, asset, spec), [gltf, asset, spec]);
  useEffect(() => {
    rig.brakeMats.current = model.brakeMaterials;
    return () => { rig.brakeMats.current = []; };
  }, [model, rig.brakeMats]);
  if (!model.wheels) return fallback; // nós de roda não encontrados
  const wheels = model.wheels.map((w) => ({ position: w.position, content: <primitive object={w.object} /> }));
  return <Rig rig={rig} body={<primitive object={model.body} />} wheels={wheels} />;
}

class ModelErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.warn('Falha ao carregar o modelo 3D, usando o modelo procedural.', err); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function Car({ game }) {
  const root = useRef();
  const rig = {
    body: useRef(), steer: [useRef(), useRef()], spin: [useRef(), useRef(), useRef(), useRef()], brakeMats: useRef([]),
  };
  const lights = useMemo(() => ({
    brake: new THREE.MeshStandardMaterial({ color: '#8a0008', emissive: '#ff0010', emissiveIntensity: 0.5 }),
    reverse: new THREE.MeshStandardMaterial({ color: '#dddddd', emissive: '#ffffff', emissiveIntensity: 0 }),
  }), []);
  const spec = game.car.spec;
  const asset = game.carData.asset;

  useFrame(() => {
    const car = game.car;
    root.current.position.set(car.x, 0, -car.y);
    root.current.rotation.y = car.heading;
    if (rig.body.current) {
      rig.body.current.rotation.set(car.roll, 0, car.pitch);
      rig.body.current.position.y = -Math.abs(car.pitch) * 0.6;
    }
    rig.steer.forEach((s) => s.current && (s.current.rotation.y = car.steer));
    rig.spin.forEach((s, i) => s.current && (s.current.rotation.z = -(i < 2 ? car.wheelAngF : car.wheelAngR)));
    const braking = car.brake > 0.05 || car.handbrake > 0.1;
    lights.brake.emissiveIntensity = braking ? 1.5 : 0.5;
    for (const m of rig.brakeMats.current) m.emissiveIntensity = braking ? 2.2 : 0.15;
    lights.reverse.emissiveIntensity = car.gear === -1 ? 2.5 : 0;
  });

  const procedural = <ProceduralCar spec={spec} rig={rig} lights={lights} />;
  return (
    <group ref={root}>
      {asset?.file ? (
        <ModelErrorBoundary fallback={procedural}>
          <Suspense fallback={procedural}>
            <GltfCar asset={asset} spec={spec} rig={rig} fallback={procedural} />
          </Suspense>
        </ModelErrorBoundary>
      ) : procedural}
    </group>
  );
}
