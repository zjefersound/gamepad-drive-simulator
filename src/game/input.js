import { moveTowards } from './math.js';

// Mapeamento "standard" da Gamepad API (controle Xbox)
export const BTN = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  VIEW: 8, MENU: 9, LS: 10, RS: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};

// Deadzone com reescala: sem "degrau" logo após sair da zona morta
const deadzone = (v, dz) => {
  const a = Math.abs(v);
  if (a < dz) return 0;
  return (Math.sign(v) * (a - dz)) / (1 - dz);
};

const STEER_DEADZONE = 0.07;
const TRIGGER_DEADZONE = 0.04;
const LOOK_DEADZONE = 0.15;

const PREVENT_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export function createInput() {
  const keys = new Set();
  const keyEdges = new Set();
  let prevButtons = [];
  let activePad = null;
  let pointerPressed = false;

  const onKeyDown = (e) => {
    if (PREVENT_KEYS.has(e.code)) e.preventDefault();
    if (!e.repeat) keyEdges.add(e.code);
    keys.add(e.code);
  };
  const onKeyUp = (e) => keys.delete(e.code);
  const onBlur = () => keys.clear();
  const onPointer = () => (pointerPressed = true);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pointerdown', onPointer);

  const state = {
    steer: 0, // -1 (direita) .. 1 (esquerda)
    throttle: 0,
    brake: 0,
    handbrake: 0,
    horn: false,
    lookX: 0,
    lookY: 0,
    pressed: {},
    anyPressed: false,
    gamepadName: '',
    source: 'teclado',
  };
  let kbSteer = 0;

  function pickGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let best = null;
    for (const p of pads) {
      if (!p || !p.connected) continue;
      if (!best || (p.mapping === 'standard' && best.mapping !== 'standard')) best = p;
    }
    return best;
  }

  // Alguns controles genéricos reportam eixos "presos" (ex.: 1.0 em repouso).
  // Um eixo só passa a valer depois de se afastar do valor inicial.
  const calib = new Map();
  function axis(gp, i) {
    let c = calib.get(gp.index);
    if (!c || c.id !== gp.id) {
      c = { id: gp.id, rest: gp.axes.slice(), live: gp.axes.map(() => false) };
      calib.set(gp.index, c);
    }
    const v = gp.axes[i] || 0;
    if (!c.live[i] && Math.abs(v - (c.rest[i] || 0)) > 0.3) c.live[i] = true;
    return c.live[i] ? v : 0;
  }

  function poll(dt) {
    const gp = pickGamepad();
    activePad = gp;

    const pressed = {
      camera: false, reset: false, assist: false, gearUp: false,
      gearDown: false, transmission: false, resetCones: false,
    };
    let any = false;
    let steer = 0, throttle = 0, brake = 0, handbrake = 0, horn = false, lookX = 0, lookY = 0;

    if (gp) {
      const val = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
      const down = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      const edge = (i) => down(i) && !prevButtons[i];

      steer = -deadzone(axis(gp, 0), STEER_DEADZONE);
      throttle = deadzone(val(BTN.RT), TRIGGER_DEADZONE);
      brake = deadzone(val(BTN.LT), TRIGGER_DEADZONE);
      handbrake = down(BTN.A) ? 1 : 0;
      horn = down(BTN.B);
      lookX = deadzone(axis(gp, 2), LOOK_DEADZONE);
      lookY = deadzone(axis(gp, 3), LOOK_DEADZONE);

      pressed.camera = edge(BTN.Y);
      pressed.assist = edge(BTN.X);
      pressed.gearUp = edge(BTN.RB);
      pressed.gearDown = edge(BTN.LB);
      pressed.transmission = edge(BTN.VIEW);
      pressed.reset = edge(BTN.MENU);
      pressed.resetCones = edge(BTN.DOWN);

      for (let i = 0; i < gp.buttons.length; i++) if (edge(i)) any = true;
      if (Math.abs(steer) > 0.3) any = true;
      prevButtons = gp.buttons.map((b) => b.pressed);

      state.gamepadName = gp.id.replace(/\(.*?\)/g, '').trim() || 'Gamepad';
      state.source = 'gamepad';
    } else {
      prevButtons = [];
      state.gamepadName = '';
      state.source = 'teclado';
    }

    // Teclado como alternativa (volante "virtual" com rampa suave)
    const left = keys.has('ArrowLeft') || keys.has('KeyA');
    const right = keys.has('ArrowRight') || keys.has('KeyD');
    const target = (left ? 1 : 0) - (right ? 1 : 0);
    const rate = target === 0 || Math.sign(target) !== Math.sign(kbSteer) ? 6 : 2.8;
    kbSteer = moveTowards(kbSteer, target, rate * dt);

    if (left || right || Math.abs(steer) < 0.001) steer = kbSteer;
    if (keys.has('ArrowUp') || keys.has('KeyW')) throttle = 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) brake = 1;
    if (keys.has('Space')) handbrake = 1;
    if (keys.has('KeyH')) horn = true;

    if (keyEdges.has('KeyC')) pressed.camera = true;
    if (keyEdges.has('KeyT')) pressed.assist = true;
    if (keyEdges.has('KeyE')) pressed.gearUp = true;
    if (keyEdges.has('KeyQ')) pressed.gearDown = true;
    if (keyEdges.has('KeyM')) pressed.transmission = true;
    if (keyEdges.has('KeyR')) pressed.reset = true;
    if (keyEdges.has('KeyK')) pressed.resetCones = true;
    if (keyEdges.size > 0 || pointerPressed) any = true;
    keyEdges.clear();
    pointerPressed = false;

    Object.assign(state, { steer, throttle, brake, handbrake, horn, lookX, lookY, pressed, anyPressed: any });
    return state;
  }

  function rumble(strong, weak, duration = 120) {
    const act = activePad && activePad.vibrationActuator;
    if (!act || !act.playEffect) return;
    act
      .playEffect('dual-rumble', {
        startDelay: 0,
        duration,
        strongMagnitude: Math.min(1, strong),
        weakMagnitude: Math.min(1, weak),
      })
      .catch(() => {});
  }

  function dispose() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('pointerdown', onPointer);
  }

  return { state, poll, rumble, dispose };
}
