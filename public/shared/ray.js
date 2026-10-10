// Zrake za pucanje: protiv kutija mape, poda i pogodnih zona igrača.
import { HITBOX } from './config.js';

export function rayBox(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = 0, tmax = Infinity, t1, t2, tmp;
  if (dx !== 0) {
    t1 = (minX - ox) / dx; t2 = (maxX - ox) / dx;
    if (t1 > t2) { tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
  } else if (ox < minX || ox > maxX) return Infinity;
  if (dy !== 0) {
    t1 = (minY - oy) / dy; t2 = (maxY - oy) / dy;
    if (t1 > t2) { tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
  } else if (oy < minY || oy > maxY) return Infinity;
  if (dz !== 0) {
    t1 = (minZ - oz) / dz; t2 = (maxZ - oz) / dz;
    if (t1 > t2) { tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
  } else if (oz < minZ || oz > maxZ) return Infinity;
  return tmin > tmax ? Infinity : tmin;
}

export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return Infinity;
  const thc = Math.sqrt(r * r - d2);
  const t0 = tca - thc;
  if (t0 >= 0) return t0;
  return tca + thc >= 0 ? 0 : Infinity;
}

// Udaljenost do prvog zida/poda, najviše maxT.
export function rayWorld(boxes, ox, oy, oz, dx, dy, dz, maxT) {
  let best = maxT;
  if (dy < 0) {
    const t = -oy / dy;
    if (t < best) best = t;
  }
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const t = rayBox(ox, oy, oz, dx, dy, dz, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ);
    if (t < best) best = t;
  }
  return best;
}

// Vraća { t, part } ili null. part je 'head', 'body' ili 'legs'.
export function rayHitbox(ox, oy, oz, dx, dy, dz, px, py, pz, crouch) {
  const hb = crouch ? HITBOX.crouch : HITBOX.stand;
  const h = HITBOX.half;
  const th = raySphere(ox, oy, oz, dx, dy, dz, px, py + hb.head, pz, HITBOX.headR);
  const tb = rayBox(ox, oy, oz, dx, dy, dz, px - h, py, pz - h, px + h, py + hb.body, pz + h);
  if (th === Infinity && tb === Infinity) return null;
  if (th <= tb) return { t: th, part: 'head' };
  const hitY = oy + dy * tb;
  return { t: tb, part: hitY < py + hb.legs ? 'legs' : 'body' };
}
