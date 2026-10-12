// Snajper — server. Poslužuje igru i vodi sobe preko WebSocketa.
// Server odlučuje o svemu što je bitno (pogoci, šteta, bodovi), pa varanje u pregledniku ne pomaže puno.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  TICK_RATE, INTERP_DELAY, MAX_HP, RESPAWN_TIME, SPAWN_PROTECT, MATCH_TIME, END_TIME,
  MAX_PLAYERS, MAX_BOTS, P, W, SKINS, PISTOL, spreadFor, pistolSpread, eyeHeight, aimDir,
  MODES, SCORE_LIMIT, FLAG,
} from './public/shared/config.js';
import { buildMap } from './public/shared/map.js';
import { createBody, stepBody, blocked } from './public/shared/physics.js';
import { rayWorld, rayHitbox } from './public/shared/ray.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three', 'build');
const THREE_ADDONS_DIR = path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm');
const PORT = Number(process.env.PORT) || 3000;
const MATCH_SECONDS = Number(process.env.MATCH_TIME) || MATCH_TIME;
const END_SECONDS = Number(process.env.END_TIME) || END_TIME;
// Lozinka za admin panel. Postavlja se na Renderu (Environment → ADMIN_KEY), nikad u kodu jer je repozitorij javan.
const ADMIN_KEY = String(process.env.ADMIN_KEY || '');
const CHEATS = ['god', 'ammo', 'rapid', 'aim', 'speed', 'fly', 'wall', 'pistol'];
const RAPID_COOLDOWN = 150; // ms
const PISTOL_SLACK = 100;   // ms tolerancije na razmak između metaka pištolja (mreža zna zgusnuti poruke)

const MAP = buildMap();
const BOXES = MAP.boxes;
if (process.env.SPAWNS) {
  // samo za testove: "x,z;x,z"
  MAP.spawns = process.env.SPAWNS.split(';').map((s) => s.split(',').map(Number));
}
const FLAG_RETURN = Number(process.env.FLAG_RETURN) || FLAG.returnTime; // s, testovi ga skrate
const TEAM_SWITCH_GAP = 5000; // ms između dvije promjene tima
const MAX_Y = 9.5;
const BOT_RANGE = 95;
// Botovi su namjerno sporiji od dobrog igrača: kasnije primijete, sporije okreću i duže ciljaju.
const BOT = {
  scanEvery: 450, scanJitter: 300,   // ms između "pogleda oko sebe"
  react: 1400, reactJitter: 1200,    // ms od kad te vidi do prvog hica
  turnRate: 3.2,                     // rad/s okretanja prema meti
  pitchRate: 4,
  aimTolerance: 0.035,               // rad: koliko točno mora naciljati prije hica
};
const BOT_NAMES = ['Bot Ivo', 'Bot Ana', 'Bot Luka', 'Bot Mia', 'Bot Toni', 'Bot Sara', 'Bot Dino', 'Bot Lea'];

const now = () => performance.now();
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
const turn = (a, b, max) => a + clamp(angDiff(a, b), -max, max);

/* ------------------------------------------------------------------ HTTP */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (pathname === '/rooms') {
    // Izbornik pokazuje aktivne sobe i njihov način, da se zna u što ulaziš.
    const list = [...rooms.values()]
      .map((r) => ({
        code: r.code, mode: r.mode, slide: r.allowSlide, players: r.humans(), bots: r.players.size - r.humans(), state: r.state,
      }))
      .sort((a, b) => b.players - a.players)
      .slice(0, 20);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(list));
    return;
  }
  if (pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  let base = PUBLIC_DIR;
  let rel = pathname;
  if (pathname.startsWith('/three/')) {
    base = THREE_DIR;
    rel = pathname.slice('/three'.length);
  } else if (pathname.startsWith('/three-addons/')) {
    base = THREE_ADDONS_DIR;
    rel = pathname.slice('/three-addons'.length);
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(base, rel);
  if (!file.startsWith(base + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Nema te stranice');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': base === PUBLIC_DIR ? 'no-cache' : 'public, max-age=604800',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(serveStatic);

/* ------------------------------------------------------------------ sobe i igrači */

const rooms = new Map();

class Room {
  constructor(code, botFill, mode = 'ffa', allowSlide = true) {
    this.code = code;
    this.players = new Map();
    this.nextId = 1;
    this.botFill = botFill;
    this.botSerial = 0;
    this.state = 'play';
    this.timeLeft = MATCH_SECONDS;
    this.endAt = 0;
    this.mode = mode;
    this.teamScore = [0, 0];
    this.flags = mode === 'ctf' ? makeFlags() : null;
    this.votes = new Map();
    // Slajdanje bira onaj tko otvori sobu (admin ga može mijenjati). Fizika se vrti u pregledniku,
    // pa server ovo ne može potpuno provesti; slajd ionako ne daje više od brzine trčanja.
    this.allowSlide = allowSlide;
  }

  humans() {
    let n = 0;
    for (const p of this.players.values()) if (!p.bot) n++;
    return n;
  }

  broadcast(msg, except) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) if (p !== except) sendRaw(p, s);
  }
}

function sendRaw(p, s) {
  if (p.ws && p.ws.readyState === WebSocket.OPEN) p.ws.send(s);
}

function send(p, msg) {
  if (p.ws) sendRaw(p, JSON.stringify(msg));
}

function cleanName(s) {
  const n = String(s ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} _.\-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  return n || 'Igrač';
}

function cleanRoom(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'razred';
}

function uniqueName(room, name) {
  const taken = new Set([...room.players.values()].map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) {
    const n = `${name.slice(0, 13)} ${i}`;
    if (!taken.has(n.toLowerCase())) return n;
  }
}

function makePlayer(room, name, ws, bot, skin = 'klasik') {
  const id = room.nextId++;
  const t = now();
  const p = {
    id, ws, bot,
    name: uniqueName(room, name),
    hue: Math.round((id * 137.508) % 360),
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    crouch: false, ground: true, scoped: false, scopeStart: 0,
    hp: MAX_HP, alive: false, kills: 0, deaths: 0,
    respawnAt: t, protectUntil: 0,
    ammo: W.mag, reloadUntil: 0, lastShot: -1e9,
    spawnSeq: 0, lastMove: t, budget: 0, hist: [], rtt: 80, strikes: 0,
    admin: false, adminTries: 0, cheats: {},
    skin: SKINS.includes(skin) ? skin : 'klasik', streak: 0,
    pistolAmmo: 0, pistolLastShot: -1e9, holding: 'rifle',
    team: isTeamMode(room) ? pickTeam(room) : null, teamSwitchAt: -1e9,
    body: null,
    ai: bot ? {
      target: null, readyAt: 0, nextScan: 0, nextShotGap: 0, goal: null, goalUntil: 0,
      stuckCheck: 0, stuck: 0, lastX: 0, lastZ: 0, strafeDir: 1, strafeUntil: 0, crouchToShoot: false,
      detourUntil: 0,
    } : null,
  };
  room.players.set(id, p);
  return p;
}

function roster(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id, name: p.name, hue: p.hue, kills: p.kills, deaths: p.deaths, bot: p.bot, skin: p.skin, team: p.team,
  }));
}

/* ------------------------------------------------------------------ načini igre i timovi */

function isTeamMode(room) {
  return room.mode === 'tdm' || room.mode === 'ctf';
}

// Prijateljske vatre nema: u timskim načinima suigrača ne ozljeđuje ni metak ni eksplozija.
function canHurt(room, from, to) {
  return !(isTeamMode(room) && from.team === to.team);
}

function teamCounts(room) {
  const n = [0, 0];
  for (const p of room.players.values()) if (p.team !== null) n[p.team]++;
  return n;
}

// Novi igrač (i bot) ide u manji tim, a kad su jednaki, nasumično.
function pickTeam(room) {
  const n = teamCounts(room);
  if (n[0] !== n[1]) return n[0] < n[1] ? 0 : 1;
  return Math.random() < 0.5 ? 0 : 1;
}

// Kod promjene načina: ljudi se izmjenično dijele u timove, a botovi popune manji tim.
function assignTeams(room) {
  const all = [...room.players.values()];
  for (const p of all) p.team = null;
  if (!isTeamMode(room)) return;
  const humans = all.filter((p) => !p.bot).sort(() => Math.random() - 0.5);
  const first = Math.random() < 0.5 ? 0 : 1;
  humans.forEach((p, i) => { p.team = (first + i) % 2; });
  for (const p of all) if (p.bot) p.team = pickTeam(room);
}

function scoreLimit(room) {
  return SCORE_LIMIT[room.mode] || 0;
}

function winningTeam(room) {
  const [r, b] = room.teamScore;
  return r > b ? 0 : b > r ? 1 : -1;
}

function addTeamScore(room, team) {
  if (room.state === 'play' && team !== null) room.teamScore[team]++;
}

function setMode(room, mode, t) {
  room.mode = mode;
  room.flags = mode === 'ctf' ? makeFlags() : null;
  assignTeams(room);
  room.broadcast({ t: 'mode', mode, lim: scoreLimit(room), players: roster(room) });
  resetMatch(room, t);
}

function setTeam(room, p, team, t) {
  dropFlag(room, p, t);
  p.team = team;
  room.broadcast({ t: 'team', id: p.id, team });
  if (p.alive && room.state === 'play') spawn(room, p);
}

// "Promijeni tim" iz menija. Ako bi timovi bili neravnopravni, s igračem se zamijeni bot iz drugog tima.
function onTeamSwitch(room, p, t) {
  if (!isTeamMode(room) || p.team === null) return;
  const refuse = (err) => send(p, { t: 'team', id: p.id, team: p.team, err });
  if (t - p.teamSwitchAt < TEAM_SWITCH_GAP) {
    refuse('Pričekaj malo prije nove promjene tima.');
    return;
  }
  const from = p.team;
  const to = 1 - from;
  const n = teamCounts(room);
  let swap = null;
  if (Math.abs(n[to] + 1 - (n[from] - 1)) > 1) {
    swap = [...room.players.values()].reverse().find((o) => o.bot && o.team === to);
    if (!swap) {
      refuse('Ne može: timovi bi bili neravnopravni.');
      return;
    }
  }
  p.teamSwitchAt = t;
  setTeam(room, p, to, t);
  if (swap) setTeam(room, swap, from, t);
}

/* ------------------------------------------------------------------ zastave (CTF) */

// state: 0 u bazi, 1 netko je nosi, 2 ispuštena na tlu
function makeFlags() {
  return MAP.flags.map(([x, z], team) => ({ team, state: 0, x, y: 0, z, carrier: null, dropAt: 0 }));
}

function flagEvent(room, f, e, p) {
  room.broadcast({ t: 'flag', e, f: f.team, id: p ? p.id : 0 });
}

function returnFlag(room, f, p) {
  [f.x, f.z] = MAP.flags[f.team];
  f.y = 0;
  f.state = 0;
  f.carrier = null;
  flagEvent(room, f, 'ret', p);
}

// Nosač je umro, izašao ili promijenio tim: zastava pada na tlo ispod mjesta gdje je stajao.
function dropFlag(room, p, t) {
  if (!room.flags) return;
  for (const f of room.flags) {
    if (f.carrier !== p) continue;
    f.state = 2;
    f.carrier = null;
    f.dropAt = t;
    f.x = p.x;
    f.z = p.z;
    f.y = Math.max(0, p.y + 0.1 - rayWorld(BOXES, p.x, p.y + 0.1, p.z, 0, -1, 0, 60));
    flagEvent(room, f, 'drop', p);
  }
}

function touches(p, x, y, z) {
  return Math.hypot(p.x - x, p.z - z) <= FLAG.touch && Math.abs(p.y - y) <= 2;
}

function tickFlags(room, t) {
  for (const f of room.flags) {
    if (f.state === 1) {
      f.x = f.carrier.x;
      f.y = f.carrier.y;
      f.z = f.carrier.z;
    } else if (f.state === 2 && t - f.dropAt >= FLAG_RETURN * 1000) {
      returnFlag(room, f, null);
    }
  }
  for (const p of room.players.values()) {
    if (!p.alive || p.team === null) continue;
    for (const f of room.flags) {
      if (f.state === 1 || !touches(p, f.x, f.y, f.z)) continue;
      if (f.team !== p.team) {
        f.state = 1;
        f.carrier = p;
        flagEvent(room, f, 'take', p);
      } else if (f.state === 2) {
        returnFlag(room, f, p);
      }
    }
    // Osvajanje: tuđa zastava donesena do vlastitog postolja dok je vlastita zastava u bazi.
    const own = room.flags[p.team];
    const enemy = room.flags[1 - p.team];
    if (enemy.carrier === p && own.state === 0 && touches(p, own.x, own.y, own.z)) {
      addTeamScore(room, p.team);
      room.broadcast({ t: 'flag', e: 'cap', f: enemy.team, id: p.id });
      [enemy.x, enemy.z] = MAP.flags[enemy.team];
      enemy.y = 0;
      enemy.state = 0;
      enemy.carrier = null;
    }
  }
}

function flagSnap(room) {
  return room.flags.map((f) => [f.state, r2(f.x), r2(f.y), r2(f.z), f.carrier ? f.carrier.id : 0]);
}

// Poziva se nakon svakog ubojstva: bod timu u TDM-u, ispuštanje zastave u CTF-u.
function onKillModes(room, from, to, t) {
  if (room.mode === 'tdm' && from.team !== to.team) addTeamScore(room, from.team);
  dropFlag(room, to, t);
}

/* ------------------------------------------------------------------ pojava i povijest položaja */

// U timskim načinima: samo mjesta na polovici svog tima (crveni x+z<0, plavi x+z>0),
// najdalje od protivnika, a ne na suigraču. Inače najdalje od svih.
function pickSpawn(room, self) {
  const others = [...room.players.values()].filter((o) => o !== self && o.alive);
  const team = isTeamMode(room) ? self.team : null;
  let spots = MAP.spawns;
  if (team !== null) {
    const half = spots.filter(([x, z]) => (team === 0 ? x + z < 0 : x + z > 0));
    if (half.length) spots = half;
  }
  const scored = spots
    .map(([x, z]) => {
      let d = Infinity;
      let taken = false;
      for (const o of others) {
        const dist = Math.hypot(o.x - x, o.z - z);
        if (team !== null && o.team === team) taken ||= dist < 2;
        else d = Math.min(d, dist);
      }
      return { x, z, d: taken ? -1 : d };
    })
    .sort((a, b) => b.d - a.d);
  const choices = process.env.SPAWNS ? 1 : Math.min(3, scored.length);
  return scored[Math.floor(Math.random() * choices)];
}

function spawn(room, p) {
  const s = pickSpawn(room, p);
  const t = now();
  Object.assign(p, {
    x: s.x, y: 0, z: s.z, yaw: Math.atan2(s.x, s.z), pitch: 0,
    crouch: false, ground: true, scoped: false, holding: 'rifle',
    hp: MAX_HP, alive: true, ammo: W.mag, reloadUntil: 0, lastShot: -1e9,
    protectUntil: t + SPAWN_PROTECT * 1000, lastMove: t, budget: 2,
  });
  p.spawnSeq++;
  p.hist = [{ t, x: p.x, y: p.y, z: p.z, c: false }];
  if (p.bot) {
    p.body = createBody(p.x, 0, p.z);
    p.ai.goal = null;
    p.ai.target = null;
  }
  send(p, { t: 'spawn', x: p.x, y: 0, z: p.z, yaw: r3(p.yaw), q: p.spawnSeq, prot: SPAWN_PROTECT });
}

function pushHist(p, t) {
  p.hist.push({ t, x: p.x, y: p.y, z: p.z, c: p.crouch });
  while (p.hist.length > 2 && t - p.hist[0].t > 1000) p.hist.shift();
}

// Gdje je igrač bio u trenutku t. Strijelac vidi druge malo u prošlosti, pa pogotke provjeravamo tamo.
function posAt(p, t) {
  const h = p.hist;
  if (!h.length || t >= h[h.length - 1].t) return { x: p.x, y: p.y, z: p.z, c: p.crouch };
  if (t <= h[0].t) return h[0];
  for (let i = h.length - 1; i > 0; i--) {
    const a = h[i - 1];
    const b = h[i];
    if (t >= a.t) {
      const k = (t - a.t) / (b.t - a.t || 1);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, c: k < 0.5 ? a.c : b.c };
    }
  }
  return h[0];
}

function speedOf(p) {
  const h = p.hist;
  if (h.length < 2) return 0;
  const last = h[h.length - 1];
  let first = h[0];
  for (let i = h.length - 1; i >= 0; i--) {
    if (last.t - h[i].t >= 200) {
      first = h[i];
      break;
    }
  }
  const dt = (last.t - first.t) / 1000;
  if (dt < 0.05) return 0;
  return Math.hypot(last.x - first.x, last.z - first.z) / dt;
}

/* ------------------------------------------------------------------ poruke igrača */

function onUpdate(p, m) {
  if (!p.alive || m.q !== p.spawnSeq) return;
  const x = +m.x, y = +m.y, z = +m.z, yaw = +m.yaw, pitch = +m.pitch;
  if (![x, y, z, yaw, pitch].every(Number.isFinite)) return;
  const t = now();
  const dt = Math.min(1, (t - p.lastMove) / 1000);
  p.lastMove = t;
  // "Budžet" kretanja dopušta kratke zastoje mreže, ali ne i teleportiranje ili prebrzo trčanje.
  p.budget = Math.min(4, p.budget + P.sprint * 1.25 * dt + 0.05);
  const crouch = !!m.c;
  const dh = Math.hypot(x - p.x, z - p.z);
  const A = MAP.arena;
  if (p.admin) {
    // Admin s brzinom ili letenjem preskače provjeru kretanja, ali ostaje unutar arene.
    p.x = clamp(x, -A, A);
    p.y = clamp(y, 0, 60);
    p.z = clamp(z, -A, A);
  } else {
    const inWall = blocked(BOXES, x, y + 0.05, z, (crouch ? P.crouchHeight : P.height) - 0.1, P.radius - 0.08);
    if (dh > p.budget || y - p.y > 1.9 || y < -0.05 || y > MAX_Y || Math.abs(x) > A || Math.abs(z) > A || inWall) {
      p.strikes++;
      send(p, { t: 'corr', x: r3(p.x), y: r3(p.y), z: r3(p.z) });
      return;
    }
    p.budget -= dh;
    p.x = x;
    p.y = y;
    p.z = z;
  }
  p.yaw = yaw;
  p.pitch = clamp(pitch, -1.55, 1.55);
  p.crouch = crouch;
  p.ground = !!m.g;
  // Pištolj u ruci vide i drugi. Bez metaka (i bez cheata) igrač drži pušku, što god klijent tvrdio.
  p.holding = m.h && hasPistol(p) ? 'pistol' : 'rifle';
  const scoped = !!m.s && p.holding === 'rifle'; // pištolj nema nišan
  if (scoped && !p.scoped) p.scopeStart = t;
  p.scoped = scoped;
  pushHist(p, t);
}

function onShoot(room, p, m) {
  if (!Array.isArray(m.d) || m.d.length !== 3) return;
  const d = m.d.map(Number);
  if (!d.every(Number.isFinite)) return;
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 0.5) return;
  if (m.w === 'pistol') firePistol(room, p, d[0] / len, d[1] / len, d[2] / len);
  else fireRifle(room, p, d[0] / len, d[1] / len, d[2] / len, null);
}

function onReload(p) {
  if (!p.alive || p.reloadUntil || p.ammo >= W.mag) return;
  p.reloadUntil = now() + W.reload * 1000;
}

/* ------------------------------------------------------------------ pucanje */

function canFire(p, t) {
  if (p.cheats.ammo) {
    p.reloadUntil = 0;
    p.ammo = W.mag;
  }
  if (p.reloadUntil) {
    if (t < p.reloadUntil - 150) return false;
    p.reloadUntil = 0;
    p.ammo = W.mag;
  }
  if (p.ammo <= 0) return false;
  const cooldown = p.cheats.rapid ? RAPID_COOLDOWN : W.cooldown * 1000;
  return t - p.lastShot >= cooldown - 120;
}

// Nasumično odstupanje unutar stošca širine s (radijani).
function jitter(dx, dy, dz, s) {
  if (s <= 0) return [dx, dy, dz];
  let ux = -dz, uy = 0, uz = dx;
  if (Math.abs(dy) > 0.99) { ux = 1; uz = 0; }
  let l = Math.hypot(ux, uy, uz);
  ux /= l; uy /= l; uz /= l;
  const vx = dy * uz - dz * uy;
  const vy = dz * ux - dx * uz;
  const vz = dx * uy - dy * ux;
  const a = Math.random() * Math.PI * 2;
  const r = s * Math.sqrt(Math.random());
  const ca = Math.cos(a) * r;
  const sa = Math.sin(a) * r;
  const nx = dx + ux * ca + vx * sa;
  const ny = dy + uy * ca + vy * sa;
  const nz = dz + uz * ca + vz * sa;
  l = Math.hypot(nx, ny, nz);
  return [nx / l, ny / l, nz / l];
}

// Jedan hitac (puška ili pištolj): odstupanje, zraka iz oka i poruka 'shot' svima.
// Druge igrače provjeravamo malo u prošlosti, tamo gdje ih je strijelac vidio na ekranu.
// tag: oznaka oružja u poruci 'shot' ('p' = pištolj), za pušku je nema.
function traceShot(room, p, dx, dy, dz, spread, range, t, tag) {
  [dx, dy, dz] = jitter(dx, dy, dz, spread);
  const ox = p.x;
  const oy = p.y + eyeHeight(p.crouch);
  const oz = p.z;
  const wall = rayWorld(BOXES, ox, oy, oz, dx, dy, dz, range);
  let dist = wall;
  let target = null;
  let part = null;
  const rewindTo = p.bot ? t : t - Math.min(350, p.rtt / 2 + INTERP_DELAY + 25);
  for (const o of room.players.values()) {
    if (o === p || !o.alive || t < o.protectUntil || !canHurt(room, p, o)) continue; // suigrač: metak prolazi
    const q = posAt(o, rewindTo);
    const h = rayHitbox(ox, oy, oz, dx, dy, dz, q.x, q.y, q.z, q.c);
    if (h && h.t < dist) {
      dist = h.t;
      target = o;
      part = h.part;
    }
  }
  const msg = {
    t: 'shot', id: p.id,
    o: [r2(ox), r2(oy), r2(oz)],
    e: [r2(ox + dx * dist), r2(oy + dy * dist), r2(oz + dz * dist)],
    h: target ? target.id : 0,
  };
  if (tag) msg.w = tag;
  room.broadcast(msg);
  // hitSomething: metak je u nešto udario (zid, pod ili igrač), a nije samo odletio u nebo.
  return { ox, oy, oz, dx, dy, dz, dist, target, part, rewindTo, hitSomething: !!target || wall < range };
}

function fireRifle(room, p, dx, dy, dz, forcedSpread) {
  if (room.state !== 'play' || !p.alive) return;
  const t = now();
  if (!canFire(p, t)) return;
  p.lastShot = t;
  p.protectUntil = 0;
  if (!p.cheats.ammo) {
    p.ammo--;
    if (p.ammo <= 0) p.reloadUntil = t + W.reload * 1000;
  }
  const spread = p.cheats.aim
    ? 0
    : forcedSpread ?? spreadFor(p.scoped, (t - p.scopeStart) / 1000, speedOf(p) > 1.2, !p.ground, p.crouch);
  const s = traceShot(room, p, dx, dy, dz, spread, W.range, t, null);
  // No-scope: hitac iz puške bez nišana (botovi uvijek nišane).
  if (s.target) damage(room, p, s.target, s.part, W.damage[s.part], t, null, !p.scoped);
}

/* ------------------------------------------------------------------ eksplozivni pištolj */

function hasPistol(p) {
  return p.pistolAmmo > 0 || !!p.cheats.pistol;
}

function firePistol(room, p, dx, dy, dz) {
  if (room.state !== 'play' || !p.alive) return;
  // Klijent sam oduzima metke pa mu kod odbijenog hica javimo pravo stanje, da se brojke ne raziđu.
  if (!hasPistol(p)) {
    send(p, { t: 'pistol', n: 0 });
    return;
  }
  const t = now();
  if (t - p.pistolLastShot < PISTOL.cooldown * 1000 - PISTOL_SLACK) {
    send(p, { t: 'pistol', n: p.pistolAmmo });
    return;
  }
  p.pistolLastShot = t;
  p.protectUntil = 0;
  if (!p.cheats.pistol) {
    p.pistolAmmo--;
    if (p.pistolAmmo <= 0) {
      p.pistolAmmo = 0;
      send(p, { t: 'pistol', n: 0 });
    }
  }
  const spread = p.cheats.aim ? 0 : pistolSpread(speedOf(p) > 1.2);
  const s = traceShot(room, p, dx, dy, dz, spread, PISTOL.range, t, 'p');
  if (s.target) damage(room, p, s.target, s.part, MAX_HP, t, 'pistol'); // izravan pogodak uvijek ubija
  if (!s.hitSomething) return;
  // Eksplozija malo ispred mjesta udarca, na strani strijelca, da je ne zakloni baš zid u koji je metak udario.
  const back = Math.min(0.15, s.dist);
  const k = s.dist - back;
  explode(room, p, s.ox + s.dx * k, s.oy + s.dy * k, s.oz + s.dz * k, t, s.rewindTo);
}

// Ubija sve unutar PISTOL.radius do čijih prsa vodi slobodan put (zid štiti). Strijelca nikad ne ozljeđuje.
function explode(room, p, x, y, z, t, rewindTo) {
  room.broadcast({ t: 'boom', x: r2(x), y: r2(y), z: r2(z), by: p.id, r: PISTOL.radius });
  for (const o of room.players.values()) {
    if (o === p || !o.alive || t < o.protectUntil || o.cheats.god || !canHurt(room, p, o)) continue;
    const q = posAt(o, rewindTo);
    const tx = q.x - x, ty = q.y + (q.c ? 0.7 : 1.1) - y, tz = q.z - z;
    const dist = Math.hypot(tx, ty, tz);
    if (dist > PISTOL.radius) continue;
    if (dist > 0.3 && rayWorld(BOXES, x, y, z, tx / dist, ty / dist, tz / dist, dist) < dist - 0.4) continue;
    send(p, { t: 'hit', part: 'blast', kill: true });
    send(o, { t: 'dmg', hp: 0, from: p.id, fx: r2(x), fz: r2(z) });
    killPlayer(room, p, o, t, 'pistol', false);
  }
}

/* ------------------------------------------------------------------ šteta i ubojstva */

// weapon: null za pušku, 'pistol' za pištolj.
function damage(room, from, to, part, amount, t, weapon, noScope = false) {
  if (to.cheats.god) {
    send(from, { t: 'hit', part, kill: false });
    return;
  }
  to.hp -= amount;
  const kill = to.hp <= 0;
  send(from, { t: 'hit', part, kill });
  send(to, { t: 'dmg', hp: Math.max(0, to.hp), from: from.id, fx: r2(from.x), fz: r2(from.z) });
  if (kill) killPlayer(room, from, to, t, weapon || (part === 'head' ? 'head' : 'shot'), part === 'head', noScope);
}

// w u poruci 'kill': 'shot' ili 'head' (puška), 'pistol' (pištolj, izravno ili eksplozijom).
function killPlayer(room, from, to, t, w, hs, noScope = false) {
  to.alive = false;
  to.hp = 0;
  to.scoped = false;
  to.holding = 'rifle';
  to.deaths++;
  to.streak = 0;
  to.respawnAt = t + RESPAWN_TIME * 1000;
  from.kills++;
  from.streak++;
  const msg = { t: 'kill', k: from.id, v: to.id, hs, w, kk: from.kills, vd: to.deaths };
  if (noScope) msg.ns = 1;
  room.broadcast(msg);
  onKillModes(room, from, to, t);
  if (!from.bot && from.streak % PISTOL.streak === 0) {
    from.pistolAmmo = PISTOL.mag;
    send(from, { t: 'pistol', n: from.pistolAmmo });
    room.broadcast({ t: 'streak', id: from.id, n: from.streak });
  }
}

/* ------------------------------------------------------------------ botovi */

function randomGround() {
  for (let i = 0; i < 20; i++) {
    const x = (Math.random() * 2 - 1) * (MAP.arena - 6);
    const z = (Math.random() * 2 - 1) * (MAP.arena - 6);
    if (!blocked(BOXES, x, 0.01, z, P.height)) return [x, z];
  }
  return MAP.spawns[Math.floor(Math.random() * MAP.spawns.length)].slice();
}

// Slobodno mjesto do r metara od (x, z): zaobilaznica kad bot zapne na putu do zastave.
function nearGround(x, z, r) {
  const A = MAP.arena - 2;
  for (let i = 0; i < 12; i++) {
    const nx = clamp(x + (Math.random() * 2 - 1) * r, -A, A);
    const nz = clamp(z + (Math.random() * 2 - 1) * r, -A, A);
    if (!blocked(BOXES, nx, 0.01, nz, P.height)) return [nx, nz];
  }
  return randomGround();
}

// CTF cilj bota: s tuđom zastavom kući, inače po tuđu zastavu ako je nitko ne nosi, inače null (luta).
function ctfGoal(room, b) {
  const enemy = room.flags[1 - b.team];
  if (enemy.carrier === b) return MAP.flags[b.team];
  if (enemy.state !== 1) return [enemy.x, enemy.z];
  return null;
}

function syncBots(room) {
  const humans = room.humans();
  // Botovi popunjavaju sobu dok je praznjikava i odlaze kako ulaze pravi igrači,
  // osim kad admin ručno postavi broj botova: tada ostaju koliko je rekao.
  const freeSlots = MAX_PLAYERS - humans;
  const want = room.botFixed
    ? clamp(room.botFill, 0, freeSlots)
    : clamp(room.botFill - (humans - 1), 0, Math.min(room.botFill, freeSlots));
  const bots = [...room.players.values()].filter((p) => p.bot);
  if (bots.length < want) {
    const name = BOT_NAMES[room.botSerial++ % BOT_NAMES.length];
    const b = makePlayer(room, name, null, true, SKINS[Math.floor(Math.random() * SKINS.length)]);
    room.broadcast({ t: 'join', id: b.id, name: b.name, hue: b.hue, bot: true, skin: b.skin, team: b.team });
  } else if (bots.length > want) {
    let b = bots[bots.length - 1];
    if (isTeamMode(room)) {
      // odlazi bot iz većeg tima, da timovi ostanu jednaki
      const n = teamCounts(room);
      const bigger = n[0] > n[1] ? 0 : n[1] > n[0] ? 1 : b.team;
      b = bots.reverse().find((o) => o.team === bigger) || b;
    }
    dropFlag(room, b, now());
    room.players.delete(b.id);
    room.broadcast({ t: 'leave', id: b.id });
  }
}

function botThink(room, b, t, dt) {
  const ai = b.ai;
  if (t >= ai.nextScan) {
    ai.nextScan = t + BOT.scanEvery + Math.random() * BOT.scanJitter;
    let best = null;
    let bestD = BOT_RANGE;
    const ex = b.x, ey = b.y + eyeHeight(b.crouch), ez = b.z;
    for (const o of room.players.values()) {
      if (o === b || !o.alive || t < o.protectUntil || !canHurt(room, b, o)) continue;
      const tx = o.x - ex, ty = o.y + 1.2 - ey, tz = o.z - ez;
      const d = Math.hypot(tx, ty, tz);
      if (d >= bestD || d < 0.5) continue;
      if (rayWorld(BOXES, ex, ey, ez, tx / d, ty / d, tz / d, d) >= d - 0.3) {
        best = o;
        bestD = d;
      }
    }
    if (best !== ai.target) {
      ai.target = best;
      ai.readyAt = t + BOT.react + Math.random() * BOT.reactJitter;
    }
  }
  if (ai.target && (!ai.target.alive || !room.players.has(ai.target.id))) ai.target = null;

  let wx = 0, wz = 0, jump = false, crouch = false;
  if (ai.target && room.state === 'play') {
    const o = ai.target;
    const tx = o.x - b.x, tz = o.z - b.z;
    const ty = o.y + 1.2 - (b.y + eyeHeight(b.crouch));
    const yaw = Math.atan2(-tx, -tz);
    const pitch = Math.atan2(ty, Math.hypot(tx, tz));
    b.yaw = turn(b.yaw, yaw, BOT.turnRate * dt);
    b.pitch += (pitch - b.pitch) * Math.min(1, BOT.pitchRate * dt);
    if (!b.scoped) {
      b.scoped = true;
      b.scopeStart = t;
    }
    // Između hitaca bot se izmiče lijevo-desno, a prije hica stane (i ponekad čučne) da nacilja.
    if (t >= ai.strafeUntil) {
      ai.strafeDir = Math.random() < 0.5 ? -1 : 1;
      ai.strafeUntil = t + 700 + Math.random() * 900;
      ai.crouchToShoot = Math.random() < 0.3;
    }
    const shotSoon = t >= ai.readyAt && t - b.lastShot > ai.nextShotGap - 500;
    const objective = room.mode === 'ctf' && t >= ai.detourUntil ? ctfGoal(room, b) : null;
    if (shotSoon) {
      crouch = ai.crouchToShoot;
    } else if (objective) {
      // CTF: između hitaca bot ne stoji na mjestu nego ide prema zastavi (ili kući s njom).
      const gx = objective[0] - b.x, gz = objective[1] - b.z;
      const gl = Math.hypot(gx, gz) || 1;
      wx = gx / gl;
      wz = gz / gl;
      if (t >= ai.stuckCheck) {
        if (Math.hypot(b.x - ai.lastX, b.z - ai.lastZ) < 0.3) {
          jump = true;
          if (++ai.stuck > 2) {
            ai.goal = nearGround(b.x, b.z, 14);
            ai.detourUntil = t + 3500;
            ai.stuck = 0;
          }
        } else {
          ai.stuck = 0;
        }
        ai.lastX = b.x;
        ai.lastZ = b.z;
        ai.stuckCheck = t + 600;
      }
    } else {
      wx = Math.cos(b.yaw) * ai.strafeDir;
      wz = -Math.sin(b.yaw) * ai.strafeDir;
      if (t >= ai.stuckCheck) {
        if (Math.hypot(b.x - ai.lastX, b.z - ai.lastZ) < 0.3) ai.strafeDir *= -1;
        ai.lastX = b.x;
        ai.lastZ = b.z;
        ai.stuckCheck = t + 600;
      }
    }
    const aimed = Math.abs(angDiff(b.yaw, yaw)) < BOT.aimTolerance;
    if (aimed && t >= ai.readyAt && t - b.lastShot > ai.nextShotGap) {
      const [dx, dy, dz] = aimDir(b.yaw, b.pitch);
      fireRifle(room, b, dx, dy, dz, 0.007 + Math.random() * 0.014);
      ai.nextShotGap = W.cooldown * 1000 + 700 + Math.random() * 1500;
    }
  } else {
    b.scoped = false;
    const objective = room.mode === 'ctf' && room.state === 'play' && t >= ai.detourUntil ? ctfGoal(room, b) : null;
    if (objective) {
      ai.goal = objective;
      ai.goalUntil = t + 12000;
    } else if (!ai.goal || t > ai.goalUntil || Math.hypot(ai.goal[0] - b.x, ai.goal[1] - b.z) < 1.5) {
      ai.goal = randomGround();
      ai.goalUntil = t + 12000;
    }
    const gx = ai.goal[0] - b.x, gz = ai.goal[1] - b.z;
    const gl = Math.hypot(gx, gz) || 1;
    wx = gx / gl;
    wz = gz / gl;
    b.yaw = turn(b.yaw, Math.atan2(-gx, -gz), 4 * dt);
    b.pitch *= 0.9;
    if (t >= ai.stuckCheck) {
      if (Math.hypot(b.x - ai.lastX, b.z - ai.lastZ) < 0.6) {
        ai.stuck++;
        jump = true;
        if (ai.stuck > 2) {
          ai.goal = room.mode === 'ctf' ? nearGround(b.x, b.z, 14) : randomGround();
          ai.detourUntil = t + 3500;
          ai.stuck = 0;
        }
      } else {
        ai.stuck = 0;
      }
      ai.lastX = b.x;
      ai.lastZ = b.z;
      ai.stuckCheck = t + 1000;
    }
  }
  stepBody(b.body, { wx, wz, jump, crouch, scoped: b.scoped }, dt, BOXES);
  b.x = b.body.x;
  b.y = b.body.y;
  b.z = b.body.z;
  b.crouch = b.body.crouch;
  b.ground = b.body.onGround;
  pushHist(b, t);
}

/* ------------------------------------------------------------------ runde i otkucaj servera */

function endMatch(room, t) {
  room.state = 'end';
  room.endAt = t + END_SECONDS * 1000;
  room.timeLeft = 0;
  const board = roster(room).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  room.votes = new Map();
  const msg = { t: 'end', board, next: END_SECONDS, mode: room.mode };
  if (isTeamMode(room)) {
    msg.ts = room.teamScore;
    msg.win = winningTeam(room); // -1 neriješeno
  }
  room.broadcast(msg);
}

/* ------------------------------------------------------------------ glasanje za sljedeći način */

function voteTally(room) {
  const v = Object.fromEntries(MODES.map((m) => [m, 0]));
  for (const mode of room.votes?.values() ?? []) v[mode]++;
  return v;
}

function onVote(room, p, m) {
  if (room.state !== 'end' || p.bot || !MODES.includes(m.mode)) return;
  room.votes.set(p.id, m.mode);
  room.broadcast({ t: 'votes', v: voteTally(room) });
}

// Najviše glasova pobjeđuje. Kod izjednačenja ostaje trenutni način ako je među prvima, inače nasumično.
// Bez glasova se igra isti način.
function pickNextMode(room) {
  const v = voteTally(room);
  const best = Math.max(...Object.values(v));
  if (best === 0) return room.mode;
  const top = MODES.filter((m) => v[m] === best);
  return top.includes(room.mode) ? room.mode : top[Math.floor(Math.random() * top.length)];
}

function nextRound(room, t) {
  const mode = pickNextMode(room);
  room.votes = new Map();
  if (mode !== room.mode) setMode(room, mode, t);
  else resetMatch(room, t);
}

function resetMatch(room, t) {
  room.state = 'play';
  room.timeLeft = MATCH_SECONDS;
  room.teamScore = [0, 0];
  if (room.flags) room.flags = makeFlags();
  for (const p of room.players.values()) {
    p.kills = 0;
    p.deaths = 0;
    p.streak = 0;
    p.pistolAmmo = 0;
    p.holding = 'rifle';
    p.alive = false;
    p.respawnAt = t;
  }
  room.broadcast({ t: 'reset', tl: MATCH_SECONDS, mode: room.mode });
}

function tickRoom(room, t) {
  const dt = 1 / TICK_RATE;
  if (room.state === 'play') {
    room.timeLeft -= dt;
    const lim = scoreLimit(room);
    if (room.timeLeft <= 0 || (lim && (room.teamScore[0] >= lim || room.teamScore[1] >= lim))) endMatch(room, t);
  } else if (t >= room.endAt) {
    nextRound(room, t);
  }
  syncBots(room);
  for (const p of room.players.values()) {
    if (!p.alive) {
      if (room.state === 'play' && t >= p.respawnAt) spawn(room, p);
      continue;
    }
    if (p.reloadUntil && t >= p.reloadUntil) {
      p.reloadUntil = 0;
      p.ammo = W.mag;
    }
    if (p.bot) botThink(room, p, t, dt);
  }
  if (room.flags && room.state === 'play') tickFlags(room, t);
  const list = [];
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    // zastavice: 1 čuči, 2 nišani, 4 zaštićen, 8 drži pištolj
    const f = (p.crouch ? 1 : 0) | (p.scoped ? 2 : 0) | (t < p.protectUntil ? 4 : 0)
      | (p.holding === 'pistol' && hasPistol(p) ? 8 : 0);
    list.push([p.id, r2(p.x), r2(p.y), r2(p.z), r3(p.yaw), r3(p.pitch), f]);
  }
  const snap = { t: 's', p: list, tl: Math.max(0, Math.ceil(room.timeLeft)) };
  if (isTeamMode(room)) snap.ts = room.teamScore;
  if (room.flags) snap.fl = flagSnap(room);
  const s = JSON.stringify(snap);
  for (const p of room.players.values()) {
    if (p.ws && p.ws.bufferedAmount < 262144) sendRaw(p, s); // sporim vezama preskačemo stanje umjesto da gomilamo
  }
}

setInterval(() => {
  const t = now();
  for (const room of rooms.values()) tickRoom(room, t);
}, 1000 / TICK_RATE);

/* ------------------------------------------------------------------ admin */

function sameSecret(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function adminState(p) {
  return { t: 'admin', ok: true, cheats: p.cheats };
}

function onAdminLogin(room, p, m) {
  if (p.admin) {
    send(p, adminState(p));
    return;
  }
  if (!ADMIN_KEY) {
    send(p, { t: 'admin', ok: false, msg: 'Admin nije uključen: na Renderu nije postavljen ADMIN_KEY.' });
    return;
  }
  // Ne zaključavamo po IP adresi jer cijela škola izlazi na internet s iste adrese.
  if (p.adminTries >= 5) {
    send(p, { t: 'admin', ok: false, msg: 'Previše pokušaja. Izađi i uđi ponovno u igru.' });
    return;
  }
  p.adminTries++;
  if (sameSecret(String(m.key ?? ''), ADMIN_KEY)) {
    p.admin = true;
    console.log(`admin prijava: "${p.name}" u sobi "${room.code}"`);
    send(p, adminState(p));
  } else {
    setTimeout(() => send(p, { t: 'admin', ok: false, msg: 'Kriva lozinka.' }), 800);
  }
}

function onAdmin(room, p, m) {
  const t = now();
  switch (m.a) {
    case 'cheat':
      if (CHEATS.includes(m.name)) p.cheats[m.name] = !!m.on;
      if (p.cheats.god && p.alive) p.hp = MAX_HP;
      send(p, adminState(p));
      break;
    case 'kick': {
      const target = room.players.get(Math.floor(+m.id));
      if (!target || target === p) return;
      if (target.bot) {
        room.botFixed = true;
        room.botFill = Math.max(0, [...room.players.values()].filter((o) => o.bot).length - 1);
        dropFlag(room, target, t);
        room.players.delete(target.id);
        room.broadcast({ t: 'leave', id: target.id });
      } else {
        send(target, { t: 'kicked' });
        setTimeout(() => target.ws.close(4001, 'kick'), 100);
      }
      break;
    }
    case 'bots':
      room.botFixed = true;
      room.botFill = clamp(Math.floor(+m.n) || 0, 0, MAX_BOTS);
      break;
    case 'restart':
      resetMatch(room, t);
      break;
    case 'slide':
      room.allowSlide = !!m.on;
      room.broadcast({ t: 'rules', slide: room.allowSlide });
      break;
    case 'mode':
      if (MODES.includes(m.mode) && m.mode !== room.mode) setMode(room, m.mode, t);
      break;
    case 'end':
      if (room.state === 'play') endMatch(room, t);
      break;
    case 'say': {
      const text = String(m.text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
      if (text) room.broadcast({ t: 'announce', text });
      break;
    }
    default: break;
  }
}

/* ------------------------------------------------------------------ WebSocket */

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  let room = null;
  let player = null;
  let windowStart = now();
  let count = 0;

  ws.on('message', (data) => {
    const t = now();
    if (t - windowStart > 1000) {
      windowStart = t;
      count = 0;
    }
    if (++count > 120) {
      if (count > 400) ws.terminate();
      return;
    }
    let m;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (!m || typeof m !== 'object') return;

    if (!player) {
      if (m.t !== 'join') return;
      const code = cleanRoom(m.room);
      let r = rooms.get(code);
      if (r && r.humans() >= MAX_PLAYERS) {
        ws.send(JSON.stringify({ t: 'err', msg: `Soba je puna (${MAX_PLAYERS} igrača). Probaj drugu sobu.` }));
        ws.close();
        return;
      }
      if (!r) {
        const mode = MODES.includes(m.mode) ? m.mode : 'ffa';
        r = new Room(code, clamp(Math.floor(+m.bots) || 0, 0, MAX_BOTS), mode, m.slide !== false);
        rooms.set(code, r);
        console.log(`soba "${code}" otvorena (${mode})`);
      }
      room = r;
      player = makePlayer(room, cleanName(m.name), ws, false, String(m.skin ?? ''));
      send(player, {
        t: 'welcome', id: player.id, room: code, state: room.state,
        tl: Math.ceil(room.timeLeft), players: roster(room),
        mode: room.mode, team: player.team, teamScore: room.teamScore, scoreLimit: scoreLimit(room),
        slide: room.allowSlide,
      });
      room.broadcast({
        t: 'join', id: player.id, name: player.name, hue: player.hue, bot: false, skin: player.skin, team: player.team,
      }, player);
      if (room.state === 'play') spawn(room, player);
      return;
    }

    switch (m.t) {
      case 'u': onUpdate(player, m); break;
      case 'shoot': onShoot(room, player, m); break;
      case 'reload': onReload(player); break;
      case 'ping':
        player.rtt = clamp(+m.rtt || 0, 0, 1000);
        send(player, { t: 'pong', ct: +m.ct || 0 });
        break;
      case 'alogin': onAdminLogin(room, player, m); break;
      case 'admin': if (player.admin) onAdmin(room, player, m); break;
      case 'team': onTeamSwitch(room, player, t); break;
      case 'vote': onVote(room, player, m); break;
      default: break;
    }
  });

  ws.on('close', () => {
    if (!player || !room) return;
    dropFlag(room, player, now());
    room.players.delete(player.id);
    if (room.votes?.delete(player.id)) room.broadcast({ t: 'votes', v: voteTally(room) });
    room.broadcast({ t: 'leave', id: player.id });
    if (room.humans() === 0) {
      rooms.delete(room.code);
      console.log(`soba "${room.code}" zatvorena`);
    }
  });
});

// Mrtve veze (zatvoren laptop, pao wifi) izbacujemo nakon 30 s.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

server.listen(PORT, () => {
  console.log(`Snajper radi na http://localhost:${PORT}`);
});

process.on('SIGTERM', () => {
  wss.close();
  server.close(() => process.exit(0));
});
