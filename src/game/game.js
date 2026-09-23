import { createInput } from './input.js';
import { createAudio } from './audio.js';
import {
  ASSISTS, G, buildSpec, controlStep, createCarState, physicsStep, resetCar, suspensionStep,
} from './carPhysics.js';
import {
  CURB_WIDTH, ROAD_WIDTH, WORLD_LIMIT, createCones, createTrack, generateTrees,
  nearestOnTrack, resetCones, spawnAt,
} from './track.js';
import { clamp } from './math.js';
import { getCar } from '../data/cars.js';

const PHYSICS_DT = 1 / 240;
export const CAMERA_MODES = ['Perseguição', 'Perseguição longe', 'Capô', 'Para-choque'];

const CONE_RADIUS = 0.3;

export function createGame(carId) {
  const carData = getCar(carId);
  const track = createTrack();
  const spawnIndex = track.N - 10;
  return {
    track,
    trees: generateTrees(track),
    cones: createCones(),
    carData,
    car: createCarState(spawnAt(track, spawnIndex), buildSpec(carData)),
    input: createInput(),
    audio: createAudio(),
    settings: { assistLevel: 0, manual: false, cameraMode: 0 },
    lap: { current: 0, best: null, last: null, started: false, checkpoint: false, lastIndex: spawnIndex, count: 0 },
    started: false,
    acc: 0,
    time: 0,
    impact: 0,
    rumbleTimer: 0,
    trackIndex: spawnIndex,
    toast: null,
  };
}

function showToast(game, text) {
  game.toast = { text, until: game.time + 2.2 };
}

function toWorld(car) {
  const c = Math.cos(car.heading), s = Math.sin(car.heading);
  car.wvx = car.vx * c - car.vy * s;
  car.wvy = car.vx * s + car.vy * c;
}
function toLocal(car) {
  const c = Math.cos(car.heading), s = Math.sin(car.heading);
  car.vx = car.wvx * c + car.wvy * s;
  car.vy = -car.wvx * s + car.wvy * c;
}

// Impulso de colisão num ponto do carro (rp = vetor do CG até o contato, n = normal para fora do obstáculo)
function resolveContact(game, rpx, rpy, nx, ny, pen, restitution) {
  const car = game.car;
  car.x += nx * pen;
  car.y += ny * pen;
  const vpx = car.wvx - car.r * rpy;
  const vpy = car.wvy + car.r * rpx;
  const vn = vpx * nx + vpy * ny;
  if (vn >= 0) return;
  const m = car.spec.mass, I = car.spec.inertia;
  const rn = rpx * ny - rpy * nx;
  const j = (-(1 + restitution) * vn) / (1 / m + (rn * rn) / I);
  car.wvx += (j * nx) / m;
  car.wvy += (j * ny) / m;
  car.r += (rn * j) / I;
  // atrito tangencial
  const tx = -ny, ty = nx;
  const vt = vpx * tx + vpy * ty;
  const rt = rpx * ty - rpy * tx;
  const jt = clamp(-vt / (1 / m + (rt * rt) / I), -0.35 * j, 0.35 * j);
  car.wvx += (jt * tx) / m;
  car.wvy += (jt * ty) / m;
  car.r += (rt * jt) / I;
  game.impact = Math.max(game.impact, clamp(-vn / 12, 0, 1));
}

function collide(game) {
  const car = game.car;
  const { circles: CAR_CIRCLES, radius: CAR_RADIUS } = car.spec.collision;
  toWorld(car);
  const c = Math.cos(car.heading), s = Math.sin(car.heading);
  for (const off of CAR_CIRCLES) {
    const rpx = off * c, rpy = off * s;
    const cx = car.x + rpx, cy = car.y + rpy;

    for (const t of game.trees) {
      const dx = cx - t.x, dy = cy - t.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) continue;
      const dist = Math.hypot(dx, dy);
      const minD = CAR_RADIUS + t.radius;
      if (dist < minD && dist > 1e-6) {
        resolveContact(game, rpx - (dx / dist) * CAR_RADIUS, rpy - (dy / dist) * CAR_RADIUS, dx / dist, dy / dist, minD - dist, 0.25);
      }
    }

    const lim = WORLD_LIMIT - CAR_RADIUS;
    if (cx > lim) resolveContact(game, rpx + CAR_RADIUS, rpy, -1, 0, cx - lim, 0.3);
    if (cx < -lim) resolveContact(game, rpx - CAR_RADIUS, rpy, 1, 0, -lim - cx, 0.3);
    if (cy > lim) resolveContact(game, rpx, rpy + CAR_RADIUS, 0, -1, cy - lim, 0.3);
    if (cy < -lim) resolveContact(game, rpx, rpy - CAR_RADIUS, 0, 1, -lim - cy, 0.3);
  }
  toLocal(car);
}

function updateCones(game, dt) {
  const car = game.car;
  const { circles: CAR_CIRCLES, radius: CAR_RADIUS } = car.spec.collision;
  const c = Math.cos(car.heading), s = Math.sin(car.heading);
  for (const cone of game.cones) {
    const ddx = cone.x - car.x, ddy = cone.y - car.y;
    if (ddx * ddx + ddy * ddy < 16 && cone.z < 0.5) {
      for (const off of CAR_CIRCLES) {
        const rpx = off * c, rpy = off * s;
        const dx = cone.x - (car.x + rpx), dy = cone.y - (car.y + rpy);
        const dist = Math.hypot(dx, dy);
        if (dist < CAR_RADIUS + CONE_RADIUS && dist > 1e-6) {
          const nx = dx / dist, ny = dy / dist;
          const vpx = car.wvx - car.r * rpy, vpy = car.wvy + car.r * rpx;
          const sp = Math.hypot(vpx, vpy);
          cone.x += nx * (CAR_RADIUS + CONE_RADIUS - dist);
          cone.y += ny * (CAR_RADIUS + CONE_RADIUS - dist);
          if (sp > 0.5) {
            cone.vx = vpx * 1.15 + nx * 1.5;
            cone.vy = vpy * 1.15 + ny * 1.5;
            cone.vz = 1 + sp * 0.18;
            cone.spin = (Math.random() - 0.5) * 12;
            cone.tiltDir = Math.atan2(cone.vy, cone.vx);
            cone.tiltVel = 3 + sp * 0.4;
            cone.knocked = true;
            game.impact = Math.max(game.impact, 0.12);
          }
        }
      }
    }
    if (!cone.knocked) continue;
    cone.vz -= G * dt;
    cone.x += cone.vx * dt;
    cone.y += cone.vy * dt;
    cone.z += cone.vz * dt;
    cone.yaw += cone.spin * dt;
    cone.tilt = Math.min(Math.PI / 2, cone.tilt + cone.tiltVel * dt);
    if (cone.z <= 0) {
      cone.z = 0;
      cone.vz = cone.vz < -1.5 ? -cone.vz * 0.3 : 0;
      const f = Math.max(0, 1 - 4 * dt);
      cone.vx *= f;
      cone.vy *= f;
      cone.spin *= f;
    }
  }
}

function updateLap(game, index, dt) {
  const { lap, track } = game;
  const N = track.N;
  if (index > N * 0.45 && index < N * 0.55) lap.checkpoint = true;
  if (lap.lastIndex > N * 0.9 && index < N * 0.1) {
    if (lap.started && lap.checkpoint) {
      lap.last = lap.current;
      lap.count++;
      const record = lap.best == null || lap.current < lap.best;
      if (record) lap.best = lap.current;
      showToast(game, record ? 'Nova melhor volta!' : 'Volta completa');
    }
    lap.started = true;
    lap.current = 0;
    lap.checkpoint = false;
  } else if (lap.lastIndex < N * 0.1 && index > N * 0.9) {
    lap.started = false; // cruzou a linha ao contrário
  }
  lap.lastIndex = index;
  if (lap.started) lap.current += dt;
}

function resetToTrack(game) {
  const { track, car } = game;
  const near = nearestOnTrack(track, car.x, car.y);
  resetCar(car, spawnAt(track, near.index));
  game.lap.started = false;
  game.lap.lastIndex = near.index;
  game.acc = 0;
}

export function updateGame(game, dt) {
  const { input, car, settings } = game;
  game.time += dt;
  const st = input.poll(dt);
  const p = st.pressed;

  if (st.anyPressed) {
    game.started = true;
    game.audio.start();
  }
  if (p.camera) settings.cameraMode = (settings.cameraMode + 1) % CAMERA_MODES.length;
  if (p.assist) {
    settings.assistLevel = (settings.assistLevel + 1) % ASSISTS.length;
    showToast(game, `Assistência: ${ASSISTS[settings.assistLevel].name}`);
  }
  if (p.transmission) {
    settings.manual = !settings.manual;
    showToast(game, settings.manual ? 'Câmbio manual (LB / RB)' : 'Câmbio automático');
  }
  if (p.reset) resetToTrack(game);
  if (p.resetCones) { resetCones(game.cones); showToast(game, 'Cones reposicionados'); }

  // Superfície: asfalto/zebra ou grama
  const near = nearestOnTrack(game.track, car.x, car.y);
  game.trackIndex = near.index;
  car.onRoad = near.dist < ROAD_WIDTH / 2 + CURB_WIDTH;
  car.surfaceGrip = car.onRoad ? 1 : 0.68;
  car.surfaceRoll = car.onRoad ? 0 : 140;

  const assist = ASSISTS[settings.assistLevel];
  controlStep(car, st, dt, assist, settings.manual, p);

  game.acc += dt;
  let steps = 0;
  while (game.acc >= PHYSICS_DT && steps < 30) {
    physicsStep(car, PHYSICS_DT, assist);
    collide(game);
    game.acc -= PHYSICS_DT;
    steps++;
  }

  updateCones(game, dt);
  suspensionStep(car, dt);
  updateLap(game, near.index, dt);
  game.audio.update(car, st);

  // Vibração do controle
  game.impact = Math.max(0, game.impact - dt * 3);
  game.rumbleTimer -= dt;
  if (game.rumbleTimer <= 0) {
    game.rumbleTimer = 0.09;
    const speed = Math.hypot(car.vx, car.vy);
    const offroad = car.onRoad ? 0 : clamp(speed / 15, 0, 1) * (0.15 + Math.random() * 0.2);
    const limiter = car.rpm > car.spec.redline - 50 ? 0.12 : 0;
    const strong = game.impact + offroad + car.wheelspin * 0.25;
    const weak = Math.max(car.skidR, car.skidF) * 0.35 + limiter + (car.tcActive || car.espActive ? 0.1 : 0) + game.impact * 0.5;
    if (strong > 0.02 || weak > 0.02) input.rumble(strong, weak, 130);
  }
}
