import * as THREE from 'three';

function canvasTexture(w, h, draw, repeat = true) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function speckle(ctx, w, h, count, colors, size = 2) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
    ctx.fillRect(Math.random() * w, Math.random() * h, size, size);
  }
}

// Asfalto: u atravessa a pista, v segue o comprimento (1 repetição = 16 m)
export function asphaltTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#3b3e44';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 22000, ['#33363b', '#44474d', '#2e3035', '#4a4d52'], 2);
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(10, 0, 9, h);
    ctx.fillRect(w - 19, 0, 9, h);
    ctx.fillStyle = '#e2c64a';
    ctx.fillRect(w / 2 - 4, 0, 8, h / 2);
  });
}

export function grassTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#4c7a34';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 9000, ['#44702e', '#57883c', '#3f6a2a', '#5f9043'], 2);
  });
}

export function checkerTexture() {
  const tex = canvasTexture(256, 32, (ctx, w, h) => {
    const s = h / 2;
    for (let x = 0; x < w / s; x++) {
      for (let y = 0; y < 2; y++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
        ctx.fillRect(x * s, y * s, s, s);
      }
    }
  }, false);
  return tex;
}

export function coneTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    ctx.fillStyle = '#ff6a13';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, h * 0.35, w, h * 0.18);
  }, false);
}
