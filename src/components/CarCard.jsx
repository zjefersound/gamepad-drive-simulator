const STAT_LABELS = [
  ['speed', 'Velocidade'],
  ['acceleration', 'Aceleração'],
  ['handling', 'Dirigibilidade'],
  ['braking', 'Frenagem'],
  ['launch', 'Arrancada'],
  ['offroad', 'Fora de estrada'],
];

const DRIVETRAIN = { FWD: 'Dianteira', RWD: 'Traseira', AWD: 'Integral' };

/** Ficha do carro no estilo "garagem" de jogo de corrida. */
export default function CarCard({ car }) {
  const s = car.specs ?? {};
  return (
    <div className="car-card">
      <div className="car-head">
        <div>
          <div className="car-brand">{car.brand} · {car.year}</div>
          <div className="car-model">{car.model} <span className="dim">{car.generation}</span></div>
        </div>
        {car.class && (
          <div className={`pi-badge class-${car.class}`}>
            <b>{car.class}</b><span>{car.pi}</span>
          </div>
        )}
      </div>

      {car.stats && (
        <div className="stats">
          {STAT_LABELS.map(([key, label]) => (
            <div className="stat" key={key}>
              <span>{label}</span>
              <div className="stat-bar"><div style={{ width: `${(car.stats[key] ?? 0) * 10}%` }} /></div>
              <b className="mono">{(car.stats[key] ?? 0).toFixed(1)}</b>
            </div>
          ))}
        </div>
      )}

      <div className="specs">
        {s.powerCv && <span><b>{s.powerCv}</b> cv</span>}
        {s.torqueNm && <span><b>{s.torqueNm}</b> Nm</span>}
        {s.weightKg && <span><b>{s.weightKg}</b> kg</span>}
        {s.drivetrain && <span>Tração <b>{DRIVETRAIN[s.drivetrain] ?? s.drivetrain}</b></span>}
        {s.zeroToHundredS && <span>0–100 <b>{s.zeroToHundredS}</b> s</span>}
        {s.topSpeedKmh && <span>Máx <b>{s.topSpeedKmh}</b> km/h</span>}
      </div>
    </div>
  );
}

/** Crédito do modelo 3D (exigido pela licença Creative Commons). */
export function ModelCredits({ car }) {
  const c = car.asset?.credits;
  if (!c) return null;
  return (
    <div className="credits">
      Modelo 3D: <a href={c.source} target="_blank" rel="noreferrer">{c.title}</a> por{' '}
      <a href={c.authorUrl} target="_blank" rel="noreferrer">{c.author}</a> ·{' '}
      <a href={c.licenseUrl} target="_blank" rel="noreferrer">{c.license}</a>
    </div>
  );
}
