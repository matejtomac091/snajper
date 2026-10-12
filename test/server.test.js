// Pravi server + pravi WebSocket klijenti: pogoci, ubojstva, respawn, varanje, punjenje, runde, botovi.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Više agenata/strojeva može vrtjeti testove odjednom: TEST_PORT_BASE=3201 node test/run.js
const BASE = Number(process.env.TEST_PORT_BASE) || 3101;

export function startServer(port, env = {}) {
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errOut = '';
  proc.stderr.on('data', (d) => { errOut += d; });
  return new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (String(d).includes('radi na')) resolve({ proc, err: () => errOut }); });
    proc.on('exit', (code) => reject(new Error(`server je pao (${code}): ${errOut}`)));
    setTimeout(() => reject(new Error('server se nije pokrenuo')), 5000);
  });
}

export class Client {
  constructor(port) {
    this.port = port;
    this.log = [];
    this.waiters = [];
  }

  connect(name, room, bots = 0) {
    this.ws = new WebSocket(`ws://localhost:${this.port}/ws`);
    this.ws.on('message', (data) => {
      const m = JSON.parse(data);
      if (m.t === 's') { this.snap = m; return; }
      this.log.push(m);
      if (m.t === 'spawn') this.me = { x: m.x, y: m.y, z: m.z, q: m.q };
      this.waiters = this.waiters.filter((w) => {
        if (w.type === m.t && w.pred(m)) { w.resolve(m); return false; }
        return true;
      });
    });
    return new Promise((resolve) => {
      this.ws.on('open', async () => {
        this.send({ t: 'join', name, room, bots });
        this.welcome = await this.wait('welcome');
        resolve(this.welcome);
      });
    });
  }

  send(m) { this.ws.send(JSON.stringify(m)); }

  wait(type, pred = () => true, timeout = 6000) {
    const found = this.log.find((m) => m.t === type && pred(m) && !m._used);
    if (found) { found._used = true; return Promise.resolve(found); }
    return new Promise((resolve, reject) => {
      const w = { type, pred, resolve: (m) => { m._used = true; clearTimeout(timer); resolve(m); } };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new Error(`nije stiglo "${type}" u ${timeout} ms`));
      }, timeout);
      this.waiters.push(w);
    });
  }

  none(type, pred, ms) {
    for (const m of this.log) m._used = true; // gledamo samo poruke koje tek stignu
    return this.wait(type, pred, ms).then(() => { throw new Error(`stiglo je "${type}", a nije trebalo`); }, () => true);
  }

  update(extra = {}) {
    this.send({ t: 'u', x: this.me.x, y: this.me.y, z: this.me.z, yaw: 0, pitch: 0, c: 0, g: 1, s: 0, q: this.me.q, ...extra });
  }

  keepAlive(extra) {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.update(extra), 50);
  }

  close() { clearInterval(this.timer); this.ws.close(); }
}

export function dirTo(from, to) {
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const l = Math.hypot(...d);
  return d.map((v) => v / l);
}

async function httpTests(port) {
  const base = `http://localhost:${port}`;
  const get = (p) => fetch(base + p).then(async (r) => ({ status: r.status, type: r.headers.get('content-type'), body: await r.text() }));
  assert.equal((await get('/health')).body, 'ok');
  const index = await get('/');
  assert.equal(index.status, 200);
  assert.match(index.type, /text\/html/);
  assert.equal((await get('/three/three.module.js')).status, 200);
  assert.equal((await get('/three/three.core.js')).status, 200);
  assert.match((await get('/shared/config.js')).type, /javascript/);
  assert.notEqual((await get('/..%2fserver.js')).status, 200, 'ne smije poslužiti server.js');
  assert.notEqual((await get('/three/..%2f..%2fpackage.json')).status, 200, 'ne smije izaći iz three mape');
  assert.equal((await get('/nepostoji.js')).status, 404);
  console.log('  http: stranica, three.js, zaštita putanja ✔');
}

async function combatTests(port) {
  const A = new Client(port);
  const B = new Client(port);
  await A.connect('Ana', 'test1');
  const wB = await B.connect('<ana>', 'test1');
  const bName = wB.players.find((p) => p.id === wB.id).name;
  assert.equal(bName, 'ana 2', `ime je očišćeno i jedinstveno: "${bName}"`);
  await A.wait('spawn');
  await B.wait('spawn');
  assert.deepEqual([A.me.x, A.me.z], [-64, -45]);
  assert.deepEqual([B.me.x, B.me.z], [-64, -25]);
  A.keepAlive({ s: 1 });
  B.keepAlive();

  // zaštita nakon pojave: pogodak ne prolazi
  await sleep(300);
  const eyeA = [A.me.x, 1.6, A.me.z];
  A.send({ t: 'shoot', d: dirTo(eyeA, [B.me.x, 1.56, B.me.z]) });
  const s0 = await A.wait('shot');
  assert.equal(s0.h, 0, 'zaštićen igrač ne prima pogodak');
  console.log('  zaštita nakon pojave ✔');

  // headshot nakon repetiranja i isteka zaštite
  await sleep(1500);
  A.send({ t: 'shoot', d: dirTo(eyeA, [B.me.x, 1.56, B.me.z]) });
  const hit = await A.wait('hit');
  assert.equal(hit.part, 'head');
  assert.equal(hit.kill, true);
  const dmg = await B.wait('dmg');
  assert.equal(dmg.hp, 0);
  const kill = await B.wait('kill');
  assert.equal(kill.k, A.welcome.id);
  assert.equal(kill.hs, true);
  assert.equal(kill.kk, 1);
  console.log('  headshot ubija iz jednog metka ✔');

  // repetiranje: odmah drugi metak se odbija
  A.send({ t: 'shoot', d: [0, 0, 1] });
  await A.none('shot', () => true, 400);
  console.log('  repetiranje između metaka ✔');

  // varanje: teleport se vraća
  A.send({ t: 'u', x: A.me.x + 30, y: 0, z: A.me.z, yaw: 0, pitch: 0, c: 0, g: 1, s: 1, q: A.me.q });
  const corr = await A.wait('corr');
  assert.equal(corr.x, A.me.x);
  console.log('  teleport se odbija ✔');

  // respawn
  const sp = await B.wait('spawn', (m) => m.q === 2, 5000);
  assert.deepEqual([sp.x, sp.z], [-64, -25]);
  console.log('  ponovna pojava nakon 3 s ✔');

  // snajper ubija iz jednog pogotka i kad pogodi tijelo
  await sleep(1700);
  A.send({ t: 'shoot', d: dirTo(eyeA, [B.me.x, 1.1, B.me.z]) });
  const hit2 = await A.wait('hit');
  assert.equal(hit2.part, 'body');
  assert.equal(hit2.kill, true);
  assert.equal((await B.wait('dmg')).hp, 0);
  console.log('  pogodak u tijelo ubija iz jednog metka ✔');

  // punjenje: dok traje, pucanje se odbija
  A.send({ t: 'reload' });
  await sleep(1300);
  A.send({ t: 'shoot', d: [0, 0, 1] });
  await A.none('shot', () => true, 400);
  await sleep(800);
  A.send({ t: 'shoot', d: [0, -0.2, 0.98] });
  await A.wait('shot', () => true, 1000);
  console.log('  punjenje blokira pucanje 2.3 s ✔');

  // kraj runde i nova runda
  const end = await A.wait('end', () => true, 15000);
  assert.equal(end.board[0].name, 'Ana');
  assert.equal(end.board[0].kills, 2);
  A.send({ t: 'shoot', d: [0, 0, 1] });
  await A.none('shot', () => true, 1300);
  await A.wait('reset', () => true, 5000);
  await A.wait('spawn', (m) => m.q === 2, 3000);
  console.log('  kraj runde, rezultati i nova runda ✔');

  // admin bez lozinke na serveru je isključen
  A.send({ t: 'alogin', key: 'bilo-sto' });
  const noAdmin = await A.wait('admin');
  assert.equal(noAdmin.ok, false);
  assert.match(noAdmin.msg, /ADMIN_KEY/);
  console.log('  bez ADMIN_KEY nema admina ✔');

  // trčanje (8.2 m/s) server prihvaća, a 20 m/s vraća natrag (rezerva od 4 m za trzaje mreže brzo se potroši)
  await sleep(300);
  for (const m of A.log) m._used = true;
  const homeX = A.me.x;
  for (let i = 0; i < 20; i++) {
    A.me.x = homeX + (i % 2 ? 0 : 0.4); // 0.4 m svakih 50 ms = 8 m/s
    await sleep(50);
  }
  await A.none('corr', () => true, 300);
  for (let i = 0; i < 20; i++) {
    A.me.x = homeX + (i % 2 ? 0 : 1.0); // 20 m/s
    await sleep(50);
  }
  await A.wait('corr', () => true, 1500);
  A.me.x = homeX;
  console.log('  trčanje 8 m/s prihvaćeno, 20 m/s odbijeno ✔');

  // izlazak
  B.close();
  await A.wait('leave', (m) => m.id === wB.id);
  A.close();
  console.log('  izlazak igrača ✔');
}

async function botTests(port) {
  const C = new Client(port);
  await C.connect('Tester', 'vjezba', 3);
  await C.wait('spawn');
  C.keepAlive();
  await sleep(1500);
  assert.equal(C.snap.p.length, 4, `ja + 3 bota, a vidim ${C.snap.p.length}`);
  const ids = C.snap.p.map((p) => p[0]).filter((id) => id !== C.welcome.id);
  const travelled = new Map(ids.map((id) => [id, 0]));
  let prev = new Map(C.snap.p.map((p) => [p[0], [p[1], p[3]]]));
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    const cur = new Map(C.snap.p.map((p) => [p[0], [p[1], p[3]]]));
    for (const id of ids) {
      const a = prev.get(id), b = cur.get(id);
      if (a && b) travelled.set(id, travelled.get(id) + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    prev = cur;
  }
  const moved = ids.filter((id) => travelled.get(id) > 3);
  assert.ok(moved.length >= 2, `botovi se kreću (pomaknulo se ${moved.length}/3)`);
  console.log(`  botovi: 3 u sobi, ${moved.length} se kreće ✔`);

  // drugi čovjek ulazi: jedan bot mora otići
  const D = new Client(port);
  await D.connect('Drugi', 'vjezba');
  await C.wait('leave', (m) => ids.includes(m.id), 2000);
  console.log('  bot odlazi kad uđe pravi igrač ✔');

  // botovi pucaju kad nekoga vide (ne mora se dogoditi u kratkom testu, samo bilježimo)
  await sleep(12000);
  const botShots = C.log.filter((m) => m.t === 'shot' && ids.includes(m.id)).length;
  const kills = C.log.filter((m) => m.t === 'kill').length;
  console.log(`  botovi u 12 s: ${botShots} hitaca, ${kills} ubojstava`);
  C.close();
  D.close();
}

async function adminTests(port) {
  const A = new Client(port);
  const M = new Client(port);
  await A.connect('Igrac', 'adm');
  await M.connect('Matej', 'adm');
  await A.wait('spawn');
  await M.wait('spawn');
  A.keepAlive({ s: 1 });
  M.keepAlive({ s: 1 });

  A.send({ t: 'admin', a: 'restart' });
  await A.none('reset', () => true, 500);
  console.log('  obični igrač ne može admin naredbe ✔');

  M.send({ t: 'alogin', key: 'krivo' });
  const bad = await M.wait('admin');
  assert.equal(bad.ok, false);
  assert.match(bad.msg, /Kriva/);
  M.send({ t: 'alogin', key: 'tajna-123' });
  await M.wait('admin', (m) => m.ok);
  console.log('  kriva lozinka odbijena, prava prolazi ✔');

  M.send({ t: 'admin', a: 'cheat', name: 'god', on: true });
  await M.wait('admin', (m) => m.ok && m.cheats.god);
  await sleep(1600);
  A.send({ t: 'shoot', d: dirTo([A.me.x, 1.6, A.me.z], [M.me.x, 1.56, M.me.z]) });
  const h = await A.wait('hit');
  assert.equal(h.kill, false);
  await M.none('dmg', () => true, 300);
  console.log('  besmrtnost: headshot ne ubija admina ✔');

  M.send({ t: 'admin', a: 'cheat', name: 'rapid', on: true });
  M.send({ t: 'admin', a: 'cheat', name: 'ammo', on: true });
  await M.wait('admin', (m) => m.ok && m.cheats.rapid && m.cheats.ammo);
  const before = M.log.filter((m) => m.t === 'shot' && m.id === M.welcome.id).length;
  for (let i = 0; i < 8; i++) {
    M.send({ t: 'shoot', d: [1, -0.05, 0] });
    await sleep(200);
  }
  await sleep(200);
  const fired = M.log.filter((m) => m.t === 'shot' && m.id === M.welcome.id).length - before;
  assert.equal(fired, 8, `brza paljba + beskonačni meci: ${fired}/8 hitaca`);
  console.log('  brza paljba i beskonačni meci: 8 hitaca u 1.6 s ✔');

  M.send({ t: 'shoot', d: dirTo([M.me.x, 1.6, M.me.z], [A.me.x, 0.4, A.me.z]) });
  const legs = await M.wait('hit', (m) => m.part === 'legs');
  assert.equal(legs.kill, true);
  console.log('  pogodak u noge ubija iz jednog metka ✔');

  // Eksplozivni pištolj. Admin ima savršen nišan (test ne ovisi o sreći) i nema besmrtnost,
  // da se vidi da ga vlastita eksplozija ne ozljeđuje. A stoji na (-40, -20.8), 0.9 m južno od zida z=-22.
  const mid = M.welcome.id;
  M.send({ t: 'admin', a: 'cheat', name: 'god', on: false });
  M.send({ t: 'admin', a: 'cheat', name: 'aim', on: true });
  M.send({ t: 'admin', a: 'cheat', name: 'pistol', on: true });
  await M.wait('admin', (m) => m.ok && !m.cheats.god && m.cheats.aim && m.cheats.pistol);
  await A.wait('spawn', (m) => m.q === 2, 5000);
  await sleep(1700);
  for (const m of A.log) m._used = true;
  for (const m of M.log) m._used = true;
  M.send({ t: 'shoot', d: dirTo([M.me.x, 1.6, M.me.z], [A.me.x, 0, A.me.z + 2]), w: 'pistol' });
  const ps = await A.wait('shot', (m) => m.id === mid);
  assert.equal(ps.w, 'p');
  assert.equal(ps.h, 0, 'metak je pao u tlo, nije izravno pogodio');
  const boom = await A.wait('boom', (m) => m.by === mid);
  assert.equal(boom.r, 3.5);
  const off = Math.hypot(boom.x - A.me.x, boom.z - A.me.z);
  assert.ok(off > 1.5 && off < 2.5, `eksplozija ${off.toFixed(2)} m od mete`);
  const pk = await A.wait('kill', (m) => m.v === A.welcome.id, 2000);
  assert.equal(pk.k, mid);
  assert.equal(pk.w, 'pistol');
  await M.wait('hit', (m) => m.part === 'blast' && m.kill);
  console.log(`  pištolj: metak u tlo ${off.toFixed(1)} m od igrača ga raznese (radius ${boom.r} m) ✔`);

  // zid štiti: admin se teleportira na drugu stranu zida i puca u tlo tik uz zid
  await A.wait('spawn', (m) => m.q === 3, 5000);
  await sleep(1700);
  M.me = { ...M.me, z: -30 };
  M.update();
  let mark = A.log.length;
  M.send({ t: 'shoot', d: dirTo([M.me.x, 1.6, M.me.z], [A.me.x, 0, -23]), w: 'pistol' });
  const wb = await A.wait('boom', (m) => m.by === mid);
  const reach = Math.hypot(wb.x - A.me.x, wb.y - 1.1, wb.z - A.me.z);
  assert.ok(reach < 3.5, `eksplozija mora biti unutar radiusa (${reach.toFixed(2)} m)`);
  await sleep(500);
  assert.ok(!A.log.slice(mark).some((m) => m.t === 'kill' || m.t === 'dmg'), 'zid je trebao zaštititi igrača');
  console.log(`  zid štiti od eksplozije (${reach.toFixed(1)} m, ali iza zida) ✔`);

  // treće ubojstvo zaredom (puškom) puni eksplozivni pištolj na 8 metaka
  M.send({ t: 'admin', a: 'cheat', name: 'pistol', on: false });
  await M.wait('admin', (m) => m.ok && !m.cheats.pistol);
  M.me = { ...M.me, z: -10 };
  M.update();
  M.send({ t: 'shoot', d: dirTo([M.me.x, 1.6, M.me.z], [A.me.x, 1.1, A.me.z]) });
  const award = await M.wait('pistol', (m) => m.n === 8, 3000);
  assert.equal(award.n, 8);
  await A.wait('streak', (m) => m.id === mid && m.n === 3, 2000);
  console.log('  niz od 3 ubojstva daje eksplozivni pištolj s 8 metaka ✔');

  // drži pištolj: drugi vide zastavicu 8, a nišan (2) se ne pali ni kad ga klijent traži
  M.keepAlive({ s: 1, h: 1 });
  await sleep(300);
  const row = A.snap.p.find((p) => p[0] === mid);
  assert.equal(row[6] & 8, 8, 'zastavica 8: drži pištolj');
  assert.equal(row[6] & 2, 0, 'pištolj nema nišan');

  // Hitac odmah za hicem se odbija (0.3 s) i server javi pravo stanje (7). Svaki hitac troši metak,
  // deveti ne prolazi. Admin bez besmrtnosti puca sebi pod noge: vlastita eksplozija ga ne ozljeđuje.
  for (const m of M.log) m._used = true;
  mark = M.log.length;
  const down = [0, -1, 0];
  M.send({ t: 'shoot', d: down, w: 'pistol' });
  M.send({ t: 'shoot', d: down, w: 'pistol' });
  const resync = await M.wait('pistol', () => true, 2000);
  assert.equal(resync.n, 7, 'drugi hitac unutar 0.3 s se odbija, prvi troši metak');
  for (let i = 0; i < 7; i++) {
    await sleep(350);
    M.send({ t: 'shoot', d: down, w: 'pistol' });
  }
  await M.wait('pistol', (m) => m.n === 0, 2000);
  await sleep(350);
  M.send({ t: 'shoot', d: down, w: 'pistol' });
  await sleep(400);
  const after = M.log.slice(mark);
  const pShots = after.filter((m) => m.t === 'shot' && m.id === mid).length;
  const pBooms = after.filter((m) => m.t === 'boom' && m.by === mid).length;
  assert.equal(pShots, 8, `8 metaka, a prošlo je ${pShots}`);
  assert.equal(pBooms, 8);
  assert.ok(!after.some((m) => m.t === 'dmg' || (m.t === 'kill' && m.v === mid)), 'vlastita eksplozija ne smije ozlijediti strijelca');
  assert.equal(A.snap.p.find((p) => p[0] === mid)[6] & 8, 0, 'bez metaka opet drži pušku');
  console.log('  pištolj: razmak 0.3 s, 8 metaka pa kraj, strijelac neozlijeđen ✔');
  M.keepAlive({ s: 1 });
  M.send({ t: 'admin', a: 'cheat', name: 'god', on: true });
  await M.wait('admin', (m) => m.ok && m.cheats.god);

  M.send({ t: 'u', x: M.me.x, y: 30, z: M.me.z, yaw: 0, pitch: 0, c: 0, g: 0, s: 0, q: M.me.q });
  await M.none('corr', () => true, 300);
  console.log('  admin smije letjeti ✔');

  M.send({ t: 'admin', a: 'bots', n: 2 });
  await M.wait('join', (m) => m.bot, 2000);
  await M.wait('join', (m) => m.bot, 2000);
  console.log('  admin dodaje botove ✔');

  M.send({ t: 'admin', a: 'say', text: 'Pozdrav razrede' });
  await A.wait('announce', (m) => m.text === 'Pozdrav razrede');
  console.log('  poruka svima ✔');

  const closed = new Promise((resolve) => A.ws.on('close', resolve));
  M.send({ t: 'admin', a: 'kick', id: A.welcome.id });
  await A.wait('kicked');
  await closed;
  console.log('  admin izbacuje igrača ✔');
  A.close();
  M.close();
}

export async function run() {
  const s1 = await startServer(BASE, { SPAWNS: '-64,-45;-64,-25', MATCH_TIME: '16', END_TIME: '3' });
  try {
    await httpTests(BASE);
    await combatTests(BASE);
  } finally {
    s1.proc.kill();
  }
  assert.equal(s1.err(), '', `greške na serveru: ${s1.err()}`);

  // A se pojavi 0.9 m južno od zida na z=-22 (test eksplozije iza zida), M 10.8 m južnije, s čistim pogledom.
  const s3 = await startServer(BASE + 2, { SPAWNS: '-40,-20.8;-40,-10', ADMIN_KEY: 'tajna-123' });
  try {
    await adminTests(BASE + 2);
  } finally {
    s3.proc.kill();
  }
  assert.equal(s3.err(), '', `greške na serveru: ${s3.err()}`);

  const s2 = await startServer(BASE + 1);
  try {
    await botTests(BASE + 1);
  } finally {
    s2.proc.kill();
  }
  assert.equal(s2.err(), '', `greške na serveru: ${s2.err()}`);
}
