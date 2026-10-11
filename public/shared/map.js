// Mapa "Luka": 140 x 140 m. Pola mape se zrcali kroz središte pa obje strane imaju iste pozicije.
// Kutija: [centarX, dnoY, centarZ, širina(x), visina(y), dubina(z), boja]

export const ARENA = 70;

export const COLORS = [
  '#a7abb1', // 0 zid
  '#b4533c', // 1 crveni kontejner
  '#3f6fb0', // 2 plavi kontejner
  '#4f8a4a', // 3 zeleni kontejner
  '#a9803f', // 4 sanduk
  '#c2b083', // 5 vreće s pijeskom
  '#7d818a', // 6 toranj
  '#949aa3', // 7 stepenice
  '#5d636b', // 8 vanjski zid
  '#8b9098', // 9 krov
  '#caa22a', // 10 žuti kontejner
];

const C = { wall: 0, red: 1, blue: 2, green: 3, crate: 4, sand: 5, tower: 6, stair: 7, border: 8, roof: 9, yellow: 10 };

function box(list, cx, y, cz, w, h, d, c) {
  list.push([cx, y, cz, w, h, d, c]);
}

// Snajperski toranj visok 6 m sa stepenicama na istočnoj strani i ogradom s prorezima.
function tower(L, cx, cz) {
  box(L, cx, 0, cz, 8, 6, 8, C.tower);
  const steps = 12;
  const depth = 0.65;
  for (let i = 1; i <= steps; i++) {
    box(L, cx + 4 + (steps - i + 0.5) * depth, 0, cz + 2.5, depth, i * 0.5, 2.4, C.stair);
  }
  const y = 6, h = 1.1, t = 0.4;
  box(L, cx, y, cz - 3.8, 8, h, t, C.wall);              // sjever
  box(L, cx - 3.8, y, cz, t, h, 8, C.wall);              // zapad
  box(L, cx - 2.5, y, cz + 3.8, 3, h, t, C.wall);        // jug, s prorezom
  box(L, cx + 2, y, cz + 3.8, 4, h, t, C.wall);
  box(L, cx + 3.8, y, cz - 3.25, t, h, 1.5, C.wall);     // istok, s prorezom; južni dio je ulaz sa stepenica
  box(L, cx + 3.8, y, cz - 0.25, t, h, 2.5, C.wall);
}

// Pola središnje zgrade (16 x 16 m, krov na 4.8 m). Druga polovica nastaje zrcaljenjem.
function centerHalf(L) {
  box(L, -4.6, 0, -7.75, 6.8, 4.5, 0.5, C.wall);         // sjeverni zid s vratima
  box(L, 4.6, 0, -7.75, 6.8, 4.5, 0.5, C.wall);
  box(L, 0, 2.6, -7.75, 2.4, 1.9, 0.5, C.wall);
  box(L, -7.75, 0, -4.35, 0.5, 4.5, 6.3, C.wall);        // zapadni zid s vratima
  box(L, -7.75, 0, 4.35, 0.5, 4.5, 6.3, C.wall);
  box(L, -7.75, 2.6, 0, 0.5, 1.9, 2.4, C.wall);
  const n = 10, top = 4.8, depth = 0.68;                 // vanjske stepenice na krov
  for (let i = 1; i <= n; i++) {
    box(L, 8 - (n - i + 0.5) * depth, 0, -9.1, depth, (top / n) * i, 2.0, C.stair);
  }
  box(L, -1.5, 4.8, -7.8, 13, 0.9, 0.4, C.roof);         // ograda na krovu
  box(L, -7.8, 4.8, 0, 0.4, 0.9, 15.2, C.roof);
  box(L, -4.5, 0, -4.5, 1.3, 1.3, 1.3, C.crate);
}

function halfMap(L) {
  tower(L, -56, -56);
  centerHalf(L);

  // kontejnerski terminal
  box(L, 44, 0, -50, 6.1, 2.6, 2.5, C.red);
  box(L, 44, 0, -46.5, 6.1, 2.6, 2.5, C.blue);
  box(L, 38.5, 0, -48, 2.5, 2.6, 6.1, C.green);
  box(L, 48, 0, -43.6, 1.2, 1.0, 1.2, C.crate);         // sanduci za penjanje na kontejner
  box(L, 48.2, 0, -45.3, 1.3, 2.0, 1.3, C.crate);
  box(L, 53, 0, -30, 2.5, 2.6, 6.1, C.yellow);
  box(L, 25, 0, -61, 6.1, 2.6, 2.5, C.blue);

  // dugi zidovi
  box(L, -40, 0, -22, 14, 3, 0.6, C.wall);
  box(L, -18, 0, -22, 12, 3, 0.6, C.wall);
  box(L, 20, 0, -24, 16, 3, 0.6, C.wall);
  box(L, 46, 0, -18, 0.6, 3, 12, C.wall);
  box(L, -60, 0, -20, 0.6, 3, 16, C.wall);

  // vreće s pijeskom (zaklon za čučanje)
  box(L, -28, 0, -36, 5, 1.0, 1, C.sand);
  box(L, 8, 0, -40, 6, 1.0, 1, C.sand);
  box(L, 30, 0, -36, 1, 1.0, 5, C.sand);
  box(L, -48, 0, -34, 4, 1.0, 1, C.sand);
  box(L, 60, 0, -8, 1, 1.0, 5, C.sand);
  box(L, -8, 0, -56, 5, 1.0, 1, C.sand);
  box(L, 22, 0, -10, 4, 1.0, 1, C.sand);

  // sanduci
  box(L, -22, 0, -8, 1.4, 1.4, 1.4, C.crate);
  box(L, -23.5, 0, -6.6, 1.2, 1.2, 1.2, C.crate);
  box(L, -30, 0, -2, 1.5, 1.5, 1.5, C.crate);
  box(L, 15, 0, -30, 1.4, 1.4, 1.4, C.crate);
  box(L, 16.4, 0, -31.3, 1.2, 2.4, 1.2, C.crate);
  box(L, -12, 0, -42, 1.4, 1.4, 1.4, C.crate);
  box(L, 34, 0, -12, 1.4, 1.4, 1.4, C.crate);
  box(L, 58, 0, -42, 1.4, 1.4, 1.4, C.crate);
  box(L, -44, 0, -10, 1.4, 1.4, 1.4, C.crate);
  box(L, 0, 0, -28, 1.4, 1.4, 1.4, C.crate);
}

const HALF_SPAWNS = [
  [-64, -40], [-40, -64], [-20, -50], [5, -64], [32, -42], [64, -50],
  [64, -20], [-64, -5], [-35, -30], [10, -18], [-50, -45], [35, -60],
];

// Postolje zastave (način Zastava): na tlu ispred crvenog tornja, 4 m od svega. Plavo je zrcalno.
const FLAG_BASE = [-48, -48];

export function buildMap() {
  const A = ARENA;
  const once = [];
  box(once, 0, 0, -A - 0.5, 2 * A + 2, 8, 1, C.border);
  box(once, 0, 0, A + 0.5, 2 * A + 2, 8, 1, C.border);
  box(once, -A - 0.5, 0, 0, 1, 8, 2 * A + 2, C.border);
  box(once, A + 0.5, 0, 0, 1, 8, 2 * A + 2, C.border);
  box(once, 0, 4.5, 0, 16, 0.3, 16, C.roof);
  box(once, 0, 0, 0, 0.8, 4.5, 0.8, C.wall);

  const half = [];
  halfMap(half);

  const raw = [...once];
  for (const b of half) {
    raw.push(b);
    raw.push([-b[0], b[1], -b[2], b[3], b[4], b[5], b[6]]);
  }

  const boxes = raw.map(([cx, y, cz, w, h, d, c]) => ({
    minX: cx - w / 2, maxX: cx + w / 2,
    minY: y, maxY: y + h,
    minZ: cz - d / 2, maxZ: cz + d / 2,
    c,
  }));

  const spawns = [];
  for (const [x, z] of HALF_SPAWNS) spawns.push([x, z], [-x, -z]);

  // flags[0] je crvena (x+z<0), flags[1] plava
  const flags = [[FLAG_BASE[0], FLAG_BASE[1]], [-FLAG_BASE[0], -FLAG_BASE[1]]];

  return { boxes, spawns, arena: A, flags };
}
