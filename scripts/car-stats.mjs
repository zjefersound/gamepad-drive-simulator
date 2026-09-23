// Mede cada carro do cars.json na física do jogo e calcula notas, PI e classe.
//   npm run car-stats            -> só mostra
//   npm run car-stats -- --write -> grava "stats", "measured", "pi" e "class" no JSON
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSpec } from '../src/game/carPhysics.js';
import { measureCar, rateCar } from '../src/game/carStats.js';

const file = fileURLToPath(new URL('../src/data/cars.json', import.meta.url));
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const write = process.argv.includes('--write');

for (const car of data.cars) {
  const measured = measureCar(buildSpec(car));
  const { stats, pi, class: cls } = rateCar(measured);
  console.log(`\n${car.brand} ${car.model} ${car.year}  [${cls} ${pi}]`);
  console.table({ ...measured, ...Object.fromEntries(Object.entries(stats).map(([k, v]) => [`nota.${k}`, v])) });
  if (car.specs?.zeroToHundredS) console.log(`  ficha técnica: 0-100 ${car.specs.zeroToHundredS}s, máx ${car.specs.topSpeedKmh} km/h`);
  if (write) Object.assign(car, { class: cls, pi, stats, measured });
}

if (write) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`\n✔ ${file} atualizado`);
}
