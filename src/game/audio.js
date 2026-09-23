import { clamp } from './math.js';

// Som procedural (Web Audio): motor, pneus, vento e buzina. Sem arquivos externos.
export function createAudio() {
  let ctx = null;
  let n = null;

  function noiseBuffer(ac) {
    const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);

    // Motor: harmônicos de dente-de-serra + quadrada, filtrados
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.Q.value = 2;
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(x * 2.2); }
    shaper.curve = curve;
    engineFilter.connect(shaper).connect(engineGain).connect(master);

    const mk = (type, gain) => {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(engineFilter);
      o.start();
      return o;
    };
    const osc = [mk('sawtooth', 0.5), mk('square', 0.35), mk('sawtooth', 0.18)];

    const noise = noiseBuffer(ctx);
    const loopNoise = () => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      s.start();
      return s;
    };

    // Pneus
    const tireFilter = ctx.createBiquadFilter();
    tireFilter.type = 'bandpass';
    tireFilter.frequency.value = 1400;
    tireFilter.Q.value = 6;
    const tireGain = ctx.createGain();
    tireGain.gain.value = 0;
    loopNoise().connect(tireFilter).connect(tireGain).connect(master);

    // Vento / rolagem
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 500;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    loopNoise().connect(windFilter).connect(windGain).connect(master);

    // Buzina
    const hornGain = ctx.createGain();
    hornGain.gain.value = 0;
    hornGain.connect(master);
    for (const f of [415, 520]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.12;
      o.connect(g).connect(hornGain);
      o.start();
    }

    n = { osc, engineFilter, engineGain, tireGain, tireFilter, windGain, windFilter, hornGain };
  }

  function start() {
    if (!ctx) build();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function update(car, input) {
    if (!ctx || !n || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const f = (car.rpm / 60) * 2; // 4 cilindros: 2 explosões por volta
    n.osc[0].frequency.setTargetAtTime(f, t, 0.015);
    n.osc[1].frequency.setTargetAtTime(f * 0.5, t, 0.015);
    n.osc[2].frequency.setTargetAtTime(f * 2, t, 0.015);
    n.engineFilter.frequency.setTargetAtTime(250 + car.throttle * 1800 + car.rpm * 0.28, t, 0.03);
    n.engineGain.gain.setTargetAtTime(0.1 + car.throttle * 0.14, t, 0.05);

    const speed = Math.hypot(car.vx, car.vy);
    const skid = Math.max(car.skidR, car.skidF);
    const tire = car.onRoad ? skid * 0.3 : 0;
    n.tireGain.gain.setTargetAtTime(tire, t, 0.05);
    n.tireFilter.frequency.setTargetAtTime(1100 + skid * 700, t, 0.1);

    const wind = clamp(speed / 60, 0, 1) ** 2 * 0.35 + (car.onRoad ? 0 : clamp(speed / 20, 0, 1) * 0.25);
    n.windGain.gain.setTargetAtTime(wind, t, 0.1);
    n.windFilter.frequency.setTargetAtTime(car.onRoad ? 500 : 250, t, 0.1);

    n.hornGain.gain.setTargetAtTime(input.horn ? 1 : 0, t, 0.01);
  }

  return { start, update, isRunning: () => !!ctx && ctx.state === 'running' };
}
