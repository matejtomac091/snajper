// Provjera mape i fizike: mjesta za pojavu su slobodna, stepenice vode na toranj i krov, zidovi drže.
import assert from 'node:assert/strict';
import { buildMap } from '../public/shared/map.js';
import { createBody, stepBody, blocked } from '../public/shared/physics.js';
import { P } from '../public/shared/config.js';
import { rayWorld, rayHitbox } from '../public/shared/ray.js';

const MAP = buildMap();
const B = MAP.boxes;

function walk(body, wx, wz, seconds, opts = {}) {
  const dt = opts.dt ?? 1 / 60;
  for (let t = 0; t < seconds; t += dt) stepBody(body, { wx, wz, jump: !!opts.jump, crouch: !!opts.crouch }, dt, B);
  return body;
}

export function run() {
  console.log(`  mapa: ${B.length} kutija, ${MAP.spawns.length} mjesta za pojavu`);

  for (const [x, z] of MAP.spawns) {
    assert.ok(!blocked(B, x, 0.01, z, P.height), `spawn (${x}, ${z}) je u zidu`);
    assert.ok(Math.abs(x) < MAP.arena - 1 && Math.abs(z) < MAP.arena - 1, `spawn (${x}, ${z}) izvan arene`);
  }

  // stoji na tlu
  const g = walk(createBody(-64, 2, -40), 0, 0, 1);
  assert.ok(g.onGround && g.y === 0, 'pada na tlo');

  // stepenice tornja (-56,-56): steps x od -44.2 do -52, z ≈ -53.5; hodamo prema zapadu
  const t = walk(createBody(-42, 0, -53.5), -1, 0, 4);
  assert.ok(Math.abs(t.y - 6) < 0.01, `popne se na toranj, y=${t.y.toFixed(2)}`);
  assert.ok(t.x < -52, `stoji na vrhu tornja, x=${t.x.toFixed(2)}`);
  // zapadna ograda zaustavlja
  walk(t, -1, 0, 3);
  assert.ok(t.x > -59.6 - 0.01 && t.x < -58, `ograda tornja drži, x=${t.x.toFixed(2)}`);

  // zrcalni toranj (56,56): stepenice prema istoku od x=52 do 44.2, z ≈ 53.5
  const t2 = walk(createBody(42, 0, 53.5), 1, 0, 4);
  assert.ok(Math.abs(t2.y - 6) < 0.01, `zrcalni toranj, y=${t2.y.toFixed(2)}`);

  // krov središnje zgrade: stepenice x 1.2..8 na z ≈ -9.1, hodamo prema istoku pa prema jugu na krov
  const r = walk(createBody(0.5, 0, -9.1), 1, 0, 1.35);
  assert.ok(Math.abs(r.y - 4.8) < 0.01, `vrh stepenica krova, y=${r.y.toFixed(2)}`);
  walk(r, 0, 1, 1);
  assert.ok(Math.abs(r.y - 4.8) < 0.01 && r.z > -8, `na krovu, y=${r.y.toFixed(2)} z=${r.z.toFixed(2)}`);

  // kroz vrata u zgradu i ispod krova
  const d = walk(createBody(0, 0, -14), 0, 1, 2.5);
  assert.ok(d.z > -7 && d.y === 0, `prolazi kroz vrata, z=${d.z.toFixed(2)}`);

  // zid drži (dugi zid na z=-22, x -47..-33)
  const w = walk(createBody(-40, 0, -26), 0, 1, 3);
  assert.ok(w.z < -22.3 - P.radius + 0.01, `zid drži, z=${w.z.toFixed(3)}`);

  // preskok sanduka 1.4 m nije moguć bez skoka, s 1.0 m vrećom ide skokom
  const s = walk(createBody(-28, 0, -33), 0, -1, 1);
  assert.ok(s.z > -35.5 + P.radius - 0.01, 'vreća zaustavlja hodanje');
  walk(s, 0, -1, 1.5, { jump: true });
  assert.ok(s.z < -36.5, `skokom preko vreće, z=${s.z.toFixed(2)}`);

  // čučanj
  const c = walk(createBody(-64, 0, -40), 0, 0, 0.2, { crouch: true });
  assert.ok(c.crouch, 'čučanj radi');
  walk(c, 0, 0, 0.2);
  assert.ok(!c.crouch, 'ustaje kad pusti');

  // spori kompjuter: dt 0.1 s ne smije propasti kroz krov
  const slow = createBody(0, 6, 0.5);
  for (let i = 0; i < 20; i++) stepBody(slow, { wx: 0, wz: 0 }, 0.1, B);
  assert.ok(Math.abs(slow.y - 4.8) < 0.01, `ne propada kroz krov na 10 fps, y=${slow.y.toFixed(2)}`);

  // zrake
  const dist = rayWorld(B, -40, 1.6, -30, 0, 0, 1, 400);
  assert.ok(Math.abs(dist - (30 - 22.3)) < 0.01, `zraka udara u zid na ${dist.toFixed(2)} m`);
  const head = rayHitbox(0, 1.56, 10, 0, 0, -1, 0, 0, 0, false);
  assert.equal(head.part, 'head');
  const body = rayHitbox(0, 1.1, 10, 0, 0, -1, 0, 0, 0, false);
  assert.equal(body.part, 'body');
  const legs = rayHitbox(0, 0.4, 10, 0, 0, -1, 0, 0, 0, false);
  assert.equal(legs.part, 'legs');
  const miss = rayHitbox(0, 1.1, 10, 0, 0, -1, 1, 0, 0, false);
  assert.equal(miss, null);
  const crouchHead = rayHitbox(0, 1.08, 10, 0, 0, -1, 0, 0, 0, true);
  assert.equal(crouchHead.part, 'head');
  const overCrouch = rayHitbox(0, 1.5, 10, 0, 0, -1, 0, 0, 0, true);
  assert.equal(overCrouch, null, 'metak prolazi iznad čučnja');
}
