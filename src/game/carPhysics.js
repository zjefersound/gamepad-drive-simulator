import { clamp, moveTowards } from './math.js';

/*
 * Modelo de veículo "bicicleta" (2 eixos) com:
 *  - pneus com curva Pacejka simplificada e círculo de atrito (tração x curva)
 *  - transferência de carga longitudinal (frenagem pesa a dianteira)
 *  - tração dianteira, traseira ou integral, câmbio e curva de torque vindos do cars.json
 *  - assistências: controle de tração, ESP, contra-esterço e limite de esterço
 *    dependente da velocidade (o grande segredo da boa dirigibilidade no gamepad)
 *
 * Coordenadas do corpo: x = frente, y = esquerda, yaw positivo = anti-horário.
 */

export const G = 9.81;
const RAD2RPM = 60 / (2 * Math.PI);

const DRIVE_FRONT_SHARE = { FWD: 1, RWD: 0, AWD: 0.4 };

const DEFAULTS = {
  mass: 1200,
  cgToFront: 1.2,
  cgToRear: 1.3,
  cgHeight: 0.5,
  wheelRadius: 0.3,
  halfTrack: 0.72,
  maxSteer: 0.6,
  drivetrain: 'RWD',
  torqueCurve: [[1000, 150], [4000, 200], [6500, 170]],
  idleRpm: 850,
  redline: 6800,
  shiftUpRpm: 6500,
  shiftDownRpm: 2600,
  engineBrake: 40,
  gears: [3.5, 2.1, 1.45, 1.1, 0.9],
  reverseGear: 3.3,
  finalDrive: 3.9,
  drivetrainEff: 0.87,
  brakeForce: 12000,
  brakeBias: 0.66,
  drag: 0.4,
  rollingResistance: 0.013,
  muFront: 1.0,
  muRear: 1.1,
};

/** Monta a especificação de física a partir de um carro do cars.json. */
export function buildSpec(carData) {
  const p = { ...DEFAULTS, ...(carData.physics || {}) };
  p.wheelbase = p.cgToFront + p.cgToRear;
  p.inertia = p.inertia ?? p.mass * p.cgToFront * p.cgToRear * 1.15;
  p.driveFront = p.driveFrontShare ?? DRIVE_FRONT_SHARE[p.drivetrain] ?? 0;
  p.topGear = p.gears.length;
  p.torqueCurve = [...p.torqueCurve].sort((x, y) => x[0] - y[0]);

  // Colisão: 3 círculos ao longo do comprimento, centrados entre os eixos
  const length = (carData.specs?.lengthMm ?? 4000) / 1000;
  const radius = (carData.specs?.widthMm ?? 1700) / 2000;
  const mid = (p.cgToFront - p.cgToRear) / 2;
  const reach = length / 2 - radius;
  p.collision = { radius, circles: [mid + reach, mid, mid - reach] };
  return p;
}

export const ASSISTS = [
  { name: 'Completa', tc: true, esp: true, countersteer: 0.55, steerAllowance: 1.0 },
  { name: 'Esportiva', tc: true, esp: false, countersteer: 0.3, steerAllowance: 1.15 },
  { name: 'Desligada', tc: false, esp: false, countersteer: 0, steerAllowance: 1.6 },
];

// Curva lateral do pneu (Pacejka "magic formula" normalizada)
// Traseira com queda mais suave após o pico: derrapagem progressiva e controlável
const PB = 13, PC_FRONT = 1.45, PC_REAR = 1.28, PE = 0.2;
export function tireCurve(slip, C = PC_FRONT) {
  const x = PB * slip;
  return Math.sin(C * Math.atan(x - PE * (x - Math.atan(x))));
}
export const PEAK_SLIP = (() => {
  let best = 0, bestV = 0;
  for (let s = 0; s < 0.6; s += 0.001) {
    const v = tireCurve(s);
    if (v > bestV) { bestV = v; best = s; }
  }
  return best;
})();

/** Torque (Nm) interpolado da curva do carro. */
export function engineTorque(p, rpm) {
  const c = p.torqueCurve;
  if (rpm <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (rpm <= c[i][0]) {
      const [r0, t0] = c[i - 1], [r1, t1] = c[i];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return c[c.length - 1][1];
}

const gearRatio = (p, gear) => (gear === -1 ? -p.reverseGear : gear === 0 ? 0 : p.gears[gear - 1]);

export function wheelRpm(car, gear) {
  const p = car.spec;
  return Math.abs((car.vx / p.wheelRadius) * gearRatio(p, gear) * p.finalDrive) * RAD2RPM;
}

export function createCarState({ x, y, heading }, spec) {
  return {
    spec,
    x, y, heading,
    vx: 0, vy: 0, r: 0,
    wvx: 0, wvy: 0,
    steer: 0,
    throttle: 0, brake: 0, handbrake: 0,
    gear: 1, shiftTimer: 0, reverseTimer: 0,
    rpm: spec.idleRpm, rpmTarget: spec.idleRpm,
    axLoad: 0, ayLoad: 0,
    pitch: 0, pitchVel: 0, roll: 0, rollVel: 0,
    slipF: 0, slipR: 0, latUseF: 0, latUseR: 0,
    wheelspin: 0, spinF: 0, spinR: 0, tcActive: false, espActive: false,
    skidF: 0, skidR: 0,
    wheelAngF: 0, wheelAngR: 0,
    surfaceGrip: 1, surfaceRoll: 0, onRoad: true,
  };
}

export function resetCar(car, pose) {
  Object.assign(car, createCarState(pose, car.spec));
}

function setGear(car, gear, shiftTime = 0.18) {
  if (car.gear === gear) return;
  car.gear = gear;
  car.shiftTimer = shiftTime;
}

/** Processa entradas (câmbio, pedais, direção). Roda uma vez por frame. */
export function controlStep(car, input, dt, assist, manual, pressed) {
  const p = car.spec;
  const fwd = car.vx;
  car.shiftTimer = Math.max(0, car.shiftTimer - dt);

  if (manual) {
    if (pressed.gearUp) {
      if (car.gear === -1) { if (fwd > -1.5) setGear(car, 1, 0.12); }
      else if (car.gear < p.topGear) setGear(car, car.gear + 1);
    }
    if (pressed.gearDown) {
      if (car.gear === 1) { if (fwd < 1.5) setGear(car, -1, 0.12); }
      else if (car.gear > 1) setGear(car, car.gear - 1, 0.14);
    }
    car.throttle = input.throttle;
    car.brake = input.brake;
  } else {
    // Ré automática: segure o freio parado
    if (car.gear >= 1) {
      if (fwd < 0.7 && input.brake > 0.3 && input.throttle < 0.05) {
        car.reverseTimer += dt;
        if (car.reverseTimer > 0.3) { setGear(car, -1, 0.1); car.reverseTimer = 0; }
      } else car.reverseTimer = 0;
    } else if (car.gear === -1) {
      if (fwd > -0.7 && input.throttle > 0.3 && input.brake < 0.05) {
        car.reverseTimer += dt;
        if (car.reverseTimer > 0.12) { setGear(car, 1, 0.1); car.reverseTimer = 0; }
      } else car.reverseTimer = 0;
    }

    if (car.gear === -1) { car.throttle = input.brake; car.brake = input.throttle; }
    else { car.throttle = input.throttle; car.brake = input.brake; }

    if (car.gear >= 1 && car.shiftTimer === 0) {
      const rpm = wheelRpm(car, car.gear);
      if (rpm > p.shiftUpRpm && car.gear < p.topGear) setGear(car, car.gear + 1, 0.2);
      else if (car.gear > 1) {
        const lower = wheelRpm(car, car.gear - 1);
        const kickdown = car.throttle > 0.9 && lower < p.shiftUpRpm - 1000;
        if ((rpm < p.shiftDownRpm && lower < p.shiftUpRpm - 900) || kickdown) setGear(car, car.gear - 1, 0.15);
      }
    }
  }
  car.handbrake = input.handbrake;

  // ---- Direção ----
  const speed = Math.abs(car.vx);
  const raw = input.steer;
  // Curva de resposta: mais precisão perto do centro do analógico
  const shaped = Math.sign(raw) * Math.pow(Math.abs(raw), 1.5);
  // Limite de esterço pela velocidade: ângulo necessário para o limite de aderência
  // + ângulo de deriva de pico do pneu. Evita "sair de frente" ao jogar o analógico no talo.
  const mu = p.muFront * car.surfaceGrip;
  const v2 = Math.max(speed * speed, 1);
  // (desconta a deriva típica da traseira no limite, que também soma na dianteira)
  const rearSlipEst = 0.1 * clamp((speed - 5) / 15, 0, 1);
  const limit = Math.min(
    p.maxSteer,
    Math.atan((p.wheelbase * mu * G) / v2) + PEAK_SLIP * assist.steerAllowance - rearSlipEst,
  );
  let target = shaped * limit;

  // Contra-esterço assistido: rodas acompanham a direção de deslocamento na derrapagem
  if (assist.countersteer > 0 && car.vx > 3) {
    const beta = Math.atan2(car.vy, car.vx);
    target += beta * assist.countersteer;
  }
  target = clamp(target, -p.maxSteer, p.maxSteer);

  const returning = Math.abs(target) < Math.abs(car.steer) || Math.sign(target) !== Math.sign(car.steer);
  const rate = returning ? 5.5 : 3.4;
  car.steer = moveTowards(car.steer, target, rate * dt);
}

/**
 * Força longitudinal de um eixo: tração + freio, limitada pela aderência.
 * Retorna também quanto de aderência lateral sobra (círculo de atrito).
 */
function axleLongitudinal(drive, braking, Fmax, latUse, tc) {
  let Fx = drive + braking;
  let wheelspin = 0, tcActive = false, latExtra = 1;
  if (Math.abs(drive) > Math.abs(braking)) {
    const tcLimit = Fmax * Math.sqrt(Math.max(0.25, 1 - latUse * latUse)) * 0.97;
    if (tc && Math.abs(Fx) > tcLimit) {
      Fx = Math.sign(Fx) * tcLimit;
      tcActive = true;
    } else if (Math.abs(Fx) > Fmax) {
      wheelspin = clamp((Math.abs(Fx) / Fmax - 1) * 2 + 0.35, 0, 1);
      Fx = Math.sign(Fx) * Fmax * 0.9;
      latExtra = 0.75;
    }
  } else {
    Fx = clamp(Fx, -Fmax * 0.95, Fmax * 0.95); // ABS
  }
  return { Fx, wheelspin, tcActive, latExtra };
}

/** Integra a dinâmica do veículo por um passo fixo. */
export function physicsStep(car, dt, assist) {
  const p = car.spec;
  const { mass: m, inertia: I, cgToFront: a, cgToRear: b, cgHeight: h, wheelbase: L } = p;
  const { vx, vy, r } = car;
  const d = car.steer;
  const cosd = Math.cos(d), sind = Math.sin(d);
  const speed = Math.hypot(vx, vy);

  // Carga nos eixos com transferência longitudinal
  const Fzf = clamp((m * G * b) / L - (m * car.axLoad * h) / L, m * G * 0.15, m * G * 0.85);
  const Fzr = m * G - Fzf;
  const FmaxF = p.muFront * car.surfaceGrip * Fzf;
  const FmaxR = p.muRear * car.surfaceGrip * Fzr;

  // Velocidades nos eixos
  const vfy = vy + a * r;
  const vry = vy - b * r;
  const vfLong = vx * cosd + vfy * sind;
  const vfLat = -vx * sind + vfy * cosd;
  const LOW = 1.5;
  const slipF = Math.atan2(vfLat, Math.max(Math.abs(vfLong), LOW));
  const slipR = Math.atan2(vry, Math.max(Math.abs(vx), LOW));

  // Motor
  const ratio = gearRatio(p, car.gear);
  let rpm = wheelRpm(car, car.gear);
  if (Math.abs(car.gear) === 1) {
    // embreagem patinando na saída
    rpm = Math.max(rpm, p.idleRpm + car.throttle * 3200 * (1 - clamp(Math.abs(vx) / 9, 0, 1)));
  }
  rpm = Math.max(rpm, p.idleRpm);

  const sv = clamp(vx / 0.6, -1, 1); // sinal suave: evita tremedeira parado
  const svF = clamp(vfLong / 0.6, -1, 1);
  const handbrakeOn = car.handbrake > 0.1;
  let driveForce = 0;
  let engBrake = 0;
  // Freio de mão só desacopla o motor quando ele empurra a traseira
  const clutchIn = car.handbrake > 0.5 && p.driveFront < 1;
  if (car.shiftTimer <= 0 && !clutchIn) {
    if (car.throttle > 0.02) {
      const torque = rpm > p.redline ? 0 : engineTorque(p, rpm) * car.throttle;
      driveForce = (torque * ratio * p.finalDrive * p.drivetrainEff) / p.wheelRadius;
    } else {
      engBrake = ((p.engineBrake * (rpm / p.redline) * Math.abs(ratio) * p.finalDrive) / p.wheelRadius) *
        clamp(Math.abs(vx) / 3, 0, 1);
    }
  }

  const brake = car.brake * p.brakeForce;
  const kF = p.driveFront, kR = 1 - p.driveFront;

  const front = axleLongitudinal(
    driveForce * kF, -svF * (brake * p.brakeBias + engBrake * kF), FmaxF, car.latUseF, assist.tc,
  );
  let rear;
  if (handbrakeOn) {
    rear = { Fx: -sv * FmaxR * 0.8 * car.handbrake, wheelspin: 0, tcActive: false, latExtra: 0.55 };
  } else {
    rear = axleLongitudinal(
      driveForce * kR, -sv * (brake * (1 - p.brakeBias) + engBrake * kR), FmaxR, car.latUseR, assist.tc,
    );
  }
  const FxF = front.Fx, FxR = rear.Fx;

  // Círculo de atrito: o que sobra de aderência vai para a lateral
  const latCapF = Math.sqrt(Math.max(0, 1 - (FxF / FmaxF) ** 2)) * front.latExtra;
  const latCapR = Math.sqrt(Math.max(0, 1 - (FxR / FmaxR) ** 2)) * rear.latExtra;
  const FyF = -tireCurve(slipF) * FmaxF * latCapF;
  const FyR = -tireCurve(slipR, PC_REAR) * FmaxR * latCapR;
  car.latUseF = Math.abs(FyF) / FmaxF;
  car.latUseR = Math.abs(FyR) / FmaxR;

  // Forças no corpo
  const Ffx = FxF * cosd - FyF * sind;
  const Ffy = FxF * sind + FyF * cosd;
  const rolling = p.rollingResistance * m * G * sv + 3 * vx;
  const fx = Ffx + FxR - p.drag * speed * vx - rolling - car.surfaceRoll * vx;
  const fy = Ffy + FyR - p.drag * speed * vy - car.surfaceRoll * vy;
  let torque = a * Ffy - b * FyR;

  // ESP: corta rotação excessiva (sobre-esterço) de forma progressiva
  let espActive = false;
  if (assist.esp && speed > 4) {
    const rMax = (p.muRear * car.surfaceGrip * G) / speed;
    const rDes = clamp((vx * Math.tan(d)) / L, -rMax, rMax);
    const err = r - rDes;
    if (Math.abs(r) > Math.abs(rDes) + 0.08 && Math.sign(err) === Math.sign(r)) {
      torque -= err * I * 3;
      espActive = true;
    }
  }

  const ax = fx / m;
  const ay = fy / m;
  car.vx += (ax + vy * r) * dt;
  car.vy += (ay - vx * r) * dt;
  car.r += (torque / I) * dt;

  // Baixa velocidade: mistura com modelo cinemático (sem derrapar em manobra)
  const kin = 1 - clamp((speed - 1) / 3, 0, 1);
  if (kin > 0) {
    const rKin = (car.vx * Math.tan(d)) / L;
    const t = Math.min(1, dt * 25) * kin;
    car.r += (rKin - car.r) * t;
    car.vy += (rKin * b - car.vy) * t;
  }

  // Integração da pose
  const c = Math.cos(car.heading), s = Math.sin(car.heading);
  car.wvx = car.vx * c - car.vy * s;
  car.wvy = car.vx * s + car.vy * c;
  car.x += car.wvx * dt;
  car.y += car.wvy * dt;
  car.heading += car.r * dt;

  const k = Math.min(1, dt * 10);
  car.axLoad += (ax - car.axLoad) * k;
  car.ayLoad += (ay - car.ayLoad) * k;

  const wheelspin = Math.max(front.wheelspin, rear.wheelspin);
  const tcActive = front.tcActive || rear.tcActive;
  car.rpmTarget = Math.min(p.redline + 150, rpm + wheelspin * 2600 + (tcActive ? 350 : 0));
  car.slipF = slipF;
  car.slipR = slipR;
  car.wheelspin = wheelspin;
  car.spinF = front.wheelspin;
  car.spinR = rear.wheelspin;
  car.tcActive = tcActive;
  car.espActive = espActive;

  // Rotação visual das rodas
  const spinDir = Math.sign(driveForce) * 25;
  car.wheelAngF += (vfLong / p.wheelRadius + front.wheelspin * spinDir) * dt;
  if (!handbrakeOn) car.wheelAngR += (vx / p.wheelRadius + rear.wheelspin * spinDir) * dt;

  // Intensidade de marca de pneu / chiado
  const moving = clamp((speed - 2) / 3, 0, 1);
  const latR = clamp((Math.abs(slipR) - PEAK_SLIP * 1.1) / 0.25, 0, 1);
  const latF = clamp((Math.abs(slipF) - PEAK_SLIP * 1.25) / 0.25, 0, 1);
  car.skidR = Math.max(latR * moving, rear.wheelspin, handbrakeOn ? moving : 0);
  car.skidF = Math.max(latF * moving, front.wheelspin);
}

/** Suspensão visual (mola-amortecedor em pitch e roll). */
export function suspensionStep(car, dt) {
  const targetPitch = clamp(car.axLoad * 0.009, -0.07, 0.07);
  const targetRoll = clamp(car.ayLoad * 0.011, -0.09, 0.09);
  car.pitchVel += ((targetPitch - car.pitch) * 140 - car.pitchVel * 14) * dt;
  car.pitch += car.pitchVel * dt;
  car.rollVel += ((targetRoll - car.roll) * 120 - car.rollVel * 13) * dt;
  car.roll += car.rollVel * dt;
  car.rpm += (car.rpmTarget - car.rpm) * Math.min(1, dt * 14);
}
