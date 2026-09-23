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
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
  });
  return null;
}

const MAX_SEGMENTS = 4000;

export function Skidmarks({ game }) {
  const { geometry, material } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SEGMENTS * 12), 3).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array(MAX_SEGMENTS * 6);
    for (let i = 0; i < MAX_SEGMENTS; i++) {
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6);
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const m = new THREE.MeshBasicMaterial({
      color: '#0d0d0d', transparent: true, opacity: 0.42, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    return { geometry: g, material: m };
  }, []);
  const st = useRef({ next: 0, last: [0, 1, 2, 3].map(() => ({ x: 0, y: 0, active: false })) });

  useFrame(() => {
    const car = game.car;
    const c = Math.cos(car.heading), s = Math.sin(car.heading);
    const pos = geometry.attributes.position;
    let changed = false;
    for (let w = 0; w < 4; w++) {
      const intensity = w < 2 ? car.skidF : car.skidR;
      const last = st.current.last[w];
      if (intensity < 0.3) { last.active = false; continue; }
      const lx = w < 2 ? car.spec.cgToFront : -car.spec.cgToRear;
      const ly = w % 2 === 0 ? car.spec.halfTrack : -car.spec.halfTrack;
      const px = car.x + lx * c - ly * s;
      const py = car.y + lx * s + ly * c;
      if (!last.active) { Object.assign(last, { x: px, y: py, active: true }); continue; }
      const dx = px - last.x, dy = py - last.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.35) continue;
      if (len > 3) { Object.assign(last, { x: px, y: py }); continue; }
      const nx = (-dy / len) * 0.12, ny = (dx / len) * 0.12;
      const i = st.current.next;
      const arr = pos.array;
      const put = (k, x, y) => { arr[i * 12 + k * 3] = x; arr[i * 12 + k * 3 + 1] = 0.045; arr[i * 12 + k * 3 + 2] = -y; };
      put(0, last.x + nx, last.y + ny);
      put(1, last.x - nx, last.y - ny);
      put(2, px + nx, py + ny);
      put(3, px - nx, py - ny);
      st.current.next = (i + 1) % MAX_SEGMENTS;
      Object.assign(last, { x: px, y: py });
      changed = true;
    }
    if (changed) pos.needsUpdate = true;
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
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
