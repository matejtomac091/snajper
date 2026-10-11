// Grafika po razinama kvalitete.
//   low   = izvorni izgled igre (školska računala, 4 GB RAM-a, integrirana grafika). Ništa dodatno.
//   high  = proceduralne teksture 512 px, PBR materijali, sjene od sunca, nebo s gradijentom i oblacima.
//   ultra = teksture 1024 px, sjene 4096 px i sitna trava/kamenčići po tlu (samo ukras, niži od 0.25 m).
// Sve teksture se crtaju na canvasu pri pokretanju; nema mrežnih resursa.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const GFX_LEVELS = ['low', 'high', 'ultra'];

const levelOf = (level) => (GFX_LEVELS.includes(level) ? level : 'low');

// Podešeno za ACES: scena ostaje svijetla, a sjene se i dalje jasno vide.
const RICH = {
  exposure: 0.95,
  horizon: '#c7dbeb', // ujedno boja magle
  upper: '#8bb7e0',
  zenith: '#3b76c0',
  sunColor: 0xfff1dc,
  sunIntensity: 3.8,
  sunDir: new THREE.Vector3(0.583, 0.766, 0.272).normalize(),
  hemiSky: 0xd9e8ff,
  hemiGround: 0x776c56,
  hemiIntensity: 0.55,
  envIntensity: 0.18,
};

// Veličina jedne pločice teksture u metrima (UV-ovi su u stvarnom mjerilu).
const TILE = { concrete: 4, container: 2.6, sand: 1, crate: 1.2, ground: 6 };
const POST_W = 0.14; // kutni stup kontejnera
const POST_U = 0.025; // stupac teksture kontejnera bez rebara (za stupove)

/* ================================================================ renderer */

export function createRenderer(level) {
  if (levelOf(level) === 'low') {
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    r.toneMapping = THREE.NoToneMapping;
    return r;
  }
  const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
  r.shadowMap.enabled = true;
  // U three r186 PCFSoftShadowMap više ne postoji (pretvara se u PCFShadowMap uz upozorenje u konzoli).
  // PCFShadowMap s shadow.radius je njegova zamjena i daje mekane rubove sjena.
  r.shadowMap.type = THREE.PCFShadowMap;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = RICH.exposure;
  r.outputColorSpace = THREE.SRGBColorSpace;
  return r;
}

/* ================================================================ materijali likova */

export function makeCharacterMaterial(level, color, opts) {
  const { emissive = false, metal = 0, rough = 0.6 } = opts ?? {};
  if (levelOf(level) === 'low') {
    return emissive ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color });
  }
  if (emissive) {
    return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 2.2, roughness: 0.4, metalness: 0 });
  }
  return new THREE.MeshStandardMaterial({
    color,
    roughness: THREE.MathUtils.clamp(rough, 0.05, 1),
    metalness: THREE.MathUtils.clamp(metal, 0, 1),
  });
}

/* ================================================================ okoliš */

export function buildEnvironment(scene, renderer, level, MAP, COLORS) {
  const lvl = levelOf(level);
  if (lvl === 'low') return buildLow(scene, MAP, COLORS);
  return buildRich(scene, renderer, lvl, MAP, COLORS);
}

// Stranice kutije: normala i kutovi (0 = min, 1 = max) obrnuto od kazaljke gledano izvana.
// c[0] -> c[1] ide "udesno", c[0] -> c[3] "prema gore".
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

/* ---------------------------------------------------------------- low: izvorni izgled, doslovno */

function buildLow(scene, MAP, COLORS) {
  const SKY = new THREE.Color('#a9cbe8');
  scene.background = SKY;
  scene.fog = new THREE.Fog(SKY, 110, 300);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x5d5648, 1.8));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
  sun.position.set(40, 90, 25);
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ map: lowGroundTexture() }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  scene.add(lowWorld(MAP, COLORS));
  return { sun, envMap: null, update() {} };
}

function lowGroundTexture() {
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

// Cijela mapa je jedna mreža s bojama po vrhovima: jedan poziv za crtanje umjesto 140.
function lowWorld(MAP, COLORS) {
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
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

/* ---------------------------------------------------------------- high / ultra */

function buildRich(scene, renderer, lvl, MAP, COLORS) {
  const ultra = lvl === 'ultra';
  const S = ultra ? 1024 : 512;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const aniso = ultra ? maxAniso : Math.min(4, maxAniso);
  const sunDir = RICH.sunDir;

  // nebo i magla (magla = boja horizonta pa se daleki objekti stapaju s nebom)
  const horizon = new THREE.Color(RICH.horizon);
  scene.background = horizon.clone();
  scene.fog = new THREE.Fog(horizon.clone(), 110, 300);
  const sky = makeSky(sunDir);
  scene.add(sky);

  // svjetla
  scene.add(new THREE.HemisphereLight(RICH.hemiSky, RICH.hemiGround, RICH.hemiIntensity));
  const sun = new THREE.DirectionalLight(RICH.sunColor, RICH.sunIntensity);
  setupSunShadow(sun, sunDir, ultra);
  scene.add(sun, sun.target);

  // okolišno svjetlo i odsjaji
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envMap = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();
  scene.environment = envMap;
  scene.environmentIntensity = RICH.envIntensity;

  // teksture
  const F = makeFields(S, 1337);
  const macro = canvasTexture(256, macroData(256), false, 1);
  const tex = (data, srgb) => canvasTexture(S, data, srgb, aniso);
  const concrete = concreteData(S, F);
  const containers = containerData(S, F, COLORS);
  const crate = crateData(S, F, COLORS[4]);
  const sand = sandData(S, F, COLORS[5]);

  const concreteRM = tex(concrete.rm, false);
  const mats = {
    concrete: new THREE.MeshStandardMaterial({
      map: tex(concrete.color, true), normalMap: tex(concrete.normal, false),
      roughnessMap: concreteRM, roughness: 1, metalness: 0, vertexColors: true,
    }),
    crate: new THREE.MeshStandardMaterial({
      map: tex(crate.color, true), normalMap: tex(crate.normal, false),
      roughnessMap: tex(crate.rm, false), roughness: 1, metalness: 0, vertexColors: true,
    }),
    sand: new THREE.MeshStandardMaterial({
      map: tex(sand.color, true), normalMap: tex(sand.normal, false),
      roughnessMap: tex(sand.rm, false), roughness: 1, metalness: 0, vertexColors: true,
    }),
  };
  const containerNormal = tex(containers.normal, false);
  const containerRM = tex(containers.rm, false);
  for (const [c, data] of containers.colors) {
    mats[`container${c}`] = new THREE.MeshStandardMaterial({
      map: tex(data, true), normalMap: containerNormal,
      roughnessMap: containerRM, metalnessMap: containerRM, roughness: 1, metalness: 1, vertexColors: true,
    });
  }

  // beton je siv i boji se po COLORS kroz boje vrhova; ovo vraća prosječnu svjetlinu na boju iz palete
  const concreteGain = 1 / concrete.meanLinear;
  for (const [key, mat] of Object.entries(mats)) addWorldVariation(mat, macro, key === 'concrete' ? 1 : 0.5);
  for (const mesh of richWorld(MAP, COLORS, mats, concreteGain)) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  scene.add(makeGround(S, F, aniso, MAP, macro));
  if (ultra) for (const m of makeClutter(MAP)) scene.add(m);

  return {
    sun,
    envMap,
    update(cameraPosition) {
      sky.position.copy(cameraPosition);
    },
  };
}

// Statična ortografska sjena preko cijele arene (±75 m), granice izračunate iz kutova arene.
function setupSunShadow(sun, sunDir, ultra) {
  sun.position.copy(sunDir).multiplyScalar(160);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  const sh = sun.shadow;
  const size = ultra ? 4096 : 2048;
  sh.mapSize.set(size, size);
  // U kartu sjena idu stražnje strane (three to radi sam za FrontSide materijale). Kutije su zatvorene i
  // stražnja strana je barem 0.3 m iza osvijetljene, pa je dovoljan mali pomak: nema "acne", a sjena
  // ne odlijepi od podnožja tankih zidova (peter-panning).
  sh.bias = 0;
  sh.normalBias = ultra ? 0.008 : 0.012;
  sh.radius = ultra ? 2 : 1.5;
  const cam = sh.camera;
  cam.position.copy(sun.position);
  cam.lookAt(sun.target.position);
  cam.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const x of [-75, 75]) for (const y of [0, 11]) for (const z of [-75, 75]) {
    v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    lo.min(v);
    hi.max(v);
  }
  cam.left = lo.x - 0.5;
  cam.right = hi.x + 0.5;
  cam.bottom = lo.y - 0.5;
  cam.top = hi.y + 0.5;
  cam.near = Math.max(0.5, -hi.z - 5);
  cam.far = -lo.z + 5;
  cam.updateProjectionMatrix();
}

/* ---------------------------------------------------------------- nebo */

function makeSky(sunDir) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      zenith: { value: new THREE.Color(RICH.zenith) },
      upper: { value: new THREE.Color(RICH.upper) },
      horizon: { value: new THREE.Color(RICH.horizon) },
      sunColor: { value: new THREE.Color(RICH.sunColor) },
      sunDir: { value: sunDir.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith;
      uniform vec3 upper;
      uniform vec3 horizon;
      uniform vec3 sunColor;
      uniform vec3 sunDir;
      varying vec3 vDir;
      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash12(i);
        float b = hash12(i + vec2(1.0, 0.0));
        float c = hash12(i + vec2(0.0, 1.0));
        float d = hash12(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float fbm(vec2 p) {
        float s = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) {
          s += a * vnoise(p);
          p = p * 2.03 + vec2(1.7, 9.2);
          a *= 0.5;
        }
        return s;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float t = max(h, 0.0);
        vec3 col = mix(horizon, upper, smoothstep(0.0, 0.22, t));
        col = mix(col, zenith, smoothstep(0.15, 0.9, t));
        float sd = max(dot(d, sunDir), 0.0);
        col += sunColor * (pow(sd, 8.0) * 0.22 + pow(sd, 64.0) * 0.45);
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.12) * 1.4;
          float n = fbm(uv + vec2(3.1, 7.4));
          float cover = smoothstep(0.5, 0.78, n) * smoothstep(0.02, 0.25, h);
          float lit = smoothstep(0.35, 0.8, fbm(uv * 1.9 + vec2(11.0, 4.0)));
          vec3 cloud = mix(vec3(0.74, 0.79, 0.86), vec3(1.0), 0.45 + 0.55 * lit) + sunColor * pow(sd, 6.0) * 0.25;
          col = mix(col, cloud, cover * 0.85);
        }
        col += sunColor * smoothstep(0.99935, 0.99975, sd) * 3.0;
        col = mix(horizon, col, smoothstep(-0.01, 0.0, h));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  // Kamera ima far = 450, pa kupola od 380 m uvijek stane. Crta se zadnja: samo nepokriveni pikseli.
  const sky = new THREE.Mesh(new THREE.SphereGeometry(380, 32, 16), mat);
  sky.frustumCulled = false;
  sky.renderOrder = 1000;
  sky.raycast = () => {};
  return sky;
}

/* ---------------------------------------------------------------- geometrija svijeta */

const KIND = { 0: 'concrete', 6: 'concrete', 7: 'concrete', 8: 'concrete', 9: 'concrete', 1: 'container', 2: 'container', 3: 'container', 10: 'container', 4: 'crate', 5: 'sand' };
const AO_MIN = 0.64;

// Jedna spojena mreža po materijalu. UV-ovi su u stvarnom mjerilu (metri / veličina pločice):
// ±X stranice koriste (z, y), ±Y (x, z), ±Z (x, y). Kontejneri i sanduci su usidreni na kut kutije
// da im okvir/šine padnu na rubove; sanduci se dijele na cijeli broj ploča od ~1.2 m.
function richWorld(MAP, COLORS, mats, concreteGain) {
  const groups = new Map();
  const tint = new THREE.Color();
  const P = new THREE.Vector3();
  const corner = (b, s) => new THREE.Vector3(s[0] ? b.maxX : b.minX, s[1] ? b.maxY : b.minY, s[2] ? b.maxZ : b.minZ);

  MAP.boxes.forEach((b, i) => {
    const kind = KIND[b.c] ?? 'concrete';
    const key = kind === 'container' ? `container${b.c}` : kind;
    if (!mats[key]) return;
    if (!groups.has(key)) groups.set(key, { pos: [], nor: [], uv: [], col: [], idx: [] });
    const g = groups.get(key);

    const shade = 0.95 + (((i * 7919) % 100) / 100) * 0.1;
    if (kind === 'concrete') tint.set(COLORS[b.c]).multiplyScalar(concreteGain * shade);
    else tint.setScalar(shade);
    const grounded = b.minY < 0.01;
    const height = b.maxY - b.minY;
    const aoH = grounded ? Math.min(0.9, height * 0.45) : 0;

    for (const f of FACES) {
      if (f.n[1] === -1 && grounded) continue; // dno na tlu se nikad ne vidi
      const side = f.n[1] === 0;
      const p0 = corner(b, f.c[0]);
      const right = corner(b, f.c[1]).sub(p0);
      const up = corner(b, f.c[3]).sub(p0);
      const W = right.length();
      const H = up.length();
      right.normalize();
      up.normalize();

      const cols = [0, 1];
      const rows = [0, 1];
      const post = kind === 'container' && side && W > POST_W * 3;
      if (post) cols.splice(1, 0, POST_W / W, 1 - POST_W / W);
      if (side && aoH > 0 && aoH < H) rows.splice(1, 0, aoH / H);

      const uvAt = (a, t) => {
        P.copy(p0).addScaledVector(right, a * W).addScaledVector(up, t * H);
        if (kind === 'crate') {
          return [a * Math.max(1, Math.round(W / TILE.crate)), t * Math.max(1, Math.round(H / TILE.crate))];
        }
        if (kind === 'container') {
          // šine moraju biti točno na vrhu i dnu: v ide 0..1 po visini kontejnera
          return side ? [(a * W) / TILE.container, t] : [(a * W) / TILE.container, (t * H) / TILE.container];
        }
        if (kind === 'sand' && side) return [P.dot(right) / TILE.sand, (P.y - b.minY) / TILE.sand];
        const tile = kind === 'sand' ? TILE.sand : TILE.concrete;
        return [P.dot(right) / tile, P.dot(up) / tile];
      };

      for (let ri = 0; ri < rows.length - 1; ri++) {
        for (let ci = 0; ci < cols.length - 1; ci++) {
          const isPost = post && ci !== 1;
          const start = g.pos.length / 3;
          for (const [a, t] of [[cols[ci], rows[ri]], [cols[ci + 1], rows[ri]], [cols[ci + 1], rows[ri + 1]], [cols[ci], rows[ri + 1]]]) {
            const uv = uvAt(a, t); // postavlja i P
            if (isPost) uv[0] = POST_U;
            g.pos.push(P.x, P.y, P.z);
            g.nor.push(f.n[0], f.n[1], f.n[2]);
            g.uv.push(uv[0], uv[1]);
            const y = P.y - b.minY;
            let k = aoH > 0 && y < aoH ? AO_MIN + (1 - AO_MIN) * (y / aoH) : 1;
            if (isPost) k *= 0.82;
            g.col.push(tint.r * k, tint.g * k, tint.b * k);
          }
          g.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
        }
      }
    }
  });

  const meshes = [];
  for (const [key, g] of groups) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3));
    geo.setIndex(g.idx);
    geo.computeBoundingSphere();
    meshes.push(new THREE.Mesh(geo, mats[key]));
  }
  return meshes;
}

// Velike mrlje u svjetskim koordinatama (jedno čitanje teksture) da se pločice od 4 m ne vide kao uzorak.
function addWorldVariation(mat, macro, amount) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.macroMap = { value: macro };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;\nuniform sampler2D macroMap;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec4 mv = texture2D(macroMap, vec2(vWorldP.x + vWorldP.z * 0.7, vWorldP.y + vWorldP.z * 0.4) / 23.0);
          diffuseColor.rgb *= 1.0 + ((mv.r - 0.5) * 1.2 + (mv.b - 0.5) * 0.3) * ${amount.toFixed(2)};
        }`);
  };
  mat.customProgramCacheKey = () => `snajper-world-${amount}`;
}

/* ---------------------------------------------------------------- tlo */

function makeGround(S, F, aniso, MAP, macro) {
  const data = groundData(S, F);
  const map = canvasTexture(S, data.color, true, aniso);
  const normalMap = canvasTexture(S, data.normal, false, aniso);
  normalMap.repeat.set(1 / TILE.ground, 1 / TILE.ground);
  const ao = groundAOTexture(S, MAP);

  const geo = new THREE.PlaneGeometry(1000, 1000);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), -p.getZ(i)); // UV u metrima
  const mat = new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.macroMap = { value: macro };
    shader.uniforms.groundAO = { value: ao };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;\nuniform sampler2D macroMap;\nuniform sampler2D groundAO;')
      .replace('#include <map_fragment>', /* glsl */ `
        #ifdef USE_MAP
          // dva uzorka iste teksture u različitom mjerilu i kutu + velike mrlje = nema vidljivog ponavljanja
          vec2 gUv = vGroundXZ / ${TILE.ground.toFixed(1)};
          vec4 g1 = texture2D(map, gUv);
          vec4 g2 = texture2D(map, mat2(0.79, -0.61, 0.61, 0.79) * gUv * 0.43 + vec2(0.37, 0.71));
          vec4 m1 = texture2D(macroMap, vGroundXZ / 113.0);
          vec4 m2 = texture2D(macroMap, vGroundXZ / 29.0 + vec2(0.5, 0.25));
          vec3 gc = mix(g1.rgb, g2.rgb, smoothstep(0.3, 0.7, m2.b));
          gc = mix(gc, gc * vec3(1.16, 1.07, 0.8), m1.g * 0.85);
          gc *= m1.r * 2.0 * (0.92 + 0.16 * m2.r);
          gc *= texture2D(groundAO, (vGroundXZ + 76.0) / 152.0).r;
          diffuseColor.rgb *= gc;
        #endif`);
  };
  mat.customProgramCacheKey = () => 'snajper-ground';
  const ground = new THREE.Mesh(geo, mat);
  ground.receiveShadow = true;
  return ground;
}

// Tamni rub na tlu oko svake kutije koja stoji na tlu (kontaktna sjena), preko cijele arene.
function groundAOTexture(S, MAP) {
  const N = S;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, N, N);
  const k = N / 152;
  const px = (v) => (v + 76) * k;
  g.fillStyle = 'rgba(0,0,0,0.075)';
  for (const b of MAP.boxes) {
    if (b.minY > 0.01) continue;
    const reach = 0.35 + Math.min(1.3, (b.maxY - b.minY) * 0.3);
    for (let s = 1; s <= 7; s++) {
      const e = (reach * s) / 7;
      g.fillRect(px(b.minX - e), px(b.minZ - e), (b.maxX - b.minX + 2 * e) * k, (b.maxZ - b.minZ + 2 * e) * k);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/* ---------------------------------------------------------------- sitni ukrasi na tlu (ultra) */

// Samo vizualno i niže od 0.25 m: ne smije zaklanjati pogled ondje gdje nema kolizije.
function makeClutter(MAP) {
  const rand = mulberry(9001);
  const blocked = MAP.boxes.filter((b) => b.minY < 0.3);
  const free = (x, z) => {
    if (Math.abs(x) > 69.6 || Math.abs(z) > 69.6) return false;
    for (const b of blocked) {
      if (x > b.minX - 0.15 && x < b.maxX + 0.15 && z > b.minZ - 0.15 && z < b.maxZ + 0.15) return false;
    }
    return true;
  };
  const inner = blocked.filter((b) => b.c !== 8);
  const centres = [];
  while (centres.length < 330) {
    let x, z;
    if (rand() < 0.45 && inner.length) {
      // uz podnožje zidova i kutija trava raste gušće
      const b = inner[Math.floor(rand() * inner.length)];
      const side = Math.floor(rand() * 4);
      const off = 0.2 + rand() * 0.7;
      x = side < 2 ? b.minX + rand() * (b.maxX - b.minX) : side === 2 ? b.minX - off : b.maxX + off;
      z = side >= 2 ? b.minZ + rand() * (b.maxZ - b.minZ) : side === 0 ? b.minZ - off : b.maxZ + off;
    } else {
      x = (rand() * 2 - 1) * 69;
      z = (rand() * 2 - 1) * 69;
    }
    if (free(x, z)) centres.push([x, z]);
  }

  const TUFTS = 2600;
  const PEBBLES = 400;
  const tuftMesh = new THREE.InstancedMesh(tuftGeometry(), new THREE.MeshStandardMaterial({
    map: tuftTexture(), alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.9, metalness: 0,
  }), TUFTS);
  const pebbleMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 }), PEBBLES);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const color = new THREE.Color();

  const place = (mesh, count, makeOne) => {
    let n = 0, guard = 0;
    while (n < count && guard++ < count * 20) {
      const [cx, cz] = centres[Math.floor(rand() * centres.length)];
      const r = Math.sqrt(rand()) * 1.4;
      const a = rand() * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (!free(x, z)) continue;
      makeOne(x, z);
      mesh.setMatrixAt(n, m);
      mesh.setColorAt(n, color);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  place(tuftMesh, TUFTS, (x, z) => {
    const s = 0.7 + rand() * 0.45;
    // geometrija je visoka 0.2 m, a y-mjerilo najviše 1.15 → najviše 0.23 m
    scl.set(s, 0.6 + rand() * 0.55, s);
    m.compose(pos.set(x, 0, z), q.setFromEuler(e.set(0, rand() * Math.PI, 0)), scl);
    color.setHSL(0.17 + rand() * 0.06, 0.3 + rand() * 0.25, 0.7 + rand() * 0.2);
  });
  place(pebbleMesh, PEBBLES, (x, z) => {
    const s = 0.035 + rand() * 0.08;
    scl.set(s * (0.8 + rand() * 0.5), s * (0.45 + rand() * 0.3), s * (0.8 + rand() * 0.5));
    m.compose(pos.set(x, 0, z), q.setFromEuler(e.set(rand() * 0.4, rand() * Math.PI, rand() * 0.4)), scl);
    color.setHSL(0.08 + rand() * 0.05, 0.06 + rand() * 0.08, 0.26 + rand() * 0.14);
  });

  for (const mesh of [tuftMesh, pebbleMesh]) {
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.raycast = () => {};
    mesh.computeBoundingSphere();
  }
  return [tuftMesh, pebbleMesh];
}

function tuftGeometry() {
  const pos = [], nor = [], uv = [], idx = [];
  const w = 0.17, h = 0.2;
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI) / 3;
    const dx = Math.cos(a) * w, dz = Math.sin(a) * w;
    const s = pos.length / 3;
    pos.push(-dx, 0, -dz, dx, 0, dz, dx, h, dz, -dx, h, -dz);
    for (let i = 0; i < 4; i++) nor.push(0, 1, 0); // osvijetljeno kao tlo, ne kao okomita ploha
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(s, s + 1, s + 2, s, s + 2, s + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

function tuftTexture() {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const rand = mulberry(77);
  for (let i = 0; i < 26; i++) {
    const x = N * (0.12 + rand() * 0.76);
    const w = N * (0.018 + rand() * 0.02);
    const top = N * (0.05 + rand() * 0.5);
    const lean = (rand() - 0.5) * N * 0.35;
    const l = 165 + rand() * 75;
    g.fillStyle = `rgb(${(l * 0.74) | 0},${l | 0},${(l * 0.42) | 0})`;
    g.beginPath();
    g.moveTo(x - w, N);
    g.quadraticCurveTo(x - w * 0.5 + lean * 0.3, (N + top) / 2, x + lean, top);
    g.quadraticCurveTo(x + w * 0.5 + lean * 0.3, (N + top) / 2, x + w, N);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ================================================================ proceduralne teksture */

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ss = (a, b, x) => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

// Šum vrijednosti koji se besprijekorno ponavlja na S×S (S je potencija broja 2), normaliziran na 0..1.
function fbmField(S, cells, octaves, seed) {
  const out = new Float32Array(S * S);
  const rand = mulberry(seed);
  let amp = 1;
  for (let o = 0; o < octaves; o++) {
    const n = cells << o;
    if (n > S) break;
    const lat = new Float32Array(n * n);
    for (let i = 0; i < lat.length; i++) lat[i] = rand();
    const step = n / S;
    const x0 = new Int32Array(S), x1 = new Int32Array(S), fx = new Float32Array(S);
    for (let x = 0; x < S; x++) {
      const v = x * step, i = Math.floor(v), f = v - i;
      x0[x] = i % n;
      x1[x] = (i + 1) % n;
      fx[x] = f * f * (3 - 2 * f);
    }
    for (let y = 0; y < S; y++) {
      const v = y * step, j = Math.floor(v), f = v - j, fy = f * f * (3 - 2 * f);
      const r0 = (j % n) * n, r1 = ((j + 1) % n) * n, row = y * S;
      for (let x = 0; x < S; x++) {
        const a = lat[r0 + x0[x]], b = lat[r0 + x1[x]], c = lat[r1 + x0[x]], d = lat[r1 + x1[x]];
        const top = a + (b - a) * fx[x];
        out[row + x] += (top + (c + (d - c) * fx[x] - top) * fy) * amp;
      }
    }
    amp *= 0.5;
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < out.length; i++) {
    if (out[i] < lo) lo = out[i];
    if (out[i] > hi) hi = out[i];
  }
  const k = 1 / (hi - lo || 1);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) * k;
  return out;
}

// Zajednička polja šuma za sve teksture (svaka ih čita s drugim pomakom).
function makeFields(S, seed) {
  const rand = mulberry(seed + 4);
  const G = new Float32Array(S * S);
  for (let i = 0; i < G.length; i++) G[i] = rand();
  return {
    A: fbmField(S, 4, 6, seed + 1), // krupno
    B: fbmField(S, 16, 4, seed + 2), // srednje
    C: fbmField(S, 64, 3, seed + 3), // sitno
    G, // zrno po pikselu
  };
}

// Normal mapa (tangentni prostor, OpenGL) iz visine u metrima; p = metara po pikselu.
function normalFromHeight(S, H, p, gain = 1) {
  const out = new Uint8ClampedArray(S * S * 4);
  const M = S - 1;
  const k = gain / (2 * p);
  for (let y = 0; y < S; y++) {
    const up = ((y - 1) & M) * S, dn = ((y + 1) & M) * S, row = y * S;
    for (let x = 0; x < S; x++) {
      const dx = (H[row + ((x + 1) & M)] - H[row + ((x - 1) & M)]) * k;
      const dy = (H[dn + x] - H[up + x]) * k;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const o = (row + x) * 4;
      out[o] = (-dx * inv * 0.5 + 0.5) * 255;
      out[o + 1] = (dy * inv * 0.5 + 0.5) * 255;
      out[o + 2] = (inv * 0.5 + 0.5) * 255;
      out[o + 3] = 255;
    }
  }
  return out;
}

function canvasTexture(S, data, srgb, aniso) {
  let c = data;
  if (!(data instanceof HTMLCanvasElement)) {
    c = document.createElement('canvas');
    c.width = c.height = S;
    c.getContext('2d').putImageData(new ImageData(data, S, S), 0, 0);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  return t;
}

const hexRGB = (hex) => {
  const h = new THREE.Color(hex).getHex();
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
};

function meanLinear(color) {
  let sum = 0, n = 0;
  for (let i = 0; i < color.length; i += 4 * 7) {
    sum += s2l(color[i] / 255) * 0.2126 + s2l(color[i + 1] / 255) * 0.7152 + s2l(color[i + 2] / 255) * 0.0722;
    n++;
  }
  return sum / n;
}

/* ---------------------------------------------------------------- beton (siv, boji se po vrhovima) */

function concreteData(S, F) {
  const M = S - 1, p = TILE.concrete / S;
  const color = new Uint8ClampedArray(S * S * 4), rm = new Uint8ClampedArray(S * S * 4), H = new Float32Array(S * S);
  const { A, B, C, G } = F;
  const panel = S / 2, hole = S / 4;
  const holeR = Math.max(1.3, 0.017 / p), seamW = Math.max(1, 0.009 / p);
  const streak = new Float32Array(S);
  for (let x = 0; x < S; x++) streak[x] = ss(0.6, 0.85, C[37 * S + x]) * ss(0.35, 0.7, B[101 * S + x]);
  const oa = S >> 1, ob = (S / 3) | 0;

  for (let y = 0; y < S; y++) {
    const yy = y % panel;
    const dsy = Math.min(yy + 0.5, panel - yy - 0.5);
    const fall = Math.pow(1 - yy / panel, 1.5);
    const hy = ((y + 0.5) % hole) - hole / 2;
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const a = A[i], b = B[((y + 97) & M) * S + ((x + 211) & M)], c = C[i], g = G[i];
      const a2 = A[((y + oa) & M) * S + ((x + ob) & M)];
      let v = 0.84 + (a - 0.5) * 0.1 + (b - 0.5) * 0.1 + (c - 0.5) * 0.07 + (g - 0.5) * 0.06;
      const stain = ss(0.6, 0.9, a2);
      v *= 1 - 0.1 * stain;
      v *= 1 - 0.15 * streak[x] * fall * (0.6 + 0.4 * c);
      const xx = x % panel;
      const ds = Math.min(dsy, xx + 0.5, panel - xx - 0.5);
      const seam = 1 - ss(seamW * 0.5, seamW * 1.7, ds);
      v *= 1 - 0.4 * seam;
      const hx = ((x + 0.5) % hole) - hole / 2;
      const hm = 1 - ss(holeR * 0.7, holeR * 1.3, Math.sqrt(hx * hx + hy * hy));
      v *= 1 - 0.5 * hm;
      H[i] = b * 0.004 + c * 0.003 + g * 0.0007 - seam * 0.006 - hm * 0.008;
      const o = i * 4;
      color[o] = v * 255;
      color[o + 1] = v * 253;
      color[o + 2] = v * 250;
      color[o + 3] = 255;
      rm[o + 1] = (0.86 + (b - 0.5) * 0.12 - stain * 0.1 + seam * 0.06) * 255;
      rm[o + 3] = 255;
    }
  }
  // sitne rupice od zraka
  const rand = mulberry(5);
  const pits = (S * S) / 1800;
  for (let n = 0; n < pits; n++) {
    const cx = rand() * S, cy = rand() * S, r = (0.0015 + rand() * 0.003) / p + 0.5;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > r) continue;
        const i = (y & M) * S + (x & M);
        const k = 1 - 0.3 * (1 - d / r);
        color[i * 4] *= k;
        color[i * 4 + 1] *= k;
        color[i * 4 + 2] *= k;
        H[i] -= 0.002 * (1 - d / r);
      }
    }
  }
  return { color, rm, normal: normalFromHeight(S, H, p, 1), meanLinear: meanLinear(color) };
}

/* ---------------------------------------------------------------- kontejner (valoviti lim, boja ubačena u teksturu) */

function containerData(S, F, COLORS) {
  const M = S - 1, p = TILE.container / S;
  const { A, B, C, G } = F;
  const N = S * S;
  const H = new Float32Array(N), shadeM = new Float32Array(N), rust = new Float32Array(N), dirt = new Float32Array(N), bleach = new Float32Array(N);
  const rm = new Uint8ClampedArray(N * 4);

  // presjek rebra (trapez): 9 rebara po pločici, prvih 5% širine je ravno (spoj panela / kutni stup)
  const flat = Math.round(S * 0.05);
  const rib = new Float32Array(S);
  for (let x = flat; x < S; x++) {
    const t = (((x + 0.5 - flat) / (S - flat)) * 9) % 1;
    rib[x] = t < 0.12 ? ss(0, 1, t / 0.12) : t < 0.45 ? 1 : t < 0.57 ? 1 - ss(0, 1, (t - 0.45) / 0.12) : 0;
  }
  const rustCol = new Float32Array(S);
  for (let x = 0; x < S; x++) rustCol[x] = ss(0.72, 0.9, C[211 * S + x]);
  const railT = Math.round(S * 0.045), railB = Math.round(S * 0.065);

  for (let y = 0; y < S; y++) {
    const fy = y / S;
    const inTop = y < railT, inBot = y >= S - railB;
    const edge = Math.min(Math.abs(y - railT), Math.abs(S - railB - y));
    const nearRail = 1 - ss(0, S * 0.08, edge);
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const a = A[((y + 300) & M) * S + ((x + 50) & M)], b = B[i], c = C[((y + 77) & M) * S + x], g = G[i];
      let h = rib[x] * 0.036;
      let sh = 0.94 + (rib[x] - 0.5) * 0.08; // malo tamnije u udubinama
      if (inTop || inBot) {
        const d = inTop ? railT - y : y - (S - railB);
        const bev = ss(0, 2.5, d);
        h = 0.044 * bev + (inTop ? 0 : 0.002 * g);
        sh = 0.84 + 0.06 * bev;
      } else if (y === railT || y === S - railB - 1) {
        sh *= 0.8;
      }
      sh *= 0.94 + (a - 0.5) * 0.12 + (c - 0.5) * 0.06 + (g - 0.5) * 0.04;
      const r = ss(0.7, 0.86, b * 0.5 + c * 0.25 + a * 0.1 + nearRail * 0.22 + (inBot ? 0.1 : 0))
        + rustCol[x] * Math.max(0, 1 - y / (S * 0.45)) * (0.4 + 0.6 * c) * (y > railT ? 1 : 0) * 0.6;
      rust[i] = Math.min(1, r);
      dirt[i] = ss(0.55, 1.0, fy) * (0.45 + 0.55 * B[((y + 150) & M) * S + ((x + 333) & M)]);
      bleach[i] = (1 - fy) * (1 - fy) * (0.4 + 0.6 * a);
      shadeM[i] = sh;
      H[i] = h + rust[i] * c * 0.0015;
      const o = i * 4;
      rm[o + 1] = (0.48 + (b - 0.5) * 0.12 + rust[i] * 0.42 + dirt[i] * 0.25) * 255;
      rm[o + 2] = (0.35 * (1 - rust[i]) * (1 - dirt[i] * 0.6)) * 255;
      rm[o + 3] = 255;
    }
  }
  // ogrebotine (svjetlije, do temeljne boje)
  const scratch = new Float32Array(N);
  const rand = mulberry(31);
  for (let n = 0; n < 35; n++) {
    let x = rand() * S, y = S * (0.15 + rand() * 0.75);
    const ang = (rand() - 0.5) * 1.2, len = S * (0.02 + rand() * 0.07);
    for (let s = 0; s < len; s++) {
      x += Math.cos(ang);
      y += Math.sin(ang);
      scratch[((y | 0) & M) * S + ((x | 0) & M)] = 0.6 + rand() * 0.4;
    }
  }

  const colors = new Map();
  for (const c of [1, 2, 3, 10]) {
    const [pr, pg, pb] = hexRGB(COLORS[c]);
    const out = new Uint8ClampedArray(N * 4);
    for (let i = 0; i < N; i++) {
      const g = G[i], cc = C[i];
      let r = pr * shadeM[i], gg = pg * shadeM[i], bb = pb * shadeM[i];
      const bl = bleach[i] * 0.18;
      r += (225 - r) * bl; gg += (225 - gg) * bl; bb += (220 - bb) * bl;
      const d = dirt[i] * 0.5;
      r += (78 - r) * d; gg += (66 - gg) * d; bb += (52 - bb) * d;
      const rs = rust[i];
      if (rs > 0) {
        const t = cc * 0.7 + g * 0.3;
        r += (86 + 52 * t - r) * rs; gg += (52 + 32 * t - gg) * rs; bb += (34 + 18 * t - bb) * rs;
      }
      const sc = scratch[i];
      if (sc > 0) { r += (190 - r) * sc * 0.3; gg += (186 - gg) * sc * 0.3; bb += (178 - bb) * sc * 0.3; }
      const o = i * 4;
      out[o] = r; out[o + 1] = gg; out[o + 2] = bb; out[o + 3] = 255;
    }
    colors.set(c, out);
  }
  return { colors, rm, normal: normalFromHeight(S, H, p, 1) };
}

/* ---------------------------------------------------------------- drveni sanduk (daske + okvir + dijagonala) */

function crateData(S, F, hex) {
  const p = TILE.crate / S;
  const { A, B, C, G } = F;
  const N = S * S;
  const color = new Uint8ClampedArray(N * 4), rm = new Uint8ClampedArray(N * 4), H = new Float32Array(N);
  const [wr, wg, wb] = hexRGB(hex);
  const fw = S * 0.13, bw = S * 0.12, planks = 5, plankH = S / planks;
  const gap = Math.max(1.2, 0.005 / p);
  // dijagonala od donjeg lijevog do gornjeg desnog unutarnjeg kuta (canvas y raste prema dolje)
  const ax = fw, ay = S - fw, bx = S - fw, by = fw;
  const dl = Math.hypot(bx - ax, by - ay), dxn = (bx - ax) / dl, dyn = (by - ay) / dl;
  const tone = (id) => 0.84 + mulberry(id * 977 + 3)() * 0.26;
  const sample = (f, x, y) => f[((y | 0) & (S - 1)) * S + ((x | 0) & (S - 1))];

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let along, across, id, h, edgeD;
      const dEdge = Math.min(x, S - 1 - x, y, S - 1 - y);
      const proj = (x - ax) * dxn + (y - ay) * dyn;
      const perp = Math.abs((x - ax) * -dyn + (y - ay) * dxn);
      if (dEdge < fw) {
        const vertical = Math.min(x, S - 1 - x) < fw && Math.min(x, S - 1 - x) <= Math.min(y, S - 1 - y);
        id = vertical ? (x < S / 2 ? 1 : 2) : (y < S / 2 ? 3 : 4);
        along = vertical ? y : x;
        across = vertical ? x : y;
        edgeD = vertical ? Math.min(Math.abs(x - (x < S / 2 ? fw : S - 1 - fw)), x, S - 1 - x) : Math.min(Math.abs(y - (y < S / 2 ? fw : S - 1 - fw)), y, S - 1 - y);
        h = 0.022;
      } else if (perp < bw / 2 && proj > 0 && proj < dl) {
        id = 5;
        along = proj;
        across = perp;
        edgeD = bw / 2 - perp;
        h = 0.02;
      } else {
        const k = Math.floor(y / plankH);
        id = 10 + k;
        along = x;
        across = y;
        const yy = y - k * plankH;
        edgeD = Math.min(yy, plankH - yy);
        h = edgeD < gap ? -0.006 : 0;
      }
      // letvičasta tekstura drveta: šum razvučen duž daske
      const grain = sample(C, along * 0.12 + id * 61, across * 1.6) * 0.6 + sample(B, along * 0.25 + id * 37, across * 2.2) * 0.4;
      const ring = 0.5 + 0.5 * Math.sin((across * 0.9 + sample(A, along * 0.3, across * 0.3 + id * 50) * 40) * 0.8);
      let v = tone(id) * (0.8 + grain * 0.25 + ring * 0.08) * (0.94 + G[i] * 0.08);
      const bevel = ss(0, 2.2, edgeD);
      v *= 0.7 + 0.3 * bevel;
      if (h < 0) v *= 0.35;
      // sjena od uzdignutog okvira/dijagonale na daskama
      if (id >= 10) {
        const dFrame = dEdge - fw;
        const dBrace = perp - bw / 2;
        const near = Math.min(dFrame, proj > 0 && proj < dl ? dBrace : 1e9);
        v *= 0.72 + 0.28 * ss(0, S * 0.025, near);
      }
      H[i] = h * bevel + grain * 0.0015;
      const o = i * 4;
      color[o] = wr * v; color[o + 1] = wg * v; color[o + 2] = wb * v; color[o + 3] = 255;
      rm[o + 1] = (0.78 + (grain - 0.5) * 0.2) * 255;
      rm[o + 3] = 255;
    }
  }
  // čavli na okviru i krajevima dijagonale
  const nails = [];
  for (const u of [fw / 2, S - fw / 2]) for (const v of [fw / 2, S - fw / 2]) nails.push([u, v]);
  for (const u of [fw / 2, S - fw / 2]) nails.push([u, S / 2], [S / 2, u]);
  nails.push([ax + dxn * fw * 0.6, ay + dyn * fw * 0.6], [bx - dxn * fw * 0.6, by - dyn * fw * 0.6]);
  const nr = Math.max(1.3, 0.008 / p);
  for (const [cx, cy] of nails) {
    for (const ox of [-S * 0.025, S * 0.025]) {
      const px = cx + ox, py = cy;
      for (let y = Math.floor(py - nr - 1); y <= py + nr + 1; y++) {
        for (let x = Math.floor(px - nr - 1); x <= px + nr + 1; x++) {
          if (x < 0 || y < 0 || x >= S || y >= S) continue;
          const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
          if (d > nr) continue;
          const o = (y * S + x) * 4;
          const k = 0.45 + 0.25 * (1 - d / nr);
          color[o] = 70 * k + 30; color[o + 1] = 68 * k + 28; color[o + 2] = 64 * k + 26;
          rm[o + 1] = 120;
          H[y * S + x] += 0.002 * (1 - d / nr);
        }
      }
    }
  }
  return { color, rm, normal: normalFromHeight(S, H, p, 1.2) };
}

/* ---------------------------------------------------------------- vreće s pijeskom */

function sandData(S, F, hex) {
  const M = S - 1, p = TILE.sand / S;
  const { A, B, C, G } = F;
  const N = S * S;
  const color = new Uint8ClampedArray(N * 4), rm = new Uint8ClampedArray(N * 4), H = new Float32Array(N);
  const [sr, sg, sb] = hexRGB(hex);
  const rows = 5, rowH = S / rows, bagW = S / 2;
  const jit = (r, k, s) => mulberry(r * 131 + k * 17 + s * 7 + 11)();

  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / rowH);
    const by0 = ((y - row * rowH) / rowH) * 2 - 1;
    const off = (row % 2) * bagW * 0.5;
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const lx = (x + off) % S;
      const k = Math.floor(lx / bagW);
      const bx0 = ((lx - k * bagW) / bagW) * 2 - 1;
      const sx = 0.95 + jit(row, k, 1) * 0.04, sy = 0.9 + jit(row, k, 2) * 0.08;
      const qx = (bx0 - (jit(row, k, 3) - 0.5) * 0.05) / sx;
      const qy = (by0 - (jit(row, k, 4) - 0.5) * 0.08 + qx * (jit(row, k, 5) - 0.5) * 0.2) / sy;
      const d = Math.pow(Math.abs(qx), 4) + Math.pow(Math.abs(qy), 2.2);
      let h = d < 1 ? Math.pow(1 - d, 0.35) : 0;
      // zavezani kraj vreće
      const tieSide = (row + k) % 2 ? 1 : -1;
      const tie = ss(0.78, 0.95, qx * tieSide) * (d < 1 ? 1 : 0);
      h *= 1 - 0.25 * tie;
      const a = A[i], b = B[((y + 41) & M) * S + ((x + 87) & M)], c = C[i], g = G[i];
      const weave = 0.95 + 0.05 * Math.sin(x * 2.1) * Math.sin(y * 2.1);
      const fold = 1 - 0.12 * ss(0.6, 0.9, C[((y * 3) & M) * S + ((x + 500) & M)]) * h;
      const bagTone = 0.9 + jit(row, k, 6) * 0.16;
      let v = (0.6 + 0.4 * h) * bagTone * (0.9 + (b - 0.5) * 0.18 + (c - 0.5) * 0.1 + (g - 0.5) * 0.06) * weave * fold * (1 - 0.15 * tie);
      v *= 1 - 0.12 * (y / S) * (0.5 + a); // donji redovi prljaviji
      if (h <= 0) v = 0.4 + 0.1 * g;
      H[i] = h * 0.05 + c * 0.003 + g * 0.0005;
      const o = i * 4;
      color[o] = sr * v; color[o + 1] = sg * v; color[o + 2] = sb * v * (1 - 0.05 * tie); color[o + 3] = 255;
      rm[o + 1] = (0.92 + (g - 0.5) * 0.08) * 255;
      rm[o + 3] = 255;
    }
  }
  return { color, rm, normal: normalFromHeight(S, H, p, 1) };
}

/* ---------------------------------------------------------------- trava i zemlja */

function groundData(S, F) {
  const M = S - 1, p = TILE.ground / S;
  const { A, B, C, G } = F;
  const N = S * S;
  const H = new Float32Array(N);
  const dirtMask = new Float32Array(N);
  const img = new Uint8ClampedArray(N * 4);
  const grassA = [104, 132, 66], grassB = [146, 164, 88], dry = [170, 160, 104], soil = [128, 108, 80];
  const oa = (S / 3) | 0, ob = (S * 0.7) | 0;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const a = A[((y + oa) & M) * S + ((x + ob) & M)], a2 = A[((y + 200) & M) * S + ((x + 31) & M)];
      const b = B[((y + 13) & M) * S + ((x + 400) & M)], c = C[((y + 90) & M) * S + ((x + 7) & M)], g = G[i];
      const t = ss(0.25, 0.75, b * 0.7 + c * 0.3);
      let r = grassA[0] + (grassB[0] - grassA[0]) * t, gg = grassA[1] + (grassB[1] - grassA[1]) * t, bb = grassA[2] + (grassB[2] - grassA[2]) * t;
      const dr = ss(0.55, 0.8, a2) * 0.55;
      r += (dry[0] - r) * dr; gg += (dry[1] - gg) * dr; bb += (dry[2] - bb) * dr;
      const dm = ss(0.72, 0.84, a + (c - 0.5) * 0.25);
      dirtMask[i] = dm;
      r += (soil[0] - r) * dm * 0.75; gg += (soil[1] - gg) * dm * 0.75; bb += (soil[2] - bb) * dm * 0.75;
      const k = (0.86 + c * 0.22) * (0.9 + g * 0.2);
      const o = i * 4;
      img[o] = r * k; img[o + 1] = gg * k; img[o + 2] = bb * k; img[o + 3] = 255;
      H[i] = c * 0.012 + g * 0.002 - dm * 0.004 + b * 0.01;
    }
  }

  // vlati trave: kratki potezi u nekoliko nijansi, grupirani po boji (malo poziva canvasa)
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.putImageData(new ImageData(img, S, S), 0, 0);
  const rand = mulberry(99);
  const shades = ['#5d7a37', '#7d9a49', '#9cb35f', '#b3b878', '#4f6a2e', '#8aa152'];
  const len0 = 0.012 / p, len1 = 0.035 / p;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, 0.004 / p);
  const strokes = Math.round(N / 55);
  const paths = shades.map(() => new Path2D());
  for (let n = 0; n < strokes; n++) {
    const x = rand() * S, y = rand() * S;
    if (dirtMask[((y | 0) & M) * S + ((x | 0) & M)] > rand() * 1.2) continue;
    const ang = rand() * Math.PI * 2, len = len0 + rand() * (len1 - len0);
    const ex = Math.cos(ang) * len, ey = Math.sin(ang) * len;
    const path = paths[Math.floor(rand() * shades.length)];
    for (const ox of [0, x < len1 ? S : x > S - len1 ? -S : 0]) {
      for (const oy of [0, y < len1 ? S : y > S - len1 ? -S : 0]) {
        path.moveTo(x + ox, y + oy);
        path.lineTo(x + ox + ex, y + oy + ey);
      }
    }
  }
  ctx.globalAlpha = 0.5;
  paths.forEach((path, k) => {
    ctx.strokeStyle = shades[k];
    ctx.stroke(path);
  });
  ctx.globalAlpha = 1;
  // kamenčići na zemljanim mrljama
  for (let n = 0; n < N / 900; n++) {
    const x = rand() * S, y = rand() * S;
    if (dirtMask[((y | 0) & M) * S + ((x | 0) & M)] < 0.3) continue;
    const r = (0.003 + rand() * 0.006) / p;
    const l = 110 + rand() * 60;
    ctx.fillStyle = `rgb(${l | 0},${(l * 0.96) | 0},${(l * 0.9) | 0})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + rand() * 0.4), rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  return { color: cv, normal: normalFromHeight(S, H, p, 1) };
}

// Velike mrlje za tlo (podaci, ne boja): R = svjetlina/2, G = suhoća, B = maska miješanja dvaju mjerila.
function macroData(S) {
  const R = fbmField(S, 4, 5, 501), Gf = fbmField(S, 3, 5, 502), Bf = fbmField(S, 5, 4, 503);
  const out = new Uint8ClampedArray(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const o = i * 4;
    out[o] = (0.5 + (R[i] - 0.5) * 0.16) * 255;
    out[o + 1] = ss(0.5, 0.85, Gf[i]) * 255;
    out[o + 2] = Bf[i] * 255;
    out[o + 3] = 255;
  }
  return out;
}
