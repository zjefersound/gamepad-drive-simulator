import { useEffect, useRef, useState } from 'react';
import { ASSISTS, CAR } from '../game/carPhysics';
import { CAMERA_MODES } from '../game/game';
import { formatTime } from '../game/math';

const MAP_SIZE = 170;

function Minimap({ game }) {
  const canvas = useRef();
  const bounds = useRef(null);

  useEffect(() => {
    const { samples } = game.track;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const s of samples) {
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
      minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
    }
    const pad = 12;
    const scale = (MAP_SIZE - pad * 2) / Math.max(maxX - minX, maxY - minY);
    const ox = (MAP_SIZE - (maxX - minX) * scale) / 2;
    const oy = (MAP_SIZE - (maxY - minY) * scale) / 2;
    bounds.current = { toX: (x) => ox + (x - minX) * scale, toY: (y) => MAP_SIZE - (oy + (y - minY) * scale) };

    let raf;
    const draw = () => {
      const ctx = canvas.current?.getContext('2d');
      if (ctx) {
        const { toX, toY } = bounds.current;
        ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 5;
        ctx.beginPath();
        samples.forEach((s, i) => (i ? ctx.lineTo(toX(s.x), toY(s.y)) : ctx.moveTo(toX(s.x), toY(s.y))));
        ctx.closePath();
        ctx.stroke();
        ctx.strokeStyle = '#1b1f2a';
        ctx.lineWidth = 3;
        ctx.stroke();
        const s0 = samples[0];
        ctx.fillStyle = '#fff';
        ctx.fillRect(toX(s0.x) - 2, toY(s0.y) - 5, 4, 10);

        const car = game.car;
        ctx.save();
        ctx.translate(toX(car.x), toY(car.y));
        ctx.rotate(-car.heading);
        ctx.fillStyle = '#ff2d4b';
        ctx.beginPath();
        ctx.moveTo(7, 0);
        ctx.lineTo(-5, 4.5);
        ctx.lineTo(-5, -4.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [game]);

  return <canvas ref={canvas} width={MAP_SIZE} height={MAP_SIZE} className="minimap" />;
}

function snapshot(game) {
  const { car, lap, settings, input } = game;
  return {
    speed: Math.round(Math.hypot(car.vx, car.vy) * 3.6),
    gear: car.gear === -1 ? 'R' : String(car.gear),
    rpm: car.rpm,
    manual: settings.manual,
    assist: ASSISTS[settings.assistLevel].name,
    camera: CAMERA_MODES[settings.cameraMode],
    tc: car.tcActive,
    esp: car.espActive,
    offroad: !car.onRoad,
    lapCurrent: lap.started ? lap.current : null,
    lapBest: lap.best,
    lapLast: lap.last,
    laps: lap.count,
    pad: input.state.gamepadName,
    toast: game.toast && game.toast.until > game.time ? game.toast.text : null,
    started: game.started,
    throttle: car.throttle,
    brake: car.brake,
    steer: input.state.steer,
  };
}

export default function Hud({ game }) {
  const [s, setS] = useState(() => snapshot(game));
  const [help, setHelp] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setS(snapshot(game)), 50);
    const onKey = (e) => e.code === 'F1' && (e.preventDefault(), setHelp((h) => !h));
    window.addEventListener('keydown', onKey);
    return () => { clearInterval(id); window.removeEventListener('keydown', onKey); };
  }, [game]);

  const rpmFrac = Math.min(1, s.rpm / (CAR.redline + 300));
  const redFrac = (CAR.redline - 600) / (CAR.redline + 300);

  return (
    <div className="hud">
      <div className="top-left panel">
        <div className="row"><span className="label">Volta</span><span className="mono big">{formatTime(s.lapCurrent)}</span></div>
        <div className="row"><span className="label">Última</span><span className="mono">{formatTime(s.lapLast)}</span></div>
        <div className="row"><span className="label">Melhor</span><span className="mono best">{formatTime(s.lapBest)}</span></div>
        <div className="row"><span className="label">Voltas</span><span className="mono">{s.laps}</span></div>
      </div>

      <div className="top-right">
        <Minimap game={game} />
        <div className={`pad-status ${s.pad ? 'on' : ''}`}>
          {s.pad ? `🎮 ${s.pad}` : '⌨️ Teclado — conecte um controle e aperte um botão'}
        </div>
      </div>

      {s.toast && <div className="toast">{s.toast}</div>}
      {s.offroad && s.speed > 5 && <div className="warning">FORA DA PISTA</div>}

      <div className="bottom-right panel dash">
        <div className="speed"><span className="mono">{s.speed}</span><small>km/h</small></div>
        <div className="gear-box">
          <div className={`gear ${s.gear === 'R' ? 'rev' : ''}`}>{s.gear}</div>
          <div className="trans">{s.manual ? 'MAN' : 'AUTO'}</div>
        </div>
        <div className="rpm">
          <div className="rpm-bar" style={{ width: `${rpmFrac * 100}%` }} />
          <div className="rpm-red" style={{ left: `${redFrac * 100}%` }} />
          <span className="rpm-label mono">{Math.round(s.rpm / 100) * 100} rpm</span>
        </div>
        <div className="pedals">
          <div className="pedal"><div className="fill brake" style={{ height: `${s.brake * 100}%` }} /></div>
          <div className="pedal"><div className="fill throttle" style={{ height: `${s.throttle * 100}%` }} /></div>
          <div className="steer"><div className="steer-dot" style={{ left: `${50 - s.steer * 50}%` }} /></div>
        </div>
        <div className="flags">
          <span className={s.tc ? 'flag lit' : 'flag'}>TC</span>
          <span className={s.esp ? 'flag lit' : 'flag'}>ESP</span>
          <span className="assist">Assist.: {s.assist}</span>
        </div>
      </div>

      {help && (
        <div className="bottom-left panel help">
          <b>Controles</b> <span className="dim">(F1 oculta)</span>
          <ul>
            <li><kbd>LS</kbd> Direção <span className="dim">· ← → / A D</span></li>
            <li><kbd>RT</kbd> Acelerar <span className="dim">· ↑ / W</span></li>
            <li><kbd>LT</kbd> Freio / Ré <span className="dim">· ↓ / S</span></li>
            <li><kbd>A</kbd> Freio de mão <span className="dim">· Espaço</span></li>
            <li><kbd>B</kbd> Buzina <span className="dim">· H</span></li>
            <li><kbd>X</kbd> Assistências <span className="dim">· T</span></li>
            <li><kbd>Y</kbd> Câmera ({s.camera}) <span className="dim">· C</span></li>
            <li><kbd>RS</kbd> Olhar em volta</li>
            <li><kbd>LB</kbd>/<kbd>RB</kbd> Marchas (manual) <span className="dim">· Q / E</span></li>
            <li><kbd>View</kbd> Auto / Manual <span className="dim">· M</span></li>
            <li><kbd>Menu</kbd> Voltar à pista <span className="dim">· R</span></li>
            <li><kbd>D-pad ↓</kbd> Repor cones <span className="dim">· K</span></li>
          </ul>
        </div>
      )}

      {!s.started && (
        <div className="overlay">
          <h1>Gamepad Drive Simulator</h1>
          <p>Conecte um controle Xbox e pressione qualquer botão</p>
          <p className="dim">ou clique / aperte uma tecla para usar o teclado (e ativar o som)</p>
        </div>
      )}
    </div>
  );
}
