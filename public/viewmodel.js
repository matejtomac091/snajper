// Modeli oružja u prvom licu: snajper s optikom i pištolj s eksplozivnim mecima.
// Ishodište svakog modela je kod rukohvata/okidača, cijev gleda prema -Z, +Y je gore, jedinice su metri.
// Nema vanjskih datoteka: teksture se crtaju na canvasu.
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const RIFLE_MUZZLE = [0, 0.005, -1.215];
const PISTOL_MUZZLE = [0, 0.033, -0.201];

export function createViewmodels(level = 'high') {
  const quality = level === 'low' ? 0 : level === 'ultra' ? 2 : 1;
  const kit = new Kit(quality);
  const rifle = quality === 0 ? buildRifleLow(kit) : buildRifle(kit);
  const pistol = quality === 0 ? buildPistolLow(kit) : buildPistol(kit);
  return {
    rifle,
    pistol,
    muzzle: {
      rifle: new THREE.Vector3(...RIFLE_MUZZLE),
      pistol: new THREE.Vector3(...PISTOL_MUZZLE),
    },
    dispose: () => kit.dispose(),
  };
}

/* ================================================================ alati za gradnju */

class Kit {
  constructor(quality) {
    this.quality = quality;
    this.seg = quality === 2 ? 32 : quality === 1 ? 20 : 8;
    this.owned = new Set();
    this.dummy = new THREE.Object3D();
    this.mats = null;
  }

  own(resource) {
    this.owned.add(resource);
    return resource;
  }

  dispose() {
    for (const resource of this.owned) resource.dispose();
    this.owned.clear();
  }

  batch() {
    return new Batch(this);
  }

  // Profil zadan u ravnini (z, y) istisnut po širini oko x = 0, sa zaobljenim rubovima.
  extrude(shape, width, { bevel = 0.002, bevelT = bevel, segs = 2, curve = 6 } = {}) {
    const depth = Math.max(0.0002, width - 2 * bevelT);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: bevel > 0,
      bevelThickness: bevelT,
      bevelSize: bevel,
      bevelOffset: -bevel,
      bevelSegments: segs,
      curveSegments: curve,
    });
    geo.rotateY(-Math.PI / 2);
    geo.translate(depth / 2, 0, 0);
    return crease(geo, 50);
  }

  // Tijelo vrtnje oko osi Z; točke su [polumjer, udaljenost prema naprijed (-z)].
  lathe(points, segs = this.seg) {
    const geo = new THREE.LatheGeometry(points.map(([r, d]) => new THREE.Vector2(r, d)), segs);
    geo.rotateX(-Math.PI / 2);
    return crease(geo, 35);
  }

  // Valjak po osi Z (rFront je prema -z).
  cylZ(rFront, rBack, len, segs = this.seg, open = false, thetaStart = 0, thetaLength = Math.PI * 2) {
    const geo = new THREE.CylinderGeometry(rFront, rBack, len, segs, 1, open, thetaStart, thetaLength);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }

  cylX(r, len, segs = this.seg) {
    const geo = new THREE.CylinderGeometry(r, r, len, segs);
    geo.rotateZ(Math.PI / 2);
    return geo;
  }

  rod(a, b, r, segs = 12) {
    const from = new THREE.Vector3(...a);
    const dir = new THREE.Vector3(...b).sub(from);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(r, r, len, segs);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    geo.translate(from.x + (b[0] - a[0]) / 2, from.y + (b[1] - a[1]) / 2, from.z + (b[2] - a[2]) / 2);
    return geo;
  }

  materials() {
    if (!this.mats) this.mats = this.quality === 0 ? lowMaterials(this) : fineMaterials(this);
    return this.mats;
  }
}

// Skuplja dijelove po materijalu i spaja ih u jednu mrežu po materijalu (malo draw callova).
class Batch {
  constructor(kit) {
    this.kit = kit;
    this.parts = new Map();
  }

  add(geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scale = 1) {
    const d = this.kit.dummy;
    d.position.fromArray(pos);
    d.rotation.set(rot[0], rot[1], rot[2]);
    if (typeof scale === 'number') d.scale.setScalar(scale);
    else d.scale.fromArray(scale);
    d.updateMatrix();
    geo.applyMatrix4(d.matrix);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(geo);
    return this;
  }

  addMatrix(geo, mat, matrix) {
    geo.applyMatrix4(matrix);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(geo);
    return this;
  }

  into(parent) {
    for (const [mat, list] of this.parts) {
      const flat = list.map(plain);
      const merged = mergeGeometries(flat, false);
      for (const geo of new Set([...list, ...flat])) geo.dispose();
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      parent.add(new THREE.Mesh(this.kit.own(merged), mat));
    }
    this.parts.clear();
    return parent;
  }
}

function plain(geo) {
  const out = geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
  }
  out.clearGroups();
  return out;
}

// toCreasedNormals spaja vrhove na 0.01 jedinice, pa računamo u milimetrima.
function crease(geo, degrees) {
  geo.scale(1000, 1000, 1000);
  const out = toCreasedNormals(geo, (degrees * Math.PI) / 180);
  if (out !== geo) geo.dispose();
  out.scale(0.001, 0.001, 0.001);
  return out;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const rbox = (w, h, d, r, segs = 2) => new RoundedBoxGeometry(w, h, d, segs, r);

function poly(points) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  return s;
}

function roundRect(z0, y0, z1, y1, r) {
  const s = new THREE.Shape();
  s.moveTo(z0 + r, y0);
  s.lineTo(z1 - r, y0);
  s.quadraticCurveTo(z1, y0, z1, y0 + r);
  s.lineTo(z1, y1 - r);
  s.quadraticCurveTo(z1, y1, z1 - r, y1);
  s.lineTo(z0 + r, y1);
  s.quadraticCurveTo(z0, y1, z0, y1 - r);
  s.lineTo(z0, y0 + r);
  s.quadraticCurveTo(z0, y0, z0 + r, y0);
  return s;
}

/* ================================================================ teksture */

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Godovi orahovine; pločica se ponavlja u oba smjera. u ide duž kundaka.
function woodTexture(kit, w, h) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const px = img.data;
  const rand = rng(1337);
  const waves = [];
  for (let i = 0; i < 7; i++) {
    waves.push([1 + Math.floor(rand() * 3), Math.floor(rand() * 5) - 2, (0.3 + rand() * 0.5) / (1 + i * 0.6), rand() * 6.2832]);
  }
  const RINGS = 9;
  const light = [132, 80, 42];
  const dark = [46, 24, 10];
  const TAU = Math.PI * 2;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      let n = 0;
      for (const [fu, fv, amp, ph] of waves) n += amp * Math.sin(TAU * (fu * u + fv * v) + ph);
      const ring = Math.pow(0.5 + 0.5 * Math.sin(TAU * (v * RINGS + n * 0.35)), 4);
      const fine = 0.5 + 0.5 * Math.sin(TAU * (v * RINGS * 6 + n * 1.4));
      const blotch = 0.5 + 0.5 * Math.sin(TAU * (u * 2 + v + n * 0.4));
      const k = Math.min(1, ring * 0.5 + fine * 0.14 + blotch * 0.22);
      const i = (y * w + x) * 4;
      px[i] = light[0] + (dark[0] - light[0]) * k;
      px[i + 1] = light[1] + (dark[1] - light[1]) * k;
      px[i + 2] = light[2] + (dark[2] - light[2]) * k;
      px[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = '#2a1408';
  for (let i = 0; i < (w * h) / 160; i++) {
    const x = rand() * w;
    const y = Math.floor(rand() * h);
    const len = 3 + rand() * 16;
    ctx.globalAlpha = 0.08 + rand() * 0.14;
    ctx.fillRect(x, y, len, 1);
    if (x + len > w) ctx.fillRect(x - w, y, len, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = kit.quality === 2 ? 8 : 4;
  return kit.own(tex);
}

// Normal mapa s dijamantnim nazubljenjem (rukohvat, gumbi optike, drvo kod rukohvata).
function knurlNormalTexture(kit, size, cells, strength) {
  const height = new Float32Array(size * size);
  const tri = (t) => 1 - Math.abs(2 * (t - Math.floor(t)) - 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * cells;
      const v = ((y + 0.5) / size) * cells;
      height[y * size + x] = Math.min(tri(u + v), tri(u - v));
    }
  }
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const ny = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      img.data[i] = (nx / len) * 127.5 + 127.5;
      img.data[i + 1] = (ny / len) * 127.5 + 127.5;
      img.data[i + 2] = (1 / len) * 127.5 + 127.5;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return kit.own(tex);
}

// Mekani radijalni sjaj za užarene dijelove (nema bloom efekta u igri).
function haloTexture(kit) {
  const c = canvas(64, 64);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return kit.own(tex);
}

function repeated(kit, tex, u, v) {
  const t = kit.own(tex.clone());
  t.repeat.set(u, v);
  t.needsUpdate = true;
  return t;
}

/* ================================================================ materijali */

function lowMaterials(kit) {
  const own = (m) => kit.own(m);
  return {
    metal: own(new THREE.MeshLambertMaterial({ color: '#2b2e33' })),
    dark: own(new THREE.MeshLambertMaterial({ color: '#1d1f22' })),
    wood: own(new THREE.MeshLambertMaterial({ color: '#6b4a2b' })),
    glass: own(new THREE.MeshLambertMaterial({ color: '#29496b', emissive: '#0b1a2c' })),
    polymer: own(new THREE.MeshLambertMaterial({ color: '#25272a' })),
    orange: own(new THREE.MeshBasicMaterial({ color: '#ff8a2a' })),
  };
}

function fineMaterials(kit) {
  const ultra = kit.quality === 2;
  const own = (m) => kit.own(m);
  const wood = woodTexture(kit, ultra ? 1024 : 512, ultra ? 256 : 128);
  wood.repeat.set(1 / 0.55, 1 / 0.14);
  const knurl = knurlNormalTexture(kit, ultra ? 128 : 64, 8, ultra ? 2.2 : 1.8);
  // Nemetali dobivaju slabiji utjecaj okoline, inače ih hemisfera + PMREM isperu.
  const woodParams = { map: wood, roughness: 0.48, metalness: 0, envMapIntensity: 0.55 };
  const glow = own(new THREE.MeshBasicMaterial({ color: '#ff9a35' }));
  return {
    gun: own(new THREE.MeshStandardMaterial({ color: '#3b3f45', metalness: 0.85, roughness: 0.36 })),
    dark: own(new THREE.MeshStandardMaterial({ color: '#1e2023', metalness: 0.6, roughness: 0.42 })),
    steel: own(new THREE.MeshStandardMaterial({ color: '#8e939a', metalness: 1, roughness: 0.28 })),
    wood: own(ultra
      ? new THREE.MeshPhysicalMaterial({ ...woodParams, clearcoat: 0.5, clearcoatRoughness: 0.25 })
      : new THREE.MeshStandardMaterial(woodParams)),
    woodCheck: own(new THREE.MeshStandardMaterial({
      map: wood,
      color: '#c9bcae',
      roughness: 0.8,
      envMapIntensity: 0.45,
      normalMap: repeated(kit, knurl, 55, 55),
      normalScale: new THREE.Vector2(1.6, 1.6),
    })),
    rubber: own(new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.92, envMapIntensity: 0.5 })),
    spacer: own(new THREE.MeshStandardMaterial({ color: '#4d4842', roughness: 0.6, envMapIntensity: 0.5 })),
    knurl: own(new THREE.MeshStandardMaterial({
      color: '#1e2023',
      metalness: 0.6,
      roughness: 0.45,
      normalMap: repeated(kit, knurl, 4, 1),
    })),
    white: own(new THREE.MeshStandardMaterial({ color: '#f0f0f0', roughness: 0.5 })),
    red: own(new THREE.MeshStandardMaterial({ color: '#d42a1a', roughness: 0.4, emissive: '#3a0500' })),
    glass: own(ultra
      ? new THREE.MeshPhysicalMaterial({
        color: '#0c1c38',
        metalness: 0,
        roughness: 0.03,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        ior: 1.7,
        iridescence: 0.85,
        iridescenceIOR: 1.45,
        iridescenceThicknessRange: [260, 520],
        envMapIntensity: 1.6,
      })
      : new THREE.MeshStandardMaterial({ color: '#0d1d38', metalness: 0.65, roughness: 0.06, envMapIntensity: 1.5, emissive: '#020814' })),
    polymer: own(new THREE.MeshStandardMaterial({ color: '#17181a', roughness: 0.7, metalness: 0, envMapIntensity: 0.35 })),
    grip: own(new THREE.MeshStandardMaterial({
      color: '#141516',
      roughness: 0.85,
      envMapIntensity: 0.45,
      normalMap: repeated(kit, knurl, 55, 55),
      normalScale: new THREE.Vector2(1.2, 1.2),
    })),
    orange: own(new THREE.MeshStandardMaterial({ color: '#ff6d1f', metalness: 0.5, roughness: 0.32, emissive: '#6a2200' })),
    glow,
    sightWhite: own(new THREE.MeshBasicMaterial({ color: '#f4f4f4' })),
    halo: own(new THREE.SpriteMaterial({
      map: haloTexture(kit),
      color: '#ff8a2a',
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })),
    bore: own(new THREE.MeshStandardMaterial({ color: '#050505', roughness: 1 })),
  };
}

/* ================================================================ snajper (high/ultra) */

const BORE_Y = 0.005;
const SCOPE_Y = 0.08;

function buildRifle(kit) {
  const M = kit.materials();
  const seg = kit.seg;
  const ultra = kit.quality === 2;
  const rifle = new THREE.Group();
  rifle.name = 'rifle';
  const b = kit.batch();

  addStock(kit, b, M, ultra);
  addReceiverAndBarrel(kit, b, M, seg);
  addScope(kit, b, M, seg);
  addLowerParts(kit, b, M);
  b.into(rifle);

  const bolt = new THREE.Group();
  bolt.name = 'bolt';
  addBolt(kit, kit.batch(), M, seg).into(bolt);
  rifle.add(bolt);
  return rifle;
}

function addStock(kit, b, M, ultra) {
  const s = new THREE.Shape();
  s.moveTo(0.300, 0.034);
  s.lineTo(0.190, 0.037);
  s.quadraticCurveTo(0.115, 0.039, 0.088, 0.024);
  s.quadraticCurveTo(0.064, 0.008, 0.044, -0.004);
  s.lineTo(-0.600, -0.004);
  s.quadraticCurveTo(-0.622, -0.006, -0.622, -0.030);
  s.quadraticCurveTo(-0.620, -0.056, -0.596, -0.058);
  s.lineTo(-0.300, -0.062);
  s.lineTo(0.026, -0.062);
  s.quadraticCurveTo(0.036, -0.064, 0.042, -0.080);
  s.lineTo(0.060, -0.146);
  s.quadraticCurveTo(0.062, -0.152, 0.068, -0.152);
  s.lineTo(0.100, -0.152);
  s.quadraticCurveTo(0.106, -0.152, 0.104, -0.144);
  s.quadraticCurveTo(0.090, -0.100, 0.104, -0.086);
  s.quadraticCurveTo(0.120, -0.078, 0.150, -0.082);
  s.lineTo(0.300, -0.124);
  s.closePath();
  const curve = ultra ? 10 : 6;
  b.add(kit.extrude(s, 0.052, { bevel: 0.008, bevelT: 0.010, segs: ultra ? 4 : 3, curve }), M.wood);

  // gumeni potkundačnik i bijeli razmak
  const pad = new THREE.Shape();
  pad.moveTo(0.303, 0.036);
  pad.lineTo(0.317, 0.036);
  pad.quadraticCurveTo(0.326, 0.036, 0.326, 0.026);
  pad.lineTo(0.326, -0.116);
  pad.quadraticCurveTo(0.326, -0.127, 0.317, -0.127);
  pad.lineTo(0.303, -0.127);
  pad.closePath();
  b.add(kit.extrude(pad, 0.054, { bevel: 0.006, segs: 2, curve }), M.rubber);
  b.add(kit.extrude(poly([[0.2995, 0.035], [0.3025, 0.035], [0.3025, -0.125], [0.2995, -0.125]]), 0.051, { bevel: 0.007, bevelT: 0.008, segs: 2 }), M.spacer);

  // nazubljenje na rukohvatu i prednjem dijelu
  const gripPatch = poly([[0.052, -0.080], [0.065, -0.132], [0.092, -0.136], [0.088, -0.100], [0.094, -0.086]]);
  const forePatch = roundRect(-0.540, -0.048, -0.360, -0.018, 0.006);
  for (const sx of [-1, 1]) {
    b.add(kit.extrude(gripPatch, 0.0008, { bevel: 0 }), M.woodCheck, [sx * 0.0263, 0, 0]);
    b.add(kit.extrude(forePatch, 0.0008, { bevel: 0, curve: 3 }), M.woodCheck, [sx * 0.0263, 0, 0]);
  }
}

function addReceiverAndBarrel(kit, b, M, seg) {
  const R = 0.021;
  b.add(kit.cylZ(R, R, 0.06, seg), M.gun, [0, BORE_Y, -0.010]);
  // otvor za izbacivanje čahure gore desno: valjak bez tog isječka
  const mid = 1.22;
  const half = 0.55;
  b.add(kit.cylZ(R, R, 0.09, seg, true, mid + half, Math.PI * 2 - 2 * half), M.gun, [0, BORE_Y, -0.085]);
  b.add(kit.cylZ(R, R, 0.16, seg), M.gun, [0, BORE_Y, -0.210]);
  b.add(kit.cylZ(0.0228, 0.0228, 0.014, seg), M.gun, [0, BORE_Y, -0.281]);
  b.add(box(0.0025, 0.006, 0.016), M.gun, [-0.0205, BORE_Y + 0.003, 0.004]);

  // pikatini šina
  b.add(box(0.020, 0.006, 0.302), M.dark, [0, 0.0255, -0.135]);
  for (let i = 0; i < 30; i++) b.add(box(0.0225, 0.0035, 0.0052), M.dark, [0, 0.03025, 0.010 - i * 0.01]);

  // cijev i kočnica trzaja
  const brake = [];
  let d = 1.146;
  brake.push([0.0150, 1.130], [0.0150, d]);
  for (let i = 0; i < 3; i++) {
    brake.push([0.0188, d + 0.002], [0.0188, d + 0.014]);
    d += 0.014;
    if (i < 2) {
      brake.push([0.0112, d + 0.002], [0.0112, d + 0.011]);
      d += 0.011;
    }
  }
  b.add(kit.lathe([
    [0.0172, 0.276], [0.0172, 0.300], [0.0162, 0.312], [0.0158, 0.420], [0.0140, 0.700], [0.0124, 1.000], [0.0120, 1.128],
    ...brake,
    [0.0176, 1.215], [0.0058, 1.215], [0.0058, 1.205], [0.0001, 1.205],
  ], seg), M.gun, [0, BORE_Y, 0]);
}

function addScope(kit, b, M, seg) {
  const ridges = (r0, r1, start, count, pitch) => {
    const pts = [];
    for (let i = 0; i < count; i++) {
      const z = start + i * pitch;
      pts.push([r1, z + pitch * 0.2], [r1, z + pitch * 0.7], [r0, z + pitch]);
    }
    return pts;
  };
  b.add(kit.lathe([
    [0.0172, 0.026], [0.0172, 0.018], [0.0215, 0.018], [0.0225, 0.021], [0.0225, 0.046],
    ...ridges(0.0225, 0.0233, 0.046, 4, 0.006),
    [0.0225, 0.088], [0.0212, 0.091], [0.0212, 0.096],
    ...ridges(0.0212, 0.0219, 0.096, 4, 0.005),
    [0.0212, 0.118], [0.0175, 0.138], [0.0165, 0.145], [0.0165, 0.300], [0.0175, 0.310],
    [0.0270, 0.348], [0.0280, 0.356], [0.0280, 0.410], [0.0289, 0.412], [0.0289, 0.420], [0.0250, 0.420], [0.0250, 0.414],
  ], seg), M.dark, [0, SCOPE_Y, 0]);

  // leće: blago ispupčene kapice
  const lens = (r, curvature, z, facing) => {
    const theta = Math.asin(r / curvature);
    const geo = new THREE.SphereGeometry(curvature, seg, 3, 0, Math.PI * 2, 0, theta);
    geo.rotateX((facing * Math.PI) / 2);
    geo.translate(0, SCOPE_Y, z - facing * curvature * Math.cos(theta));
    return geo;
  };
  b.add(lens(0.0172, 0.06, -0.026, 1), M.glass);
  b.add(lens(0.0250, 0.07, -0.414, -1), M.glass);

  // prstenovi nosača
  for (const z of [-0.170, -0.272]) {
    b.add(rbox(0.019, 0.030, 0.013, 0.002), M.dark, [0, 0.047, z]);
    b.add(kit.cylZ(0.0205, 0.0205, 0.013, seg), M.dark, [0, SCOPE_Y, z]);
    b.add(kit.cylX(0.0045, 0.008, 12), M.gun, [-0.0125, 0.040, z]);
    b.add(box(0.0412, 0.0012, 0.0135), M.gun, [0, SCOPE_Y, z]);
  }

  // kućište tornjića i tornjići
  b.add(rbox(0.038, 0.036, 0.040, 0.007, 3), M.dark, [0, SCOPE_Y, -0.225]);
  addTurret(kit, b, M, [0, SCOPE_Y + 0.017, -0.225], [0, 1, 0], 0.0125, 0.016, true);
  addTurret(kit, b, M, [0.018, SCOPE_Y, -0.225], [1, 0, 0], 0.0112, 0.012, false);
  addTurret(kit, b, M, [-0.018, SCOPE_Y, -0.225], [-1, 0, 0], 0.0145, 0.010, true);
  // ručica za povećanje na prstenu
  b.add(rbox(0.0045, 0.010, 0.014, 0.0015), M.dark, [-0.0158, SCOPE_Y + 0.0148, -0.107], [0, 0, 0.82]);
}

function addTurret(kit, b, M, base, axis, r, h, ticks) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...base),
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...axis)),
    new THREE.Vector3(1, 1, 1),
  );
  const seg = kit.seg;
  const put = (geo, mat, pos, rot = [0, 0, 0]) => {
    kit.dummy.position.fromArray(pos);
    kit.dummy.rotation.set(rot[0], rot[1], rot[2]);
    kit.dummy.scale.setScalar(1);
    kit.dummy.updateMatrix();
    geo.applyMatrix4(kit.dummy.matrix);
    b.addMatrix(geo, mat, m);
  };
  put(new THREE.CylinderGeometry(r * 1.12, r * 1.12, 0.005, seg), M.dark, [0, 0.0025, 0]);
  put(new THREE.CylinderGeometry(r, r, h, seg, 1, true), M.knurl, [0, 0.005 + h / 2, 0]);
  put(new THREE.CircleGeometry(r, seg), M.dark, [0, 0.005 + h, 0], [-Math.PI / 2, 0, 0]);
  put(new THREE.CylinderGeometry(r * 0.45, r * 0.5, 0.0016, seg), M.gun, [0, 0.0058 + h, 0]);
  put(box(0.0009, 0.0042, 0.0012), M.white, [0, 0.0028, r * 1.12]);
  if (ticks) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const len = i % 3 === 0 ? 0.0026 : 0.0014;
      put(box(0.0006, len, 0.0006), M.white, [Math.sin(a) * r * 1.005, 0.005 + len / 2, Math.cos(a) * r * 1.005], [0, a, 0]);
    }
  }
}

function addLowerParts(kit, b, M) {
  // štitnik okidača s otvorom
  const guard = new THREE.Shape();
  guard.moveTo(-0.058, -0.050);
  guard.lineTo(0.034, -0.050);
  guard.lineTo(0.034, -0.076);
  guard.quadraticCurveTo(0.034, -0.092, 0.018, -0.092);
  guard.lineTo(-0.042, -0.092);
  guard.quadraticCurveTo(-0.058, -0.092, -0.058, -0.076);
  guard.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-0.050, -0.054);
  hole.lineTo(-0.050, -0.074);
  hole.quadraticCurveTo(-0.050, -0.085, -0.039, -0.085);
  hole.lineTo(0.015, -0.085);
  hole.quadraticCurveTo(0.026, -0.085, 0.026, -0.074);
  hole.lineTo(0.026, -0.054);
  hole.closePath();
  guard.holes.push(hole);
  b.add(kit.extrude(guard, 0.010, { bevel: 0.002, segs: 2 }), M.dark);

  const trigger = new THREE.Shape();
  trigger.moveTo(-0.004, -0.060);
  trigger.quadraticCurveTo(-0.011, -0.071, 0.003, -0.081);
  trigger.lineTo(0.0065, -0.0795);
  trigger.quadraticCurveTo(-0.003, -0.071, 0.003, -0.060);
  trigger.closePath();
  b.add(kit.extrude(trigger, 0.0055, { bevel: 0.001, segs: 1 }), M.steel);

  // odvojivi spremnik
  b.add(rbox(0.026, 0.052, 0.088, 0.003), M.dark, [0, -0.074, -0.112]);
  b.add(box(0.0272, 0.003, 0.070), M.dark, [0, -0.086, -0.112]);
  b.add(rbox(0.030, 0.008, 0.094, 0.003), M.gun, [0, -0.1015, -0.112]);
  b.add(box(0.012, 0.006, 0.006), M.gun, [0, -0.065, -0.062]);

  // držači remena
  for (const [z, y] of [[-0.540, -0.059], [0.235, -0.106]]) {
    b.add(new THREE.CylinderGeometry(0.0042, 0.0042, 0.010, 10), M.gun, [0, y - 0.004, z]);
    b.add(new THREE.TorusGeometry(0.010, 0.0018, 8, 20), M.gun, [0, y - 0.017, z], [0, Math.PI / 2, 0]);
  }
}

function addBolt(kit, b, M, seg) {
  b.add(kit.cylZ(0.019, 0.019, 0.20, seg), M.steel, [0, BORE_Y, -0.080]);
  b.add(kit.lathe([[0.0001, -0.058], [0.006, -0.058], [0.0095, -0.054], [0.0135, -0.044], [0.0142, -0.030], [0.0142, -0.016]], seg), M.gun, [0, BORE_Y, 0]);
  b.add(kit.cylZ(0.0032, 0.0032, 0.004, 10), M.red, [0, BORE_Y, 0.059]);
  b.add(kit.cylX(0.0075, 0.016, 14), M.steel, [0.018, BORE_Y, 0.012]);
  b.add(kit.rod([0.022, BORE_Y, 0.012], [0.050, BORE_Y - 0.032, 0.022], 0.0042, 12), M.steel);
  b.add(new THREE.SphereGeometry(0.0105, seg, Math.round(seg * 0.6)), M.dark, [0.051, BORE_Y - 0.034, 0.023], [0.3, 0, 0], [1, 1, 1.18]);
  return b;
}

/* ================================================================ pištolj (high/ultra) */

const PISTOL_BORE = 0.033;

function buildPistol(kit) {
  const M = kit.materials();
  const seg = kit.seg;
  const ultra = kit.quality === 2;
  const pistol = new THREE.Group();
  pistol.name = 'pistol';

  const slide = new THREE.Group();
  slide.name = 'slide';
  addSlide(kit, kit.batch(), M, ultra).into(slide);
  pistol.add(slide);

  const b = kit.batch();
  addFrame(kit, b, M, ultra);
  addExplosiveAccents(kit, b, M, seg);
  b.into(pistol);
  for (const [pos, size] of [[[0, 0.046, -0.031], 0.05], [[0, PISTOL_BORE, -0.204], 0.04]]) {
    const halo = new THREE.Sprite(M.halo);
    halo.position.fromArray(pos);
    halo.scale.setScalar(size);
    halo.renderOrder = 1;
    pistol.add(halo);
  }
  pistol.userData.glow = [M.glow, M.halo];
  return pistol;
}

function addSlide(kit, b, M, ultra) {
  // navlaka s prozorčićem ležišta na vrhu
  const s = new THREE.Shape();
  s.moveTo(0.025, 0.018);
  s.lineTo(0.025, 0.046);
  s.quadraticCurveTo(0.025, 0.050, 0.020, 0.050);
  s.lineTo(-0.010, 0.050);
  s.lineTo(-0.010, 0.041);
  s.lineTo(-0.052, 0.041);
  s.lineTo(-0.052, 0.050);
  s.lineTo(-0.163, 0.050);
  s.quadraticCurveTo(-0.170, 0.050, -0.170, 0.044);
  s.lineTo(-0.170, 0.020);
  s.lineTo(-0.168, 0.018);
  s.closePath();
  b.add(kit.extrude(s, 0.026, { bevel: 0.0025, bevelT: 0.003, segs: ultra ? 3 : 2, curve: ultra ? 6 : 4 }), M.gun);

  // nazubljenja za povlačenje navlake
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 7; i++) b.add(box(0.0009, 0.021, 0.0015), M.dark, [sx * 0.0134, 0.0325, 0.0195 - i * 0.0032], [0.18, 0, 0]);
    for (let i = 0; i < 5; i++) b.add(box(0.0009, 0.018, 0.0015), M.dark, [sx * 0.0134, 0.0330, -0.136 - i * 0.0032], [0.18, 0, 0]);
  }

  // nišani
  b.add(rbox(0.022, 0.005, 0.010, 0.0015, 1), M.dark, [0, 0.0525, 0.015]);
  for (const sx of [-1, 1]) {
    b.add(box(0.0075, 0.0055, 0.007), M.dark, [sx * 0.0063, 0.0575, 0.0155]);
    b.add(new THREE.CircleGeometry(0.0010, 10), M.sightWhite, [sx * 0.0063, 0.0585, 0.0191]);
  }
  b.add(box(0.0035, 0.0065, 0.0065), M.dark, [0, 0.05325, -0.158]);
  b.add(new THREE.CircleGeometry(0.0012, 12), M.glow, [0, 0.0548, -0.15465]);

  // narančasta stražnja pločica navlake i svjetleća linija po vrhu (vidi se iz prvog lica)
  b.add(rbox(0.017, 0.024, 0.002, 0.0008, 1), M.orange, [0, 0.0335, 0.0255]);
  b.add(box(0.0016, 0.0007, 0.098), M.glow, [0, 0.05015, -0.104]);
  return b;
}

function addFrame(kit, b, M, ultra) {
  const f = new THREE.Shape();
  f.moveTo(0.022, 0.018);
  f.lineTo(-0.168, 0.018);
  f.lineTo(-0.168, 0.006);
  f.quadraticCurveTo(-0.168, 0.002, -0.162, 0.002);
  f.lineTo(-0.078, 0.002);
  f.lineTo(-0.074, -0.004);
  f.lineTo(-0.070, -0.026);
  f.quadraticCurveTo(-0.067, -0.039, -0.053, -0.039);
  f.lineTo(-0.018, -0.039);
  f.quadraticCurveTo(-0.010, -0.039, -0.009, -0.030);
  f.lineTo(-0.008, -0.010);
  f.lineTo(0.016, -0.092);
  f.quadraticCurveTo(0.017, -0.097, 0.022, -0.097);
  f.lineTo(0.058, -0.097);
  f.quadraticCurveTo(0.063, -0.097, 0.062, -0.092);
  f.lineTo(0.036, 0.004);
  f.quadraticCurveTo(0.040, 0.012, 0.046, 0.016);
  f.quadraticCurveTo(0.048, 0.020, 0.040, 0.020);
  f.lineTo(0.022, 0.018);
  const hole = new THREE.Path();
  hole.moveTo(-0.064, -0.004);
  hole.lineTo(-0.016, -0.004);
  hole.lineTo(-0.015, -0.026);
  hole.quadraticCurveTo(-0.015, -0.033, -0.022, -0.033);
  hole.lineTo(-0.053, -0.033);
  hole.quadraticCurveTo(-0.062, -0.033, -0.063, -0.024);
  hole.closePath();
  f.holes.push(hole);
  b.add(kit.extrude(f, 0.028, { bevel: 0.0025, bevelT: 0.003, segs: ultra ? 3 : 2, curve: ultra ? 6 : 4 }), M.polymer);

  // obloge rukohvata
  const panel = poly([[-0.003, -0.012], [0.033, -0.004], [0.057, -0.088], [0.020, -0.090]]);
  for (const sx of [-1, 1]) b.add(kit.extrude(panel, 0.0018, { bevel: 0.0005, segs: 1 }), M.grip, [sx * 0.0145, 0, 0]);

  const trigger = new THREE.Shape();
  trigger.moveTo(-0.033, -0.004);
  trigger.quadraticCurveTo(-0.043, -0.015, -0.032, -0.027);
  trigger.lineTo(-0.0285, -0.026);
  trigger.quadraticCurveTo(-0.036, -0.015, -0.028, -0.004);
  trigger.closePath();
  b.add(kit.extrude(trigger, 0.006, { bevel: 0.001, segs: 1 }), M.gun);


  // šina ispod cijevi, poluge s lijeve strane, gumb spremnika
  for (let i = 0; i < 3; i++) b.add(box(0.018, 0.003, 0.0055), M.polymer, [0, 0.0005, -0.104 - i * 0.015]);
  b.add(rbox(0.0018, 0.0055, 0.024, 0.0007, 1), M.gun, [-0.0145, 0.0135, -0.052]);
  b.add(kit.cylX(0.0026, 0.003, 12), M.gun, [-0.0155, 0.0150, -0.046]);
  b.add(box(0.0016, 0.004, 0.009), M.gun, [-0.0145, 0.0095, -0.078]);
  b.add(kit.cylX(0.0032, 0.0032, 12), M.gun, [-0.0146, -0.007, 0.004]);
}

function addExplosiveAccents(kit, b, M, seg) {
  // narančasti kompenzator na ustima cijevi
  b.add(rbox(0.024, 0.030, 0.029, 0.004), M.orange, [0, 0.034, -0.186]);
  for (let i = 0; i < 3; i++) b.add(rbox(0.013, 0.0016, 0.0036, 0.0006, 1), M.glow, [0, 0.0491, -0.178 - i * 0.008]);
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 2; i++) b.add(rbox(0.0016, 0.012, 0.0036, 0.0006, 1), M.glow, [sx * 0.0121, 0.034, -0.181 - i * 0.009]);
  }
  b.add(new THREE.RingGeometry(0.0042, 0.0066, seg), M.glow, [0, PISTOL_BORE, -0.2008], [0, Math.PI, 0]);
  b.add(new THREE.CircleGeometry(0.0042, seg), M.bore, [0, PISTOL_BORE, -0.2007], [0, Math.PI, 0]);

  // užareni metak vidljiv kroz prozorčić ležišta
  b.add(kit.cylZ(0.0058, 0.0058, 0.034, seg), M.glow, [0, 0.0425, -0.031]);
  for (const z of [-0.019, -0.043]) b.add(kit.cylZ(0.0061, 0.0061, 0.0016, seg), M.orange, [0, 0.0425, z]);

  // svjetleće trake na okviru
  for (const sx of [-1, 1]) b.add(box(0.0006, 0.0026, 0.074), M.glow, [sx * 0.0142, 0.0095, -0.122]);

  // narančasta peta spremnika (8 metaka)
  const plate = new THREE.Shape();
  plate.moveTo(0.013, -0.095);
  plate.lineTo(0.065, -0.095);
  plate.lineTo(0.066, -0.101);
  plate.quadraticCurveTo(0.066, -0.105, 0.061, -0.105);
  plate.lineTo(0.017, -0.105);
  plate.quadraticCurveTo(0.012, -0.105, 0.013, -0.101);
  plate.closePath();
  b.add(kit.extrude(plate, 0.031, { bevel: 0.002, segs: 2, curve: 4 }), M.orange);
}

/* ================================================================ low: jednostavno i jeftino */

function buildRifleLow(kit) {
  const M = kit.materials();
  const rifle = new THREE.Group();
  rifle.name = 'rifle';
  const b = kit.batch();
  b.add(box(0.07, 0.12, 0.36), M.wood, [0, -0.03, 0.14]);
  b.add(box(0.05, 0.075, 0.035), M.wood, [0, -0.115, 0.08], [-0.3, 0, 0]);
  b.add(box(0.065, 0.08, 0.46), M.metal, [0, 0, -0.24]);
  b.add(box(0.06, 0.05, 0.3), M.wood, [0, -0.05, -0.32]);
  b.add(kit.cylZ(0.013, 0.016, 0.72, 8), M.metal, [0, BORE_Y, -0.83]);
  b.add(kit.cylZ(0.019, 0.019, 0.045, 8), M.metal, [0, BORE_Y, -1.1925]);
  b.add(kit.cylZ(0.03, 0.03, 0.32, 12), M.dark, [0, SCOPE_Y, -0.22]);
  b.add(kit.cylZ(0.036, 0.03, 0.06, 12), M.dark, [0, SCOPE_Y, -0.4]);
  b.add(new THREE.CircleGeometry(0.033, 12), M.glass, [0, SCOPE_Y, -0.4305], [0, Math.PI, 0]);
  b.add(new THREE.CircleGeometry(0.027, 12), M.glass, [0, SCOPE_Y, -0.0595]);
  b.add(kit.cylZ(0.011, 0.011, 0.02, 8), M.dark, [0, SCOPE_Y + 0.035, -0.22], [Math.PI / 2, 0, 0]);
  b.add(box(0.02, 0.04, 0.03), M.metal, [0, 0.045, -0.14]);
  b.add(box(0.02, 0.04, 0.03), M.metal, [0, 0.045, -0.3]);
  b.add(box(0.07, 0.016, 0.016), M.metal, [0.05, 0.02, -0.06]);
  b.add(box(0.03, 0.045, 0.08), M.dark, [0, -0.085, -0.13]);
  b.into(rifle);
  return rifle;
}

function buildPistolLow(kit) {
  const M = kit.materials();
  const pistol = new THREE.Group();
  pistol.name = 'pistol';
  const b = kit.batch();
  b.add(box(0.026, 0.032, 0.195), M.metal, [0, 0.034, -0.0725]);
  b.add(box(0.028, 0.016, 0.19), M.polymer, [0, 0.010, -0.073]);
  b.add(box(0.03, 0.11, 0.045), M.polymer, [0, -0.042, 0.026], [-0.27, 0, 0]);
  b.add(box(0.008, 0.006, 0.074), M.polymer, [0, -0.036, -0.033]);
  b.add(box(0.008, 0.04, 0.006), M.polymer, [0, -0.018, -0.068]);
  b.add(box(0.004, 0.022, 0.006), M.metal, [0, -0.014, -0.032]);
  b.add(box(0.0035, 0.007, 0.006), M.dark, [0, 0.0535, -0.158]);
  b.add(box(0.02, 0.008, 0.008), M.dark, [0, 0.054, 0.015]);
  b.add(box(0.024, 0.030, 0.03), M.orange, [0, 0.034, -0.186]);
  b.add(box(0.029, 0.003, 0.07), M.orange, [0, 0.010, -0.12]);
  b.add(box(0.027, 0.006, 0.03), M.orange, [0, 0.0475, -0.031]);
  b.add(box(0.032, 0.008, 0.05), M.orange, [0, -0.098, 0.040], [-0.27, 0, 0]);
  b.into(pistol);
  pistol.userData.glow = [M.orange];
  return pistol;
}
