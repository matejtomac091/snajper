// Zajednička pravila igre. Uvozi ih i server i preglednik, pa su brojke uvijek iste na obje strane.

export const TICK_RATE = 20;          // koliko puta u sekundi server šalje stanje
export const INTERP_DELAY = 100;      // ms: druge igrače prikazujemo malo u prošlosti da kretanje bude glatko
export const MAX_HP = 100;
export const RESPAWN_TIME = 3;        // s
export const SPAWN_PROTECT = 1.5;     // s nakon pojave nitko te ne može pogoditi (prekida se kad pucaš)
export const MATCH_TIME = 300;        // s, jedna runda
export const END_TIME = 15;           // s, rezultati i glasanje za sljedeći način između rundi
export const MAX_PLAYERS = 24;
export const MAX_BOTS = 8;

export const P = {
  radius: 0.32,
  height: 1.8,
  crouchHeight: 1.3,
  eye: 1.6,
  crouchEye: 1.1,
  walk: 5.5,
  crouchSpeed: 2.4,
  scopeSpeed: 3.0,
  jump: 7.0,
  gravity: 20,
  step: 0.55,        // stepenice i niske prepreke prelaze se bez skoka
  maxFall: 30,
};

export const W = {
  mag: 5,
  cooldown: 1.15,    // s, repetiranje između metaka
  reload: 2.3,       // s
  range: 400,
  damage: { head: 100, body: 100, legs: 100 }, // snajper ubija iz jednog pogotka, gdje god pogodi
  scopeIn: 0.22,     // s dok nišan ne postane precizan
  zoom: [20, 9],     // FOV za 4x i 8x
  spreadHip: 0.06,   // radijani, pucanje bez nišana
  spreadScoped: 0.0012,
  spreadMove: 0.035,
  spreadAir: 0.09,
  crouchMul: 0.6,
};

// Pogodne zone (u metrima iznad stopala). Iste brojke koristi i model lika u pregledniku.
export const HITBOX = {
  half: 0.3,
  headR: 0.21,
  stand: { legs: 0.8, body: 1.38, head: 1.56 },
  crouch: { legs: 0.5, body: 0.92, head: 1.08 },
};

export function spreadFor(scoped, scopeTime, moving, airborne, crouch) {
  let s = scoped && scopeTime >= W.scopeIn ? W.spreadScoped : W.spreadHip;
  if (moving) s += scoped ? W.spreadMove * 0.6 : W.spreadMove;
  if (airborne) s += W.spreadAir;
  if (crouch) s *= W.crouchMul;
  return s;
}

export function eyeHeight(crouch) {
  return crouch ? P.crouchEye : P.eye;
}

// Smjer pogleda za yaw/pitch (Three.js kamera, redoslijed rotacije YXZ, gleda prema -Z).
export function aimDir(yaw, pitch) {
  const c = Math.cos(pitch);
  return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}

// Skinovi su samo izgled: svi imaju istu pogodnu zonu, pa nijedan nije lakše pogoditi.
export const SKINS = ['klasik', 'vozac', 'robot', 'kaktus', 'banana', 'ninja'];

// Eksplozivni pištolj: za svaka 3 ubojstva zaredom (bez umiranja) napuni se na 8 metaka.
// Nema nišana. Pogodak ubija, a metak eksplodira gdje udari: radius je u metrima.
export const PISTOL = { streak: 3, mag: 8, cooldown: 0.3, range: 150, spreadHip: 0.018, spreadMove: 0.012, radius: 3.5 };

export function pistolSpread(moving) {
  return PISTOL.spreadHip + (moving ? PISTOL.spreadMove : 0);
}

// Načini igre. Bira ih onaj tko prvi otvori sobu (ili admin usred igre).
export const MODES = ['ffa', 'tdm', 'ctf'];
export const MODE_NAMES = { ffa: 'Svi protiv svih', tdm: 'Timski deathmatch', ctf: 'Zastava (CTF)' };
// Do koliko se igra: ubojstva tima (tdm) ili osvojene zastave (ctf). Inače pobjeđuje tko vodi kad istekne vrijeme.
export const SCORE_LIMIT = { ffa: 0, tdm: 30, ctf: 3 };
// Timovi: 0 = Crveni (polovica mape x+z<0), 1 = Plavi (x+z>0). hue je boja lika.
export const TEAMS = [
  { name: 'Crveni', color: '#e0473a', hue: 5 },
  { name: 'Plavi', color: '#3a7be0', hue: 215 },
];
// Zastava se uzima dodirom (m), a ispuštena se sama vraća u bazu nakon returnTime sekundi.
export const FLAG = { touch: 1.6, returnTime: 20 };
