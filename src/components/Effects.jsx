import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { wheelContacts } from '../game/effects';
import { clamp } from '../game/math';

// ---------------------------------------------------------------------------
// Marcas de pneu: faixas com opacidade proporcional à derrapagem (fade suave),
// mais escuras na roda externa; na grama viram sulcos marrons.
// ---------------------------------------------------------------------------
const MAX_SEGMENTS = 6000;
const ASPHALT = [0.06, 0.06, 0.06];
const DIRT = [0.24, 0.17, 0.09];

export function Skidmarks({ game }) {
  const { geometry, material } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SEGMENTS * 12), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_SEGMENTS * 16), 4).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array(MAX_SEGMENTS * 6);
    for (let i = 0; i < MAX_SEGMENTS; i++) {
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6);
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const m = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    return { geometry: g, material: m };
  }, []);

  const st = useRef({
    next: 0,
    contacts: undefined,
    last: [0, 1, 2, 3].map(() => ({ x: 0, y: 0, alpha: 0, active: false })),
  });

  useFrame(() => {
    const car = game.car;
    const s = st.current;
    s.contacts = wheelContacts(car, s.contacts);
    const speed = Math.hypot(car.vx, car.vy);
    const pos = geometry.attributes.position;
    const col = geometry.attributes.color;
    let changed = false;

    s.contacts.forEach((w, i) => {
      const last = s.last[i];
      const grass = !car.onRoad;
      // na grama o pneu sempre deixa rastro; no asfalto só derrapando
      let alpha = grass ? (speed > 2 ? 0.28 + 0.35 * w.intensity : 0) : w.intensity > 0.12 ? 0.12 + 0.55 * w.intensity : 0;
      if (alpha <= 0) { last.active = false; return; }
      if (!last.active) { Object.assign(last, { x: w.x, y: w.y, alpha: 0, active: true }); return; }
      const dx = w.x - last.x, dy = w.y - last.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.3) return;
      if (len > 3) { Object.assign(last, { x: w.x, y: w.y, alpha: 0 }); return; }

      const half = grass ? 0.13 : 0.1;
      const nx = (-dy / len) * half, ny = (dx / len) * half;
      const k = s.next;
      const P = pos.array, C = col.array;
      const color = grass ? DIRT : ASPHALT;
      const put = (v, x, y, a) => {
        P[k * 12 + v * 3] = x; P[k * 12 + v * 3 + 1] = grass ? 0.012 : 0.045; P[k * 12 + v * 3 + 2] = -y;
        C.set([color[0], color[1], color[2], a], k * 16 + v * 4);
      };
      alpha = Math.min(alpha, last.alpha + 0.25); // entrada suave
      put(0, last.x + nx, last.y + ny, last.alpha);
      put(1, last.x - nx, last.y - ny, last.alpha);
      put(2, w.x + nx, w.y + ny, alpha);
      put(3, w.x - nx, w.y - ny, alpha);
      s.next = (k + 1) % MAX_SEGMENTS;
      Object.assign(last, { x: w.x, y: w.y, alpha });
      changed = true;
    });
    if (changed) { pos.needsUpdate = true; col.needsUpdate = true; }
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={1} />;
}

// ---------------------------------------------------------------------------
// Fumaça de pneu (asfalto) e poeira (grama): partículas com shader de disco suave.
// ---------------------------------------------------------------------------
const MAX_PARTICLES = 900;

const smokeVertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    vAlpha = aAlpha;
    vColor = aColor;
  }
`;

const smokeFragment = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float a = smoothstep(0.5, 0.08, d);
    float shade = 0.85 + 0.3 * (0.5 - gl_PointCoord.y);
    float alpha = a * vAlpha;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(vColor * shade, alpha);
  }
`;

export function TireSmoke({ game }) {
  const { points, attrs, uniforms } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const mk = (size) => new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * size), size).setUsage(THREE.DynamicDrawUsage);
    const a = { position: mk(3), aSize: mk(1), aAlpha: mk(1), aColor: mk(3) };
    Object.entries(a).forEach(([k, v]) => g.setAttribute(k, v));
    const u = { uScale: { value: 500 } };
    const m = new THREE.ShaderMaterial({
      uniforms: u, vertexShader: smokeVertex, fragmentShader: smokeFragment,
      transparent: true, depthWrite: false,
    });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    p.renderOrder = 2;
    return { points: p, attrs: a, uniforms: u };
  }, []);

  const sim = useMemo(() => ({
    parts: Array.from({ length: MAX_PARTICLES }, () => ({
      alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 0, s1: 0, a0: 0, r: 0, g: 0, b: 0,
    })),
    next: 0,
    acc: [0, 0, 0, 0],
    contacts: undefined,
  }), []);

  const spawn = (car, w, dust) => {
    const p = sim.parts[sim.next];
    sim.next = (sim.next + 1) % MAX_PARTICLES;
    const j = () => (Math.random() * 2 - 1);
    p.alive = true;
    p.x = w.x + j() * 0.2;
    p.z = -(w.y + j() * 0.2);
    p.y = 0.25 + Math.random() * 0.1;
    // herda parte da velocidade do carro e se espalha
    p.vx = car.wvx * 0.3 + j() * 0.8;
    p.vz = -car.wvy * 0.3 + j() * 0.8;
    p.vy = 0.4 + Math.random() * 0.6;
    p.life = 0;
    if (dust) {
      p.max = 0.9 + Math.random() * 0.7;
      p.s0 = 0.7; p.s1 = 3.0 + Math.random() * 1.2;
      p.a0 = 0.5;
      const k = 0.85 + Math.random() * 0.3;
      p.r = 0.66 * k; p.g = 0.56 * k; p.b = 0.4 * k;
    } else {
      p.max = 1.8 + Math.random() * 1.2;
      p.s0 = 0.6; p.s1 = 3.4 + Math.random() * 1.4;
      p.a0 = 0.18 + 0.3 * w.intensity;
      const k = 0.82 + Math.random() * 0.12;
      p.r = p.g = p.b = k;
    }
  };

  useFrame((state, dt) => {
    dt = Math.min(dt, 0.05);
    const car = game.car;
    const speed = Math.hypot(car.vx, car.vy);
    sim.contacts = wheelContacts(car, sim.contacts);

    // Emissão por roda
    sim.contacts.forEach((w, i) => {
      let rate;
      if (car.onRoad) rate = w.intensity > 0.15 ? 75 * w.intensity : 0;
      else rate = (speed > 3 ? clamp(speed / 20, 0, 1) * 16 : 0) + w.intensity * 40;
      sim.acc[i] += rate * dt;
      while (sim.acc[i] >= 1) { spawn(car, w, !car.onRoad); sim.acc[i] -= 1; }
    });

    const P = attrs.position.array, S = attrs.aSize.array, A = attrs.aAlpha.array, C = attrs.aColor.array;
    const drag = Math.max(0, 1 - 1.4 * dt);
    sim.parts.forEach((p, i) => {
      if (!p.alive) { S[i] = 0; A[i] = 0; return; }
      p.life += dt;
      if (p.life >= p.max) { p.alive = false; S[i] = 0; A[i] = 0; return; }
      p.vx *= drag; p.vz *= drag; p.vy = p.vy * drag + 0.3 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const f = p.life / p.max;
      P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z;
      S[i] = p.s0 + (p.s1 - p.s0) * (1 - (1 - f) * (1 - f));
      A[i] = p.a0 * Math.min(1, p.life / 0.12) * Math.pow(1 - f, 1.6);
      C[i * 3] = p.r; C[i * 3 + 1] = p.g; C[i * 3 + 2] = p.b;
    });
    Object.values(attrs).forEach((a) => { a.needsUpdate = true; });
    uniforms.uScale.value = state.size.height * state.gl.getPixelRatio() * 0.5 * state.camera.projectionMatrix.elements[5];
  });

  return <primitive object={points} />;
}
