import * as THREE from 'three';
import { mulberry32 } from './math.js';

export const ROAD_WIDTH = 13;
export const CURB_WIDTH = 1.3;
export const WORLD_LIMIT = 420;

// Pontos de controle do circuito (plano 2D: x, y). No three.js: (x, 0, -y)
const CONTROL = [
  [0, -80], [80, -80], [140, -70], [170, -30], [160, 20], [120, 40],
  [100, 80], [130, 120], [110, 165], [50, 170], [10, 140], [-20, 100],
  [-70, 110], [-130, 90], [-160, 40], [-150, -20], [-110, -60], [-60, -80],
];

export function createTrack() {
  const curve = new THREE.CatmullRomCurve3(
    CONTROL.map(([x, y]) => new THREE.Vector3(x, 0, y)),
    true,
    'centripetal',
  );
  const N = 900;
  const pts = curve.getSpacedPoints(N);
  pts.pop();

  const samples = pts.map((p) => ({ x: p.x, y: p.z, tx: 0, ty: 0, nx: 0, ny: 0, s: 0, curvature: 0 }));
  let length = 0;
  for (let i = 0; i < N; i++) {
    const prev = samples[(i - 1 + N) % N];
    const next = samples[(i + 1) % N];
    let tx = next.x - prev.x, ty = next.y - prev.y;
    const l = Math.hypot(tx, ty);
    tx /= l; ty /= l;
    const sp = samples[i];
    sp.tx = tx; sp.ty = ty;
    sp.nx = -ty; sp.ny = tx; // normal à esquerda
    if (i > 0) length += Math.hypot(sp.x - samples[i - 1].x, sp.y - samples[i - 1].y);
    sp.s = length;
  }
  length += Math.hypot(samples[0].x - samples[N - 1].x, samples[0].y - samples[N - 1].y);
  for (let i = 0; i < N; i++) {
    const a = samples[(i - 2 + N) % N], c = samples[(i + 2) % N];
    const ang = Math.atan2(a.tx * c.ty - a.ty * c.tx, a.tx * c.tx + a.ty * c.ty);
    const ds = Math.hypot(c.x - a.x, c.y - a.y);
    samples[i].curvature = ang / ds;
  }

  return { samples, N, length, width: ROAD_WIDTH };
}

export function nearestOnTrack(track, x, y) {
  let best = 0, bestD = Infinity;
  const { samples } = track;
  for (let i = 0; i < samples.length; i++) {
    const dx = samples[i].x - x, dy = samples[i].y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return { index: best, dist: Math.sqrt(bestD) };
}

export function spawnAt(track, index) {
  const s = track.samples[(index + track.N) % track.N];
  return { x: s.x, y: s.y, heading: Math.atan2(s.ty, s.tx) };
}

export function generateTrees(track) {
  const rand = mulberry32(1337);
  const trees = [];
  let tries = 0;
  while (trees.length < 320 && tries < 20000) {
    tries++;
    const x = (rand() * 2 - 1) * (WORLD_LIMIT - 15);
    const y = (rand() * 2 - 1) * (WORLD_LIMIT - 15);
    if (x > -95 && x < 165 && y > -170 && y < -100) continue; // área de treino com cones
    if (nearestOnTrack(track, x, y).dist < ROAD_WIDTH / 2 + 12) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.y - y) < 5)) continue;
    trees.push({ x, y, radius: 0.45, scale: 0.8 + rand() * 0.7, rot: rand() * Math.PI * 2 });
  }
  return trees;
}

export function createCones() {
  const layout = [];
  // Slalom
  for (let i = 0; i < 10; i++) layout.push([-60 + i * 14, -130]);
  // Círculo para "zerinhos"
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    layout.push([125 + Math.cos(a) * 12, -135 + Math.sin(a) * 12]);
  }
  // Portões de frenagem
  for (let i = 0; i < 4; i++) {
    layout.push([-60 + i * 30, -150], [-60 + i * 30, -156]);
  }
  return layout.map(([x, y]) => ({
    home: [x, y], x, y, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, tilt: 0, tiltVel: 0, tiltDir: 0, spin: 0, knocked: false,
  }));
}

export function resetCones(cones) {
  for (const c of cones) {
    Object.assign(c, { x: c.home[0], y: c.home[1], z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, tilt: 0, tiltVel: 0, spin: 0, knocked: false });
  }
}
