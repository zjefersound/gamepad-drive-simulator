import { ASSISTS, controlStep, createCarState, physicsStep, suspensionStep } from './carPhysics.js';
import { clamp } from './math.js';

/*
 * Testes padronizados rodando a própria física do jogo (sem render).
 * Usado por `npm run car-stats` para preencher "stats", "class" e "pi" no cars.json.
 */

const FRAME = 1 / 60;
const STEP = 1 / 240;
const NO_PRESS = {};

function simulate(spec, { grip = 1, init, input, stop, maxT = 120 }) {
  const car = createCarState({ x: 0, y: 0, heading: 0 }, spec);
  car.surfaceGrip = grip;
  car.surfaceRoll = grip < 1 ? 140 : 0;
  if (init) init(car);
  const assist = ASSISTS[0];
  let t = 0;
  let dist = 0;
  while (t < maxT) {
    controlStep(car, { steer: 0, throttle: 0, brake: 0, handbrake: 0, ...input(car, t) }, FRAME, assist, false, NO_PRESS);
    for (let i = 0; i < 4; i++) {
      physicsStep(car, STEP, assist);
      dist += Math.hypot(car.vx, car.vy) * STEP;
    }
    suspensionStep(car, FRAME);
    t += FRAME;
    if (stop && stop(car, t, dist)) break;
  }
  return { car, t, dist };
}

const kmh = (car) => Math.hypot(car.vx, car.vy) * 3.6;

/** Mede os números de desempenho de um carro. */
export function measureCar(spec) {
  const full = () => ({ throttle: 1 });

  const t60 = simulate(spec, { input: full, stop: (c) => kmh(c) >= 60 }).t;
  const t100 = simulate(spec, { input: full, stop: (c) => kmh(c) >= 100 }).t;
  const t60Grass = simulate(spec, { grip: 0.68, input: full, stop: (c) => kmh(c) >= 60, maxT: 60 }).t;

  let top = 0;
  simulate(spec, { input: full, stop: (c) => { top = Math.max(top, kmh(c)); return false; }, maxT: 150 });

  const braking = simulate(spec, {
    init: (c) => { c.vx = 100 / 3.6; c.gear = 3; },
    input: () => ({ brake: 1 }),
    stop: (c) => c.vx < 0.3,
  });

  // Skidpad: esterço máximo a ~80 km/h, mede a aceleração lateral sustentada
  let latSum = 0, latN = 0;
  simulate(spec, {
    init: (c) => { c.vx = 80 / 3.6; c.gear = 3; },
    input: (c, t) => ({ steer: 1, throttle: kmh(c) < 80 ? 0.6 : 0.2 }),
    stop: (c, t) => {
      if (t > 4) { latSum += Math.abs(c.ayLoad); latN++; }
      return t > 8;
    },
  });

  return {
    zeroToSixtyS: +t60.toFixed(2),
    zeroToHundredS: +t100.toFixed(2),
    zeroToSixtyGrassS: +t60Grass.toFixed(2),
    topSpeedKmh: Math.round(top),
    braking100to0M: +braking.dist.toFixed(1),
    lateralG: +(latSum / latN / 9.81).toFixed(2),
  };
}

const rate = (v, worst, best) => +clamp((10 * (v - worst)) / (best - worst), 0, 10).toFixed(1);

const CLASSES = [[901, 'X'], [801, 'S2'], [701, 'S1'], [601, 'A'], [501, 'B'], [401, 'C'], [0, 'D']];

/** Converte as medições em notas de 0 a 10, índice de desempenho (PI) e classe. */
export function rateCar(m) {
  const stats = {
    speed: rate(m.topSpeedKmh, 120, 330),
    acceleration: rate(m.zeroToHundredS, 16, 2.5),
    braking: rate(m.braking100to0M, 55, 28),
    handling: rate(m.lateralG, 0.6, 1.5),
    launch: rate(m.zeroToSixtyS, 7, 1.4),
    offroad: rate(m.zeroToSixtyGrassS, 12, 2.5),
  };
  const avg =
    stats.speed * 0.2 + stats.acceleration * 0.25 + stats.braking * 0.15 +
    stats.handling * 0.25 + stats.launch * 0.1 + stats.offroad * 0.05;
  const pi = Math.round(clamp(100 + avg * 80, 100, 999));
  const cls = CLASSES.find(([min]) => pi >= min)[1];
  return { stats, pi, class: cls };
}
