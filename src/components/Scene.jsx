import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { updateGame } from '../game/game';
import { angleDiff, clamp } from '../game/math';
import { coneTexture } from './textures';

/** Passo de simulação: roda antes de tudo no frame. */
export function Simulation({ game }) {
  useFrame((_, dt) => updateGame(game, Math.min(dt, 0.05)), -1);
  return null;
}

/** Sol com sombra que acompanha o carro. */
export function SunLight({ game }) {
  const light = useRef();
  useFrame(() => {
    const { x, y } = game.car;
    light.current.position.set(x + 40, 70, -y + 30);
    light.current.target.position.set(x, 0, -y);
    light.current.target.updateMatrixWorld();
  });
  return (
    <directionalLight
      ref={light}
      intensity={2.2}
      color="#fff4e0"
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-bias={-0.0004}
      shadow-camera-left={-45}
      shadow-camera-right={45}
      shadow-camera-top={45}
      shadow-camera-bottom={-45}
      shadow-camera-near={10}
      shadow-camera-far={200}
    />
  );
}

export function CameraRig({ game }) {
  const s = useRef({ yaw: null, dist: 6.2 });
  useFrame(({ camera }, dt) => {
    dt = Math.min(dt, 0.05);
    const car = game.car;
    const look = game.input.state;
    const mode = game.settings.cameraMode;
    const speed = Math.hypot(car.vx, car.vy);
    const st = s.current;

    // Na derrapagem a câmera olha parcialmente para onde o carro está indo
    let targetYaw = car.heading;
    if (car.vx > 2) targetYaw += Math.atan2(car.vy, car.vx) * 0.55;
    if (st.yaw == null) st.yaw = targetYaw;
    const follow = mode >= 2 ? 40 : 4.5;
    st.yaw += angleDiff(targetYaw, st.yaw) * Math.min(1, dt * follow);
    if (mode >= 2) st.yaw = car.heading + angleDiff(st.yaw, car.heading);

    const yaw = st.yaw - look.lookX * Math.PI * 0.9;
    const fx = Math.cos(yaw), fy = Math.sin(yaw);
    let fovTarget;

    if (mode <= 1) {
      const baseD = mode === 0 ? 5.6 : 8.8;
      const targetD = baseD + speed * 0.03 + clamp(car.axLoad, -8, 8) * 0.05;
      st.dist += (targetD - st.dist) * Math.min(1, dt * 3);
      const h = (mode === 0 ? 1.8 : 3.0) + look.lookY * 1.6;
      camera.position.set(car.x - fx * st.dist, Math.max(0.6, h), -(car.y - fy * st.dist));
      camera.lookAt(car.x + fx * 2, 1.0, -(car.y + fy * 2));
      fovTarget = 58 + clamp(speed, 0, 70) * 0.26;
    } else {
      const hf = Math.cos(car.heading), hs = Math.sin(car.heading);
      const fwd = mode === 2 ? 0.1 : 2.1;
      const hgt = mode === 2 ? 1.2 : 0.5;
      camera.position.set(car.x + hf * fwd, hgt + car.pitch * fwd, -(car.y + hs * fwd));
      camera.lookAt(car.x + hf * fwd + fx * 20, hgt - 0.4 - look.lookY * 6, -(car.y + hs * fwd + fy * 20));
      camera.rotateZ(-car.roll * 0.5);
      fovTarget = 68 + clamp(speed, 0, 70) * 0.18;
    }
    // Tremor: derrapagem, grama e batidas (ruído suave, não aleatório por frame)
    const offroad = car.onRoad ? 0 : clamp(speed / 25, 0, 1);
    const shake = Math.max(car.skidR, car.skidF) * 0.025 * clamp(speed / 15, 0, 1) + offroad * 0.035 + game.impact * 0.2;
    if (shake > 0.001) {
      const tt = performance.now() / 1000;
      camera.position.x += Math.sin(tt * 41) * Math.sin(tt * 13.7) * shake;
      camera.position.y += Math.sin(tt * 53 + 1.3) * Math.sin(tt * 9.1) * shake;
      camera.position.z += Math.sin(tt * 37 + 2.1) * Math.sin(tt * 11.3) * shake;
    }
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
  });
  return null;
}

export function Cones({ game }) {
  const cones = useRef();
  const bases = useRef();
  const { coneGeo, baseGeo, coneMat } = useMemo(() => {
    const cg = new THREE.ConeGeometry(0.24, 0.72, 14, 1, true);
    cg.translate(0, 0.38, 0);
    const bg = new THREE.BoxGeometry(0.5, 0.04, 0.5);
    bg.translate(0, 0.02, 0);
    return { coneGeo: cg, baseGeo: bg, coneMat: new THREE.MeshStandardMaterial({ map: coneTexture(), roughness: 0.6, side: THREE.DoubleSide }) };
  }, []);
  const tmp = useMemo(() => ({
    m: new THREE.Matrix4(), q: new THREE.Quaternion(), qy: new THREE.Quaternion(), p: new THREE.Vector3(),
    one: new THREE.Vector3(1, 1, 1), axis: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0),
  }), []);

  const update = () => {
    const { m, q, qy, p, one, axis, up } = tmp;
    game.cones.forEach((c, i) => {
      p.set(c.x, c.z, -c.y);
      qy.setFromAxisAngle(up, c.yaw);
      axis.set(-Math.sin(c.tiltDir), 0, -Math.cos(c.tiltDir));
      q.setFromAxisAngle(axis, c.tilt).multiply(qy);
      m.compose(p, q, one);
      cones.current.setMatrixAt(i, m);
      bases.current.setMatrixAt(i, m);
    });
    cones.current.instanceMatrix.needsUpdate = true;
    bases.current.instanceMatrix.needsUpdate = true;
  };
  useLayoutEffect(() => {
    update();
    cones.current.computeBoundingSphere();
  });
  useFrame(update);

  const n = game.cones.length;
  return (
    <group>
      <instancedMesh ref={cones} args={[coneGeo, coneMat, n]} castShadow frustumCulled={false} />
      <instancedMesh ref={bases} args={[baseGeo, null, n]} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#222" />
      </instancedMesh>
    </group>
  );
}
