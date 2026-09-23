/*
 * Síntese de som de motor a combustão (AudioWorklet).
 *
 * Modelo "fisicamente informado" (inspirado em Baldan, Lachambre, Delle Monache & Boussard,
 * "Physically informed car engine sound synthesis for virtual and augmented environments", 2015):
 *   1. cada combustão gera um pulso de pressão na saída do cilindro (com variação aleatória)
 *   2. os pulsos passam por guias de onda que imitam o coletor e o tubo do escapamento
 *      (linhas de atraso com reflexão invertida na ponta aberta e perdas em alta frequência)
 *   3. o abafador é um passa-baixas que "abre" com o acelerador, seguido de saturação suave
 *   4. soma-se o ronco de admissão (ruído modulado pelos cursos de admissão) e o ruído mecânico
 * Também simula corte de giro, corte na troca de marcha e estalos na desaceleração.
 *
 * Arquivo autocontido (sem imports): é carregado com audioWorklet.addModule.
 */

const SPEED_OF_SOUND = 343;

class OnePole {
  constructor() { this.y = 0; this.a = 0; }
  set(cutoff) { this.a = Math.exp((-2 * Math.PI * cutoff) / sampleRate); }
  run(x) { this.y = x + this.a * (this.y - x); return this.y; }
}

class Biquad {
  constructor() { this.x1 = this.x2 = this.y1 = this.y2 = 0; this.b0 = 1; this.b1 = this.b2 = this.a1 = this.a2 = 0; }
  lowpass(f, q) {
    const w = (2 * Math.PI * Math.min(f, sampleRate * 0.45)) / sampleRate;
    const alpha = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + alpha;
    this.b0 = ((1 - c) / 2) / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0;
    this.a1 = (-2 * c) / a0; this.a2 = (1 - alpha) / a0;
  }
  bandpass(f, q) {
    const w = (2 * Math.PI * Math.min(f, sampleRate * 0.45)) / sampleRate;
    const alpha = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + alpha;
    this.b0 = alpha / a0; this.b1 = 0; this.b2 = -alpha / a0;
    this.a1 = (-2 * c) / a0; this.a2 = (1 - alpha) / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// Tubo acústico: realimentação atrasada com reflexão na ponta e perda de agudos
class Pipe {
  constructor(lengthM, reflection, damping) {
    this.len = Math.max(2, Math.round(((2 * lengthM) / SPEED_OF_SOUND) * sampleRate));
    this.buf = new Float32Array(this.len);
    this.i = 0;
    this.r = reflection;
    this.lp = new OnePole();
    this.lp.set(damping);
  }
  run(x) {
    const back = this.lp.run(this.buf[this.i]);
    const y = x + this.r * back;
    this.buf[this.i] = y;
    this.i = (this.i + 1) % this.len;
    return y;
  }
}

const DEFAULTS = {
  cylinders: 4,
  extractorLength: 0.55, // m, coletor
  exhaustLength: 1.9, // m, tubo até o abafador
  mufflerCutoff: 2200, // Hz com acelerador no fundo
  roughness: 0.08, // variação entre explosões
  overrunPops: 0.25, // estalos ao desacelerar (0–1)
  intake: 0.35, // volume do ronco de admissão
  mechanical: 0.25, // volume do ruído mecânico
  volume: 1,
  redline: 7000,
};

class EngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cfg = { ...DEFAULTS };
    this.rpm = 900; this.load = 0;
    this.target = { rpm: 900, load: 0, cut: false };
    this.phase = 0;
    this.lastFiring = -1;
    this.pulse = { t: 1, len: 1, amp: 0, noise: 0 };
    this.popsLeft = 0;
    this.mech = { t: 1, amp: 0 };
    this.build();
    this.port.onmessage = ({ data }) => {
      if (data.type === 'config') { Object.assign(this.cfg, data.config); this.build(); }
      else this.target = data;
    };
  }

  build() {
    const c = this.cfg;
    this.extractor = new Pipe(c.extractorLength, -0.45, 4200);
    this.exhaust = new Pipe(c.exhaustLength, -0.3, 1800);
    this.muffler = new Biquad();
    this.intakeBp = new Biquad();
    this.mechBp = new Biquad();
    this.mechBp.bandpass(3800, 3);
    this.dcX = 0; this.dcY = 0;
    this.counter = 0;
  }

  fire(firingHz) {
    const c = this.cfg;
    const t = this.target;
    const rough = 1 + (Math.random() * 2 - 1) * c.roughness * (1.4 - this.load);
    let amp = (0.22 + 0.78 * this.load) * rough;
    let noise = 0.3;

    // Corte de ignição (limitador / troca de marcha): pula explosões
    if (t.cut && Math.random() < 0.85) amp = 0;

    // Desaceleração em giro alto: mistura pobre, pulsos fracos e estalos ocasionais
    const overrun = this.load < 0.05 && this.rpm > 2400;
    if (overrun) {
      amp *= 0.55;
      if (this.popsLeft > 0) { amp = 1.6 + Math.random(); noise = 1.4; this.popsLeft--; }
      else if (Math.random() < c.overrunPops * 0.035 * (this.rpm / c.redline)) this.popsLeft = 1 + (Math.random() * 3) | 0;
    } else this.popsLeft = 0;

    const interval = sampleRate / firingHz;
    this.pulse = {
      t: 0,
      len: Math.max(sampleRate * 0.0012, Math.min(sampleRate * 0.008, interval * 0.38)),
      amp,
      noise,
    };
    this.mech = { t: 0, amp: c.mechanical * (0.3 + this.rpm / c.redline) };
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    const c = this.cfg;
    const t = this.target;

    // Parâmetros por bloco
    this.muffler.lowpass(c.mufflerCutoff * (0.35 + 0.65 * this.load) + this.rpm * 0.12, 0.9);
    this.intakeBp.bandpass(250 + this.rpm * 0.09, 1.6);

    for (let n = 0; n < out.length; n++) {
      this.rpm += (t.rpm - this.rpm) * 0.0012;
      this.load += (t.load - this.load) * 0.0025;

      // Ciclo do motor 4 tempos = 2 voltas do virabrequim
      const cycleHz = this.rpm / 120;
      const firingHz = cycleHz * c.cylinders;
      this.phase += cycleHz / sampleRate;
      if (this.phase >= 1) this.phase -= 1;
      const firing = Math.floor(this.phase * c.cylinders);
      if (firing !== this.lastFiring) { this.lastFiring = firing; this.fire(firingHz); }

      // Pulso de pressão da combustão (ataque rápido, cauda mais longa)
      let x = 0;
      const p = this.pulse;
      if (p.t < p.len) {
        const u = p.t / p.len;
        const env = Math.sin(Math.PI * Math.sqrt(u)) ** 2;
        x = env * p.amp * (1 + p.noise * (Math.random() * 2 - 1));
        p.t++;
      }

      // Coletor -> escapamento -> abafador
      let y = this.exhaust.run(this.extractor.run(x));
      y = Math.tanh(this.muffler.run(y) * (1.2 + this.load * 1.3));

      // Admissão: ruído modulado pela metade do ciclo de cada cilindro
      const intakeEnv = Math.max(0, Math.sin(this.phase * c.cylinders * Math.PI * 2));
      y += this.intakeBp.run((Math.random() * 2 - 1) * intakeEnv) * c.intake * this.load * (0.3 + this.rpm / c.redline);

      // Mecânico: "tic" do comando de válvulas
      if (this.mech.t < 90) {
        y += this.mechBp.run((Math.random() * 2 - 1) * this.mech.amp * (1 - this.mech.t / 90)) * 0.5;
        this.mech.t++;
      }

      // Remove DC e ajusta o volume (motores ficam mais altos em giro alto)
      const dc = y - this.dcX + 0.995 * this.dcY;
      this.dcX = y; this.dcY = dc;
      const level = c.volume * (0.55 + 0.45 * (this.rpm / c.redline)) * (0.75 + 0.25 * this.load);
      out[n] = dc * level * 0.5;
    }
    return true;
  }
}

registerProcessor('engine-processor', EngineProcessor);
