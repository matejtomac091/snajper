// Kretanje igrača: kutija oko igrača protiv kutija mape. Isti kod vrti preglednik (za tebe) i server (za botove).
import { P } from './config.js';

const Q = { hit: false, top: 0 };

function query(boxes, x, y, z, h, r) {
  Q.hit = false;
  Q.top = -Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ && y + h > b.minY && y < b.maxY) {
      Q.hit = true;
      if (b.maxY > Q.top) Q.top = b.maxY;
    }
  }
  return Q;
}

export function blocked(boxes, x, y, z, h, r = P.radius) {
  return query(boxes, x, y, z, h, r).hit;
}

export function createBody(x = 0, y = 0, z = 0) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, crouch: false };
}

// input: { wx, wz (željeni smjer u svijetu), jump, crouch, scoped, sprint?, speedMul?, jumpMul? }
export function stepBody(b, input, dt, boxes) {
  if (input.crouch) b.crouch = true;
  else if (b.crouch && !blocked(boxes, b.x, b.y, b.z, P.height)) b.crouch = false;

  const h = b.crouch ? P.crouchHeight : P.height;
  const base = b.crouch ? P.crouchSpeed : input.scoped ? P.scopeSpeed : input.sprint ? P.sprint : P.walk;
  const max = base * (input.speedMul || 1);

  let wx = input.wx || 0;
  let wz = input.wz || 0;
  const len = Math.hypot(wx, wz);
  if (len > 1) { wx /= len; wz /= len; }

  const dvx = wx * max - b.vx;
  const dvz = wz * max - b.vz;
  const dv = Math.hypot(dvx, dvz);
  const maxDv = (b.onGround ? 60 : 12) * dt;
  if (dv <= maxDv) { b.vx += dvx; b.vz += dvz; }
  else { b.vx += (dvx / dv) * maxDv; b.vz += (dvz / dv) * maxDv; }

  if (input.jump && b.onGround) { b.vy = P.jump * (input.jumpMul || 1); b.onGround = false; }
  b.vy = Math.max(b.vy - P.gravity * dt, -P.maxFall);

  // Podkoraci da brzi pad ili spor kompjuter (veliki dt) ne prođu kroz tanki krov.
  const travel = Math.max(Math.abs(b.vx), Math.abs(b.vz), Math.abs(b.vy)) * dt;
  const n = Math.min(12, Math.max(1, Math.ceil(travel / 0.15)));
  const s = dt / n;
  for (let i = 0; i < n; i++) {
    moveH(b, b.vx * s, 0, h, boxes);
    moveH(b, 0, b.vz * s, h, boxes);
    moveV(b, b.vy * s, h, boxes);
  }
}

function moveH(b, dx, dz, h, boxes) {
  if (dx === 0 && dz === 0) return;
  const nx = b.x + dx;
  const nz = b.z + dz;
  const q = query(boxes, nx, b.y, nz, h, P.radius);
  if (!q.hit) { b.x = nx; b.z = nz; return; }
  const top = q.top;
  if (b.onGround && top > b.y && top - b.y <= P.step && !blocked(boxes, nx, top, nz, h)) {
    b.x = nx; b.z = nz; b.y = top;
    return;
  }
  if (dx !== 0) b.vx = 0;
  if (dz !== 0) b.vz = 0;
}

function moveV(b, dy, h, boxes) {
  if (dy === 0) return;
  const ny = b.y + dy;
  if (ny <= 0) { b.y = 0; b.vy = 0; b.onGround = true; return; }
  const q = query(boxes, b.x, ny, b.z, h, P.radius);
  if (!q.hit) { b.y = ny; b.onGround = false; return; }
  if (dy < 0) {
    if (q.top <= b.y + 0.01) b.y = q.top;
    b.vy = 0;
    b.onGround = true;
  } else {
    b.vy = 0;
  }
}
