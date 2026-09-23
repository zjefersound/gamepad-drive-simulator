import { useMemo } from 'react';
import * as THREE from 'three';
import { CAR } from '../game/carPhysics';

/*
 * VW Gol G2 "bola" (1995–1999), 3 portas, modelado proceduralmente.
 * Perfil lateral desenhado no plano XY (x = frente, y = cima) e extrudado na largura (z),
 * com bevel generoso para as formas arredondadas que deram o apelido "bola".
 * Medidas aproximadas do carro real: 3,93 m x 1,64 m x 1,39 m, entre-eixos 2,47 m.
 */

const FX = CAR.cgToFront; // eixo dianteiro
const RX = -CAR.cgToRear; // eixo traseiro
const ARCH = 0.43; // raio da caixa de roda (o bevel "come" ~0,06)
const WY = CAR.wheelRadius;

function extrude(points, width, bevel, arches = false) {
  const s = new THREE.Shape();
  if (arches) {
    // parte de baixo com as caixas de roda
    s.moveTo(-1.98, 0.3);
    s.lineTo(RX - ARCH, 0.3);
    s.absarc(RX, WY, ARCH, Math.PI, 0, true);
    s.lineTo(FX - ARCH, 0.3);
    s.absarc(FX, WY, ARCH, Math.PI, 0, true);
    s.lineTo(1.8, 0.3);
    points.forEach(([x, y]) => s.lineTo(x, y));
  } else {
    s.moveTo(points[0][0], points[0][1]);
    points.slice(1).forEach(([x, y]) => s.lineTo(x, y));
  }
  s.closePath();
  const depth = width - bevel * 2;
  const g = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.75,
    bevelSegments: 5,
    curveSegments: 20,
  });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

// Contorno lateral da carroceria (frente -> traseira, por cima)
const BODY = [
  [1.87, 0.4], [1.9, 0.54], [1.87, 0.68], [1.76, 0.77], [1.3, 0.83],
  [0.62, 0.9], [-0.9, 0.93], [-1.75, 0.94], [-1.96, 0.9], [-2.03, 0.78],
  [-2.03, 0.42],
];

// Área envidraçada (para-brisa inclinado, teto e tampa traseira bem deitada)
const GLASS = [
  [0.66, 0.86], [0.5, 0.95], [-0.02, 1.3], [-0.2, 1.345], [-1.15, 1.35],
  [-1.4, 1.3], [-1.93, 0.96], [-1.9, 0.86],
];

// Teto na cor da carroceria
const ROOF = [[-0.02, 1.3], [-0.2, 1.36], [-1.15, 1.365], [-1.4, 1.31], [-1.3, 1.26], [-0.1, 1.27]];

// Colunas (só nas laterais)
const A_PILLAR = [[0.58, 0.9], [0.46, 0.9], [-0.1, 1.31], [0.0, 1.31]];
const B_PILLAR = [[-0.72, 0.92], [-0.84, 0.92], [-0.86, 1.33], [-0.74, 1.33]];
const C_PILLAR = [[-1.2, 0.93], [-1.2, 1.3], [-1.42, 1.3], [-1.9, 0.95], [-1.9, 0.93]];
const SIDE_GLASS_WIDTH = 1.36;

function shapeGeo(points, depth) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  points.slice(1).forEach(([x, y]) => s.lineTo(x, y));
  const g = new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

export default function GolBola({ color = '#d0141f', brakeMat, reverseMat }) {
  const geo = useMemo(() => ({
    body: extrude(BODY, 1.64, 0.1, true),
    glass: extrude(GLASS, SIDE_GLASS_WIDTH, 0.07),
    roof: extrude(ROOF, SIDE_GLASS_WIDTH + 0.02, 0.07),
    a: shapeGeo(A_PILLAR, 0.04),
    b: shapeGeo(B_PILLAR, 0.04),
    c: shapeGeo(C_PILLAR, 0.04),
  }), []);

  const mat = useMemo(() => ({
    paint: new THREE.MeshPhysicalMaterial({ color, metalness: 0.08, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.15 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#1c2833', metalness: 0.2, roughness: 0.05, clearcoat: 1 }),
    plastic: new THREE.MeshStandardMaterial({ color: '#26282c', roughness: 0.75 }),
    chrome: new THREE.MeshStandardMaterial({ color: '#e6e8ec', metalness: 1, roughness: 0.18 }),
    lamp: new THREE.MeshStandardMaterial({ color: '#f4f6f8', emissive: '#fff6d8', emissiveIntensity: 1.2, roughness: 0.1 }),
    amber: new THREE.MeshStandardMaterial({ color: '#ff9a1f', emissive: '#ff8a00', emissiveIntensity: 0.35 }),
    plate: new THREE.MeshStandardMaterial({ color: '#d8dde3', roughness: 0.5 }),
  }), [color]);

  const sideZ = SIDE_GLASS_WIDTH / 2 + 0.01;

  return (
    <group>
      {/* Carroceria e vidros */}
      <mesh geometry={geo.body} material={mat.paint} castShadow receiveShadow />
      <mesh geometry={geo.glass} material={mat.glass} castShadow />
      <mesh geometry={geo.roof} material={mat.paint} castShadow />
      {[sideZ, -sideZ].map((z) => (
        <group key={z} position={[0, 0, z]}>
          <mesh geometry={geo.a} material={mat.paint} />
          <mesh geometry={geo.b} material={mat.paint} />
          <mesh geometry={geo.c} material={mat.paint} />
        </group>
      ))}

      {/* Para-choques de plástico envolventes */}
      <mesh position={[1.86, 0.42, 0]} material={mat.plastic} castShadow>
        <boxGeometry args={[0.26, 0.24, 1.68]} />
      </mesh>
      <mesh position={[-2.03, 0.44, 0]} material={mat.plastic} castShadow>
        <boxGeometry args={[0.24, 0.24, 1.68]} />
      </mesh>
      {/* Friso lateral */}
      {[0.83, -0.83].map((z) => (
        <mesh key={z} position={[(RX + FX) / 2, 0.52, z]} material={mat.plastic}>
          <boxGeometry args={[FX - RX - ARCH * 2 - 0.1, 0.08, 0.04]} />
        </mesh>
      ))}

      {/* Frente: faróis, grade fina e logo VW */}
      {[1, -1].map((side) => (
        <group key={side}>
          <mesh position={[1.975, 0.665, side * 0.46]} rotation={[0, side * 0.18, 0]} material={mat.lamp}>
            <boxGeometry args={[0.08, 0.15, 0.44]} />
          </mesh>
          <mesh position={[1.93, 0.665, side * 0.74]} rotation={[0, side * 0.5, 0]} material={mat.amber}>
            <boxGeometry args={[0.07, 0.13, 0.1]} />
          </mesh>
        </group>
      ))}
      <mesh position={[1.99, 0.665, 0]} material={mat.plastic}>
        <boxGeometry args={[0.06, 0.1, 0.48]} />
      </mesh>
      <mesh position={[2.022, 0.665, 0]} rotation={[0, 0, Math.PI / 2]} material={mat.chrome}>
        <cylinderGeometry args={[0.06, 0.06, 0.02, 20]} />
      </mesh>

      {/* Traseira: lanternas horizontais, placa e luz de ré */}
      {[1, -1].map((side) => (
        <mesh key={side} position={[-2.115, 0.76, side * 0.52]} material={brakeMat}>
          <boxGeometry args={[0.06, 0.2, 0.42]} />
        </mesh>
      ))}
      <mesh position={[-2.112, 0.76, 0]} material={reverseMat}>
        <boxGeometry args={[0.05, 0.1, 0.2]} />
      </mesh>
      <mesh position={[-2.16, 0.45, 0]} material={mat.plate}>
        <boxGeometry args={[0.02, 0.13, 0.4]} />
      </mesh>

      {/* Retrovisores e maçanetas */}
      {[1, -1].map((side) => (
        <group key={side}>
          <mesh position={[0.42, 0.98, side * 0.82]} material={mat.plastic} castShadow>
            <boxGeometry args={[0.14, 0.11, 0.1]} />
          </mesh>
          <mesh position={[-0.62, 0.84, side * 0.83]} material={mat.plastic}>
            <boxGeometry args={[0.14, 0.03, 0.03]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
