import { clamp, moveTowards } from './math.js';

/*
 * Modelo de veículo "bicicleta" (2 eixos) com:
 *  - pneus com curva Pacejka simplificada e círculo de atrito (tração x curva)
 *  - transferência de carga longitudinal (frenagem pesa a dianteira)
 *  - tração traseira, câmbio de 6 marchas + ré, curva de torque
 *  - assistências: controle de tração, ESP, contra-esterço e limite de esterço
 *    dependente da velocidade (o grande segredo da boa dirigibilidade no gamepad)
 *
 * Coordenadas do corpo: x = frente, y = esquerda, yaw positivo = anti-horário.
 */

export const G = 9.81;
const RAD2RPM = 60 / (2 * Math.PI);

export const CAR = {
  mass: 1250,
  inertia: 1900,
  cgToFront: 1.18,
  cgToRear: 1.37,
  cgHeight: 0.5,
  wheelRadius: 0.33,
  halfTrack: 0.8,
  maxSteer: 0.62,
  gears: [-3.3, 3.4, 2.25, 1.65, 1.3, 1.05, 0.86], // índice 0 = ré
  finalDrive: 3.7,
  drivetrainEff: 0.85,
  idleRpm: 900,
  redline: 7200,
  shiftUpRpm: 6800,
  shiftDownRpm: 2800,
  engineBrake: 55,
  brakeForce: 15000,
  brakeBias: 0.64,
  drag: 0.42,
  rolling: 12,
  muFront: 1.0,
  muRear: 1.12,
};
CAR.wheelbase = CAR.cgToFront + CAR.cgToRear;

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

export function engineTorque(rpm) {
  const t = clamp((rpm - 800) / (CAR.redline - 800), 0, 1);
  return 185 + 155 * Math.sin(t * Math.PI * 0.95);
}

const gearRatio = (gear) => (gear === -1 ? CAR.gears[0] : gear === 0 ? 0 : CAR.gears[gear]);

export function wheelRpm(car, gear) {
  return Math.abs((car.vx / CAR.wheelRadius) * gearRatio(gear) * CAR.finalDrive) * RAD2RPM;
}

export function createCarState({ x, y, heading }) {
  return {
    x, y, heading,
    vx: 0, vy: 0, r: 0,
    wvx: 0, wvy: 0,
    steer: 0,
    throttle: 0, brake: 0, handbrake: 0,
    gear: 1, shiftTimer: 0, reverseTimer: 0,
    rpm: CAR.idleRpm, rpmTarget: CAR.idleRpm,
    axLoad: 0, ayLoad: 0,
    pitch: 0, pitchVel: 0, roll: 0, rollVel: 0,
    slipF: 0, slipR: 0, latUseR: 0,
    wheelspin: 0, tcActive: false, espActive: false,
    skidF: 0, skidR: 0,
    wheelAngF: 0, wheelAngR: 0,
    surfaceGrip: 1, surfaceRoll: 0, onRoad: true,
  };
}

export function resetCar(car, { x, y, heading }) {
  Object.assign(car, createCarState({ x, y, heading }));
}

function setGear(car, gear, shiftTime = 0.18) {
  if (car.gear === gear) return;
  car.gear = gear;
  car.shiftTimer = shiftTime;
}

/** Processa entradas (câmbio, pedais, direção). Roda uma vez por frame. */
export function controlStep(car, input, dt, assist, manual, pressed) {
  const fwd = car.vx;
  car.shiftTimer = Math.max(0, car.shiftTimer - dt);

  if (manual) {
    if (pressed.gearUp) {
      if (car.gear === -1) { if (fwd > -1.5) setGear(car, 1, 0.12); }
      else if (car.gear < 6) setGear(car, car.gear + 1);
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
      if (rpm > CAR.shiftUpRpm && car.gear < 6) setGear(car, car.gear + 1, 0.2);
      else if (car.gear > 1) {
        const lower = wheelRpm(car, car.gear - 1);
        const kickdown = car.throttle > 0.9 && lower < 5600;
        if ((rpm < CAR.shiftDownRpm && lower < CAR.shiftUpRpm - 900) || kickdown) setGear(car, car.gear - 1, 0.15);
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
  const mu = CAR.muFront * car.surfaceGrip;
  const v2 = Math.max(speed * speed, 1);
  // (desconta a deriva típica da traseira no limite, que também soma na dianteira)
  const rearSlipEst = 0.1 * clamp((speed - 5) / 15, 0, 1);
  const limit = Math.min(
    CAR.maxSteer,
    Math.atan((CAR.wheelbase * mu * G) / v2) + PEAK_SLIP * assist.steerAllowance - rearSlipEst,
  );
  let target = shaped * limit;

  // Contra-esterço assistido: rodas acompanham a direção de deslocamento na derrapagem
  if (assist.countersteer > 0 && car.vx > 3) {
    const beta = Math.atan2(car.vy, car.vx);
    target += beta * assist.countersteer;
  }
  target = clamp(target, -CAR.maxSteer, CAR.maxSteer);

  const returning = Math.abs(target) < Math.abs(car.steer) || Math.sign(target) !== Math.sign(car.steer);
  const rate = returning ? 5.5 : 3.4;
  car.steer = moveTowards(car.steer, target, rate * dt);
}

/** Integra a dinâmica do veículo por um passo fixo. */
export function physicsStep(car, dt, assist) {
  const { mass: m, inertia: I, cgToFront: a, cgToRear: b, cgHeight: h, wheelbase: L } = CAR;
  const { vx, vy, r } = car;
  const d = car.steer;
  const cosd = Math.cos(d), sind = Math.sin(d);
  const speed = Math.hypot(vx, vy);

  // Carga nos eixos com transferência longitudinal
  const Fzf = clamp((m * G * b) / L - (m * car.axLoad * h) / L, m * G * 0.15, m * G * 0.85);
  const Fzr = m * G - Fzf;
  const FmaxF = CAR.muFront * car.surfaceGrip * Fzf;
  const FmaxR = CAR.muRear * car.surfaceGrip * Fzr;

  // Velocidades nos eixos
  const vfy = vy + a * r;
  const vry = vy - b * r;
  const vfLong = vx * cosd + vfy * sind;
  const vfLat = -vx * sind + vfy * cosd;
  const LOW = 1.5;
  const slipF = Math.atan2(vfLat, Math.max(Math.abs(vfLong), LOW));
  const slipR = Math.atan2(vry, Math.max(Math.abs(vx), LOW));

  // Motor
  const ratio = gearRatio(car.gear);
  let rpm = wheelRpm(car, car.gear);
  if (Math.abs(car.gear) === 1) {
    // embreagem patinando na saída
    rpm = Math.max(rpm, CAR.idleRpm + car.throttle * 3200 * (1 - clamp(Math.abs(vx) / 9, 0, 1)));
  }
  rpm = Math.max(rpm, CAR.idleRpm);

  const sv = clamp(vx / 0.6, -1, 1); // sinal suave: evita tremedeira parado
  let driveForce = 0;
  let engBrake = 0;
  const clutchIn = car.handbrake > 0.5;
  if (car.shiftTimer <= 0 && !clutchIn) {
    if (car.throttle > 0.02) {
      const torque = rpm > CAR.redline ? 0 : engineTorque(rpm) * car.throttle;
      driveForce = (torque * ratio * CAR.finalDrive * CAR.drivetrainEff) / CAR.wheelRadius;
    } else {
      engBrake = ((CAR.engineBrake * (rpm / CAR.redline) * Math.abs(ratio) * CAR.finalDrive) / CAR.wheelRadius) *
        clamp(Math.abs(vx) / 3, 0, 1);
    }
  }

  const brake = car.brake * CAR.brakeForce;
  const svF = clamp(vfLong / 0.6, -1, 1);
  // Dianteira: só freio, com ABS
  let FxF = clamp(-svF * brake * CAR.brakeBias, -FmaxF * 0.95, FmaxF * 0.95);

  // Traseira: tração, freio, freio-motor, freio de mão
  let FxR;
  let wheelspin = 0;
  let tcActive = false;
  let latCapExtraR = 1;
  if (car.handbrake > 0.1) {
    FxR = -sv * FmaxR * 0.8 * car.handbrake;
    latCapExtraR = 0.55;
  } else {
    const braking = -sv * (brake * (1 - CAR.brakeBias) + engBrake);
    FxR = driveForce + braking;
    const isDriving = Math.abs(driveForce) > Math.abs(braking);
    if (isDriving) {
      const tcLimit = FmaxR * Math.sqrt(Math.max(0.25, 1 - car.latUseR * car.latUseR)) * 0.97;
      if (assist.tc && Math.abs(FxR) > tcLimit) {
        FxR = Math.sign(FxR) * tcLimit;
        tcActive = true;
      } else if (Math.abs(FxR) > FmaxR) {
        wheelspin = clamp((Math.abs(FxR) / FmaxR - 1) * 2 + 0.35, 0, 1);
        FxR = Math.sign(FxR) * FmaxR * 0.9;
        latCapExtraR = 0.75;
      }
    } else {
      FxR = clamp(FxR, -FmaxR * 0.95, FmaxR * 0.95);
    }
  }

  // Círculo de atrito: o que sobra de aderência vai para a lateral
  const latCapF = Math.sqrt(Math.max(0, 1 - (FxF / FmaxF) ** 2));
  const latCapR = Math.sqrt(Math.max(0, 1 - (FxR / FmaxR) ** 2)) * latCapExtraR;
  const FyF = -tireCurve(slipF) * FmaxF * latCapF;
  const FyR = -tireCurve(slipR, PC_REAR) * FmaxR * latCapR;
  car.latUseR = Math.abs(FyR) / FmaxR;

  // Forças no corpo
  const Ffx = FxF * cosd - FyF * sind;
  const Ffy = FxF * sind + FyF * cosd;
  const roll = CAR.rolling + car.surfaceRoll;
  const fx = Ffx + FxR - CAR.drag * speed * vx - roll * vx;
  const fy = Ffy + FyR - CAR.drag * speed * vy - car.surfaceRoll * vy;
  let torque = a * Ffy - b * FyR;

  // ESP: corta rotação excessiva (sobre-esterço) de forma progressiva
  let espActive = false;
  if (assist.esp && speed > 4) {
    const rMax = (CAR.muRear * car.surfaceGrip * G) / speed;
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

  car.rpmTarget = Math.min(CAR.redline + 150, rpm + wheelspin * 2600 + (tcActive ? 350 : 0));
  car.slipF = slipF;
  car.slipR = slipR;
  car.wheelspin = wheelspin;
  car.tcActive = tcActive;
  car.espActive = espActive;

  // Rotação visual das rodas
  car.wheelAngF += (vfLong / CAR.wheelRadius) * dt;
  if (car.handbrake <= 0.1) {
    car.wheelAngR += (vx / CAR.wheelRadius + wheelspin * Math.sign(driveForce) * 25) * dt;
  }

  // Intensidade de marca de pneu / chiado
  const moving = clamp((speed - 2) / 3, 0, 1);
  const latR = clamp((Math.abs(slipR) - PEAK_SLIP * 1.1) / 0.25, 0, 1);
  const latF = clamp((Math.abs(slipF) - PEAK_SLIP * 1.25) / 0.25, 0, 1);
  car.skidR = Math.max(latR * moving, wheelspin, car.handbrake > 0.1 ? moving : 0);
  car.skidF = latF * moving;
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
