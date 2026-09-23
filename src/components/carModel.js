import * as THREE from 'three';

const FORWARD_ROTATION = { '+x': 0, '-z': -Math.PI / 2, '-x': Math.PI, '+z': Math.PI / 2 };

// Separa os triângulos de uma geometria pelo lado do carro (z > 0 = direita)
function splitBySide(geometry, side) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const pos = g.attributes.position;
  const keep = [];
  for (let i = 0; i < pos.count; i += 3) {
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    if (Math.sign(cz) === side) keep.push(i);
  }
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const size = attr.itemSize;
    const arr = new attr.array.constructor(keep.length * 3 * size);
    keep.forEach((start, t) => {
      for (let v = 0; v < 3; v++) {
        for (let c = 0; c < size; c++) arr[(t * 3 + v) * size + c] = attr.array[(start + v) * size + c];
      }
    });
    out.setAttribute(name, new THREE.BufferAttribute(arr, size, attr.normalized));
  }
  return out;
}

/**
 * Prepara um modelo glTF para o simulador:
 *  - orienta para o referencial do carro (x = frente, y = cima, z = direita)
 *  - extrai as rodas (um nó por eixo, com as duas rodas) em 4 rodas independentes
 *  - alinha a carroceria para os eixos baterem com a física
 */
export function prepareCarModel(gltf, asset, spec) {
  const root = new THREE.Group();
  const scene = gltf.scene.clone(true);
  root.rotation.y = FORWARD_ROTATION[asset.forward ?? '+x'] ?? 0;
  root.scale.setScalar(asset.scale ?? 1);
  root.add(scene);
  root.updateMatrixWorld(true);

  const wheels = [];
  for (const axle of ['front', 'rear']) {
    const node = scene.getObjectByName(asset.wheelNodes?.[axle] ?? '');
    if (!node) continue;
    const meshes = [];
    node.traverse((o) => o.isMesh && meshes.push(o));
    for (const side of [1, -1]) {
      const parts = meshes.map((m) => {
        const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
        return { geometry: splitBySide(g, side), material: m.material };
      }).filter((p) => p.geometry.attributes.position.count > 0);
      const box = new THREE.Box3();
      parts.forEach((p) => { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); });
      const center = box.getCenter(new THREE.Vector3());
      const group = new THREE.Group();
      for (const p of parts) {
        p.geometry.translate(-center.x, -center.y, -center.z);
        p.geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(p.geometry, p.material);
        mesh.castShadow = true;
        group.add(mesh);
      }
      wheels.push({ axle, side, center, radius: (box.max.y - box.min.y) / 2, object: group });
    }
    node.parent.remove(node);
  }

  // Lanternas: clona os materiais indicados e faz a própria textura brilhar
  const brakeNames = new Set(asset.brakeLightMaterials ?? []);
  const brakeMaterials = new Map();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    if (brakeNames.has(o.material.name)) {
      if (!brakeMaterials.has(o.material.name)) {
        const m = o.material.clone();
        m.emissive = new THREE.Color(m.map ? '#ff2a2a' : '#ff1010');
        m.emissiveMap = m.map ?? null;
        brakeMaterials.set(o.material.name, m);
      }
      o.material = brakeMaterials.get(o.material.name);
    }
  });

  // Alinhamento: eixo dianteiro do modelo -> cgToFront; centro da roda -> raio da roda
  const front = wheels.filter((w) => w.axle === 'front');
  const offset = new THREE.Vector3();
  if (front.length) {
    const fx = front.reduce((s, w) => s + w.center.x, 0) / front.length;
    const cy = wheels.reduce((s, w) => s + w.center.y, 0) / wheels.length;
    offset.set(spec.cgToFront - fx, spec.wheelRadius - cy, 0);
  }
  const body = new THREE.Group();
  body.position.copy(offset);
  body.add(root);

  // Ordem igual à das rodas procedurais: dianteira dir/esq, traseira dir/esq
  const order = [['front', 1], ['front', -1], ['rear', 1], ['rear', -1]];
  const wheelList = order.map(([axle, side]) => {
    const w = wheels.find((x) => x.axle === axle && x.side === side);
    return w && { position: w.center.clone().add(offset).toArray(), object: w.object };
  });

  return {
    body,
    wheels: wheelList.every(Boolean) ? wheelList : null,
    brakeMaterials: [...brakeMaterials.values()],
  };
}
