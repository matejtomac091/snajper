// Snajper — klijent u pregledniku. Crta svijet (Three.js), čita miš i tipkovnicu, šalje položaj serveru.
import * as THREE from 'three';
import {
  P, W, MAX_HP, INTERP_DELAY, RESPAWN_TIME, MATCH_TIME, SKINS, PISTOL, spreadFor, pistolSpread, eyeHeight, aimDir,
} from './shared/config.js';
import { buildMap, COLORS } from './shared/map.js';
import { createBody, stepBody } from './shared/physics.js';

const $ = (id) => document.getElementById(id);
const MAP = buildMap();
const BASE_FOV = 75;
const TAU = Math.PI * 2;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r4 = (v) => Math.round(v * 10000) / 10000;
const wrap = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
const angDiff = (a, b) => wrap(b - a);

/* ================================================================ postavke */

const DEFAULTS = { name: '', room: 'razred', bots: 0, sens: 1, quality: 0.5, volume: 0.7, skin: 'klasik' };
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

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
} catch (err) {
  $('lobbyError').textContent = 'Ovaj preglednik ne može crtati 3D (WebGL). Probaj Chrome i uključi hardversko ubrzanje.';
  $('play').disabled = true;
  throw err;
}
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

const SKY = new THREE.Color('#a9cbe8');
const scene = new THREE.Scene();
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, 110, 300);

const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 450);
camera.rotation.order = 'YXZ';

scene.add(new THREE.HemisphereLight(0xffffff, 0x5d5648, 1.8));
const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
sun.position.set(40, 90, 25);
scene.add(sun);

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#8b9b69';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#83935f';
  g.fillRect(0, 0, 32, 32);
  g.fillRect(32, 32, 32, 32);
  g.strokeStyle = 'rgba(0,0,0,0.07)';
  g.strokeRect(0.5, 0.5, 63, 63);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(150, 150);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ map: groundTexture() }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Cijela mapa je jedna mreža s bojama po vrhovima: jedan poziv za crtanje umjesto 140.
function buildWorld() {
  const FACES = [
    { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
    { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
    { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
    { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
    { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
    { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
  ];
  const pos = [], nor = [], col = [], idx = [];
  const base = new THREE.Color();
  MAP.boxes.forEach((b, i) => {
    base.set(COLORS[b.c]);
    const shade = 0.9 + (((i * 7919) % 100) / 100) * 0.16;
    for (const f of FACES) {
      const start = pos.length / 3;
      for (const [sx, sy, sz] of f.c) {
        pos.push(sx ? b.maxX : b.minX, sy ? b.maxY : b.minY, sz ? b.maxZ : b.minZ);
        nor.push(f.n[0], f.n[1], f.n[2]);
        const ao = !sy && b.minY === 0 ? 0.72 : 1; // tamniji dno uz tlo, glumi sjenu
        col.push(base.r * shade * ao, base.g * shade * ao, base.b * shade * ao);
      }
      idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })));
}
buildWorld();

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

function nameTag(name) {
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
  g.fillStyle = '#ffffff';
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

function makeAvatar(hue, name, skin = 'klasik', withTag = true) {
  const mats = [];
  const geos = [];
  const kit = {
    tint: new THREE.Color().setHSL(hue / 360, 0.6, 0.5),
    mat(color, basic = false) {
      const m = basic ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color });
      mats.push(m);
      return m;
    },
    add(parent, geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
      geos.push(geo);
      const m = new THREE.Mesh(geo, material);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      parent.add(m);
      return m;
    },
    B: (w, h, d) => new THREE.BoxGeometry(w, h, d),
    S: (r, ws = 10, hs = 8) => new THREE.SphereGeometry(r, ws, hs),
    C: (rt, rb, h, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg),
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
    tag = nameTag(name);
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

const vm = new THREE.Group();
{
  const metal = new THREE.MeshLambertMaterial({ color: '#2b2e33' });
  const wood = new THREE.MeshLambertMaterial({ color: '#6b4a2b' });
  const part = (geo, mat, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    vm.add(m);
    return m;
  };
  part(new THREE.BoxGeometry(0.07, 0.12, 0.36), wood, 0, -0.03, 0.14);
  part(new THREE.BoxGeometry(0.065, 0.08, 0.46), metal, 0, 0, -0.24);
  part(new THREE.BoxGeometry(0.06, 0.05, 0.3), wood, 0, -0.05, -0.32);
  part(new THREE.CylinderGeometry(0.014, 0.016, 0.72, 8), metal, 0, 0.01, -0.82, Math.PI / 2);
  part(new THREE.CylinderGeometry(0.03, 0.03, 0.32, 12), metal, 0, 0.08, -0.22, Math.PI / 2);
  part(new THREE.CylinderGeometry(0.036, 0.03, 0.06, 12), metal, 0, 0.08, -0.4, Math.PI / 2);
  part(new THREE.BoxGeometry(0.02, 0.04, 0.03), metal, 0, 0.045, -0.14);
  part(new THREE.BoxGeometry(0.02, 0.04, 0.03), metal, 0, 0.045, -0.3);
  part(new THREE.BoxGeometry(0.07, 0.016, 0.016), metal, 0.05, 0.02, -0.06);
}
const muzzle = new THREE.Mesh(
  new THREE.SphereGeometry(0.07, 8, 6),
  new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
);
muzzle.position.set(0, 0.01, -1.22);
muzzle.visible = false;
vm.add(muzzle);
vm.scale.setScalar(0.75);
gunScene.add(vm);

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
function tracer(a, b, life) {
  const line = tracers.find((t) => !t.visible) || tracers.reduce((m, t) => (t.userData.life < m.userData.life ? t : m));
  const arr = line.geometry.attributes.position.array;
  arr[0] = a[0]; arr[1] = a[1]; arr[2] = a[2];
  arr[3] = b[0]; arr[4] = b[1]; arr[5] = b[2];
  line.geometry.attributes.position.needsUpdate = true;
  line.userData.life = line.userData.max = life;
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
}

/* ================================================================ banana: let i eksplozija */

function makeBananaMesh() {
  const g = new THREE.Group();
  const yellow = new THREE.MeshLambertMaterial({ color: '#f2d23c' });
  const brown = new THREE.MeshLambertMaterial({ color: '#5a3d17' });
  const seg = new THREE.CylinderGeometry(0.06, 0.06, 0.16, 8);
  for (let i = -1; i <= 1; i++) {
    const m = new THREE.Mesh(seg, yellow);
    m.position.set(i * 0.12, -Math.abs(i) * 0.05, 0);
    m.rotation.z = Math.PI / 2 + i * 0.45;
    g.add(m);
  }
  const tipGeo = new THREE.CylinderGeometry(0.02, 0.035, 0.06, 6);
  for (const side of [-1, 1]) {
    const tip = new THREE.Mesh(tipGeo, brown);
    tip.position.set(side * 0.22, -0.08, 0);
    tip.rotation.z = Math.PI / 2 + side * 0.9;
    g.add(tip);
  }
  g.userData.dispose = () => { yellow.dispose(); brown.dispose(); seg.dispose(); tipGeo.dispose(); };
  return g;
}

const flyingBananas = new Map(); // id -> { mesh, tx, ty, tz }
function syncFlyingBananas(list) {
  const seen = new Set();
  for (const [id, x, y, z] of list) {
    seen.add(id);
    let f = flyingBananas.get(id);
    if (!f) {
      f = { mesh: makeBananaMesh() };
      f.mesh.position.set(x, y, z);
      scene.add(f.mesh);
      flyingBananas.set(id, f);
    }
    f.tx = x; f.ty = y; f.tz = z;
  }
  for (const [id, f] of flyingBananas) {
    if (seen.has(id)) continue;
    scene.remove(f.mesh);
    f.mesh.userData.dispose();
    flyingBananas.delete(id);
  }
}

const flashes = [];
for (let i = 0; i < 3; i++) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffb02e, transparent: true, depthWrite: false, fog: false }),
  );
  m.visible = false;
  m.userData = { life: 0 };
  scene.add(m);
  flashes.push(m);
}
const chunkGeo = new THREE.BoxGeometry(0.16, 0.05, 0.32);
const chunks = [];
for (let i = 0; i < 36; i++) {
  const m = new THREE.Mesh(chunkGeo, new THREE.MeshLambertMaterial({ color: i % 3 ? '#f2d23c' : '#fff3c4', transparent: true }));
  m.visible = false;
  m.userData = { life: 0, vx: 0, vy: 0, vz: 0 };
  scene.add(m);
  chunks.push(m);
}

function boom(x, y, z) {
  const f = flashes.find((m) => !m.visible) || flashes[0];
  f.position.set(x, y, z);
  f.userData.life = 0.45;
  f.visible = true;
  let n = 0;
  for (const c of chunks) {
    if (c.visible || n >= 12) continue;
    n++;
    const a = Math.random() * Math.PI * 2;
    const sp = 6 + Math.random() * 7;
    c.position.set(x, y, z);
    c.userData = { life: 1.2, vx: Math.cos(a) * sp, vy: 4 + Math.random() * 7, vz: Math.sin(a) * sp };
    c.visible = true;
  }
  const dist = camera.position.distanceTo(new THREE.Vector3(x, y, z));
  sfx.boom(Math.min(1, 30 / (dist + 12)));
  if (dist < 25) {
    shakeUntil = performance.now() + 450;
    shakeAmp = 0.06 * (1 - dist / 25);
  }
}

function updateBananaFx(dt) {
  const k = Math.min(1, dt * 15);
  for (const f of flyingBananas.values()) {
    f.mesh.position.x += (f.tx - f.mesh.position.x) * k;
    f.mesh.position.y += (f.ty - f.mesh.position.y) * k;
    f.mesh.position.z += (f.tz - f.mesh.position.z) * k;
    f.mesh.rotation.x += dt * 10;
    f.mesh.rotation.y += dt * 6;
  }
  for (const f of flashes) {
    if (!f.visible) continue;
    f.userData.life -= dt;
    if (f.userData.life <= 0) { f.visible = false; continue; }
    const p = 1 - f.userData.life / 0.45;
    f.scale.setScalar(0.5 + p * BANANA.radius);
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
    whoosh: () => {
      if (!ctx) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(600, t);
      bp.frequency.exponentialRampToValueAtTime(2400, t + 0.25);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.35, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      src.connect(bp);
      bp.connect(g);
      g.connect(master);
      src.start(t);
      src.stop(t + 0.32);
    },
    bolt: () => { tone(2400, 0.02, 0.12); tone(1800, 0.02, 0.12, 'square', 0.12); },
    reload: () => { tone(900, 0.03, 0.12); tone(700, 0.03, 0.12, 'square', 0.9); tone(1200, 0.03, 0.12, 'square', 1.9); },
  };
})();

/* ================================================================ stanje igre */

const me = {
  id: 0, body: createBody(), yaw: 0, pitch: 0, eye: P.eye,
  hp: MAX_HP, alive: false, ammo: W.mag, reloading: false, reloadEnd: 0, lastShot: -1e9,
  scoped: false, scopeStart: 0, zoom: 0, spawnSeq: 0, protectUntil: 0, deadAt: 0, killer: '',
  bananas: 0, streak: 0,
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
let shakeUntil = 0;
let shakeAmp = 0;
const RAPID_COOLDOWN = 150; // ms, mora odgovarati serveru
const cooldownMs = () => (cheats.rapid ? RAPID_COOLDOWN : W.cooldown * 1000);

function send(m) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}

function addRoster(p) {
  roster.set(p.id, {
    id: p.id, name: p.name, hue: p.hue, kills: p.kills || 0, deaths: p.deaths || 0, bot: !!p.bot,
    skin: SKINS.includes(p.skin) ? p.skin : 'klasik', alive: false, snaps: [], av: null,
  });
}

function removeRoster(id) {
  const r = roster.get(id);
  if (r && r.av) disposeAvatar(r.av);
  roster.delete(id);
}

/* ================================================================ mreža */

function connect(name, room, bots, skin) {
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
    send({ t: 'join', name, room, bots, skin });
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
    case 'reset':
      ended = false;
      endInfo = null;
      $('end').hidden = true;
      for (const r of roster.values()) { r.kills = 0; r.deaths = 0; }
      me.bananas = 0;
      me.streak = 0;
      centerMsg('NOVA RUNDA', 2000);
      break;
    case 'err':
      failLobby(m.msg);
      break;
    case 'admin': onAdminState(m); break;
    case 'banana':
      if (m.n > me.bananas) {
        centerMsg('🍌 BANANA! Baci je tipkom G', 2500);
        sfx.kill();
      }
      me.bananas = m.n;
      break;
    case 'streak': {
      const r = roster.get(m.id);
      if (r && m.id !== me.id) feedSystem(`${r.name} ima niz od ${m.n} i bananu!`);
      break;
    }
    case 'boom': boom(m.x, m.y, m.z); break;
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
  inGame = true;
  $('lobby').hidden = true;
  $('hud').hidden = false;
  destroyPreview();
  $('settingsPause').append($('settings'));
  $('roomInfo').textContent = `Soba: ${roomCode} · igrača: ${roster.size}`;
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
  me.yaw = m.yaw;
  me.pitch = 0;
  me.eye = P.eye;
  me.alive = true;
  me.hp = MAX_HP;
  me.ammo = W.mag;
  me.reloading = false;
  me.lastShot = -1e9;
  me.scoped = false;
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
  syncFlyingBananas(m.b || []);
}

function gunTip() {
  const v = new THREE.Vector3(0.18, -0.12, -0.7);
  camera.localToWorld(v);
  return [v.x, v.y, v.z];
}

function onShot(m) {
  const own = m.id === me.id;
  tracer(own ? gunTip() : m.o, m.e, own ? 0.2 : 0.35);
  puff(m.e, m.h ? '#c0392b' : '#d8cdb5');
  if (own) return;
  const dx = m.o[0] - camera.position.x;
  const dz = m.o[2] - camera.position.z;
  const dist = Math.hypot(dx, m.o[1] - camera.position.y, dz);
  const rel = angDiff(me.yaw, Math.atan2(-dx, -dz));
  sfx.shot(Math.min(1, 25 / (dist + 10)), dist > 40, -Math.sin(rel));
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
  feedKill(k, v, m.hs, m.w === 'banana');
  if (m.v === me.id) {
    me.alive = false;
    me.hp = 0;
    me.scoped = false;
    me.streak = 0;
    me.deadAt = performance.now();
    let by = '';
    if (k) by = m.w === 'banana' ? `Raznijela te banana od: ${k.name}` : `Srušio te ${k.name}${m.hs ? ' (headshot)' : ''}`;
    $('deathBy').textContent = by;
    $('death').hidden = false;
  }
  if (m.k === me.id) {
    me.streak++;
    centerMsg(m.w === 'banana' ? 'BANANA!' : m.hs ? 'HEADSHOT!' : 'ELIMINACIJA', 1400);
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
  renderBoard($('end'), m.board[0] ? `Pobjednik: ${m.board[0].name}` : 'Kraj runde');
  const next = document.createElement('div');
  next.className = 'next';
  next.id = 'endNext';
  $('end').append(next);
  $('end').hidden = false;
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
  return r ? `hsl(${r.hue} 70% 65%)` : '#fff';
}

function feedKill(k, v, hs, banana) {
  const row = feedRow(k?.id === me.id || v?.id === me.id ? 'mine' : '');
  row.append(span(k ? k.name : '?', playerColor(k)), span(banana ? '  🍌  ' : '  ▸  '), span(v ? v.name : '?', playerColor(v)));
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
  const rows = [...roster.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
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
      tr.append(td);
    });
    table.append(tr);
  });
  el.append(h, table);
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

function throwBanana() {
  if (!me.alive || ended) return;
  if (!cheats.banana && me.bananas <= 0) return;
  send({ t: 'throw', d: aimDir(me.yaw, me.pitch).map(r4) });
  if (!cheats.banana) me.bananas--;
  me.protectUntil = 0;
  vmKick = 0.6;
  sfx.whoosh();
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
  if (me.alive) {
    const k = input.keys;
    let f = 0, r = 0;
    if (locked) {
      f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    }
    const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
    const boltReady = t - me.lastShot >= cooldownMs();
    const wantScope = locked && input.rmb && !me.reloading && boltReady && !ended;
    if (wantScope && !me.scoped) {
      me.scoped = true;
      me.scopeStart = t;
    } else if (!wantScope && me.scoped) {
      me.scoped = false;
    }
    const up = locked && k.has('Space');
    const down = locked && (k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyC'));
    if (cheats.fly) {
      fly(b, f, r, up, down, dt);
    } else {
      stepBody(b, {
        wx: -sy * f + cy * r,
        wz: -cy * f - sy * r,
        jump: up,
        crouch: down,
        scoped: me.scoped,
        speedMul: cheats.speed ? 2 : 1,
        jumpMul: cheats.speed ? 1.6 : 1,
      }, dt, MAP.boxes);
    }
  } else {
    me.scoped = false;
  }
  const eyeTarget = me.alive ? eyeHeight(b.crouch) : 0.45;
  me.eye += (eyeTarget - me.eye) * Math.min(1, dt * 12);
  camera.position.set(b.x, b.y + me.eye, b.z);
  camera.rotation.set(me.pitch, me.yaw, me.alive ? 0 : 0.35);
  if (t < shakeUntil) {
    const a = shakeAmp * ((shakeUntil - t) / 450);
    camera.rotation.x += (Math.random() - 0.5) * a;
    camera.rotation.y += (Math.random() - 0.5) * a;
  }
  const targetFov = me.scoped ? W.zoom[me.zoom] : BASE_FOV;
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
      r.av = makeAvatar(r.hue, r.name, r.skin);
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
  }
}

function updateViewmodel(t, dt) {
  const b = me.body;
  const speed = Math.hypot(b.vx, b.vz);
  bobT += dt * speed * 1.8;
  const bob = b.onGround ? Math.min(1, speed / P.walk) : 0;
  vmKick = Math.max(0, vmKick - dt * 4);
  const reloadK = me.reloading ? Math.sin(Math.min(1, Math.max(0, (me.reloadEnd - t) / (W.reload * 1000))) * Math.PI) : 0;
  vm.position.set(
    0.2 + Math.sin(bobT) * 0.012 * bob,
    -0.2 + Math.abs(Math.cos(bobT)) * 0.012 * bob - reloadK * 0.15,
    -0.5 + vmKick * 0.08,
  );
  vm.rotation.set(vmKick * 0.12 - reloadK * 0.6, 0, reloadK * 0.4);
  const since = (t - me.lastShot) / 1000;
  if (since < W.cooldown && !me.reloading) vm.rotation.z += Math.sin((since / W.cooldown) * Math.PI) * 0.25;
  muzzle.visible = t - flashAt < 55;
}

function sendUpdate(t) {
  lastSend = t;
  const b = me.body;
  send({
    t: 'u', x: r3(b.x), y: r3(b.y), z: r3(b.z), yaw: r3(me.yaw), pitch: r3(me.pitch),
    c: b.crouch ? 1 : 0, g: b.onGround ? 1 : 0, s: me.scoped ? 1 : 0, q: me.spawnSeq,
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

let fps = 0, fpsFrames = 0, fpsStart = 0;

function hud(t) {
  const hp = Math.max(0, Math.ceil(me.hp));
  setText('hp', String(hp));
  setStyle('hpfill', 'width', `${hp}%`);
  setStyle('hpfill', 'background', hp > 50 ? 'var(--ok)' : hp > 25 ? 'var(--accent)' : 'var(--danger)');
  setText('ammo', me.reloading ? 'PUNJENJE…' : cheats.ammo ? '∞' : `${me.ammo} / ${W.mag}`);
  const mine = roster.get(me.id);
  setText('kd', mine ? `Ubojstva ${mine.kills} · Smrti ${mine.deaths}${me.streak > 0 ? ` · Niz ${me.streak}` : ''}` : '');
  const bananaShown = me.alive && (me.bananas > 0 || !!cheats.banana);
  $('bananaHud').hidden = !bananaShown;
  if (bananaShown) setText('bananaCount', cheats.banana ? '∞' : String(me.bananas));
  const tl = Math.max(0, timeLeft);
  setText('timer', ended ? 'KRAJ' : `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`);
  setText('net', `${isAdmin ? 'ADMIN · ' : ''}${fps} FPS · ping ${Math.round(rtt)} ms`);

  const scopeOn = me.scoped && camera.fov < 45;
  setClass('scope', 'on', scopeOn);
  setStyle('crosshair', 'display', scopeOn || !me.alive ? 'none' : 'block');

  const b = me.body;
  const spread = cheats.aim ? 0 : spreadFor(me.scoped, (t - me.scopeStart) / 1000, Math.hypot(b.vx, b.vz) > 1.2, !b.onGround && !cheats.fly, b.crouch);
  const px = (Math.tan(spread) / Math.tan((camera.fov * Math.PI) / 360)) * (window.innerHeight / 2);
  const showSpread = me.alive && !scopeOn;
  const size = showSpread ? Math.max(8, Math.round(px * 2)) : 0;
  setStyle('spread', 'width', `${size}px`);
  setStyle('spread', 'height', `${size}px`);
  setStyle('spread', 'display', showSpread ? 'block' : 'none');

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
    updateBananaFx(dt);
    updateViewmodel(t, dt);
    net(t);
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
  renderer.clear();
  renderer.render(scene, camera);
  if (inGame && me.alive && !(me.scoped && camera.fov < 45)) {
    renderer.clearDepth();
    renderer.render(gunScene, gunCam);
  }
}
requestAnimationFrame(frame);

/* ================================================================ unos */

async function lockPointer() {
  if (!inGame) return;
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
  $('pause').hidden = locked;
  if (!locked) {
    input.keys.clear();
    input.rmb = false;
    $('board').hidden = true;
    $('roomInfo').textContent = `Soba: ${roomCode} · igrača: ${roster.size}`;
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
  if (e.button === 0) shoot();
  if (e.button === 1) {
    e.preventDefault();
    throwBanana();
  }
  if (e.button === 2) input.rmb = true;
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 2) input.rmb = false;
});
document.addEventListener('contextmenu', (e) => {
  if (inGame) e.preventDefault();
});
document.addEventListener('wheel', (e) => {
  if (locked && me.scoped) me.zoom = e.deltaY > 0 ? 0 : 1;
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
  if (!locked) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  input.keys.add(e.code);
  if (e.code === 'KeyR') reload();
  if (e.code === 'KeyG') throwBanana();
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
}

function initLobby() {
  $('settingsHome').append($('settings'));
  bindSettings();
  const params = new URLSearchParams(location.search);
  $('name').value = settings.name;
  $('room').value = params.get('soba') || settings.room;
  $('bots').value = String(settings.bots);
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
    if (!name) {
      $('lobbyError').textContent = 'Upiši ime.';
      $('name').focus();
      return;
    }
    Object.assign(settings, { name, room, bots, skin });
    saveSettings();
    sfx.init();
    connect(name, room, bots, skin);
  };
  $('play').addEventListener('click', start);
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
