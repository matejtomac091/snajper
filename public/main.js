// Snajper — klijent u pregledniku. Crta svijet (Three.js), čita miš i tipkovnicu, šalje položaj serveru.
import * as THREE from 'three';
import {
  P, W, MAX_HP, INTERP_DELAY, RESPAWN_TIME, MATCH_TIME, SKINS, PISTOL, spreadFor, pistolSpread, eyeHeight, aimDir,
  MODES, MODE_NAMES, TEAMS, FLAG,
} from './shared/config.js';
import { buildMap, COLORS } from './shared/map.js';
import { createBody, stepBody } from './shared/physics.js';
import { GFX_LEVELS, createRenderer, buildEnvironment, makeCharacterMaterial } from './gfx.js';
import { createViewmodels } from './viewmodel.js';
import { rayWorld } from './shared/ray.js';

const $ = (id) => document.getElementById(id);
const MAP = buildMap();
const BASE_FOV = 75;
const TAU = Math.PI * 2;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r4 = (v) => Math.round(v * 10000) / 10000;
const wrap = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
const angDiff = (a, b) => wrap(b - a);

/* ================================================================ postavke */

// blood: krv je isključena dok je netko ne uključi (školska igra). gfx: 'low' | 'high' | 'ultra'.
const DEFAULTS = {
  name: '', room: 'razred', bots: 0, sens: 1, quality: 0.5, volume: 0.7, skin: 'klasik', blood: false, gfx: 'low', mode: 'ffa',
  fullscreen: true,
};
const settings = (() => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('snajper') || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
})();
function saveSettings() {
  try {
    localStorage.setItem('snajper', JSON.stringify(settings));
  } catch {
    /* privatni prozor: postavke vrijede samo do zatvaranja */
  }
}

/* ================================================================ renderer i scena */

// Kvaliteta grafike (svijet, skinovi, oružje). Mijenja se samo ponovnim učitavanjem jer renderer
// ne može naknadno uključiti antialiasing i sjene.
let GFX = GFX_LEVELS.includes(settings.gfx) ? settings.gfx : 'low';
let renderer;
try {
  renderer = createRenderer(GFX);
} catch (err) {
  try {
    GFX = 'low';
    renderer = createRenderer(GFX);
  } catch {
    $('lobbyError').textContent = 'Ovaj preglednik ne može crtati 3D (WebGL). Probaj Chrome i uključi hardversko ubrzanje.';
    $('play').disabled = true;
    throw err;
  }
}
const SHADOWS = GFX !== 'low';
const canvas = renderer.domElement;
canvas.id = 'game';
document.body.prepend(canvas);
renderer.autoClear = false;

// quality je omjer piksela: 0.5 = pola rezolucije ekrana (brzo), 2 = dvostruka (oštro, samo jaka računala).
function applyQuality() {
  renderer.setPixelRatio(settings.quality);
  renderer.setSize(window.innerWidth, window.innerHeight);
  const el = document.getElementById('resVal');
  if (el) el.textContent = `${canvas.width} × ${canvas.height}`;
}
applyQuality();

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 450);
camera.rotation.order = 'YXZ';

// Nebo, svjetla, tlo i mapa. Niska kvaliteta izgleda točno kao prije; visoka i ultra imaju teksture i sjene.
const env = buildEnvironment(scene, renderer, GFX, MAP, COLORS);

/* ================================================================ likovi drugih igrača */

function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// Odsjaj nišana: kad netko nišani, vidi ga se izdaleka. Daje šansu onome na kojeg se cilja.
const GLINT = new THREE.SpriteMaterial({
  map: radialTexture('rgba(255,255,240,1)', 'rgba(255,255,200,0)'),
  blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
});

function nameTag(name, color = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 32px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(name, 128, 34);
  g.fillStyle = color;
  g.fillText(name, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(1.6, 0.4, 1);
  return s;
}

// Skinovi: svaki gradi noge, trup i glavu oko istih točaka kao pogodna zona (glava na 1.56 m),
// tako da izgled ne mijenja koliko je lako nekoga pogoditi.
const SKIN_BUILDERS = {
  klasik(legs, torso, head, k) {
    k.add(legs, k.B(0.46, 0.8, 0.3), k.mat(k.tint.clone().multiplyScalar(0.55)));
    k.add(torso, k.B(0.56, 0.6, 0.34), k.mat(k.tint));
    k.add(head, k.S(0.21), k.mat('#e8b88f'));
  },
  vozac(legs, torso, head, k) {
    const suit = k.mat('#4b3bbf');
    const white = k.mat('#f2f2f2');
    const accent = k.mat(k.tint);
    k.add(legs, k.B(0.46, 0.8, 0.3), suit);
    k.add(legs, k.B(0.05, 0.8, 0.31), white, -0.2);
    k.add(legs, k.B(0.05, 0.8, 0.31), white, 0.2);
    k.add(torso, k.B(0.56, 0.6, 0.34), suit);
    k.add(torso, k.B(0.12, 0.6, 0.35), accent);
    k.add(torso, k.B(0.58, 0.07, 0.36), white, 0, -0.26);
    k.add(head, k.S(0.23, 14, 10), white);
    k.add(head, k.C(0.235, 0.235, 0.06, 16), accent, 0, 0.08);
    k.add(head, k.B(0.3, 0.1, 0.1), k.mat('#111111'), 0, 0, -0.18);
  },
  robot(legs, torso, head, k) {
    const steel = k.mat('#9aa3ad');
    const dark = k.mat('#5c646e');
    const glow = k.mat('#3ff0ff', true);
    k.add(legs, k.B(0.18, 0.8, 0.24), dark, -0.12);
    k.add(legs, k.B(0.18, 0.8, 0.24), dark, 0.12);
    k.add(torso, k.B(0.58, 0.6, 0.36), steel);
    k.add(torso, k.B(0.18, 0.1, 0.02), glow, 0, 0.08, -0.19);
    k.add(torso, k.B(0.1, 0.44, 0.12), k.mat(k.tint), -0.34);
    k.add(torso, k.B(0.1, 0.44, 0.12), k.mat(k.tint), 0.34);
    k.add(head, k.B(0.36, 0.3, 0.34), steel);
    k.add(head, k.B(0.08, 0.05, 0.02), glow, -0.08, 0.03, -0.175);
    k.add(head, k.B(0.08, 0.05, 0.02), glow, 0.08, 0.03, -0.175);
    k.add(head, k.C(0.012, 0.012, 0.18, 6), dark, 0, 0.24);
    k.add(head, k.S(0.035, 6, 4), k.mat('#ff3b30', true), 0, 0.34);
  },
  kaktus(legs, torso, head, k) {
    const green = k.mat('#3f8f3a');
    const spike = k.mat('#f3eac0');
    k.add(legs, k.B(0.4, 0.8, 0.3), k.mat('#2f6e2b'));
    k.add(torso, k.B(0.5, 0.6, 0.38), green);
    k.add(torso, k.B(0.16, 0.13, 0.13), green, -0.32, -0.02);
    k.add(torso, k.B(0.12, 0.32, 0.12), green, -0.38, 0.14);
    k.add(torso, k.B(0.16, 0.13, 0.13), green, 0.32, -0.1);
    k.add(torso, k.B(0.12, 0.24, 0.12), green, 0.38, 0.02);
    for (const [x, y] of [[-0.15, 0.15], [0.12, -0.1], [0.05, 0.2], [-0.1, -0.18]]) {
      k.add(torso, k.B(0.03, 0.03, 0.08), spike, x, y, -0.22);
      k.add(torso, k.B(0.03, 0.03, 0.08), spike, -x, y, 0.22);
    }
    k.add(head, k.S(0.21), green);
    k.add(head, k.B(0.34, 0.07, 0.04), k.mat('#111111'), 0, 0.03, -0.19);
    k.add(head, k.S(0.06, 8, 6), k.mat(k.tint), 0, 0.22);
  },
  banana(legs, torso, head, k) {
    const yellow = k.mat('#f2d23c');
    const brown = k.mat('#6b4a1f');
    const white = k.mat('#ffffff');
    const black = k.mat('#111111');
    k.add(legs, k.B(0.16, 0.8, 0.18), brown, -0.11);
    k.add(legs, k.B(0.16, 0.8, 0.18), brown, 0.11);
    k.add(torso, k.C(0.24, 0.28, 0.6, 12), yellow, 0, 0, 0, 0, 0, 0.08);
    k.add(head, k.S(0.22, 12, 10), yellow);
    k.add(head, k.C(0.04, 0.06, 0.16, 6), brown, 0.03, 0.24, 0, 0, 0, -0.3);
    for (const x of [-0.08, 0.08]) {
      k.add(head, k.S(0.05, 8, 6), white, x, 0.04, -0.18);
      k.add(head, k.S(0.025, 6, 4), black, x, 0.04, -0.225);
    }
  },
  ninja(legs, torso, head, k) {
    const black = k.mat('#1c1f26');
    const band = k.mat(k.tint);
    k.add(legs, k.B(0.46, 0.8, 0.3), black);
    k.add(torso, k.B(0.56, 0.6, 0.34), black);
    k.add(torso, k.B(0.58, 0.07, 0.36), band, 0, -0.22);
    k.add(head, k.S(0.21), black);
    k.add(head, k.B(0.28, 0.06, 0.05), k.mat('#e8b88f'), 0, 0.02, -0.18);
    k.add(head, k.C(0.215, 0.215, 0.06, 14), band, 0, 0.1);
    k.add(head, k.B(0.04, 0.04, 0.25), band, 0.05, 0.08, 0.28, 0.4);
  },
};

// tagColor: boja imena iznad glave (u timskim načinima boja tima).
function makeAvatar(hue, name, skin = 'klasik', withTag = true, tagColor = '#ffffff') {
  const mats = [];
  const geos = [];
  const kit = {
    tint: new THREE.Color().setHSL(hue / 360, 0.6, 0.5),
    mat(color, basic = false) {
      const m = makeCharacterMaterial(GFX, color, { emissive: basic });
      mats.push(m);
      return m;
    },
    add(parent, geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
      geos.push(geo);
      const m = new THREE.Mesh(geo, material);
      m.castShadow = SHADOWS;
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      parent.add(m);
      return m;
    },
    B: (w, h, d) => new THREE.BoxGeometry(w, h, d),
    S: (r, ws = 10, hs = 8) => new THREE.SphereGeometry(r, SHADOWS ? ws * 2 : ws, SHADOWS ? hs * 2 : hs),
    C: (rt, rb, h, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, SHADOWS ? seg * 2 : seg),
  };
  const root = new THREE.Group();
  const legs = new THREE.Group();
  legs.position.y = 0.4;
  const upper = new THREE.Group();
  upper.position.y = 0.8;
  const torso = new THREE.Group();
  torso.position.y = 0.3;
  const head = new THREE.Group();
  head.position.y = 0.76;
  const gunPivot = new THREE.Group();
  gunPivot.position.set(0.2, 0.5, -0.1);
  const rifle = kit.add(gunPivot, kit.B(0.07, 0.09, 1.1), kit.mat('#2a2d32'), 0, 0, -0.4);
  // Mali pištolj umjesto puške kad igrač drži eksplozivni pištolj (zastavica 8 u stanju sa servera).
  const pistol = new THREE.Group();
  kit.add(pistol, kit.B(0.07, 0.12, 0.26), kit.mat('#2a2d32'), 0, 0, -0.1);
  kit.add(pistol, kit.B(0.075, 0.03, 0.18), kit.mat('#ff7a1a'), 0, 0.03, -0.1);
  pistol.visible = false;
  gunPivot.add(pistol);
  (SKIN_BUILDERS[skin] || SKIN_BUILDERS.klasik)(legs, torso, head, kit);
  const glint = new THREE.Sprite(GLINT);
  glint.scale.setScalar(0.9);
  glint.position.set(0.05, 0.78, -0.3);
  glint.visible = false;
  upper.add(torso, head, gunPivot, glint);
  root.add(legs, upper);
  let tag = null;
  if (withTag) {
    tag = nameTag(name, tagColor);
    tag.position.y = 2.15;
    root.add(tag);
  }
  return { root, legs, upper, head, gunPivot, rifle, pistol, glint, tag, mats, geos, crouch: false, prot: false, holdsPistol: false };
}

function setHoldsPistol(av, on) {
  if (av.holdsPistol === on) return;
  av.holdsPistol = on;
  av.rifle.visible = !on;
  av.pistol.visible = on;
}

function setCrouch(av, c) {
  if (av.crouch === c) return;
  av.crouch = c;
  av.legs.scale.y = c ? 0.5 : 1;
  av.legs.position.y = c ? 0.2 : 0.4;
  av.upper.position.y = c ? 0.32 : 0.8;
  if (av.tag) av.tag.position.y = c ? 1.67 : 2.15;
}

function setProtected(av, p) {
  if (av.prot === p) return;
  av.prot = p;
  for (const m of av.mats) {
    m.transparent = p;
    m.opacity = p ? 0.45 : 1;
  }
}

// Vidi kroz zidove: likovi se crtaju preko svega.
function setWallhack(av, on) {
  av.root.traverse((o) => {
    if (!o.material) return;
    o.material.depthTest = !on;
    o.renderOrder = on ? 10 : 0;
  });
}

function disposeAvatar(av, parent = scene) {
  parent.remove(av.root);
  for (const m of av.mats) m.dispose();
  for (const g of av.geos) g.dispose();
  if (av.tag) {
    av.tag.material.map.dispose();
    av.tag.material.dispose();
  }
}

/* ================================================================ puška u ruci */

const gunScene = new THREE.Scene();
const gunCam = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.01, 10);
gunScene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
const gunSun = new THREE.DirectionalLight(0xffffff, 1.5);
gunSun.position.set(1, 2, 1);
gunScene.add(gunSun);

// Puška i eksplozivni pištolj u ruci (viewmodel.js), detaljniji na visokoj i ultra kvaliteti.
const VMS = createViewmodels(GFX);
if (env.envMap) {
  gunScene.environment = env.envMap;
  gunScene.environmentIntensity = 0.8;
}

function muzzleFlash(radius, color, at) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 8, 6),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  m.position.copy(at);
  m.position.z -= radius * 0.8;
  m.visible = false;
  return m;
}

const vm = VMS.rifle;
const muzzle = muzzleFlash(0.07, 0xffd27a, VMS.muzzle.rifle);
vm.add(muzzle);
vm.scale.setScalar(0.75);
gunScene.add(vm);

const PISTOL_VM_POS = [0.16, -0.16, -0.4];
const pistolVm = VMS.pistol;
pistolVm.userData.flash = muzzleFlash(0.05, 0xffb060, VMS.muzzle.pistol);
pistolVm.add(pistolVm.userData.flash);
pistolVm.visible = false;
gunScene.add(pistolVm);

/* ================================================================ efekti: tragovi metaka i udarci */

const tracers = [];
for (let i = 0; i < 24; i++) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xfff0b0, transparent: true, depthWrite: false }));
  line.visible = false;
  line.frustumCulled = false;
  line.userData = { life: 0, max: 1 };
  scene.add(line);
  tracers.push(line);
}
function tracer(a, b, life, color = 0xfff0b0) {
  const line = tracers.find((t) => !t.visible) || tracers.reduce((m, t) => (t.userData.life < m.userData.life ? t : m));
  const arr = line.geometry.attributes.position.array;
  arr[0] = a[0]; arr[1] = a[1]; arr[2] = a[2];
  arr[3] = b[0]; arr[4] = b[1]; arr[5] = b[2];
  line.geometry.attributes.position.needsUpdate = true;
  line.userData.life = line.userData.max = life;
  line.material.color.set(color);
  line.material.opacity = 1;
  line.visible = true;
}

const puffGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
const puffs = [];
for (let i = 0; i < 20; i++) {
  const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
  m.visible = false;
  m.userData = { life: 0 };
  scene.add(m);
  puffs.push(m);
}
function puff(p, color) {
  const m = puffs.find((x) => !x.visible) || puffs[0];
  m.position.set(p[0], p[1], p[2]);
  m.material.color.set(color);
  m.userData.life = 0.4;
  m.visible = true;
}

function updateFx(dt) {
  for (const t of tracers) {
    if (!t.visible) continue;
    t.userData.life -= dt;
    if (t.userData.life <= 0) t.visible = false;
    else t.material.opacity = t.userData.life / t.userData.max;
  }
  for (const m of puffs) {
    if (!m.visible) continue;
    m.userData.life -= dt;
    if (m.userData.life <= 0) { m.visible = false; continue; }
    const k = m.userData.life / 0.4;
    m.scale.setScalar(1 + (1 - k) * 2.5);
    m.material.opacity = k;
  }
  updateParticles(dt);
  updateDecals(dt);
}

/* ================================================================ krv i iskre na pogocima */

// Koliko čestica po pogotku i najviše mrlja na tlu, prema postavci grafike (settings.gfx).
// Sve je unaprijed napravljeno (jedan Points za sve čestice, gotove mrlje), pa se tijekom igre ništa ne stvara.
const HIT_FX = { low: { burst: 8, decals: 6 }, high: { burst: 20, decals: 20 }, ultra: { burst: 32, decals: 40 } };
const hitFx = () => HIT_FX[settings.gfx] || HIT_FX.low;
const PARTICLE_MAX = 192;
const DECAL_MAX = 40;
const DECAL_LIFE = 8; // s
const BLOOD_COLORS = ['#5c0606', '#7a0b0b', '#430303'].map((c) => new THREE.Color(c));
const SPARK_COLORS = ['#ffffff', '#d4d4d4', '#a6a6a6'].map((c) => new THREE.Color(c));

const prt = {
  pos: new Float32Array(PARTICLE_MAX * 3),
  col: new Float32Array(PARTICLE_MAX * 4),
  vel: new Float32Array(PARTICLE_MAX * 3),
  life: new Float32Array(PARTICLE_MAX),
  max: new Float32Array(PARTICLE_MAX),
  floor: new Float32Array(PARTICLE_MAX),
  next: 0,
};
for (let i = 0; i < PARTICLE_MAX; i++) prt.pos[i * 3 + 1] = -1000;
const prtGeo = new THREE.BufferGeometry();
prtGeo.setAttribute('position', new THREE.BufferAttribute(prt.pos, 3).setUsage(THREE.DynamicDrawUsage));
prtGeo.setAttribute('color', new THREE.BufferAttribute(prt.col, 4).setUsage(THREE.DynamicDrawUsage));
const prtPoints = new THREE.Points(prtGeo, new THREE.PointsMaterial({
  size: 0.07, map: radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'),
  vertexColors: true, transparent: true, depthWrite: false,
}));
prtPoints.frustumCulled = false;
prtPoints.visible = false;
scene.add(prtPoints);

// n čestica iz točke (x,y,z), uglavnom u smjeru (dx,dy,dz). blood: tamnocrvene kapi, inače bijelo-sive iskre.
// floor: visina plohe ispod, tamo čestice nestaju.
function spray(x, y, z, dx, dy, dz, n, blood, floor) {
  const colors = blood ? BLOOD_COLORS : SPARK_COLORS;
  const speed = blood ? 2.4 : 4.5;
  for (let k = 0; k < n; k++) {
    const i = prt.next;
    prt.next = (i + 1) % PARTICLE_MAX;
    const j = i * 3;
    const s = speed * (0.4 + Math.random() * 0.8);
    prt.pos[j] = x;
    prt.pos[j + 1] = y;
    prt.pos[j + 2] = z;
    prt.vel[j] = dx * s + (Math.random() - 0.5) * s;
    prt.vel[j + 1] = dy * s + (Math.random() - 0.25) * s;
    prt.vel[j + 2] = dz * s + (Math.random() - 0.5) * s;
    prt.life[i] = prt.max[i] = blood ? 0.45 + Math.random() * 0.45 : 0.2 + Math.random() * 0.25;
    prt.floor[i] = floor;
    const c = colors[k % colors.length];
    const q = i * 4;
    prt.col[q] = c.r;
    prt.col[q + 1] = c.g;
    prt.col[q + 2] = c.b;
    prt.col[q + 3] = 1;
  }
  prtPoints.visible = true;
}

function updateParticles(dt) {
  if (!prtPoints.visible) return;
  let alive = 0;
  const fall = 9.8 * dt;
  for (let i = 0; i < PARTICLE_MAX; i++) {
    if (prt.life[i] <= 0) continue;
    const j = i * 3;
    prt.life[i] -= dt;
    if (prt.life[i] <= 0 || prt.pos[j + 1] < prt.floor[i]) {
      prt.life[i] = 0;
      prt.pos[j + 1] = -1000;
      prt.col[i * 4 + 3] = 0;
      continue;
    }
    alive++;
    prt.vel[j + 1] -= fall;
    prt.pos[j] += prt.vel[j] * dt;
    prt.pos[j + 1] += prt.vel[j + 1] * dt;
    prt.pos[j + 2] += prt.vel[j + 2] * dt;
    prt.col[i * 4 + 3] = Math.min(1, (prt.life[i] / prt.max[i]) * 1.6);
  }
  prtGeo.attributes.position.needsUpdate = true;
  prtGeo.attributes.color.needsUpdate = true;
  if (!alive) prtPoints.visible = false;
}

function splatTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const blob = (x, y, r) => {
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  };
  g.fillStyle = '#5a0707';
  blob(32, 32, 13);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + Math.random() * 0.5;
    const d = 7 + Math.random() * 9;
    blob(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, 4 + Math.random() * 5);
  }
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * TAU;
    const d = 20 + Math.random() * 9;
    blob(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, 1 + Math.random() * 2);
  }
  g.fillStyle = 'rgba(40, 0, 0, 0.45)';
  blob(31, 33, 8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const decalGeo = new THREE.PlaneGeometry(1, 1);
decalGeo.rotateX(-Math.PI / 2);
const decalTex = splatTexture();
const decals = [];
for (let i = 0; i < DECAL_MAX; i++) {
  const m = new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({
    map: decalTex, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  }));
  m.visible = false;
  m.renderOrder = 1;
  m.userData.life = 0;
  scene.add(m);
  decals.push(m);
}
let decalNext = 0;

// Mrlja na prvoj plohi ispod točke (x, top, z): tlo, krov ili sanduk. Nema je ako je ploha predaleko.
function addDecal(x, top, z, size) {
  const t = rayWorld(MAP.boxes, x, top, z, 0, -1, 0, 2.5);
  if (t < 0.05 || t >= 2.5) return;
  if (decalNext >= Math.min(DECAL_MAX, hitFx().decals)) decalNext = 0;
  const m = decals[decalNext++];
  m.position.set(x, top - t + 0.015, z);
  m.rotation.y = Math.random() * TAU;
  m.scale.set(size, 1, size);
  m.userData.life = DECAL_LIFE;
  m.material.opacity = 0.92;
  m.visible = true;
}

function updateDecals(dt) {
  for (let i = 0; i < DECAL_MAX; i++) {
    const m = decals[i];
    if (!m.visible) continue;
    m.userData.life -= dt;
    if (m.userData.life <= 0) m.visible = false;
    else m.material.opacity = 0.92 * Math.min(1, m.userData.life / 2);
  }
}

// Kad se krv isključi, makni i ono što je već na ekranu.
function clearBlood() {
  for (let i = 0; i < DECAL_MAX; i++) decals[i].visible = false;
  for (let i = 0; i < PARTICLE_MAX; i++) {
    prt.life[i] = 0;
    prt.pos[i * 3 + 1] = -1000;
    prt.col[i * 4 + 3] = 0;
  }
  prtGeo.attributes.position.needsUpdate = true;
  prtGeo.attributes.color.needsUpdate = true;
  prtPoints.visible = false;
}

// Pogodak u igrača (poruka 'shot' s h): kapi krvi ili, bez krvi, sive iskre.
function hitEffect(m) {
  const blood = !!settings.blood;
  puff(m.e, blood ? '#6e0a0a' : '#d8d8d8');
  if (m.h === me.id) return; // vlastito tijelo: čestice bi prekrile ekran
  const dx = m.e[0] - m.o[0], dy = m.e[1] - m.o[1], dz = m.e[2] - m.o[2];
  const l = Math.hypot(dx, dy, dz) || 1;
  const r = roster.get(m.h);
  const floor = r && r.av ? r.av.root.position.y : 0;
  spray(m.e[0], m.e[1], m.e[2], dx / l, dy / l, dz / l, hitFx().burst, blood, floor);
}

// Ubojstvo: veći prasak na liku žrtve i, s krvi, nekoliko mrlja na tlu ispod nje.
function killEffect(m) {
  const blood = !!settings.blood;
  let x, y, z;
  let dx = 0, dz = 0;
  if (m.v === me.id) {
    x = me.body.x; y = me.body.y; z = me.body.z;
  } else {
    const r = roster.get(m.v);
    if (!r || !r.av || !r.av.root.visible) return;
    const p = r.av.root.position;
    x = p.x; y = p.y; z = p.z;
    const killer = m.k === me.id ? me.body : roster.get(m.k)?.av?.root.position;
    if (killer) {
      dx = x - killer.x;
      dz = z - killer.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
    }
    spray(x, y + (r.av.crouch ? 0.7 : 1.1), z, dx * 0.6, 0.3, dz * 0.6, hitFx().burst * 2, blood, y);
  }
  if (!blood) return;
  addDecal(x + dx * 0.3, y + 0.6, z + dz * 0.3, 0.6 + Math.random() * 0.25);
  for (let i = 0; i < 2; i++) {
    addDecal(x + dx * 0.7 + (Math.random() - 0.5) * 1.2, y + 0.6, z + dz * 0.7 + (Math.random() - 0.5) * 1.2, 0.22 + Math.random() * 0.18);
  }
}

/* ================================================================ eksplozivni pištolj: eksplozije */

const flashes = [];
for (let i = 0; i < 6; i++) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffb02e, transparent: true, depthWrite: false, fog: false }),
  );
  m.visible = false;
  m.userData = { life: 0, r: PISTOL.radius };
  scene.add(m);
  flashes.push(m);
}
const DEBRIS_COLORS = ['#5f6368', '#ff8a2a', '#3b3e43', '#ffb347'];
const chunkGeo = new THREE.BoxGeometry(0.12, 0.07, 0.14);
const chunks = [];
for (let i = 0; i < 36; i++) {
  const m = new THREE.Mesh(chunkGeo, new THREE.MeshLambertMaterial({ color: DEBRIS_COLORS[i % DEBRIS_COLORS.length], transparent: true }));
  m.visible = false;
  m.userData = { life: 0, vx: 0, vy: 0, vz: 0 };
  scene.add(m);
  chunks.push(m);
}

// r: radius eksplozije iz poruke 'boom'. Kugla vatre naraste točno do njega, pa se vidi dokle ubija.
function boom(x, y, z, r) {
  const f = flashes.find((m) => !m.visible) || flashes[0];
  f.position.set(x, y, z);
  f.userData.life = 0.45;
  f.userData.r = r;
  f.visible = true;
  let n = 0;
  for (const c of chunks) {
    if (c.visible || n >= 8) continue;
    n++;
    const a = Math.random() * TAU;
    const sp = 3 + Math.random() * 5;
    const u = c.userData;
    c.position.set(x, y, z);
    u.life = 0.9;
    u.vx = Math.cos(a) * sp;
    u.vy = 3 + Math.random() * 5;
    u.vz = Math.sin(a) * sp;
    c.visible = true;
  }
  const dist = Math.hypot(x - camera.position.x, y - camera.position.y, z - camera.position.z);
  sfx.boom(Math.min(1, 30 / (dist + 12)));
  if (dist < 25) {
    shakeUntil = performance.now() + 450;
    shakeAmp = 0.06 * (1 - dist / 25);
  }
}

function updateBoomFx(dt) {
  for (const f of flashes) {
    if (!f.visible) continue;
    f.userData.life -= dt;
    if (f.userData.life <= 0) { f.visible = false; continue; }
    const p = 1 - f.userData.life / 0.45;
    f.scale.setScalar(0.4 + p * (f.userData.r - 0.4));
    f.material.opacity = 0.85 * (1 - p);
  }
  for (const c of chunks) {
    if (!c.visible) continue;
    const u = c.userData;
    u.life -= dt;
    if (u.life <= 0) { c.visible = false; continue; }
    u.vy -= 20 * dt;
    c.position.x += u.vx * dt;
    c.position.y = Math.max(0.03, c.position.y + u.vy * dt);
    c.position.z += u.vz * dt;
    c.rotation.x += dt * 9;
    c.rotation.z += dt * 7;
    c.material.opacity = Math.min(1, u.life / 0.4);
  }
}

/* ================================================================ zastave (način Zastava) */

// Sve se napravi jednom: 2 zastave (štap + platno), 2 kruga na postoljima i 2 oznake iznad zastava.
// Izvan CTF-a samo su skrivene. Platna dijele jednu geometriju pa se val računa jednom po slici.
const FLAG_W = 1.1, FLAG_H = 0.7, POLE_H = 2.4;
const clothGeo = new THREE.PlaneGeometry(FLAG_W, FLAG_H, 6, 1);
clothGeo.translate(FLAG_W / 2 + 0.03, POLE_H - FLAG_H / 2, 0);
const clothPos = clothGeo.attributes.position;
const clothU = new Float32Array(clothPos.count);
for (let i = 0; i < clothPos.count; i++) clothU[i] = (clothPos.getX(i) - 0.03) / FLAG_W;
const poleGeo = new THREE.CylinderGeometry(0.035, 0.035, POLE_H, 6);
poleGeo.translate(0, POLE_H / 2, 0);
const poleMat = new THREE.MeshLambertMaterial({ color: '#d9dde3' });
const standGeo = new THREE.RingGeometry(FLAG.touch - 0.35, FLAG.touch, 28);
standGeo.rotateX(-Math.PI / 2);

function markerTexture(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(22, 44);
  g.lineTo(42, 44);
  g.lineTo(32, 61);
  g.closePath();
  g.fill();
  g.beginPath();
  g.arc(32, 26, 21, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#ffffff';
  g.fillRect(23, 14, 3, 25);
  g.beginPath();
  g.moveTo(26, 14);
  g.lineTo(43, 20);
  g.lineTo(26, 27);
  g.closePath();
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const flagViews = TEAMS.map((team, i) => {
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(poleGeo, poleMat),
    new THREE.Mesh(clothGeo, new THREE.MeshLambertMaterial({ color: team.color, side: THREE.DoubleSide })),
  );
  const stand = new THREE.Mesh(standGeo, new THREE.MeshBasicMaterial({ color: team.color, transparent: true, opacity: 0.6, depthWrite: false }));
  stand.position.set(MAP.flags[i][0], 0.03, MAP.flags[i][1]);
  // Oznaka se vidi kroz zidove (depthTest isključen) i uvijek je iste veličine na ekranu.
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({
    map: markerTexture(team.color), depthTest: false, depthWrite: false, sizeAttenuation: false, fog: false,
  }));
  marker.renderOrder = 20;
  group.visible = stand.visible = marker.visible = false;
  scene.add(group, stand, marker);
  return { group, stand, marker };
});
const MARKER_SIZE = 0.055 / Math.tan((75 * Math.PI) / 360); // udio visine ekrana kod običnog FOV-a

function updateFlags(t) {
  const ctf = mode === 'ctf' && !!flagState;
  const ms = MARKER_SIZE * Math.tan((camera.fov * Math.PI) / 360); // isti broj piksela i kad nišaniš
  for (let i = 0; i < 2; i++) {
    const v = flagViews[i];
    v.stand.visible = mode === 'ctf';
    const f = ctf ? flagState[i] : null;
    // Zastavu koju nosim ne crtam (bila bi mi pred očima); HUD javlja da je nosim.
    if (!f || (f[0] === 1 && f[4] === me.id)) {
      v.group.visible = v.marker.visible = false;
      continue;
    }
    let x = f[1], y = f[2], z = f[3];
    v.group.scale.setScalar(1);
    v.group.rotation.y = i === 0 ? Math.PI / 4 : -Math.PI * 0.75;
    if (f[0] === 1) {
      // Nošena zastava: manja, iza glave nosača, platno se vije unatrag.
      const r = roster.get(f[4]);
      let yaw = 0;
      if (r && r.av && r.av.root.visible) {
        const a = r.av.root;
        x = a.position.x;
        y = a.position.y;
        z = a.position.z;
        yaw = a.rotation.y;
      }
      x += Math.sin(yaw) * 0.3;
      z += Math.cos(yaw) * 0.3;
      y += r && r.av && r.av.crouch ? 0.55 : 1.0;
      v.group.scale.setScalar(0.6);
      v.group.rotation.y = yaw - Math.PI / 2;
    }
    v.group.visible = v.marker.visible = true;
    v.group.position.set(x, y, z);
    v.marker.position.set(x, y + (f[0] === 1 ? 1.9 : 3.1), z);
    v.marker.scale.set(ms, ms, 1);
  }
  if (!ctf) return;
  const k = t * 0.006;
  for (let i = 0; i < clothPos.count; i++) clothPos.setZ(i, Math.sin(k - clothU[i] * 5) * 0.12 * clothU[i]);
  clothPos.needsUpdate = true;
}

/* ================================================================ zvuk (sve se generira, nema datoteka) */

const sfx = (() => {
  let ctx = null, master = null, noise = null;
  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = settings.volume;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function out(pan) {
    if (!pan || !ctx.createStereoPanner) return master;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(master);
    return p;
  }
  function shot(vol = 1, far = false, pan = 0) {
    if (!ctx || vol < 0.01) return;
    const t = ctx.currentTime;
    const dest = out(pan);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(far ? 1400 : 5000, t);
    lp.frequency.exponentialRampToValueAtTime(250, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (far ? 0.9 : 0.55));
    src.connect(lp);
    lp.connect(g);
    g.connect(dest);
    src.start(t);
    src.stop(t + 1);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.9 * vol, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(og);
    og.connect(dest);
    o.start(t);
    o.stop(t + 0.32);
  }
  function tone(freq, dur, vol, type = 'square', delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  return {
    init,
    setVolume: (v) => { if (master) master.gain.value = v; },
    shot,
    hit: () => tone(1100, 0.06, 0.2),
    head: () => { tone(1500, 0.08, 0.25, 'sine'); tone(2100, 0.14, 0.22, 'sine', 0.06); },
    kill: () => { tone(700, 0.08, 0.25, 'triangle'); tone(1050, 0.16, 0.25, 'triangle', 0.08); },
    hurt: () => tone(140, 0.18, 0.3, 'sawtooth'),
    boom: (vol) => {
      if (!ctx || vol < 0.01) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1200, t);
      lp.frequency.exponentialRampToValueAtTime(70, t + 1.2);
      const g = ctx.createGain();
      g.gain.setValueAtTime(1.0 * vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
      src.connect(lp);
      lp.connect(g);
      g.connect(master);
      src.start(t);
      src.stop(t + 1.35);
      tone(60, 0.5, 0.9 * vol, 'sine');
    },
    // Pištolj: kraći i oštriji pucanj od puške (eksplozija ima svoj zvuk).
    pistol: (vol = 1, pan = 0) => {
      if (!ctx || vol < 0.01) return;
      const t = ctx.currentTime;
      const dest = out(pan);
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2600, t);
      bp.frequency.exponentialRampToValueAtTime(500, t + 0.15);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.8 * vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      src.connect(bp);
      bp.connect(g);
      g.connect(dest);
      src.start(t);
      src.stop(t + 0.2);
    },
    draw: () => { tone(420, 0.04, 0.1); tone(950, 0.03, 0.08, 'square', 0.07); },
    slide: () => {
      if (!ctx) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(900, t);
      bp.frequency.exponentialRampToValueAtTime(300, t + 0.6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.32, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
      src.connect(bp);
      bp.connect(g);
      g.connect(master);
      src.start(t);
      src.stop(t + 0.7);
    },
    reward: () => { tone(660, 0.1, 0.2, 'triangle'); tone(880, 0.1, 0.2, 'triangle', 0.1); tone(1320, 0.2, 0.22, 'triangle', 0.2); },
    bolt:() => { tone(2400, 0.02, 0.12); tone(1800, 0.02, 0.12, 'square', 0.12); },
    reload: () => { tone(900, 0.03, 0.12); tone(700, 0.03, 0.12, 'square', 0.9); tone(1200, 0.03, 0.12, 'square', 1.9); },
  };
})();

/* ================================================================ stanje igre */

const me = {
  id: 0, body: createBody(), yaw: 0, pitch: 0, eye: P.eye,
  hp: MAX_HP, alive: false, ammo: W.mag, reloading: false, reloadEnd: 0, lastShot: -1e9,
  scoped: false, scopeStart: 0, zoom: 0, spawnSeq: 0, protectUntil: 0, deadAt: 0, killer: '',
  streak: 0,
  // weapon: 'rifle' | 'pistol'. Metke pištolja oduzimamo sami (kao server), a poruka 'pistol' ih ispravlja.
  weapon: 'rifle', pistolAmmo: 0, pistolLastShot: -1e9, switchAt: -1e9,
};
const input = { keys: new Set(), rmb: false };
const roster = new Map(); // id -> { id, name, hue, kills, deaths, bot, alive, snaps, av }
let ws = null;
let inGame = false;
let locked = false;
let ended = false;
let roomCode = '';
let timeLeft = MATCH_TIME;
let rtt = 0;
let lastSend = 0;
let lastPing = 0;
let flashAt = -1e9;
let vmKick = 0;
let bobT = 0;
let hitUntil = 0;
let dmgDirUntil = 0;
let vignetteUntil = 0;
let centerUntil = 0;
let endInfo = null;
let isAdmin = false;
let cheats = {};
let lostReason = '';
let myVote = null;
let shakeUntil = 0;
let shakeAmp = 0;
// Način igre sobe i timski rezultat. flagState: [[stanje, x, y, z, idNosača], ...] iz stanja sa servera (CTF).
let mode = 'ffa';
let teamScore = [0, 0];
let scoreLimit = 0;
let flagState = null;
me.team = null;
const RAPID_COOLDOWN = 150; // ms, mora odgovarati serveru
const cooldownMs = () => (cheats.rapid ? RAPID_COOLDOWN : W.cooldown * 1000);

function send(m) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}

function addRoster(p) {
  roster.set(p.id, {
    id: p.id, name: p.name, hue: p.hue, kills: p.kills || 0, deaths: p.deaths || 0, bot: !!p.bot,
    skin: SKINS.includes(p.skin) ? p.skin : 'klasik', alive: false, snaps: [], av: null,
    team: p.team === 0 || p.team === 1 ? p.team : null,
  });
}

/* ================================================================ timovi */

// Tekst na tamnoj podlozi: malo svjetlije od boja timova.
const TEAM_TEXT = ['#ff6d60', '#6aa4ff'];
const TEAM_ACC = ['crvenu', 'plavu'];   // "uzima plavu zastavu"
const TEAM_NOM = ['Crvena', 'Plava'];   // "Plava zastava vraćena"
const TEAM_PL = ['Crvene', 'Plave'];    // "prelazi u Plave"

const teamMode = () => mode === 'tdm' || mode === 'ctf';
const hasTeam = (r) => teamMode() && r && (r.team === 0 || r.team === 1);

// Lik se mora ponovno složiti kad igrač promijeni tim ili soba način (druga boja).
function resetAvatar(r) {
  if (!r.av) return;
  disposeAvatar(r.av);
  r.av = null;
}

function updateRoomInfo() {
  $('roomInfo').textContent = `Soba: ${roomCode} · ${MODE_NAMES[mode] || ''} · slajdanje ${roomSlide ? 'dopušteno' : 'zabranjeno'} · igrača: ${roster.size}`;
  if ($('adminSlide')) $('adminSlide').checked = roomSlide;
  const btn = $('teamBtn');
  btn.hidden = !teamMode() || me.team === null;
  if (!btn.hidden) btn.textContent = `Promijeni tim (sada: ${TEAMS[me.team].name})`;
  if ([...$('adminMode').options].some((o) => o.value === mode)) $('adminMode').value = mode;
}

function onMode(m) {
  mode = MODES.includes(m.mode) ? m.mode : 'ffa';
  scoreLimit = m.lim || 0;
  teamScore = [0, 0];
  flagState = null;
  for (const p of m.players) {
    const r = roster.get(p.id);
    if (!r) continue;
    r.team = p.team === 0 || p.team === 1 ? p.team : null;
    resetAvatar(r);
  }
  me.team = roster.get(me.id)?.team ?? null;
  centerMsg(`${MODE_NAMES[mode]}${me.team !== null ? ` · tvoj tim: ${TEAMS[me.team].name}` : ''}`, 3500);
  feedSystem(`Način igre: ${MODE_NAMES[mode]}`);
  updateRoomInfo();
}

function onTeam(m) {
  if (m.err) {
    centerMsg(m.err, 2500);
    return;
  }
  const r = roster.get(m.id);
  if (!r) return;
  r.team = m.team;
  resetAvatar(r);
  if (m.id === me.id) {
    me.team = m.team;
    centerMsg(`Sada si u timu: ${TEAMS[m.team].name}`, 2500);
    updateRoomInfo();
  } else {
    feedSystem(`${r.name} prelazi u ${TEAM_PL[m.team]}`);
  }
}

// Događaji sa zastavama: e = take | drop | ret | cap, f = čija je zastava, id = igrač (0 = sama se vratila).
function onFlag(m) {
  const r = roster.get(m.id);
  const name = r ? r.name : '?';
  const row = feedRow(m.id === me.id ? 'mine flag' : 'flag');
  const flagSpan = (text) => span(text, TEAM_TEXT[m.f]);
  if (m.e === 'take') {
    row.append(span(name, playerColor(r)), span(' uzima '), flagSpan(`${TEAM_ACC[m.f]} zastavu`));
    if (m.id === me.id) centerMsg('IMAŠ ZASTAVU! Nosi je do svog postolja', 3000);
    else if (m.f === me.team) centerMsg('Uzeli su vam zastavu!', 2000);
  } else if (m.e === 'drop') {
    row.append(span(name, playerColor(r)), span(' ispušta '), flagSpan(`${TEAM_ACC[m.f]} zastavu`));
  } else if (m.e === 'ret') {
    if (m.id) row.append(span(name, playerColor(r)), span(' vraća '), flagSpan(`${TEAM_ACC[m.f]} zastavu`));
    else row.append(flagSpan(`${TEAM_NOM[m.f]} zastava vraćena`));
  } else if (m.e === 'cap') {
    const team = 1 - m.f;
    row.append(span(`${TEAMS[team].name} su osvojili zastavu!`, TEAM_TEXT[team]));
    centerMsg(team === me.team ? 'OSVOJILI STE ZASTAVU!' : `${TEAMS[team].name} su osvojili zastavu`, 2500);
    if (team === me.team) sfx.kill();
  }
}

function flagText(i) {
  const f = flagState[i];
  if (f[0] === 0) return 'u bazi';
  if (f[0] === 2) return 'pala';
  if (f[4] === me.id) return 'NOSIŠ JE TI';
  return `NOSI je ${roster.get(f[4])?.name || '?'}`;
}

function removeRoster(id) {
  const r = roster.get(id);
  if (r && r.av) disposeAvatar(r.av);
  roster.delete(id);
}

/* ================================================================ mreža */

function connect(name, room, bots, skin, gameMode, slide) {
  $('play').disabled = true;
  $('lobbyError').textContent = 'Spajanje… (ako server spava, prvi put može trajati do minute)';
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  const timeout = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      ws.close();
      failLobby('Ne mogu se spojiti na server. Ako ste u školi, mreža možda blokira igru.');
    }
  }, 60000);
  ws.onopen = () => {
    clearTimeout(timeout);
    send({ t: 'join', name, room, bots, skin, mode: gameMode, slide });
  };
  ws.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    handle(m);
  };
  ws.onclose = () => {
    clearTimeout(timeout);
    if (inGame) showLost(lostReason || 'Server je prekinuo vezu ili je pao internet.');
    else failLobby($('lobbyError').textContent.startsWith('Spajanje') ? 'Veza nije uspjela. Pokušaj ponovno.' : $('lobbyError').textContent);
  };
}

function failLobby(msg) {
  $('play').disabled = false;
  $('lobbyError').textContent = msg;
}

function showLost(msg) {
  inGame = false;
  if (document.pointerLockElement) document.exitPointerLock();
  $('lostMsg').textContent = msg;
  $('pause').hidden = true;
  $('lost').hidden = false;
}

function handle(m) {
  switch (m.t) {
    case 's': onSnap(m); break;
    case 'welcome': onWelcome(m); break;
    case 'spawn': onSpawn(m); break;
    case 'shot': onShot(m); break;
    case 'hit': onHit(m); break;
    case 'dmg': onDamage(m); break;
    case 'kill': onKill(m); break;
    case 'corr':
      me.body.x = m.x; me.body.y = m.y; me.body.z = m.z;
      me.body.vx = me.body.vy = me.body.vz = 0;
      me.body.slideT = 0;
      me.body.stepped = 0;
      break;
    case 'join':
      addRoster(m);
      feedSystem(`${m.name} je ušao`);
      renderAdminPlayers();
      break;
    case 'leave': {
      const r = roster.get(m.id);
      if (r) feedSystem(`${r.name} je izašao`);
      removeRoster(m.id);
      renderAdminPlayers();
      break;
    }
    case 'pong': {
      const sample = performance.now() - m.ct;
      rtt = rtt ? rtt * 0.7 + sample * 0.3 : sample;
      break;
    }
    case 'end': onEnd(m); break;
    case 'votes': onVotes(m); break;
    case 'mode': onMode(m); break;
    case 'team': onTeam(m); break;
    case 'flag': onFlag(m); break;
    case 'reset':
      ended = false;
      endInfo = null;
      teamScore = [0, 0];
      $('end').hidden = true;
      for (const r of roster.values()) { r.kills = 0; r.deaths = 0; }
      me.pistolAmmo = 0;
      me.streak = 0;
      centerMsg(`NOVA RUNDA · ${MODE_NAMES[m.mode] || ''}`, 2500);
      if (inGame && !locked) $('pause').hidden = false;
      break;
    case 'err':
      failLobby(m.msg);
      break;
    case 'admin': onAdminState(m); break;
    case 'rules':
      roomSlide = !!m.slide;
      feedSystem(`Slajdanje je sada ${roomSlide ? 'dopušteno' : 'zabranjeno'}`);
      updateRoomInfo();
      break;
    case 'pistol': me.pistolAmmo = m.n; break;
    case 'streak': {
      if (m.id === me.id) {
        centerMsg('💥 EKSPLOZIVNI PIŠTOLJ! Tipka 2', 2500);
        sfx.reward();
        break;
      }
      const r = roster.get(m.id);
      if (r) feedSystem(`${r.name} ima niz od ${m.n} i eksplozivni pištolj!`);
      break;
    }
    case 'boom': boom(m.x, m.y, m.z, m.r || PISTOL.radius); break;
    case 'announce':
      centerMsg(m.text, 5000);
      feedSystem(`Admin: ${m.text}`);
      break;
    case 'kicked':
      lostReason = 'Admin te izbacio iz sobe.';
      break;
    default: break;
  }
}

function onWelcome(m) {
  for (const id of [...roster.keys()]) removeRoster(id);
  me.id = m.id;
  for (const p of m.players) addRoster(p);
  timeLeft = m.tl;
  ended = m.state === 'end';
  roomCode = m.room;
  mode = MODES.includes(m.mode) ? m.mode : 'ffa';
  roomSlide = m.slide !== false;
  teamScore = m.teamScore || [0, 0];
  scoreLimit = m.scoreLimit || 0;
  me.team = m.team === 0 || m.team === 1 ? m.team : null;
  inGame = true;
  $('lobby').hidden = true;
  $('hud').hidden = false;
  destroyPreview();
  $('settingsPause').append($('settings'));
  updateRoomInfo();
  if (me.team !== null) centerMsg(`${MODE_NAMES[mode]} · tvoj tim: ${TEAMS[me.team].name}`, 4000);
  $('pause').hidden = false;
  const savedKey = readAdminKey();
  if (savedKey) send({ t: 'alogin', key: savedKey });
  try {
    history.replaceState(null, '', `?soba=${encodeURIComponent(roomCode)}`);
  } catch {
    /* nije bitno */
  }
}

function onSpawn(m) {
  const b = me.body;
  b.x = m.x; b.y = m.y; b.z = m.z;
  b.vx = b.vy = b.vz = 0;
  b.crouch = false;
  b.slideT = 0;
  b.stepped = 0;
  camStep = 0;
  me.yaw = m.yaw;
  me.pitch = 0;
  me.eye = P.eye;
  me.alive = true;
  me.hp = MAX_HP;
  me.ammo = W.mag;
  me.reloading = false;
  me.lastShot = -1e9;
  me.scoped = false;
  me.weapon = 'rifle';
  me.switchAt = performance.now();
  me.spawnSeq = m.q;
  me.protectUntil = performance.now() + m.prot * 1000;
  $('death').hidden = true;
}

function onSnap(m) {
  const t = performance.now();
  const seen = new Set();
  for (const [id, x, y, z, yaw, pitch, f] of m.p) {
    seen.add(id);
    if (id === me.id) continue;
    const r = roster.get(id);
    if (!r) continue;
    r.alive = true;
    r.snaps.push({ t, x, y, z, yaw, pitch, f });
    if (r.snaps.length > 30) r.snaps.shift();
  }
  for (const r of roster.values()) {
    if (r.id !== me.id && !seen.has(r.id) && r.alive) {
      r.alive = false;
      r.snaps.length = 0;
    }
  }
  timeLeft = m.tl;
  if (m.ts) teamScore = m.ts;
  flagState = m.fl || null;
}

function gunTip() {
  const v = new THREE.Vector3(0.18, -0.12, -0.7);
  camera.localToWorld(v);
  return [v.x, v.y, v.z];
}

// m.w === 'p': hitac eksplozivnog pištolja (eksplozija stiže posebno, kao 'boom').
function onShot(m) {
  const own = m.id === me.id;
  const pistol = m.w === 'p';
  tracer(own ? gunTip() : m.o, m.e, own ? 0.2 : 0.35, pistol ? 0xffa050 : 0xfff0b0);
  if (m.h) hitEffect(m);
  else puff(m.e, '#d8cdb5');
  if (own) return;
  const dx = m.o[0] - camera.position.x;
  const dz = m.o[2] - camera.position.z;
  const dist = Math.hypot(dx, m.o[1] - camera.position.y, dz);
  const rel = angDiff(me.yaw, Math.atan2(-dx, -dz));
  if (pistol) sfx.pistol(Math.min(1, 20 / (dist + 10)), -Math.sin(rel));
  else sfx.shot(Math.min(1, 25 / (dist + 10)), dist > 40, -Math.sin(rel));
}

function onHit(m) {
  hitUntil = performance.now() + 150;
  $('hitmarker').classList.toggle('head', m.part === 'head');
  if (m.kill) sfx.kill();
  else if (m.part === 'head') sfx.head();
  else sfx.hit();
}

function onDamage(m) {
  me.hp = m.hp;
  const t = performance.now();
  vignetteUntil = t + 400;
  dmgDirUntil = t + 1200;
  const rel = angDiff(me.yaw, Math.atan2(-(m.fx - me.body.x), -(m.fz - me.body.z)));
  $('dmgdir').style.transform = `translate(-50%, -50%) rotate(${(-rel * 180) / Math.PI}deg)`;
  sfx.hurt();
}

function onKill(m) {
  const k = roster.get(m.k);
  const v = roster.get(m.v);
  if (k) k.kills = m.kk;
  if (v) v.deaths = m.vd;
  killEffect(m); // prije svega ostalog: treba još vidljiv lik žrtve
  const pistol = m.w === 'pistol';
  const noScope = !!m.ns;
  feedKill(k, v, m.hs, pistol, noScope);
  if (noScope && k && v) feedSystem(`${k.name} je no-scopeao ${v.name}!`);
  if (m.v === me.id) {
    me.alive = false;
    me.hp = 0;
    me.scoped = false;
    me.streak = 0;
    me.deadAt = performance.now();
    let by = '';
    if (k && pistol) by = `Raznio te banana-pištolj: ${k.name}`;
    else if (k && noScope) by = `${k.name} te no-scopeao!${m.hs ? ' (headshot)' : ''}`;
    else if (k) by = `Srušio te ${k.name}${m.hs ? ' (headshot)' : ''}`;
    $('deathBy').textContent = by;
    $('death').hidden = false;
  }
  if (m.k === me.id) {
    me.streak++;
    const text = pistol ? 'BUM!' : noScope ? (m.hs ? 'NO-SCOPE HEADSHOT!' : 'NO-SCOPE!') : m.hs ? 'HEADSHOT!' : 'ELIMINACIJA';
    centerMsg(text, noScope ? 2200 : 1400);
  }
  if (!$('board').hidden) renderBoard($('board'), 'Rezultati');
}

function onEnd(m) {
  ended = true;
  me.scoped = false;
  for (const row of m.board) {
    const r = roster.get(row.id);
    if (r) { r.kills = row.kills; r.deaths = row.deaths; }
  }
  endInfo = { until: performance.now() + m.next * 1000, winner: m.board[0] };
  if (m.ts) teamScore = m.ts;
  let title = m.board[0] ? `Pobjednik: ${m.board[0].name}` : 'Kraj runde';
  if (m.win === 0 || m.win === 1) title = `Pobjeda: ${TEAMS[m.win].name}!`;
  else if (m.win === -1) title = 'Neriješeno!';
  renderBoard($('end'), title);
  if (m.win === 0 || m.win === 1) $('end').querySelector('h3').style.color = TEAM_TEXT[m.win];
  myVote = null;
  $('end').append(buildVote(m.mode));
  const next = document.createElement('div');
  next.className = 'next';
  next.id = 'endNext';
  $('end').append(next);
  $('end').hidden = false;
}

// Glasanje za način sljedeće runde: tipke 1/2/3 ili klik (kad miš nije zaključan).
function buildVote(current) {
  const box = document.createElement('div');
  box.className = 'vote';
  const title = document.createElement('div');
  title.className = 'vote-title';
  title.textContent = `Glasaj za sljedeći način (tipke 1, 2, 3). Bez glasova ostaje: ${MODE_NAMES[current]}`;
  const row = document.createElement('div');
  row.className = 'vote-row';
  MODES.forEach((mode, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.vote = mode;
    const key = document.createElement('span');
    key.className = 'key';
    key.textContent = `[${i + 1}]`;
    const cnt = document.createElement('span');
    cnt.className = 'cnt';
    cnt.textContent = '0';
    b.append(key, document.createTextNode(MODE_NAMES[mode]), cnt);
    b.addEventListener('click', () => castVote(mode));
    row.append(b);
  });
  box.append(title, row);
  return box;
}

function castVote(mode) {
  if (!ended || !MODES.includes(mode)) return;
  myVote = mode;
  send({ t: 'vote', mode });
  for (const b of document.querySelectorAll('[data-vote]')) b.classList.toggle('mine', b.dataset.vote === mode);
}

function onVotes(m) {
  for (const b of document.querySelectorAll('[data-vote]')) {
    const cnt = b.querySelector('.cnt');
    if (cnt) cnt.textContent = String(m.v[b.dataset.vote] || 0);
  }
}

/* ================================================================ obavijesti */

function feedRow(cls) {
  const row = document.createElement('div');
  row.className = `feed-row ${cls}`;
  const feed = $('killfeed');
  feed.prepend(row);
  while (feed.children.length > 5) feed.lastChild.remove();
  setTimeout(() => row.remove(), 6000);
  return row;
}

function span(text, color) {
  const s = document.createElement('span');
  s.textContent = text;
  if (color) s.style.color = color;
  return s;
}

function playerColor(r) {
  if (hasTeam(r)) return TEAM_TEXT[r.team];
  return r ? `hsl(${r.hue} 70% 65%)` : '#fff';
}

function feedKill(k, v, hs, pistol, noScope) {
  const row = feedRow(k?.id === me.id || v?.id === me.id ? 'mine' : '');
  row.append(span(k ? k.name : '?', playerColor(k)), span(pistol ? '  💥  ' : '  ▸  '), span(v ? v.name : '?', playerColor(v)));
  if (noScope) {
    const n = span('  NO-SCOPE');
    n.className = 'ns';
    row.append(n);
  }
  if (hs) {
    const h = span('  HEADSHOT');
    h.className = 'hs';
    row.append(h);
  }
}

function feedSystem(text) {
  feedRow('system').append(span(text));
}

function centerMsg(text, ms) {
  $('center').textContent = text;
  centerUntil = performance.now() + ms;
}

function renderBoard(el, title) {
  const sorted = [...roster.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  el.replaceChildren();
  const h = document.createElement('h3');
  h.textContent = title;
  const table = document.createElement('table');
  const head = document.createElement('tr');
  for (const [text, cls] of [['#', 'n'], ['Igrač', ''], ['K', 'n'], ['D', 'n']]) {
    const th = document.createElement('th');
    th.textContent = text;
    if (cls) th.className = cls;
    head.append(th);
  }
  table.append(head);
  // U timskim načinima: prvo crveni, pa plavi, svaki tim sa svojim zaglavljem i rezultatom.
  const groups = teamMode() ? [0, 1].map((tm) => sorted.filter((r) => r.team === tm)) : [sorted];
  groups.forEach((rows, tm) => {
    if (teamMode()) {
      const tr = document.createElement('tr');
      tr.className = `team-head t${tm}`;
      const td = document.createElement('td');
      td.colSpan = 4;
      td.textContent = `${TEAMS[tm].name.toUpperCase()} · ${teamScore[tm]}${scoreLimit ? ` / ${scoreLimit}` : ''}`;
      tr.append(td);
      table.append(tr);
    }
    appendBoardRows(table, rows);
  });
  el.append(h, table);
}

function appendBoardRows(table, rows) {
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    if (r.id === me.id) tr.className = 'me';
    const cells = [String(i + 1), r.name, String(r.kills), String(r.deaths)];
    cells.forEach((text, j) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (j !== 1) td.className = 'n';
      if (j === 1 && r.bot) {
        const b = document.createElement('span');
        b.className = 'bot';
        b.textContent = 'BOT';
        td.append(b);
      }
      if (j === 1 && hasTeam(r)) td.style.color = TEAM_TEXT[r.team];
      tr.append(td);
    });
    table.append(tr);
  });
}

/* ================================================================ pucanje */

function shoot() {
  const t = performance.now();
  if (!me.alive || ended || me.reloading) return;
  if (t - me.lastShot < cooldownMs()) return;
  if (me.ammo <= 0) {
    reload();
    return;
  }
  sendUpdate(t);
  const d = aimDir(me.yaw, me.pitch);
  send({ t: 'shoot', d: d.map(r4) });
  if (!cheats.ammo) me.ammo--;
  me.lastShot = t;
  if (!cheats.rapid) me.scoped = false;
  me.protectUntil = 0;
  if (me.ammo <= 0) {
    me.reloading = true;
    me.reloadEnd = t + W.reload * 1000;
    setTimeout(() => sfx.reload(), 300);
  } else if (!cheats.rapid) {
    setTimeout(() => sfx.bolt(), 380);
  }
  me.pitch = Math.min(1.5, me.pitch + 0.03);
  vmKick = 1;
  flashAt = t;
  sfx.shot(1);
}

const hasPistol = () => me.pistolAmmo > 0 || !!cheats.pistol;

// Eksplozivni pištolj: bez nišana, 0.3 s između metaka. Server provjerava sve isto i radi eksploziju.
function shootPistol() {
  const t = performance.now();
  if (!me.alive || ended || !hasPistol()) return;
  if (t - me.pistolLastShot < PISTOL.cooldown * 1000) return;
  sendUpdate(t);
  send({ t: 'shoot', d: aimDir(me.yaw, me.pitch).map(r4), w: 'pistol' });
  if (!cheats.pistol) me.pistolAmmo = Math.max(0, me.pistolAmmo - 1);
  me.pistolLastShot = t;
  me.protectUntil = 0;
  me.pitch = Math.min(1.5, me.pitch + 0.015);
  vmKick = 1;
  flashAt = t;
  sfx.pistol(1);
}

// '1' puška, '2' pištolj (samo s metcima ili cheatom), Q i kotačić (bez nišana) mijenjaju.
function selectWeapon(w, hint = true) {
  if (w === me.weapon || !me.alive) return;
  if (w === 'pistol' && !hasPistol()) {
    if (hint) centerMsg('Pištolj dobiješ za 3 ubojstva zaredom', 1500);
    return;
  }
  me.weapon = w;
  me.scoped = false;
  me.switchAt = performance.now();
  sfx.draw();
}

function toggleWeapon(hint) {
  selectWeapon(me.weapon === 'pistol' ? 'rifle' : 'pistol', hint);
}

function reload() {
  if (!me.alive || me.reloading || me.ammo >= W.mag) return;
  me.reloading = true;
  me.reloadEnd = performance.now() + W.reload * 1000;
  send({ t: 'reload' });
  sfx.reload();
}

/* ================================================================ petlja */

function updateMe(t, dt) {
  const b = me.body;
  if (me.reloading && t >= me.reloadEnd) {
    me.reloading = false;
    me.ammo = W.mag;
  }
  // Pištolj je prazan (ili je nova runda, ili je cheat ugašen): nakon zadnjeg bljeska natrag na pušku.
  if (me.weapon === 'pistol' && !hasPistol() && t - me.pistolLastShot > 250) selectWeapon('rifle');
  if (me.alive) {
    const k = input.keys;
    let f = 0, r = 0;
    if (locked) {
      f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    }
    const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
    const boltReady = t - me.lastShot >= cooldownMs();
    const wantScope = locked && input.rmb && me.weapon === 'rifle' && !me.reloading && boltReady && !ended;
    if (wantScope && !me.scoped) {
      me.scoped = true;
      me.scopeStart = t;
    } else if (!wantScope && me.scoped) {
      me.scoped = false;
    }
    const up = locked && k.has('Space');
    const down = locked && (k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyC'));
    // Trčanje: Shift, samo prema naprijed, ne s nišanom, ne u čučnju.
    me.sprinting = locked && f > 0 && !down && !me.scoped && (k.has('ShiftLeft') || k.has('ShiftRight'));
    if (cheats.fly) {
      fly(b, f, r, up, down, dt);
    } else {
      stepBody(b, {
        wx: -sy * f + cy * r,
        wz: -cy * f - sy * r,
        jump: up,
        crouch: down,
        scoped: me.scoped,
        sprint: me.sprinting,
        canSlide: roomSlide,
        speedMul: cheats.speed ? 2 : 1,
        jumpMul: cheats.speed ? 1.6 : 1,
      }, dt, MAP.boxes);
    }
  } else {
    me.scoped = false;
    me.sprinting = false;
  }
  const eyeTarget = me.alive ? eyeHeight(b.crouch) : 0.45;
  me.eye += (eyeTarget - me.eye) * Math.min(1, dt * 12);
  // Stepenice: fizika skače po 0.5 m, a kamera to izgladi pa nema trzanja gore ni dolje.
  camStep -= b.stepped;
  b.stepped = 0;
  camStep *= Math.exp(-dt * 13);
  if (Math.abs(camStep) > 0.9) camStep = 0;
  const sliding = me.alive && b.slideT > 0;
  if (sliding && !wasSliding) sfx.slide();
  wasSliding = sliding;
  slideK += ((sliding ? 1 : 0) - slideK) * Math.min(1, dt * 12);
  camera.position.set(b.x, b.y + me.eye + camStep, b.z);
  camera.rotation.set(me.pitch, me.yaw, me.alive ? slideK * 0.07 : 0.35);
  if (t < shakeUntil) {
    const a = shakeAmp * ((shakeUntil - t) / 450);
    camera.rotation.x += (Math.random() - 0.5) * a;
    camera.rotation.y += (Math.random() - 0.5) * a;
  }
  const sprintFov = (me.sprinting && Math.hypot(b.vx, b.vz) > P.walk ? 6 : 0) + slideK * 9;
  const targetFov = me.scoped ? W.zoom[me.zoom] : BASE_FOV + sprintFov;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 20);
    camera.updateProjectionMatrix();
  }
}

// Admin letenje: bez gravitacije i zidova, u smjeru pogleda.
function fly(b, f, r, up, down, dt) {
  const speed = (cheats.speed ? 30 : 15) * dt;
  const [fx, fy, fz] = aimDir(me.yaw, me.pitch);
  const rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
  const A = MAP.arena - 0.5;
  b.x = Math.max(-A, Math.min(A, b.x + (fx * f + rx * r) * speed));
  b.z = Math.max(-A, Math.min(A, b.z + (fz * f + rz * r) * speed));
  b.y = Math.max(0, Math.min(58, b.y + (fy * f + (up ? 1 : 0) - (down ? 1 : 0)) * speed));
  b.vx = b.vy = b.vz = 0;
  b.onGround = b.y <= 0;
  b.crouch = false;
}

function updateOthers(t) {
  const rt = t - INTERP_DELAY;
  for (const r of roster.values()) {
    if (r.id === me.id) continue;
    if (!r.alive || r.snaps.length === 0) {
      if (r.av) r.av.root.visible = false;
      continue;
    }
    if (!r.av) {
      r.av = hasTeam(r)
        ? makeAvatar(TEAMS[r.team].hue, r.name, r.skin, true, TEAM_TEXT[r.team])
        : makeAvatar(r.hue, r.name, r.skin);
      setWallhack(r.av, !!cheats.wall);
      scene.add(r.av.root);
    }
    const s = r.snaps;
    let a = s[0], b = s[0];
    if (rt >= s[s.length - 1].t) {
      a = b = s[s.length - 1];
    } else {
      for (let i = s.length - 1; i > 0; i--) {
        if (s[i - 1].t <= rt) { a = s[i - 1]; b = s[i]; break; }
      }
    }
    const k = b.t > a.t ? Math.min(1, Math.max(0, (rt - a.t) / (b.t - a.t))) : 1;
    const av = r.av;
    av.root.visible = true;
    av.root.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
    av.root.rotation.y = a.yaw + angDiff(a.yaw, b.yaw) * k;
    const pitch = a.pitch + (b.pitch - a.pitch) * k;
    av.head.rotation.x = pitch;
    av.gunPivot.rotation.x = pitch;
    setCrouch(av, !!(b.f & 1));
    av.glint.visible = !!(b.f & 2);
    setProtected(av, !!(b.f & 4));
    setHoldsPistol(av, !!(b.f & 8));
  }
}

function updateViewmodel(t, dt) {
  const b = me.body;
  const speed = Math.hypot(b.vx, b.vz);
  bobT += dt * speed * 1.8;
  const bob = b.onGround ? Math.min(1, speed / P.walk) : 0;
  vmKick = Math.max(0, vmKick - dt * 4);
  const swayX = Math.sin(bobT) * 0.012 * bob;
  const swayY = Math.abs(Math.cos(bobT)) * 0.012 * bob;
  // Promjena oružja: novo oružje kratko se podigne odozdo (180 ms).
  const raise = Math.min(1, (t - me.switchAt) / 180);
  // Pri trčanju oružje se spusti i nagne (glatko), kao u pravim pucačinama.
  sprintK += ((me.sprinting ? 1 : 0) - sprintK) * Math.min(1, dt * 10);
  const low = (1 - raise) * (1 - raise) + sprintK * 0.12;
  const flash = t - flashAt < 55;
  const pistolOut = me.weapon === 'pistol';
  vm.visible = !pistolOut;
  pistolVm.visible = pistolOut;
  muzzle.visible = !pistolOut && flash;
  pistolVm.userData.flash.visible = pistolOut && flash;
  if (pistolOut) {
    pistolVm.position.set(PISTOL_VM_POS[0] + swayX, PISTOL_VM_POS[1] + swayY - low * 0.25, PISTOL_VM_POS[2] + vmKick * 0.05);
    pistolVm.rotation.set(vmKick * 0.3 - low * 0.9, sprintK * 0.5, sprintK * 0.3 + slideK * 0.35);
    return;
  }
  const reloadK = me.reloading ? Math.sin(Math.min(1, Math.max(0, (me.reloadEnd - t) / (W.reload * 1000))) * Math.PI) : 0;
  vm.position.set(
    0.2 + swayX,
    -0.2 + swayY - reloadK * 0.15 - low * 0.25,
    -0.5 + vmKick * 0.08,
  );
  vm.rotation.set(vmKick * 0.12 - reloadK * 0.6 - low * 0.9, sprintK * 0.45, reloadK * 0.4 + sprintK * 0.35 + slideK * 0.4);
  const since = (t - me.lastShot) / 1000;
  if (since < W.cooldown && !me.reloading) vm.rotation.z += Math.sin((since / W.cooldown) * Math.PI) * 0.25;
}

function sendUpdate(t) {
  lastSend = t;
  const b = me.body;
  send({
    t: 'u', x: r3(b.x), y: r3(b.y), z: r3(b.z), yaw: r3(me.yaw), pitch: r3(me.pitch),
    c: b.crouch ? 1 : 0, g: b.onGround ? 1 : 0, s: me.scoped ? 1 : 0, h: me.weapon === 'pistol' ? 1 : 0, q: me.spawnSeq,
  });
}

function net(t) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (me.alive && t - lastSend >= 50) sendUpdate(t);
  if (t - lastPing >= 2000) {
    lastPing = t;
    send({ t: 'ping', ct: t, rtt: Math.round(rtt) });
  }
}

/* ================================================================ HUD */

const hudCache = new Map();
function setText(id, text) {
  if (hudCache.get(id) === text) return;
  hudCache.set(id, text);
  $(id).textContent = text;
}
function setStyle(id, prop, value) {
  const key = `${id}.${prop}`;
  if (hudCache.get(key) === value) return;
  hudCache.set(key, value);
  $(id).style[prop] = value;
}
function setClass(id, cls, on) {
  const key = `${id}.${cls}`;
  if (hudCache.get(key) === on) return;
  hudCache.set(key, on);
  $(id).classList.toggle(cls, on);
}
function setHidden(id, hidden) {
  const key = `${id}.hidden`;
  if (hudCache.get(key) === hidden) return;
  hudCache.set(key, hidden);
  $(id).hidden = hidden;
}

// Gore u sredini: "CRVENI 12 : 9 PLAVI" i (u CTF-u) gdje su zastave.
function teamHud() {
  const teams = teamMode();
  setHidden('teamScore', !teams);
  if (teams) {
    setText('tsRed', `CRVENI ${teamScore[0]}`);
    setText('tsBlue', `${teamScore[1]} PLAVI`);
  }
  const flags = mode === 'ctf' && !!flagState && me.team !== null;
  setHidden('flagHud', !flags);
  if (flags) {
    setText('flagMine', `Tvoja zastava: ${flagText(me.team)}`);
    setText('flagTheirs', `Njihova: ${flagText(1 - me.team)}`);
    setStyle('flagMine', 'color', TEAM_TEXT[me.team]);
    setStyle('flagTheirs', 'color', TEAM_TEXT[1 - me.team]);
  }
}

let fps = 0, fpsFrames = 0, fpsStart = 0;
let crossGap = 10;
let camStep = 0;
let slideK = 0;
let wasSliding = false;
let roomSlide = true;
let sprintK = 0;
let hudDt = 0.016;

function hud(t) {
  const hp = Math.max(0, Math.ceil(me.hp));
  setText('hp', String(hp));
  setStyle('hpfill', 'width', `${hp}%`);
  setStyle('hpfill', 'background', hp > 50 ? 'var(--ok)' : hp > 25 ? 'var(--accent)' : 'var(--danger)');
  const pistolOut = me.weapon === 'pistol';
  const pistolCount = cheats.pistol ? '∞' : String(me.pistolAmmo);
  setText('ammo', pistolOut ? `💥 ${pistolCount}${cheats.pistol ? '' : ` / ${PISTOL.mag}`}`
    : me.reloading ? 'PUNJENJE…' : cheats.ammo ? '∞' : `${me.ammo} / ${W.mag}`);
  setClass('ammo', 'pistol', pistolOut);
  const mine = roster.get(me.id);
  setText('kd', mine ? `Ubojstva ${mine.kills} · Smrti ${mine.deaths}${me.streak > 0 ? ` · Niz ${me.streak}` : ''}` : '');
  // Mali podsjetnik iznad metaka puške: imaš pištolj na tipki 2.
  const pistolShown = me.alive && !pistolOut && hasPistol();
  setClass('pistolHud', 'show', pistolShown);
  if (pistolShown) setText('pistolCount', pistolCount);
  const tl = Math.max(0, timeLeft);
  setText('timer', ended ? 'KRAJ' : `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`);
  setText('net', `${isAdmin ? 'ADMIN · ' : ''}${fps} FPS · ping ${Math.round(rtt)} ms`);
  teamHud();

  const scopeOn = me.scoped && camera.fov < 45;
  setClass('scope', 'on', scopeOn);
  setStyle('crosshair', 'display', scopeOn || !me.alive ? 'none' : 'block');
  setClass('crosshair', 'pistol', pistolOut);
  setClass('crosshair', 'sprint', !!me.sprinting);

  const b = me.body;
  const moving = Math.hypot(b.vx, b.vz) > 1.2;
  const spread = cheats.aim ? 0
    : pistolOut ? pistolSpread(moving)
      : spreadFor(me.scoped, (t - me.scopeStart) / 1000, moving, !b.onGround && !cheats.fly, b.crouch);
  const px = (Math.tan(spread) / Math.tan((camera.fov * Math.PI) / 360)) * (window.innerHeight / 2);
  // Crtice se razmiču do ruba rasipanja, glatko da ne trepere.
  crossGap += (Math.max(4, px) - crossGap) * Math.min(1, hudDt * 14);
  const gap = `${Math.round(crossGap)}px`;
  if (hudCache.get('crosshair.--gap') !== gap) {
    hudCache.set('crosshair.--gap', gap);
    $('crosshair').style.setProperty('--gap', gap);
  }

  setClass('hitmarker', 'show', t < hitUntil);
  setStyle('dmgdir', 'opacity', t < dmgDirUntil ? String(Math.min(1, (dmgDirUntil - t) / 400)) : '0');
  setStyle('vignette', 'opacity', t < vignetteUntil ? String((vignetteUntil - t) / 400) : me.alive && me.hp <= 25 ? '0.35' : '0');
  if (t >= centerUntil) setText('center', '');
  $('protect').hidden = !(me.alive && t < me.protectUntil);

  if (!me.alive && !$('death').hidden) {
    const left = Math.max(0, RESPAWN_TIME - (t - me.deadAt) / 1000);
    setText('deathTimer', ended ? 'Runda je gotova' : `Povratak za ${left.toFixed(1)} s`);
  }
  if (endInfo) {
    const left = Math.max(0, Math.ceil((endInfo.until - t) / 1000));
    const el = document.getElementById('endNext');
    if (el) el.textContent = `Nova runda za ${left} s`;
  }
}

/* ================================================================ glavna petlja */

let lastFrame = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (t - lastFrame) / 1000);
  lastFrame = t;
  fpsFrames++;
  if (t - fpsStart >= 1000) {
    fps = fpsFrames;
    fpsFrames = 0;
    fpsStart = t;
  }
  if (inGame) {
    updateMe(t, dt);
    updateOthers(t);
    updateFx(dt);
    updateBoomFx(dt);
    updateFlags(t);
    updateViewmodel(t, dt);
    net(t);
    hudDt = dt;
    hud(t);
  } else {
    const a = t * 0.00004;
    camera.position.set(Math.cos(a) * 85, 32, Math.sin(a) * 85);
    camera.lookAt(0, 2, 0);
    if (preview && preview.av) {
      preview.av.root.rotation.y = Math.PI + t * 0.0009;
      preview.r.render(preview.sc, preview.cam);
    }
  }
  env.update(camera.position);
  renderer.clear();
  renderer.render(scene, camera);
  if (inGame && me.alive && !(me.scoped && camera.fov < 45)) {
    renderer.clearDepth();
    renderer.render(gunScene, gunCam);
  }
}
requestAnimationFrame(frame);

/* ================================================================ unos */

// Cijeli zaslon + Keyboard Lock (Chrome/Edge): Ctrl+W/T/N tada idu igri, a ne pregledniku.
async function enterFullscreen() {
  if (!settings.fullscreen) return;
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    if (navigator.keyboard?.lock) await navigator.keyboard.lock();
  } catch {
    /* preglednik ne da: igra radi i bez toga, čučanj je onda sigurniji na C */
  }
}

async function lockPointer() {
  if (!inGame) return;
  await enterFullscreen();
  $('pauseHint').textContent = '';
  try {
    await canvas.requestPointerLock({ unadjustedMovement: true });
  } catch {
    try {
      await canvas.requestPointerLock();
    } catch {
      $('pauseHint').textContent = 'Pričekaj sekundu pa klikni ponovno.';
    }
  }
}

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!inGame) return;
  $('pause').hidden = locked || ended;
  if (!locked) {
    input.keys.clear();
    input.rmb = false;
    $('board').hidden = true;
    updateRoomInfo();
  }
});
document.addEventListener('pointerlockerror', () => {
  $('pauseHint').textContent = 'Pričekaj sekundu pa klikni ponovno.';
});

$('resume').addEventListener('click', lockPointer);
canvas.addEventListener('click', () => {
  if (inGame && !locked) lockPointer();
});

document.addEventListener('mousemove', (e) => {
  if (!locked || !inGame) return;
  const mx = e.movementX, my = e.movementY;
  if (Math.abs(mx) > 400 || Math.abs(my) > 400) return; // Chrome ponekad pošalje lažni skok miša
  const s = 0.0022 * settings.sens * (camera.fov / BASE_FOV);
  me.yaw = wrap(me.yaw - mx * s);
  me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch - my * s));
});

document.addEventListener('mousedown', (e) => {
  if (!locked || !inGame) return;
  if (e.button === 0) {
    if (me.weapon === 'pistol') shootPistol();
    else shoot();
  }
  if (e.button === 2) input.rmb = true;
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 2) input.rmb = false;
});
document.addEventListener('contextmenu', (e) => {
  if (inGame) e.preventDefault();
});
// Kotačić: s nišanom mijenja zum, bez nišana oružje (touchpad šalje puno događaja, pa najviše svakih 250 ms).
let wheelSwitchAt = -1e9;
document.addEventListener('wheel', (e) => {
  if (!locked || !inGame) return;
  if (me.scoped) {
    me.zoom = e.deltaY > 0 ? 0 : 1;
  } else if (e.deltaY !== 0 && e.timeStamp - wheelSwitchAt > 250) {
    wheelSwitchAt = e.timeStamp;
    toggleWeapon(false);
  }
}, { passive: true });

document.addEventListener('keydown', (e) => {
  if (!inGame) return;
  if (e.code === 'Tab') {
    e.preventDefault();
    if (locked && $('end').hidden) {
      renderBoard($('board'), 'Rezultati');
      $('board').hidden = false;
    }
    return;
  }
  if (ended && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
    castVote(MODES[Number(e.code.slice(5)) - 1]);
    return;
  }
  if (!locked) return;
  if (e.code === 'Escape') {
    // S cijelim zaslonom i zaključanom tipkovnicom Esc stiže do igre, pa pauzu otvaramo sami.
    document.exitPointerLock();
    return;
  }
  // Ctrl je čučanj: Ctrl+R, Ctrl+D, Ctrl+S, Ctrl+brojevi ne smiju raditi ništa u pregledniku.
  if (e.ctrlKey || ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  input.keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'KeyR' && me.weapon === 'rifle') reload();
  if (e.code === 'Digit1') selectWeapon('rifle');
  if (e.code === 'Digit2') selectWeapon('pistol');
  if (e.code === 'KeyQ') toggleWeapon(true);
});
document.addEventListener('keyup', (e) => {
  input.keys.delete(e.code);
  if (e.code === 'Tab') $('board').hidden = true;
});
window.addEventListener('blur', () => {
  input.keys.clear();
  input.rmb = false;
});

window.addEventListener('resize', () => {
  applyQuality();
  camera.aspect = gunCam.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  gunCam.updateProjectionMatrix();
});

/* ================================================================ izbornik */

// Mali 3D pregled skina u izborniku. Gasi se čim uđeš u igru da ne troši memoriju.
let preview = null;
function initPreview() {
  const box = $('skinPreview');
  try {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(120, 150);
    box.append(r.domElement);
    const sc = new THREE.Scene();
    sc.add(new THREE.HemisphereLight(0xffffff, 0x555555, 2.2));
    const light = new THREE.DirectionalLight(0xffffff, 1.6);
    light.position.set(2, 3, 2);
    sc.add(light);
    const cam = new THREE.PerspectiveCamera(32, 120 / 150, 0.1, 20);
    cam.position.set(0, 1.15, 4.3);
    cam.lookAt(0, 0.98, 0);
    preview = { r, sc, cam, av: null };
    setPreviewSkin(settings.skin);
  } catch {
    box.hidden = true;
  }
}
function setPreviewSkin(skin) {
  if (!preview) return;
  if (preview.av) disposeAvatar(preview.av, preview.sc);
  preview.av = makeAvatar(205, '', skin, false);
  preview.sc.add(preview.av.root);
}
function destroyPreview() {
  if (!preview) return;
  if (preview.av) disposeAvatar(preview.av, preview.sc);
  preview.r.dispose();
  preview.r.forceContextLoss();
  preview.r.domElement.remove();
  preview = null;
}

function bindSettings() {
  const sens = $('sens'), quality = $('quality'), volume = $('volume');
  sens.value = String(settings.sens);
  quality.value = String(settings.quality);
  volume.value = String(settings.volume);
  $('sensVal').textContent = Number(settings.sens).toFixed(2);
  sens.addEventListener('input', () => {
    settings.sens = Number(sens.value);
    $('sensVal').textContent = settings.sens.toFixed(2);
    saveSettings();
  });
  quality.addEventListener('change', () => {
    settings.quality = Number(quality.value);
    applyQuality();
    saveSettings();
  });
  volume.addEventListener('input', () => {
    settings.volume = Number(volume.value);
    sfx.setVolume(settings.volume);
    saveSettings();
  });
  const gfx = $('gfx');
  gfx.value = GFX;
  gfx.addEventListener('change', () => {
    settings.gfx = gfx.value;
    saveSettings();
    if (!inGame) {
      rememberLobbyFields();
      location.reload();
      return;
    }
    $('gfxApply').hidden = settings.gfx === GFX;
  });
  $('gfxApply').addEventListener('click', () => {
    // Ponovno učitaj stranicu i odmah uđi u istu sobu.
    try {
      sessionStorage.setItem('snajper-autojoin', '1');
    } catch {
      /* bez toga samo ostaneš u izborniku */
    }
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    location.reload();
  });
  const fs = $('fullscreen');
  fs.value = settings.fullscreen ? '1' : '0';
  fs.addEventListener('change', () => {
    settings.fullscreen = fs.value === '1';
    saveSettings();
    if (!settings.fullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  });
  const blood = $('blood');
  blood.value = settings.blood ? '1' : '0';
  blood.addEventListener('change', () => {
    settings.blood = blood.value === '1';
    if (!settings.blood) clearBlood();
    saveSettings();
  });
}

function rememberLobbyFields() {
  const name = $('name').value.trim();
  if (name) settings.name = name;
  settings.room = $('room').value.trim() || settings.room;
  settings.bots = Number($('bots').value) || 0;
  settings.mode = $('mode').value;
  settings.skin = $('skin').value;
  saveSettings();
}

function takeAutojoin() {
  try {
    const on = sessionStorage.getItem('snajper-autojoin') === '1';
    sessionStorage.removeItem('snajper-autojoin');
    return on;
  } catch {
    return false;
  }
}

/* ---------------- aktivne sobe u izborniku: u koji način ulaziš */

const SHORT_MODE = { ffa: 'FFA', tdm: 'TDM', ctf: 'CTF' };
const cleanRoomCode = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'razred';
// 1 igrač, 2 igrača, 5 igrača · 1 bot, 2 bota, 5 botova
const isOne = (n) => n % 10 === 1 && n % 100 !== 11;
const isFew = (n) => n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);
const playersWord = (n) => (isOne(n) ? 'igrač' : 'igrača');
const botsWord = (n) => (isOne(n) ? 'bot' : isFew(n) ? 'bota' : 'botova');
let lobbyRooms = [];
let chosenMode = 'ffa';

async function refreshRooms() {
  if (inGame) return;
  try {
    const res = await fetch('/rooms', { cache: 'no-store' });
    lobbyRooms = res.ok ? await res.json() : [];
  } catch {
    lobbyRooms = [];
  }
  renderRoomStatus();
}

function renderRoomStatus() {
  const code = cleanRoomCode($('room').value);
  const room = lobbyRooms.find((r) => r.code === code);
  const status = $('roomStatus');
  const strong = (text) => {
    const b = document.createElement('b');
    b.textContent = text;
    return b;
  };
  if (room) {
    $('mode').value = room.mode;
    $('mode').disabled = true;
    $('bots').disabled = true;
    status.replaceChildren(
      'Soba ', strong(code), ' već igra ', strong(MODE_NAMES[room.mode]),
      ` (${room.players} ${playersWord(room.players)}${room.bots ? ` i ${room.bots} ${botsWord(room.bots)}` : ''}). `,
      'Ulaziš u taj način, a sljedeći se bira glasanjem na kraju runde.',
    );
  } else {
    $('mode').disabled = false;
    $('bots').disabled = false;
    $('mode').value = chosenMode;
    status.replaceChildren(
      'Nova soba ', strong(code), ': ti biraš način igre i botove. Na kraju svake runde igrači glasaju za sljedeći način.',
    );
  }
  const list = $('roomList');
  list.replaceChildren();
  for (const r of lobbyRooms.slice(0, 8)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${r.code} · ${SHORT_MODE[r.mode] || r.mode} · ${r.players}`;
    b.title = `${MODE_NAMES[r.mode]}, ${r.players} ${playersWord(r.players)}`;
    if (r.code === code) b.className = 'on';
    b.addEventListener('click', () => {
      $('room').value = r.code;
      renderRoomStatus();
    });
    list.append(b);
  }
  list.hidden = lobbyRooms.length === 0;
}

function initLobby() {
  $('settingsHome').append($('settings'));
  bindSettings();
  const params = new URLSearchParams(location.search);
  $('name').value = settings.name;
  $('room').value = params.get('soba') || settings.room;
  $('bots').value = String(settings.bots);
  $('mode').value = MODES.includes(settings.mode) ? settings.mode : 'ffa';
  chosenMode = $('mode').value;
  $('mode').addEventListener('change', () => {
    if (!$('mode').disabled) chosenMode = $('mode').value;
  });
  $('room').addEventListener('input', renderRoomStatus);
  refreshRooms();
  const roomTimer = setInterval(() => (inGame ? clearInterval(roomTimer) : refreshRooms()), 5000);
  $('skin').value = SKINS.includes(settings.skin) ? settings.skin : 'klasik';
  $('skin').addEventListener('change', () => {
    settings.skin = $('skin').value;
    saveSettings();
    setPreviewSkin(settings.skin);
  });
  initPreview();
  const touchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
  $('mobileWarn').hidden = !touchOnly;

  const start = () => {
    const name = $('name').value.trim();
    const room = $('room').value.trim() || 'razred';
    const bots = Number($('bots').value) || 0;
    const skin = $('skin').value;
    const gameMode = $('mode').disabled ? chosenMode : $('mode').value;
    if (!name) {
      $('lobbyError').textContent = 'Upiši ime.';
      $('name').focus();
      return;
    }
    Object.assign(settings, { name, room, bots, skin, mode: gameMode });
    saveSettings();
    sfx.init();
    connect(name, room, bots, skin, gameMode);
  };
  $('play').addEventListener('click', start);
  if (takeAutojoin() && $('name').value.trim()) start();
  for (const id of ['name', 'room']) {
    $(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') start();
    });
  }
  $('copyLink').addEventListener('click', async () => {
    const link = `${location.origin}/?soba=${encodeURIComponent(roomCode)}`;
    try {
      await navigator.clipboard.writeText(link);
      $('copyLink').textContent = 'Kopirano!';
    } catch {
      $('copyLink').textContent = link;
    }
    setTimeout(() => { $('copyLink').textContent = 'Kopiraj link sobe'; }, 2500);
  });
  $('leave').addEventListener('click', () => {
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    location.reload();
  });
  $('reconnect').addEventListener('click', () => location.reload());
  $('teamBtn').addEventListener('click', () => send({ t: 'team' }));
}
/* ================================================================ admin panel */

// Lozinka se pamti samo dok je kartica otvorena (sessionStorage), da ostane na školskom računalu.
function readAdminKey() {
  try {
    return sessionStorage.getItem('snajper-admin') || '';
  } catch {
    return '';
  }
}
function writeAdminKey(key) {
  try {
    if (key) sessionStorage.setItem('snajper-admin', key);
    else sessionStorage.removeItem('snajper-admin');
  } catch {
    /* nije bitno */
  }
}

function onAdminState(m) {
  if (!m.ok) {
    isAdmin = false;
    writeAdminKey('');
    $('adminBox').hidden = false;
    $('adminMsg').textContent = m.msg || 'Prijava nije uspjela.';
    return;
  }
  isAdmin = true;
  const wallChanged = !!cheats.wall !== !!m.cheats.wall;
  cheats = { ...m.cheats };
  $('adminLogin').hidden = true;
  $('adminPanel').hidden = false;
  $('adminMsg').textContent = '';
  for (const box of document.querySelectorAll('[data-cheat]')) box.checked = !!cheats[box.dataset.cheat];
  if (wallChanged) {
    for (const r of roster.values()) if (r.av) setWallhack(r.av, !!cheats.wall);
  }
  if (cheats.ammo && me.reloading) { me.reloading = false; me.ammo = W.mag; }
  renderAdminPlayers();
}

function renderAdminPlayers() {
  if (!isAdmin) return;
  const list = $('adminPlayers');
  list.replaceChildren();
  const botCount = [...roster.values()].filter((r) => r.bot).length;
  if ([...$('adminBots').options].some((o) => Number(o.value) === botCount)) $('adminBots').value = String(botCount);
  for (const r of roster.values()) {
    const row = document.createElement('div');
    row.className = 'admin-player';
    row.append(span(`${r.name}${r.bot ? ' (bot)' : ''}${r.id === me.id ? ' (ti)' : ''}`));
    if (r.id !== me.id) {
      const kick = document.createElement('button');
      kick.type = 'button';
      kick.textContent = 'Izbaci';
      kick.addEventListener('click', () => send({ t: 'admin', a: 'kick', id: r.id }));
      row.append(kick);
    }
    list.append(row);
  }
}

function initAdmin() {
  $('adminLink').addEventListener('click', () => {
    $('adminBox').hidden = !$('adminBox').hidden;
    if (!$('adminBox').hidden && !isAdmin) $('adminKey').focus();
  });
  const login = () => {
    const key = $('adminKey').value;
    if (!key || !inGame) return;
    $('adminMsg').textContent = 'Provjeravam…';
    writeAdminKey(key);
    $('adminKey').value = '';
    send({ t: 'alogin', key });
  };
  $('adminGo').addEventListener('click', login);
  $('adminKey').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') login();
  });
  for (const box of document.querySelectorAll('[data-cheat]')) {
    box.addEventListener('change', () => send({ t: 'admin', a: 'cheat', name: box.dataset.cheat, on: box.checked }));
  }
  for (const btn of document.querySelectorAll('[data-act]')) {
    btn.addEventListener('click', () => send({ t: 'admin', a: btn.dataset.act }));
  }
  $('adminBots').addEventListener('change', () => send({ t: 'admin', a: 'bots', n: Number($('adminBots').value) }));
  $('adminMode').addEventListener('change', () => send({ t: 'admin', a: 'mode', mode: $('adminMode').value }));
  const say = () => {
    const text = $('adminSay').value.trim();
    if (!text) return;
    send({ t: 'admin', a: 'say', text });
    $('adminSay').value = '';
  };
  $('adminSayGo').addEventListener('click', say);
  $('adminSay').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') say();
  });
}

initLobby();
initAdmin();
