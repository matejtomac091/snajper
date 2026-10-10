// Zajednička pravila igre. Uvozi ih i server i preglednik, pa su brojke uvijek iste na obje strane.

export const TICK_RATE = 20;          // koliko puta u sekundi server šalje stanje
export const INTERP_DELAY = 100;      // ms: druge igrače prikazujemo malo u prošlosti da kretanje bude glatko
export const MAX_HP = 100;
export const RESPAWN_TIME = 3;        // s
export const SPAWN_PROTECT = 1.5;     // s nakon pojave nitko te ne može pogoditi (prekida se kad pucaš)
export const MATCH_TIME = 300;        // s, jedna runda
export const END_TIME = 10;           // s, ekran s rezultatima između rundi
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

// Banana bomba: dobiješ jednu za svaka 3 ubojstva zaredom (bez umiranja).
export const BANANA = {
  streak: 3,
  max: 3,        // najviše banana odjednom
  speed: 18,     // m/s
  up: 3,         // dodatni uzlet pri bacanju
  gravity: 20,
  radius: 6,     // m, sve unutra (s vidljivim putem do eksplozije) umire
  fuse: 2.5,     // s, eksplodira najkasnije nakon ovoliko
};
