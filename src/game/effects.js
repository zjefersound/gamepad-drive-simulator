import { G } from './carPhysics.js';
import { clamp } from './math.js';

// Ordem das rodas: dianteira esq., dianteira dir., traseira esq., traseira dir. (y = esquerda)
const WHEELS = [
  { front: true, side: 1 }, { front: true, side: -1 },
  { front: false, side: 1 }, { front: false, side: -1 },
];

/**
 * Posição no mundo (2D) e intensidade de derrapagem de cada roda.
 * A roda externa da curva carrega mais peso e marca/fuma mais que a interna.
 */
export function wheelContacts(car, out = WHEELS.map(() => ({ x: 0, y: 0, intensity: 0, front: false }))) {
  const p = car.spec;
  const c = Math.cos(car.heading), s = Math.sin(car.heading);
  const latG = clamp(car.ayLoad / G, -1.2, 1.2);
  WHEELS.forEach((w, i) => {
    const lx = w.front ? p.cgToFront : -p.cgToRear;
    const ly = w.side * p.halfTrack;
    // ay > 0 (curva à esquerda) carrega as rodas da direita (side = -1)
    const load = clamp(1 - w.side * latG * 0.7, 0.25, 1.6);
    const base = w.front ? car.skidF : car.skidR;
    const o = out[i];
    o.x = car.x + lx * c - ly * s;
    o.y = car.y + lx * s + ly * c;
    o.intensity = clamp(base * load, 0, 1);
    o.front = w.front;
  });
  return out;
}
