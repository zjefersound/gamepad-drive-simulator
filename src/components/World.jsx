import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Sky } from '@react-three/drei';
import { CURB_WIDTH, ROAD_WIDTH, WORLD_LIMIT } from '../game/track';
import { asphaltTexture, checkerTexture, grassTexture } from './textures';

// Faixa (ribbon) ao longo da pista entre dois deslocamentos laterais
function ribbon(track, inner, outer, y, vScale, filter) {
  const pos = [];
  const uv = [];
  const col = [];
  const { samples, N } = track;
  for (let i = 0; i < N; i++) {
    if (filter && !filter(i)) continue;
    const a = samples[i], b = samples[(i + 1) % N];
    const sa = a.s, sb = i + 1 === N ? track.length : b.s;
    const p = (s, off) => [s.x + s.nx * off, y, -(s.y + s.ny * off)];
    const a0 = p(a, inner), a1 = p(a, outer), b0 = p(b, inner), b1 = p(b, outer);
    pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
    uv.push(0, sa / vScale, 0, sb / vScale, 1, sa / vScale, 1, sa / vScale, 0, sb / vScale, 1, sb / vScale);
    const stripe = Math.floor(sa / 2.5) % 2 === 0;
    const c = stripe ? [0.85, 0.1, 0.1] : [0.95, 0.95, 0.95];
    for (let k = 0; k < 6; k++) col.push(...c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function Road({ track }) {
  const { road, curbs, tex } = useMemo(() => {
    const half = ROAD_WIDTH / 2;
    const curvy = (i) => {
      let k = 0;
      for (let j = -6; j <= 6; j++) k = Math.max(k, Math.abs(track.samples[(i + j + track.N) % track.N].curvature));
      return k > 1 / 70;
    };
    const curbGeo = [
      ribbon(track, half, half + CURB_WIDTH, 0.03, 1, curvy),
      ribbon(track, -half - CURB_WIDTH, -half, 0.03, 1, curvy),
    ];
    return { road: ribbon(track, -half, half, 0.02, 16), curbs: curbGeo, tex: asphaltTexture() };
  }, [track]);

  return (
    <group>
      <mesh geometry={road} receiveShadow>
        <meshStandardMaterial map={tex} roughness={0.92} side={THREE.DoubleSide} />
      </mesh>
      {curbs.map((g, i) => (
        <mesh key={i} geometry={g} receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.8} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

function StartLine({ track }) {
  const s = track.samples[0];
  const tex = useMemo(checkerTexture, []);
  return (
    <group position={[s.x, 0.035, -s.y]} rotation={[0, Math.atan2(s.ty, s.tx), 0]}>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} receiveShadow>
        <planeGeometry args={[ROAD_WIDTH, 1.6]} />
        <meshStandardMaterial map={tex} roughness={0.8} />
      </mesh>
      {/* Pórtico */}
      {[1, -1].map((side) => (
        <mesh key={side} position={[0, 3, side * (ROAD_WIDTH / 2 + 1.5)]} castShadow>
          <boxGeometry args={[0.4, 6, 0.4]} />
          <meshStandardMaterial color="#d9d9d9" />
        </mesh>
      ))}
      <mesh position={[0, 6.2, 0]} castShadow>
        <boxGeometry args={[0.6, 1.2, ROAD_WIDTH + 3.4]} />
        <meshStandardMaterial color="#1b1f2a" />
      </mesh>
    </group>
  );
}

function Ground() {
  const tex = useMemo(() => {
    const t = grassTexture();
    t.repeat.set(300, 300);
    return t;
  }, []);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[2400, 2400]} />
      <meshStandardMaterial map={tex} roughness={1} />
    </mesh>
  );
}

function Walls() {
  const L = WORLD_LIMIT;
  const walls = [
    [0, -L - 0.5, 2 * L + 2, 1],
    [0, L + 0.5, 2 * L + 2, 1],
    [L + 0.5, 0, 1, 2 * L + 2],
    [-L - 0.5, 0, 1, 2 * L + 2],
  ];
  return walls.map(([x, y, w, d], i) => (
    <mesh key={i} position={[x, 0.6, -y]} receiveShadow>
      <boxGeometry args={[w, 1.2, d]} />
      <meshStandardMaterial color="#9aa0a8" />
    </mesh>
  ));
}

function Trees({ trees }) {
  const trunks = useRef();
  const leaves = useRef();
  const leaves2 = useRef();
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    trees.forEach((t, i) => {
      const s = t.scale;
      q.setFromEuler(e.set(0, t.rot, 0));
      m.compose(new THREE.Vector3(t.x, 1.2 * s, -t.y), q, new THREE.Vector3(s, s, s));
      trunks.current.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(t.x, 3.6 * s, -t.y), q, new THREE.Vector3(s, s, s));
      leaves.current.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(t.x, 5.4 * s, -t.y), q, new THREE.Vector3(s * 0.75, s * 0.8, s * 0.75));
      leaves2.current.setMatrixAt(i, m);
    });
    for (const r of [trunks, leaves, leaves2]) {
      r.current.instanceMatrix.needsUpdate = true;
      r.current.computeBoundingSphere();
    }
  }, [trees]);
  return (
    <group>
      <instancedMesh ref={trunks} args={[null, null, trees.length]} castShadow>
        <cylinderGeometry args={[0.3, 0.45, 2.4, 7]} />
        <meshStandardMaterial color="#6b4a2b" />
      </instancedMesh>
      <instancedMesh ref={leaves} args={[null, null, trees.length]} castShadow>
        <coneGeometry args={[2.3, 4, 8]} />
        <meshStandardMaterial color="#2f6b2a" flatShading />
      </instancedMesh>
      <instancedMesh ref={leaves2} args={[null, null, trees.length]} castShadow>
        <coneGeometry args={[2.3, 4, 8]} />
        <meshStandardMaterial color="#377a31" flatShading />
      </instancedMesh>
    </group>
  );
}

export default function World({ game }) {
  return (
    <>
      <color attach="background" args={['#bcd3e6']} />
      <fog attach="fog" args={['#bcd3e6', 180, 750]} />
      <Sky distance={3000} sunPosition={[120, 80, 60]} turbidity={6} rayleigh={1.2} />
      <hemisphereLight args={['#dbe9ff', '#4c6b35', 0.9]} />
      <Ground />
      <Road track={game.track} />
      <StartLine track={game.track} />
      <Trees trees={game.trees} />
      <Walls />
    </>
  );
}
