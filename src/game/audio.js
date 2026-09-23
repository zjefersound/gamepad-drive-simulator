import { clamp } from './math.js';
import { PEAK_SLIP } from './carPhysics.js';
import workletUrl from './engineWorklet.js?url';

/*
 * Áudio procedural (Web Audio, sem arquivos de som):
 *  - motor: AudioWorklet com modelo físico de pulsos de combustão + escapamento (engineWorklet.js)
 *  - pneus: uma camada por eixo com guincho tonal (perto do limite de aderência),
 *    chiado de deslizamento (derrapagem aberta) e ruído de rolagem
 *  - grama/terra, vento e buzina
 */

const smooth = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

export function createAudio() {
  let ctx = null;
  let n = null;
  let engine = null; // AudioWorkletNode
  let soundConfig = {};
  let wobble = [0, 0];

  function noiseBuffer(ac, seconds = 2) {
    const buf = ac.createBuffer(1, ac.sampleRate * seconds, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });
    const noise = noiseBuffer(ctx);
    const src = () => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      s.loopStart = Math.random();
      s.start(0, Math.random() * 2);
      return s;
    };
    const filter = (type, freq, q = 1) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    };
    const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };

    const master = gain(0.5);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);

    // Motor
    const engineGain = gain(0.9);
    engineGain.connect(master);
    if (ctx.audioWorklet) {
      ctx.audioWorklet.addModule(workletUrl).then(() => {
        engine = new AudioWorkletNode(ctx, 'engine-processor', { outputChannelCount: [1] });
        engine.port.postMessage({ type: 'config', config: soundConfig });
        engine.connect(engineGain);
      }).catch((e) => console.warn('AudioWorklet indisponível:', e));
    }

    // Pneus (por eixo): guincho = ruído em ressonadores estreitos; chiado = ruído largo
    const tires = [0, 1].map(() => {
      const squealA = filter('bandpass', 850, 18);
      const squealB = filter('bandpass', 1750, 14);
      const squealGain = gain();
      const s = src();
      s.connect(squealA).connect(squealGain);
      s.connect(squealB).connect(squealGain);
      const scrubHp = filter('highpass', 180, 0.7);
      const scrubLp = filter('lowpass', 1400, 0.7);
      const scrubGain = gain();
      src().connect(scrubHp).connect(scrubLp).connect(scrubGain);
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : gain(1);
      squealGain.connect(pan);
      scrubGain.connect(pan);
      pan.connect(master);
      return { squealA, squealB, squealGain, scrubLp, scrubGain, pan };
    });

    // Rolagem no asfalto
    const roadLp = filter('lowpass', 260, 0.5);
    const roadGain = gain();
    src().connect(roadLp).connect(roadGain).connect(master);

    // Grama / terra: ruído com "grãos" (ganho modulado aleatoriamente)
    const dirtBp = filter('bandpass', 700, 0.7);
    const dirtGrain = gain();
    const dirtGain = gain();
    src().connect(dirtBp).connect(dirtGrain).connect(dirtGain).connect(master);

    // Vento
    const windLp = filter('lowpass', 500, 0.5);
    const windGain = gain();
    src().connect(windLp).connect(windGain).connect(master);

    // Buzina
    const hornGain = gain();
    hornGain.connect(master);
    for (const f of [415, 520]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = gain(0.1);
      o.connect(g).connect(hornGain);
      o.start();
    }

    n = { tires, roadGain, roadLp, dirtBp, dirtGrain, dirtGain, windGain, windLp, hornGain };
  }

  function configure(carData) {
    soundConfig = { ...(carData.sound || {}), redline: carData.physics?.redline ?? 7000 };
    if (engine) engine.port.postMessage({ type: 'config', config: soundConfig });
  }

  function start() {
    if (!ctx) build();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function update(car, input, dt) {
    if (!ctx || !n || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const p = car.spec;
    const speed = Math.hypot(car.vx, car.vy);

    // ---- Motor ----
    if (engine) {
      const nearIdle = 1 - clamp((car.rpm - p.idleRpm) / 900, 0, 1);
      const shifting = car.shiftTimer > 0;
      const limiter = car.rpm > p.redline - 20;
      const load = shifting ? 0 : Math.max(car.throttle, 0.28 * nearIdle);
      engine.port.postMessage({ rpm: car.rpm, load, cut: limiter || (shifting && car.throttle > 0.3) });
    }

    // ---- Pneus ----
    const moving = smooth((speed - 1.5) / 4);
    const axles = [
      { slip: Math.abs(car.slipF), spin: car.spinF ?? 0 },
      { slip: Math.abs(car.slipR), spin: car.spinR ?? 0 },
    ];
    const hb = car.handbrake > 0.1;
    // lado da derrapagem para o pan estéreo (traseira escapando para um lado)
    const side = clamp(-car.vy / 4, -0.6, 0.6);
    axles.forEach((a, i) => {
      const tn = n.tires[i];
      const lock = i === 1 && hb ? 0.9 : 0;
      // guincho: cresce a partir de ~80% do ângulo de pico e cede quando a derrapagem abre muito
      const nearLimit = smooth((a.slip - PEAK_SLIP * 0.8) / (PEAK_SLIP * 1.2));
      const wide = smooth((a.slip - PEAK_SLIP * 3) / 0.5);
      const squeal = Math.max(nearLimit * (1 - 0.55 * wide), a.spin * 0.9, lock) * moving;
      const scrub = Math.max(smooth((a.slip - PEAK_SLIP * 1.5) / 0.4), a.spin * 0.5, lock * 0.8) * moving;
      const onRoad = car.onRoad ? 1 : 0;

      // pitch com leve instabilidade (pneus "cantam" oscilando)
      wobble[i] += (Math.random() * 2 - 1) * 60 * dt * 10;
      wobble[i] *= 0.9;
      const f0 = 720 + 380 * nearLimit + 220 * a.spin + speed * 3 + wobble[i] + i * 60;
      tn.squealA.frequency.setTargetAtTime(f0, t, 0.05);
      tn.squealB.frequency.setTargetAtTime(f0 * 2.07, t, 0.05);
      tn.squealGain.gain.setTargetAtTime(squeal * 0.55 * onRoad, t, 0.04);
      tn.scrubLp.frequency.setTargetAtTime(700 + speed * 25, t, 0.1);
      tn.scrubGain.gain.setTargetAtTime(scrub * 0.12 * onRoad * clamp(speed / 15, 0.3, 1), t, 0.05);
      if (tn.pan.pan) tn.pan.pan.setTargetAtTime(side * (i === 1 ? 1 : 0.4), t, 0.1);
    });

    n.roadGain.gain.setTargetAtTime(car.onRoad ? clamp(speed / 45, 0, 1) * 0.12 : 0, t, 0.1);
    n.roadLp.frequency.setTargetAtTime(160 + speed * 6, t, 0.2);

    // ---- Grama ----
    const dirt = car.onRoad ? 0 : clamp(speed / 20, 0, 1) * 0.35 + Math.max(car.skidR, car.skidF) * 0.2;
    n.dirtGain.gain.setTargetAtTime(dirt, t, 0.06);
    n.dirtGrain.gain.setTargetAtTime(0.4 + Math.random() * 0.9, t, 0.01);
    n.dirtBp.frequency.setTargetAtTime(400 + speed * 18, t, 0.2);

    // ---- Vento ----
    n.windGain.gain.setTargetAtTime(clamp(speed / 55, 0, 1) ** 2 * 0.3, t, 0.15);
    n.windLp.frequency.setTargetAtTime(300 + speed * 12, t, 0.2);

    n.hornGain.gain.setTargetAtTime(input.horn ? 1 : 0, t, 0.01);
  }

  return { start, update, configure, isRunning: () => !!ctx && ctx.state === 'running' };
}
