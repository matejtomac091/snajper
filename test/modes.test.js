// Načini igre: podjela u timove, bez prijateljske vatre, timski deathmatch, zastava (CTF), FFA ostaje isti.
import assert from 'node:assert/strict';
import { startServer, Client, dirTo, sleep } from './server.test.js';
import { buildMap } from '../public/shared/map.js';
import { blocked, createBody, stepBody } from '../public/shared/physics.js';
import { rayWorld } from '../public/shared/ray.js';
import { P, FLAG } from '../public/shared/config.js';

const BASE = Number(process.env.TEST_PORT_BASE) || 3101;
const MAP = buildMap();
const B = MAP.boxes;
// Dva mjesta za pojavu na crvenoj polovici (x+z<0) i dva na plavoj (x+z>0). Svi se međusobno vide.
const SPAWNS = '-60,46;-60,32;-54,60;-46,56';
const FLAG_RETURN = 2; // s, umjesto 20
const ADMIN_KEY = 'tajna-456';

// Klijent koji u poruku 'join' doda još polja (npr. način igre).
class ModeClient extends Client {
  constructor(port, join = {}) {
    super(port);
    this.join = join;
  }

  send(m) {
    super.send(m.t === 'join' ? { ...m, ...this.join } : m);
  }
}

const half = (x, z) => (x + z < 0 ? 0 : 1);
const eye = (c) => [c.me.x, 1.6, c.me.z];
const head = (c) => [c.me.x, 1.56, c.me.z];

async function until(fn, what, ms = 2500) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await sleep(25);
  }
  throw new Error(`nije se dogodilo: ${what}`);
}

// Hodanje brzinom koju server prihvaća (keepAlive šalje c.me svakih 50 ms).
async function walkTo(c, x, z, speed = 4.5) {
  for (;;) {
    const dx = x - c.me.x, dz = z - c.me.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.01) return;
    const s = Math.min(l, speed * 0.05);
    c.me = { ...c.me, x: Math.round((c.me.x + (dx / l) * s) * 1000) / 1000, z: Math.round((c.me.z + (dz / l) * s) * 1000) / 1000 };
    await sleep(50);
  }
}

// Admin (preskače provjeru kretanja) se prebaci 3 m od točke, pa zadnje metre prehoda.
async function teleportNear(c, x, z) {
  c.me = { ...c.me, x: x + 3, z };
  await sleep(120);
  await walkTo(c, x, z);
}

function freeLine(a, b) {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (let s = 0; s <= d; s += 0.2) {
    const k = s / d;
    if (blocked(B, a[0] + (b[0] - a[0]) * k, 0.05, a[1] + (b[1] - a[1]) * k, P.height - 0.1, P.radius)) return false;
  }
  return true;
}

// Slobodno mjesto na udaljenosti dist od igrača: vidi ga, do njega se može hodati, nije blizu zastava.
function findSpot(c, dist) {
  const from = [c.me.x, c.me.z];
  for (let a = 0; a < 360; a += 10) {
    const r = (a * Math.PI) / 180;
    const p = [from[0] + Math.cos(r) * dist, from[1] + Math.sin(r) * dist];
    if (Math.abs(p[0]) > MAP.arena - 3 || Math.abs(p[1]) > MAP.arena - 3) continue;
    if (blocked(B, p[0], 0.01, p[1], P.height, 1.0) || !freeLine(from, p)) continue;
    const d = dirTo(eye(c), [p[0], 1.56, p[1]]);
    if (rayWorld(B, ...eye(c), ...d, dist + 1) < dist - 0.3) continue;
    if (MAP.flags.some(([fx, fz]) => Math.hypot(fx - p[0], fz - p[1]) < 6)) continue;
    return p;
  }
  throw new Error('nema slobodnog mjesta za test');
}

/* ------------------------------------------------------------------ mapa: postolja zastava */

function flagPlacementTests() {
  const [red, blue] = MAP.flags;
  assert.deepEqual(blue, [-red[0], -red[1]], 'zastave su zrcalne kroz središte');
  assert.ok(red[0] + red[1] < 0 && blue[0] + blue[1] > 0, 'svaka zastava je na polovici svog tima');
  for (const [i, [x, z]] of MAP.flags.entries()) {
    assert.ok(!blocked(B, x, 0.01, z, P.height), `zastava (${x}, ${z}) je u kutiji`);
    assert.ok(!blocked(B, x, 0.01, z, P.height, FLAG.touch + P.radius), `oko zastave (${x}, ${z}) nema mjesta za dodir`);
    const tower = i === 0 ? [-56, -56] : [56, 56];
    assert.ok(Math.hypot(x - tower[0], z - tower[1]) < 12, 'zastava je uz toranj svog tima');
    // do zastave se dolazi hodanjem iz pet smjerova (za plavu zrcalno)
    const sgn = i === 0 ? 1 : -1;
    for (const [ox, oz] of [[0, 8], [8, 0], [6, 6], [-8, 4], [8, -8]]) {
      const sx = x + ox * sgn, sz = z + oz * sgn;
      assert.ok(!blocked(B, sx, 0.01, sz, P.height), `početak (${sx}, ${sz}) je u kutiji`);
      const b = createBody(sx, 0, sz);
      for (let k = 0; k < 600 && Math.hypot(b.x - x, b.z - z) > 0.8; k++) {
        const dx = x - b.x, dz = z - b.z, l = Math.hypot(dx, dz);
        stepBody(b, { wx: dx / l, wz: dz / l }, 1 / 60, B);
      }
      assert.ok(Math.hypot(b.x - x, b.z - z) <= FLAG.touch, `do zastave (${x}, ${z}) se ne dolazi iz (${sx}, ${sz})`);
    }
  }
  console.log(`  postolja zastava ${JSON.stringify(MAP.flags)}: izvan kutija, zrcalna, dostupna ✔`);
}

/* ------------------------------------------------------------------ FFA se ne mijenja */

async function ffaTests(port) {
  const A = new ModeClient(port);
  const C = new ModeClient(port, { mode: 'nesto' });
  const wA = await A.connect('Fa', 'ffa1');
  await C.connect('Fc', 'ffa1');
  assert.equal(wA.mode, 'ffa');
  assert.equal(wA.team, null);
  assert.ok(wA.players.every((p) => p.team === null), 'u FFA nitko nema tim');
  assert.equal(wA.scoreLimit, 0);
  await A.wait('spawn');
  await C.wait('spawn');
  A.keepAlive();
  C.keepAlive();
  await until(() => A.snap, 'stanje');
  assert.deepEqual(Object.keys(A.snap), ['t', 'p', 'tl'], 'FFA stanje nema timske dodatke');
  A.send({ t: 'team' });
  await A.none('team', () => true, 400);
  console.log('  FFA: bez timova, stanje {t,p,tl} kao prije, nepoznat način = FFA ✔');

  // admin mijenja način: timovi se podijele i kreće nova runda
  A.send({ t: 'alogin', key: ADMIN_KEY });
  await A.wait('admin', (m) => m.ok);
  A.send({ t: 'admin', a: 'mode', mode: 'krivo' });
  await A.none('mode', () => true, 300);
  A.send({ t: 'admin', a: 'mode', mode: 'tdm' });
  const mm = await C.wait('mode');
  assert.equal(mm.mode, 'tdm');
  assert.equal(mm.lim, 30);
  assert.deepEqual(mm.players.map((p) => p.team).sort(), [0, 1], 'dva igrača u dva tima');
  await C.wait('reset');
  const sp = await C.wait('spawn', (m) => m.q === 2, 3000);
  const cTeam = mm.players.find((p) => p.id === C.welcome.id).team;
  assert.equal(half(sp.x, sp.z), cTeam, 'pojava na polovici svog tima');
  await until(() => Array.isArray(C.snap.ts), 'ts u stanju');
  A.send({ t: 'admin', a: 'mode', mode: 'ffa' });
  const back = await C.wait('mode', (m) => m.mode === 'ffa');
  assert.ok(back.players.every((p) => p.team === null));
  console.log('  admin mijenja način (FFA → TDM → FFA), kriv način se odbija ✔');
  A.close();
  C.close();
}

/* ------------------------------------------------------------------ timovi i TDM */

async function teamTests(port) {
  const cs = [];
  for (const n of ['Tim1', 'Tim2', 'Tim3', 'Tim4']) {
    const c = new ModeClient(port, { mode: 'tdm' });
    await c.connect(n, 'tdm1');
    cs.push(c);
  }
  const w = cs[0].welcome;
  assert.equal(w.mode, 'tdm');
  assert.equal(w.scoreLimit, 30);
  assert.deepEqual(w.teamScore, [0, 0]);
  const teams = cs.map((c) => c.welcome.team);
  assert.deepEqual([...teams].sort(), [0, 0, 1, 1], `timovi 2:2, a dobili smo ${teams}`);
  await until(() => cs[0].log.filter((m) => m.t === 'join').length === 3, '3 poruke join');
  const joins = cs[0].log.filter((m) => m.t === 'join');
  assert.ok(joins.every((m) => m.team === 0 || m.team === 1), 'join nosi tim');
  for (const c of cs) {
    await c.wait('spawn');
    assert.equal(half(c.me.x, c.me.z), c.welcome.team, `${c.welcome.id} se pojavio na tuđoj polovici`);
    c.keepAlive({ s: 1 });
  }
  const red = cs.filter((c) => c.welcome.team === 0);
  const blue = cs.filter((c) => c.welcome.team === 1);
  assert.notDeepEqual([red[0].me.x, red[0].me.z], [red[1].me.x, red[1].me.z], 'suigrači se ne pojave jedan na drugom');
  console.log('  4 igrača: timovi 2:2, svatko na svojoj polovici ✔');

  await until(() => Array.isArray(cs[0].snap?.ts) && !cs[0].snap.fl, 'ts bez fl u TDM stanju');

  // prijateljska vatra: metak prolazi kroz suigrača
  await sleep(1600);
  const [S, T] = red;
  S.send({ t: 'shoot', d: dirTo(eye(S), head(T)) });
  const s0 = await S.wait('shot', (m) => m.id === S.welcome.id);
  assert.equal(s0.h, 0, 'suigrač nije pogođen');
  await T.none('dmg', () => true, 400);
  assert.ok(!S.log.some((m) => m.t === 'kill'), 'nema ubojstva suigrača');
  console.log('  bez prijateljske vatre: metak prolazi kroz suigrača ✔');

  // TDM: ubojstvo protivnika daje bod timu
  await sleep(1000);
  const E = blue[0];
  S.send({ t: 'shoot', d: dirTo(eye(S), head(E)) });
  const k = await S.wait('kill', (m) => m.v === E.welcome.id);
  assert.equal(k.k, S.welcome.id);
  await until(() => S.snap.ts[0] === 1 && S.snap.ts[1] === 0, 'crveni imaju 1 bod');
  console.log('  TDM: ubojstvo protivnika = +1 timu ✔');

  // eksplozivni pištolj (admin cheat): eksplozija ne dira suigrača, a protivnika ubija
  S.send({ t: 'alogin', key: ADMIN_KEY });
  await S.wait('admin', (m) => m.ok);
  S.send({ t: 'admin', a: 'cheat', name: 'pistol', on: true });
  await S.wait('admin', (m) => m.ok && m.cheats.pistol);
  S.send({ t: 'shoot', w: 'pistol', d: dirTo(eye(S), [T.me.x, 0, T.me.z]) });
  await S.wait('boom', () => true, 2000);
  await T.none('kill', (m) => m.v === T.welcome.id, 500);
  const E2 = blue[1];
  S.send({ t: 'shoot', w: 'pistol', d: dirTo(eye(S), [E2.me.x, 0, E2.me.z]) });
  await S.wait('kill', (m) => m.v === E2.welcome.id, 2000);
  await until(() => S.snap.ts[0] === 2, 'crveni imaju 2 boda');
  console.log('  eksplozija pištolja: suigrač živ, protivnik mrtav ✔');

  // promjena tima kad bi timovi bili 1:3 se odbija
  S.send({ t: 'team' });
  const no = await S.wait('team', (m) => m.err);
  assert.equal(no.team, 0);
  console.log('  promjena tima 2:2 → 1:3 se odbija ✔');
  for (const c of cs) c.close();
}

async function botTeamTests(port) {
  const H = new ModeClient(port, { mode: 'tdm' });
  const w = await H.connect('Covjek', 'tdm2', 3);
  for (let i = 0; i < 3; i++) await H.wait('join', (m) => m.bot, 2000);
  const teamOf = new Map([[w.id, w.team], ...H.log.filter((m) => m.t === 'join').map((m) => [m.id, m.team])]);
  const count = () => [0, 1].map((t) => [...teamOf.values()].filter((x) => x === t).length);
  assert.deepEqual(count(), [2, 2], `čovjek + 3 bota = 2:2, a ne ${count()}`);
  console.log('  botovi ulaze u manji tim: 1 čovjek + 3 bota = 2:2 ✔');

  // promjena tima s botovima: jedan bot prelazi na drugu stranu da timovi ostanu 2:2
  await H.wait('spawn');
  H.keepAlive();
  const q = H.me.q;
  const from = w.team;
  H.send({ t: 'team' });
  const mine = await H.wait('team', (m) => m.id === w.id && !m.err);
  assert.equal(mine.team, 1 - from);
  const swapped = await H.wait('team', (m) => m.id !== w.id);
  assert.equal(swapped.team, from);
  teamOf.set(w.id, mine.team);
  teamOf.set(swapped.id, swapped.team);
  assert.deepEqual(count(), [2, 2]);
  await H.wait('spawn', (m) => m.q > q && half(m.x, m.z) === 1 - from, 5000); // pojava na novoj polovici
  H.send({ t: 'team' });
  await H.wait('team', (m) => m.err && /Pričekaj/.test(m.err));
  console.log('  promjena tima: bot se zamijeni, igrač se pojavi kod novog tima, ne može se odmah opet ✔');

  // drugi čovjek ulazi: odlazi bot iz većeg tima
  const H2 = new ModeClient(port);
  const w2 = await H2.connect('Covjek2', 'tdm2');
  assert.equal(w2.mode, 'tdm', 'drugi igrač dobije način sobe');
  teamOf.set(w2.id, w2.team);
  const left = await H.wait('leave', (m) => teamOf.has(m.id) && m.id !== w.id && m.id !== w2.id, 2000);
  teamOf.delete(left.id);
  assert.deepEqual(count(), [2, 2], `nakon ulaska drugog igrača ${count()}`);
  console.log('  drugi igrač ulazi, bot iz većeg tima odlazi: i dalje 2:2 ✔');
  H.close();
  H2.close();
}

/* ------------------------------------------------------------------ zastava (CTF) */

async function ctfTests(port) {
  const A = new ModeClient(port, { mode: 'ctf' });
  const D = new ModeClient(port);
  const wA = await A.connect('Nosac', 'ctf1');
  const wD = await D.connect('Branic', 'ctf1');
  assert.equal(wA.mode, 'ctf');
  assert.equal(wA.scoreLimit, 3);
  assert.equal(wD.team, 1 - wA.team, 'drugi igrač ide u drugi tim');
  const a = wA.team;
  const enemyBase = MAP.flags[1 - a];
  const homeBase = MAP.flags[a];
  await A.wait('spawn');
  await D.wait('spawn');
  A.keepAlive();
  D.keepAlive({ s: 1 });
  await until(() => A.snap?.fl, 'fl u stanju');
  assert.deepEqual(A.snap.ts, [0, 0]);
  assert.deepEqual(A.snap.fl, MAP.flags.map(([x, z]) => [0, x, 0, z, 0]), 'obje zastave u bazi');
  A.send({ t: 'alogin', key: ADMIN_KEY });
  await A.wait('admin', (m) => m.ok);

  const take = async () => {
    await teleportNear(A, ...enemyBase);
    await A.wait('flag', (m) => m.e === 'take' && m.f === 1 - a && m.id === wA.id);
  };

  // uzimanje → nošenje → osvajanje
  await take();
  await until(() => A.snap.fl[1 - a][0] === 1 && A.snap.fl[1 - a][4] === wA.id, 'zastava nošena');
  console.log('  dodir tuđe zastave: igrač je uzima ✔');
  await teleportNear(A, ...homeBase);
  const cap = await D.wait('flag', (m) => m.e === 'cap');
  assert.equal(cap.f, 1 - a);
  assert.equal(cap.id, wA.id);
  await until(() => A.snap.ts[a] === 1 && A.snap.fl[1 - a][0] === 0, 'bod i zastava vraćena');
  assert.deepEqual(A.snap.fl[1 - a].slice(1, 4), [enemyBase[0], 0, enemyBase[1]]);
  console.log('  zastava donesena do svog postolja: +1 i zastava se vraća ✔');

  // nosač pogine: zastava pada gdje je stajao, vlasnik je vraća dodirom
  await take();
  const K = findSpot(D, 9);
  A.me = { ...A.me, x: K[0], z: K[1] };
  await sleep(600);
  D.send({ t: 'shoot', d: dirTo(eye(D), head(A)) });
  await D.wait('kill', (m) => m.v === wA.id);
  const drop = await D.wait('flag', (m) => m.e === 'drop');
  assert.equal(drop.f, 1 - a);
  await until(() => A.snap.fl[1 - a][0] === 2, 'zastava pala');
  const fl = A.snap.fl[1 - a];
  assert.ok(Math.hypot(fl[1] - K[0], fl[3] - K[1]) < 0.2 && fl[2] === 0, `zastava pala na ${fl}, a ne na ${K}`);
  console.log('  nosač pogine: zastava pada na njegovo mjesto ✔');
  await walkTo(D, ...K);
  const ret = await D.wait('flag', (m) => m.e === 'ret');
  assert.equal(ret.id, wD.id);
  assert.equal(ret.f, 1 - a);
  await until(() => A.snap.fl[1 - a][0] === 0, 'zastava u bazi');
  console.log('  suigrač vlasnika dodirne palu zastavu: vraća se u bazu ✔');

  // pala zastava se sama vraća nakon FLAG_RETURN sekundi
  await A.wait('spawn', (m) => m.q === 2, 5000);
  await sleep(1000); // da istekne zaštita nakon pojave
  await take();
  const K2 = findSpot(D, 8);
  A.me = { ...A.me, x: K2[0], z: K2[1] };
  await sleep(600);
  D.send({ t: 'shoot', d: dirTo(eye(D), head(A)) });
  await D.wait('flag', (m) => m.e === 'drop');
  const dropAt = Date.now();
  const auto = await D.wait('flag', (m) => m.e === 'ret', 6000);
  const took = (Date.now() - dropAt) / 1000;
  assert.equal(auto.id, 0, 'nitko je nije vratio');
  assert.ok(took > FLAG_RETURN - 0.3 && took < FLAG_RETURN + 1, `vratila se nakon ${took.toFixed(1)} s`);
  console.log(`  pala zastava se sama vraća (${took.toFixed(1)} s) ✔`);

  // treća zastava pobjeđuje
  await A.wait('spawn', (m) => m.q === 3, 5000);
  for (const m of A.log) m._used = true; // stari 'cap' iz prvog osvajanja ne računamo
  for (let i = 2; i <= 3; i++) {
    await take();
    await teleportNear(A, ...homeBase);
    await A.wait('flag', (m) => m.e === 'cap');
  }
  const end = await D.wait('end', () => true, 2000);
  assert.equal(end.win, a);
  assert.equal(end.ts[a], 3);
  await D.wait('reset', () => true, 5000);
  await until(() => D.snap.ts[a] === 0 && D.snap.fl.every((f) => f[0] === 0), 'nova runda: 0:0, zastave u bazi');
  console.log('  3 osvojene zastave: kraj runde s pobjedničkim timom, nova runda od 0 ✔');
  A.close();
  D.close();
}

// Popis soba u izborniku i glasanje za sljedeći način na kraju runde.
async function voteTests(port) {
  const A = new ModeClient(port, { mode: 'tdm' });
  const B = new ModeClient(port);
  const wA = await A.connect('Va', 'glas1');
  const wB = await B.connect('Vb', 'glas1');
  assert.equal(wA.mode, 'tdm');
  assert.equal(wB.mode, 'tdm', 'drugi igrač ulazi u način koji je izabrao prvi');
  const rooms = await fetch(`http://localhost:${port}/rooms`).then((r) => r.json());
  const mine = rooms.find((r) => r.code === 'glas1');
  assert.ok(mine, 'soba je na popisu');
  assert.equal(mine.mode, 'tdm');
  assert.equal(mine.players, 2);
  console.log('  /rooms: soba, način i broj igrača ✔');

  A.send({ t: 'vote', mode: 'ctf' });
  await A.none('votes', () => true, 300);
  console.log('  glas usred runde se ne broji ✔');

  A.send({ t: 'alogin', key: ADMIN_KEY });
  await A.wait('admin', (m) => m.ok);
  A.send({ t: 'admin', a: 'end' });
  const end = await B.wait('end');
  assert.equal(end.mode, 'tdm');
  A.send({ t: 'vote', mode: 'ctf' });
  B.send({ t: 'vote', mode: 'nesto' });
  B.send({ t: 'vote', mode: 'ctf' });
  await B.wait('votes', (m) => m.v.ctf === 2 && m.v.tdm === 0 && m.v.ffa === 0);
  const next = await B.wait('mode', () => true, 5000);
  assert.equal(next.mode, 'ctf');
  const reset = await B.wait('reset', () => true, 2000);
  assert.equal(reset.mode, 'ctf');
  console.log('  glasanje: 2 glasa za CTF → nova runda u CTF-u ✔');

  // izjednačeno (FFA : TDM, a trenutni je CTF) → jedan od ta dva; bez glasova ostaje isti način
  A.send({ t: 'admin', a: 'end' });
  await B.wait('end');
  for (const m of B.log) m._used = true;
  A.send({ t: 'vote', mode: 'ffa' });
  B.send({ t: 'vote', mode: 'tdm' });
  const tie = await B.wait('mode', () => true, 5000);
  assert.ok(['ffa', 'tdm'].includes(tie.mode), `izjednačeno daje ${tie.mode}`);
  A.send({ t: 'admin', a: 'end' });
  await B.wait('end');
  for (const m of B.log) m._used = true;
  const kept = await B.wait('reset', () => true, 5000);
  assert.equal(kept.mode, tie.mode);
  await B.none('mode', () => true, 300);
  console.log(`  izjednačeno → ${tie.mode}; bez glasova ostaje isti način ✔`);
  A.close();
  B.close();
}

// No-scope, slajdanje kao pravilo sobe, prihvaćanje slajda na serveru i admin slaganje timova.
async function extraTests(port) {
  const A = new ModeClient(port, { slide: false });
  const B = new ModeClient(port, { slide: true });
  const wA = await A.connect('Xa', 'extra');
  const wB = await B.connect('Xb', 'extra');
  assert.equal(wA.slide, false, 'vlasnik sobe zabranio slajdanje');
  assert.equal(wB.slide, false, 'drugi igrač ne može promijeniti pravilo sobe');
  const listed = (await fetch(`http://localhost:${port}/rooms`).then((r) => r.json())).find((r) => r.code === 'extra');
  assert.equal(listed.slide, false);
  await A.wait('spawn');
  await B.wait('spawn');
  A.keepAlive({ s: 0 });
  B.keepAlive();
  A.send({ t: 'alogin', key: ADMIN_KEY });
  await A.wait('admin', (m) => m.ok);
  A.send({ t: 'admin', a: 'slide', on: true });
  await B.wait('rules', (m) => m.slide === true && m.locked === false);
  console.log('  slajdanje: bira vlasnik sobe, vidi se u /rooms, admin ga mijenja ✔');

  // no-scope: hitac bez nišana (savršen nišan samo da sigurno pogodi)
  A.send({ t: 'admin', a: 'cheat', name: 'aim', on: true });
  await A.wait('admin', (m) => m.ok && m.cheats.aim);
  await sleep(1700);
  A.send({ t: 'shoot', d: dirTo(eye(A), [B.me.x, 1.1, B.me.z]) });
  const ns = await B.wait('kill', (m) => m.k === wA.id, 3000);
  assert.equal(ns.ns, 1, 'ubojstvo bez nišana je no-scope');
  await B.wait('spawn', (m) => m.q === 2, 5000);
  A.keepAlive({ s: 1 });
  await sleep(1800);
  A.send({ t: 'shoot', d: dirTo(eye(A), [B.me.x, 1.1, B.me.z]) });
  const scoped = await B.wait('kill', (m) => m.k === wA.id, 3000);
  assert.equal(scoped.ns, undefined, 's nišanom nije no-scope');
  console.log('  no-scope: bez nišana ns=1, s nišanom ništa ✔');

  // slajd: putanja izračunata pravom fizikom (trk pa slajd), slana 20 puta u sekundi, server je prihvaća
  await B.wait('spawn', (m) => m.q === 3, 5000);
  await sleep(300);
  clearInterval(B.timer);
  for (const m of B.log) m._used = true;
  const MAP = buildMap();
  const run = (body, dir, frame) => {
    const crouch = frame >= 70;
    stepBody(body, { wx: dir[0], wz: dir[1], sprint: !crouch, crouch, canSlide: true }, 1 / 60, MAP.boxes);
  };
  // smjer u kojem ima mjesta za trk i slajd (bez zida na putu)
  const dir = [[0, -1], [0, 1], [1, 0], [-1, 0]].find((d) => {
    const probe = createBody(B.me.x, 0, B.me.z);
    for (let f = 0; f < 150; f++) run(probe, d, f);
    return probe.slideCd > 0;
  });
  assert.ok(dir, 'ima slobodnog mjesta za slajd');
  const body = createBody(B.me.x, 0, B.me.z);
  for (let frame = 0; frame < 150; frame++) {
    run(body, dir, frame);
    if (frame % 3 === 2) {
      Object.assign(B.me, { x: body.x, y: body.y, z: body.z });
      B.update({ c: body.crouch ? 1 : 0 });
      await sleep(50);
    }
  }
  assert.ok(body.slideCd > 0, 'slajd se stvarno dogodio u simulaciji');
  await B.none('corr', () => true, 400);
  B.keepAlive();
  console.log('  server prihvaća pravi trk + slajd bez vraćanja ✔');
  A.close();
  B.close();

  // admin slaže timove
  const T = new ModeClient(port, { mode: 'tdm' });
  const U = new ModeClient(port);
  const wT = await T.connect('Ta', 'timovi');
  const wU = await U.connect('Tu', 'timovi');
  assert.notEqual(wT.team, wU.team, 'automatski u različite timove');
  T.send({ t: 'alogin', key: ADMIN_KEY });
  await T.wait('admin', (m) => m.ok);
  U.send({ t: 'admin', a: 'setteam', id: wU.id, team: wT.team });
  await T.none('team', (m) => m.id === wU.id, 300);
  T.send({ t: 'admin', a: 'setteam', id: wU.id, team: wT.team });
  await U.wait('team', (m) => m.id === wU.id && m.team === wT.team);
  T.send({ t: 'admin', a: 'lockteams', on: true });
  await U.wait('rules', (m) => m.locked === true);
  await sleep(100);
  U.send({ t: 'team' });
  const refused = await U.wait('team', (m) => !!m.err);
  assert.match(refused.err, /zaključao/);
  for (const m of U.log) m._used = true;
  T.send({ t: 'admin', a: 'shuffle' });
  await sleep(400);
  const teams = new Map([[wT.id, wT.team], [wU.id, wT.team]]);
  for (const m of U.log) if (m.t === 'team' && !m.err) teams.set(m.id, m.team);
  assert.notEqual(teams.get(wT.id), teams.get(wU.id), 'nakon miješanja dva igrača su u različitim timovima');
  console.log('  admin: prebacivanje igrača, zaključani timovi, miješanje ✔');
  T.close();
  U.close();
}

export async function run() {
  flagPlacementTests();
  const s = await startServer(BASE + 3, { SPAWNS, ADMIN_KEY, FLAG_RETURN: String(FLAG_RETURN), END_TIME: '2' });
  // soba s botovima u CTF-u vrti se usput, da se vidi da botovi s ciljevima ne ruše server
  const bots = new ModeClient(BASE + 3, { mode: 'ctf' });
  try {
    await bots.connect('Gledatelj', 'ctfbot', 4);
    await ffaTests(BASE + 3);
    await teamTests(BASE + 3);
    await botTeamTests(BASE + 3);
    await ctfTests(BASE + 3);
    await voteTests(BASE + 3);
    await extraTests(BASE + 3);
    const flagEvents = bots.log.filter((m) => m.t === 'flag').length;
    console.log(`  CTF s 4 bota: ${flagEvents} događaja sa zastavama, server bez grešaka`);
  } finally {
    bots.close();
    await sleep(100);
    s.proc.kill();
  }
  assert.equal(s.err(), '', `greške na serveru: ${s.err()}`);
}
