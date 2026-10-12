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

  // trčanje: brže od hodanja, ali ne u čučnju ni s nišanom
  const run = createBody(-64, 0, -40);
  for (let i = 0; i < 60; i++) stepBody(run, { wx: 1, wz: 0, sprint: true }, 1 / 60, B);
  assert.ok(Math.abs(Math.hypot(run.vx, run.vz) - P.sprint) < 0.01, `trči ${Math.hypot(run.vx, run.vz).toFixed(2)} m/s`);
  const runCrouch = createBody(-64, 0, -40);
  for (let i = 0; i < 60; i++) stepBody(runCrouch, { wx: 1, wz: 0, sprint: true, crouch: true }, 1 / 60, B);
  assert.ok(Math.hypot(runCrouch.vx, runCrouch.vz) <= P.crouchSpeed + 0.01, 'u čučnju nema trčanja');
  const runScope = createBody(-64, 0, -40);
  for (let i = 0; i < 60; i++) stepBody(runScope, { wx: 1, wz: 0, sprint: true, scoped: true }, 1 / 60, B);
  assert.ok(Math.hypot(runScope.vx, runScope.vz) <= P.scopeSpeed + 0.01, 's nišanom nema trčanja');

  // slajd: u trku pritisni čučanj → nalet brzine koji se troši; samo ako soba dopušta i ako trčiš
  const sprintThen = (canSlide, sprint = true) => {
    const b0 = createBody(-64, 0, -40);
    for (let i = 0; i < 60; i++) stepBody(b0, { wx: 1, wz: 0, sprint, canSlide }, 1 / 60, B);
    stepBody(b0, { wx: 1, wz: 0, crouch: true, canSlide }, 1 / 60, B);
    return b0;
  };
  const sl = sprintThen(true);
  assert.ok(sl.slideT > 0 && Math.hypot(sl.vx, sl.vz) > P.sprint + 1, `slajd kreće, ${Math.hypot(sl.vx, sl.vz).toFixed(1)} m/s`);
  assert.ok(sl.crouch, 'u slajdu si nisko');
  const x0 = sl.x;
  for (let i = 0; i < 60; i++) stepBody(sl, { wx: 1, wz: 0, crouch: true, canSlide: true }, 1 / 60, B);
  assert.ok(sl.slideT === 0 && sl.slideCd > 0, 'slajd završi i kreće pauza');
  assert.ok(sl.x - x0 > 3.5 && sl.x - x0 < 7, `slajd prijeđe ${(sl.x - x0).toFixed(1)} m`);
  stepBody(sl, { wx: 1, wz: 0, crouch: false, canSlide: true }, 1 / 60, B);
  stepBody(sl, { wx: 1, wz: 0, crouch: true, canSlide: true }, 1 / 60, B);
  assert.equal(sl.slideT, 0, 'nema novog slajda dok traje pauza');
  assert.equal(sprintThen(false).slideT, 0, 'soba bez slajdanja: samo čučanj');
  assert.equal(sprintThen(true, false).slideT, 0, 'bez trčanja nema slajda');

  // niz stepenice: tijelo prati stepenice, ne leti preko njih (kamera to dodatno izgladi)
  const down = createBody(-53.5, 6, -53.5);
  walk(down, 0, 0, 0.3);
  assert.ok(Math.abs(down.y - 6) < 0.01, `na vrhu tornja, y=${down.y}`);
  down.stepped = 0;
  let airFrames = 0;
  for (let i = 0; i < 240; i++) {
    stepBody(down, { wx: 1, wz: 0 }, 1 / 60, B);
    if (!down.onGround) airFrames++;
  }
  assert.ok(down.y === 0 && down.x > -42, `sišao niz stepenice, y=${down.y.toFixed(2)} x=${down.x.toFixed(1)}`);
  assert.ok(airFrames <= 3, `niz stepenice bez skakutanja (u zraku ${airFrames} okvira)`);
  assert.ok(down.stepped < -5.5, `gotovo cijeli spust ide preko stepenica (za kameru): ${down.stepped.toFixed(2)} m`);

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
