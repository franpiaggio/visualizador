/*
 * Escena 3D con Ink Studio (splats gaussianos pixel-art, WebGL2).
 *
 * Un mar nocturno en calma con un anillo de doce monolitos: el círculo de
 * quintas puesto en el agua. Cada nota enciende la piedra de su clase de
 * altura. Todo lo que está sobre el agua tiene su gemelo invertido debajo
 * (técnica de "mundo espejo"): el mar es semitransparente y deja ver ese
 * reflejo, que además se quiebra con las ondas.
 *
 * Las piedras se esculpen y hornean una sola vez (SDF → splats). El mar, el
 * cielo y las luces son splats reservados que se reescriben en cada cuadro.
 */
import { createRenderer } from './vendor/ink/webgl.mjs';
import { buildLighthouse, buildWhale, createWhale, drawBeam } from './creatures.js';
import { captureStreamingCamera, makeCamera } from './vendor/ink/src/webgl/view.mjs';

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ───────────── paleta (el renderer cuantiza y difumina contra esto) ─────────────
const PAL = [
  0x020409, // 0 vacío
  0x060b16, 0x0a1323, 0x101c32, 0x172843, 0x203757, 0x2b496f, 0x3a5e88, 0x4d75a2, 0x668fbb, 0x89aed1, 0xb6cde2, // 1-11 azules
  0x171329, 0x251f47, 0x3b336e, 0x5a509a, 0x8a80c4, // 12-16 violetas
  0x0a1f25, 0x10363e, 0x19535b, 0x2a7a7f, 0x58aeab, 0x9fe0d6, // 17-22 verde agua
  0x1f140e, 0x432817, 0x7a4825, 0xbd7f42, 0xe9b878, 0xf7dcae, // 23-28 cálidos
  0xf3ecdc, 0xfffbf2, // 29-30 hueso / blanco
  0x0d0f14, 0x171a21, 0x23272f, 0x333842, 0x4a505c, 0x666d7a, // 31-36 piedra
  0x18262b, 0x263a40, 0x3b5558, 0x5d7a78, // 37-40 roca verdosa del farallón
  0x8d93a0, 0xbfc3c8, 0xe2e1da, // 41-43 piedra clara de la torre
  0x6a4f86, 0xa07aa8, 0xd2a8c4, // 44-46 vía láctea
];

// ───────────── geometría del anillo ─────────────
const RING_R = 3.3;
const fifths = (m) => (((Math.round(m) % 12) + 12) * 7) % 12; // C=0 G=1 D=2 … (usado para el color del cielo)
// Un pilar por nota de Mi menor natural, en orden de escala, repartidos en todo el círculo.
// (El círculo de quintas agrupaba las siete notas en un solo arco y todo caía en un rincón.)
const SCALE = [4, 6, 7, 9, 11, 0, 2]; // E F# G A B C D
const N_STONES = SCALE.length;
const pcOf = (m) => ((Math.round(m) % 12) + 12) % 12;
// pilar de una nota: si no está en la escala, el de la nota de la escala más cercana
const stoneOf = (m) => {
  const pc = pcOf(m);
  let best = 0, bd = 99;
  SCALE.forEach((s, i) => {
    const d = Math.min((pc - s + 12) % 12, (s - pc + 12) % 12);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
};
// Mi queda al fondo, de frente a la cámara inicial
const stoneAngle = (f) => (f / N_STONES) * TAU + Math.PI;
const stonePos = (f) => [Math.cos(stoneAngle(f)) * RING_R, Math.sin(stoneAngle(f)) * RING_R];
// alturas: tónica la más alta, quinta después; el resto escalonado
const HEIGHTS = [2.35, 1.45, 1.6, 1.7, 1.95, 1.35, 1.55];
const STONE_H = (f) => HEIGHTS[f];

function hsl(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}
const pack = (r, g, b) => (clamp(r) * 255 | 0) + (clamp(g) * 255 | 0) * 256 + (clamp(b) * 255 | 0) * 65536;

function env(age, attack, hold, release) {
  if (age < 0) return 0;
  if (age < attack) return age / Math.max(attack, 1e-3);
  age -= attack;
  if (age < hold) return 1;
  age -= hold;
  const r = 1 - age / Math.max(release, 1e-3);
  return r <= 0 ? 0 : r * r;
}

function inv4(m) {
  const a = m, o = new Float64Array(16);
  const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4];
  const b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
  const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12];
  const b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  const d = 1 / det;
  o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * d; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * d;
  o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * d; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * d;
  o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * d; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * d;
  o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * d; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * d;
  o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * d; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * d;
  o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * d; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * d;
  o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * d; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * d;
  o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * d; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * d;
  return o;
}
function mul4(a, b) {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
function xform(m, x, y, z, w) {
  const v = [0, 1, 2, 3].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r] * w);
  return [v[0] / v[3], v[1] / v[3], v[2] / v[3]];
}

export function createScene(canvas) {
  // ───────────── construcción ─────────────
  const B = makeBuilder(11, PAL);
  const S = KIT.sculpt(makeSculpt(B));
  S.pixel = true;
  S.amb = 0.3;
  S.sky = 0.4;
  S.sunK = 0.75;
  S.sun = KIT.V.norm([0.62, 0.42, -0.66]); // luna baja, de costado: modela las caras de las piedras

  const basalt = { r: [31, 32, 33, 34, 35, 36] };
  for (let f = 0; f < N_STONES; f++) {
    const [x, z] = stonePos(f);
    const h = STONE_H(f);
    const w = 0.18;
    const ax = B.frame(-stoneAngle(f), 0, 0);
    // piedra real (se hunde un poco en el agua) …
    S.box([x, h / 2 - 0.25, z], [w, h / 2 + 0.25, w * 0.8], basalt, { res: 0.06, rd: 0.035, ax });
    // … y su gemelo especular bajo la superficie
    S.box([x, -h / 2 + 0.02, z], [w, h / 2, w * 0.8], basalt, { res: 0.09, rd: 0.035, ax });
  }
  S.bake();

  // ── faro, lejos y detrás del anillo (de frente a la cámara inicial) ──
  const LH_DIR = [Math.sin(0.5), -Math.cos(0.5)]; // la cámara arranca en yaw -0.35: esto queda al fondo, un poco a la derecha
  const LH = [LH_DIR[0] * 44, LH_DIR[1] * 44];
  const lighthouse = buildLighthouse(B, S, LH, {
    rock: { r: [37, 38, 39, 40] },
    tower: { r: [34, 41, 42, 43] },
    dark: { r: [31, 32, 33] },
    lamp: { r: [26, 27, 28, 30], em: true },
  });
  S.bake();

  // ── luna: esfera lejana a la izquierda del faro, con mares oscuros y su reflejo ──
  const MOON_A = Math.atan2(LH_DIR[1], LH_DIR[0]) - 0.75;
  const MOON = [Math.cos(MOON_A) * 68, 10.5, Math.sin(MOON_A) * 68];
  const MOON_R = 3.1;
  {
    const lit = { r: [42, 43, 29, 30], em: true };
    const mare = { r: [42, 43, 29], em: true }; // apenas más oscuro que la superficie: manchas sutiles
    // la cara que mira al anillo
    const n = [-MOON[0], 0, -MOON[2]], nl = Math.hypot(...n);
    const f = [n[0] / nl, 0, n[2] / nl], side = [-f[2], 0, f[0]];
    for (const ym of [1, -1]) {
      const cy = MOON[1] * ym;
      S.ball([MOON[0], cy, MOON[2]], MOON_R, lit, { res: ym > 0 ? 0.22 : 0.4 });
      for (const [u, v, r] of [[-0.7, 0.8, 1.0], [0.9, -0.5, 0.8], [0.3, -1.4, 0.4]]) {
        const px = MOON[0] + f[0] * MOON_R * 0.86 + side[0] * u, pz = MOON[2] + f[2] * MOON_R * 0.86 + side[2] * u;
        S.ball([px, cy + v * ym, pz], [r, r, r * 0.2], mare, { res: ym > 0 ? 0.16 : 0.3, ax: B.frame(Math.atan2(f[0], f[2]), 0, 0) });
      }
    }
  }
  S.bake();

  // ── ballena: se hornea en su espacio local y se mueve cada cuadro ──
  const whaleRange = buildWhale(B); // voxels: ver creatures.js
  const whaleMirror = { start: B.count(), end: 0 };
  for (let i = whaleRange.start; i < whaleRange.end; i++) B.disc(0, -500, 0, [0, 1, 0], 0.05, 0.05, [0, 0, 0], 3);
  whaleMirror.end = B.count();

  // mar: rejilla polar, densa en el centro y abierta hacia el horizonte
  const seaStart = B.count();
  const seaR = [], seaS = [];
  for (let r = 0.2; r < 62; r = r * 1.028 + 0.055) {
    const spacing = 0.12 * (1 + r * 0.075);
    const n = Math.max(6, Math.round((TAU * r) / spacing));
    const off = Math.random() * TAU;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * TAU;
      B.disc(Math.cos(a) * r, 0, Math.sin(a) * r, [0, 1, 0], spacing * 0.78, 0.012, [20, 30, 50], 1.4);
      seaR.push(r);
      seaS.push(Math.random() * TAU);
    }
  }
  const seaEnd = B.count();

  // cielo: cilindro lejano de splats grandes, también espejado bajo el horizonte
  const skyStart = B.count();
  const SKY_R = 78, SKY_N = 140;
  const skyY = [];
  for (let k = -16; k <= 22; k++) {
    const s = Math.sign(k) * Math.pow(Math.abs(k) / 22, 1.7) * 60;
    skyY.push(s);
  }
  const hgap = (TAU * SKY_R) / SKY_N;
  const skyShape = [];
  skyY.forEach((y, row) => {
    const vgap = Math.max(Math.abs(y - (skyY[row - 1] ?? y)), Math.abs((skyY[row + 1] ?? y) - y));
    for (let i = 0; i < SKY_N; i++) {
      const a = ((i + (row % 2) * 0.5) / SKY_N) * TAU;
      B.disc(Math.cos(a) * SKY_R, y, Math.sin(a) * SKY_R, [-Math.cos(a), 0, -Math.sin(a)], 1, 0.5, [10, 16, 30], 1.1);
      // bandas horizontales anchas: sin dientes entre filas
      skyShape.push([a, hgap * 1.6, vgap * 1.05]);
    }
  });
  const skyEnd = B.count();

  // partículas reservadas: luces, hilos, chispas, nubes, bruma, polvo
  const PMAX = 5200;
  const pStart = B.count();
  for (let i = 0; i < PMAX; i++) B.disc(0, -500, 0, [0, 1, 0], 0.05, 0.05, [0, 0, 0], 3);
  const pEnd = B.count();

  const world = B.finish({
    cam: { target: [0, 0.95, 0], dist: 12.5, yaw: 0, pitch: 0.1, sway: 0 },
    detail: 30,
    dither: 0.55,
    radius: 90,
    look: { pixel: true, outline: false, clean: true },
  });
  const D = world.data;
  // la ballena nada en un círculo entre el anillo y el faro
  const whale = createWhale(D, whaleRange, whaleMirror, { center: [LH_DIR[0] * 7, LH_DIR[1] * 7], rx: 15, rz: 10, height: 6.5, phase: 2.2 });
  // covarianza de cada splat de cielo: ancho a lo largo del cilindro, fino en vertical
  for (let k = skyStart, i = 0; k < skyEnd; k++, i++) {
    const [a, sT, sY] = skyShape[i];
    const tx = -Math.sin(a), tz = Math.cos(a), nx = Math.cos(a), nz = Math.sin(a), sN = 0.4;
    const o = k * 16;
    D[o + 4] = sT * sT * tx * tx + sN * sN * nx * nx;
    D[o + 5] = 0;
    D[o + 6] = sT * sT * tx * tz + sN * sN * nx * nz;
    D[o + 8] = sY * sY;
    D[o + 9] = 0;
    D[o + 10] = sT * sT * tz * tz + sN * sN * nz * nz;
  }

  // filas de textura que cambian cada cuadro (512 splats por fila)
  // Filas de textura (512 splats por fila) que se suben a la GPU. Para no subir de más:
  //  · ballena + su reflejo + mar: cada cuadro
  //  · cielo: cada 3 cuadros (sus colores cambian muy despacio)
  //  · partículas: solo hasta el último slot usado
  const rowSpan = (a, b) => { const r = []; for (let q = Math.floor(a / 512); q <= Math.floor((b - 1) / 512); q++) r.push(q); return r; };
  const rowsAlways = rowSpan(whaleRange.start, seaEnd);
  const rowsSky = rowSpan(skyStart, skyEnd);
  let skyTick = 0, prevPc = PMAX;

  const renderer = createRenderer(canvas, { toolkit: { KIT, PixelLook } });

  // ───────────── estado vivo ─────────────
  const st = {
    t: 0,
    ripples: [], // {x,z,t,amp,speed,k,w,glow,col,life}
    swells: [],
    lights: [], // orbes de melodía / sonar / chispas (también iluminan el agua)
    threads: [],
    clouds: [],
    mists: [],
    dust: [],
    beams: [],
    pad: [],
    drone: [],
    stoneGlow: new Float32Array(N_STONES),
    lastOrb: null,
    origins: new Map(),
  };
  let padHue = 222, padLight = 0.3, padAmt = 0, droneAmt = 0, droneHue = 32;
  const spouts = []; // soplido de la ballena
  // vía láctea: estrellas fijas en una franja del cielo
  const stars = Array.from({ length: 260 }, () => {
    const a = Math.random() * TAU, along = Math.random();
    const yb = 16 + 12 * Math.sin(a * 1 - 0.6) + (Math.random() - 0.5) * 9 * (0.4 + Math.random());
    return { x: Math.cos(a) * 66, y: Math.max(3, yb), z: Math.sin(a) * 66, s: 0.06 + Math.random() * 0.12, tw: Math.random() * 6, b: 0.3 + Math.random() * 0.7 };
  });
  let lhFlare = 0, lhFlash = 0, lhAngle = 0, lhSpeed = TAU / 40, clockCycle = null;
  const tune = { opts: {}, dist: 16.5, pitch: -0.035, ty: 3.0, fov: 0.56, shift: 0, yawSpeed: 0.012, fov: undefined };
  let camYaw = -0.35, camDist = 20, camPitch = 0.08, camKick = 0, focus = 1;
  let userPitch = 0, userZoom = 1, idleSince = -99, hover = -1;
  let lastFrame = null;
  const harmonyLevel = new Float32Array(N_STONES);
  // blob central: corazón de la escena; al tocarlo frena o arranca la música
  const BLOB = { x: 0, y: 1.25, z: 0, r: 0.34 };
  const BLOB_N = 190;
  const blobDirs = [];
  for (let i = 0; i < BLOB_N; i++) {
    const y = 1 - (2 * (i + 0.5)) / BLOB_N, rr = Math.sqrt(1 - y * y), a = i * 2.399963;
    blobDirs.push([Math.cos(a) * rr, y, Math.sin(a) * rr]);
  }
  let blobY = BLOB.y, leanX = 0, leanY = 0, leanZ = 0;
  let blobEnergy = 0, blobAlive = 0, blobPlaying = false, blobHover = 0, blobPoke = 0;
  // niveles por capa: lv = objetivo (sube con cada nota y decae), bl = valor suavizado que ve la orbe
  const BLOB_KINDS = ['melody', 'arp', 'pad', 'drone', 'cloud', 'sonar', 'sparks', 'breath', 'dust', 'sub'];
  const BLOB_DECAY = { melody: 0.5, arp: 0.35, pad: 0.75, drone: 0.82, cloud: 0.6, sonar: 0.3, sparks: 0.25, breath: 0.7, dust: 0.2, sub: 0.55 };
  const lv = Object.fromEntries(BLOB_KINDS.map((k) => [k, 0]));
  const bl = Object.fromEntries(BLOB_KINDS.map((k) => [k, 0]));
  const bumps = []; // melodía: bultos que apuntan al pilar que suena
  const bands = []; // sonar: anillos que recorren la orbe
  const blobSeed = Float32Array.from({ length: 190 }, () => Math.random());
  let harmonyOn = new Set();
  let pose = null;
  let camM = null; // matrices reales (view + projection) del renderer
  // rayo en mundo desde coordenadas 0..1 de pantalla, invirtiendo projection·view
  function rayFrom(u, v) {
    if (!camM) return null;
    const inv = inv4(mul4(camM.projection, camM.view));
    const nx = u * 2 - 1, ny = 1 - v * 2;
    const a = xform(inv, nx, ny, -1, 1), b = xform(inv, nx, ny, 1, 1);
    return { o: a, d: [b[0] - a[0], b[1] - a[1], b[2] - a[2]] };
  }
  let focusTarget = 1;

  // vector de vista (horizontal) para estirar los reflejos hacia la cámara
  function camBasis() {
    // convención de Ink Studio: ojo = target + dist·(sin yaw·cos p, sin p, cos yaw·cos p)
    const ex = Math.sin(camYaw), ez = Math.cos(camYaw);
    return { fx: -ex, fz: -ez, rx: ez, rz: -ex };
  }

  // ───────────── disparadores ─────────────
  function originFor(ev, make) {
    if (!ev.uid) return make();
    let o = st.origins.get(ev.uid);
    if (!o) {
      o = make();
      st.origins.set(ev.uid, o);
      if (st.origins.size > 400) st.origins.delete(st.origins.keys().next().value);
    }
    return o;
  }

  function spawn(ev) {
    const t = st.t;
    const amp = clamp(ev.amp);
    const echo = ev.echo || 0;
    let anchor = null;
    blobEnergy = Math.min(1.2, blobEnergy + (ev.kind === 'sub' ? 0.6 : echo ? 0.01 : 0.05) * amp);
    if (ev.kind in lv) lv[ev.kind] = Math.min(1.3, lv[ev.kind] + (echo ? 0.06 : 0.45) * amp);
    if (!echo && (ev.kind === 'melody' || ev.kind === 'arp')) {
      // la orbe se estira hacia el pilar de la nota (la melodía mucho, el arpegio apenas)
      const f = stoneOf(ev.midi), [sx, sz] = stonePos(f);
      const up = clamp((ev.midi - 64) / 24) * 0.8 - 0.25;
      const len = Math.hypot(sx, up * RING_R, sz);
      bumps.push({ d: [sx / len, (up * RING_R) / len, sz / len], t, amp: amp * (ev.kind === 'arp' ? 0.4 : 1), life: ev.kind === 'arp' ? 2 : 3.4 });
      if (bumps.length > 16) bumps.shift();
    }
    if (!echo && ev.kind === 'sonar') bands.push({ t, amp });
    switch (ev.kind) {
      case 'melody': {
        const f = stoneOf(ev.midi);
        const [sx, sz] = stonePos(f);
        const top = STONE_H(f);
        const y = top + 0.35 + clamp((ev.midi - 70) / 14) * 0.9;
        const inward = 0.86;
        const pos = [sx * inward, y, sz * inward];
        const L = { x: pos[0], y: pos[1], z: pos[2], t, amp: echo ? amp * 0.7 : amp, warm: 1, life: echo ? 1.4 : 2.2 + ev.release, kind: 'orb', echo };
        st.lights.push(L);
        anchor = pos;
        st.stoneGlow[f] = Math.min(1.4, st.stoneGlow[f] + (echo ? 0.15 : 0.7));
        if (!echo) {
          if (st.lastOrb && t - st.lastOrb.t < 3.5) st.threads.push({ a: st.lastOrb, b: L, t });
          st.lastOrb = L;
          st.ripples.push({ x: sx * 0.93, z: sz * 0.93, t, amp: 0.05 * amp, speed: 1.1, k: 9, w: 0.08, glow: 0.35 * amp, col: [1, 0.85, 0.6], life: 4 });
        }
        break;
      }
      case 'arp': {
        const f = stoneOf(ev.midi);
        const [sx, sz] = stonePos(f);
        const o = originFor(ev, () => [sx * rand(0.55, 0.8) + rand(-0.2, 0.2), sz * rand(0.55, 0.8) + rand(-0.2, 0.2)]);
        anchor = [o[0], 0.05, o[1]];
        st.ripples.push({ x: o[0], z: o[1], t, amp: 0.035 * amp, speed: 0.9, k: 12, w: 0.05, glow: 0.45 * amp, col: [0.55, 0.75, 1], life: 3.5 });
        st.stoneGlow[f] = Math.min(1.4, st.stoneGlow[f] + 0.12 * amp);
        break;
      }
      case 'pad':
        anchor = [0, 5.5, 0];
        st.pad.push({ t, hue: 222 + ((fifths(ev.midi) - 4 + 18) % 12 - 6) * 12, amp: echo ? amp * 0.4 : amp, att: ev.attack, hold: ev.dur, rel: ev.release, lpf: ev.lpf || 700 });
        break;
      case 'drone': {
        const cb = camBasis();
        anchor = [cb.fx * 40, 0.5, cb.fz * 40];
      }
        st.drone.push({ t, amp, att: ev.attack, hold: ev.dur, rel: ev.release, midi: ev.midi });
        break;
      case 'cloud': {
        const o = originFor(ev, () => {
          const { fx, fz, rx, rz } = camBasis();
          const side = (ev.pan - 0.5) * 34;
          const dist = rand(24, 40);
          return [fx * dist + rx * side, rand(5, 11) + (ev.midi - 80) * 0.25, fz * dist + rz * side];
        });
        anchor = o;
        st.clouds.push({ x: o[0] + (echo ? rand(-3, 3) : 0), y: o[1] + (echo ? rand(-0.6, 0.6) : 0), z: o[2], t, amp, att: ev.attack, hold: ev.dur, rel: ev.release, s: rand(1.6, 2.8) * (echo ? 1.25 : 1), drift: rand(-0.3, 0.3) });
        break;
      }
      case 'sonar': {
        // el sonar es la ecolocalización de la ballena: nace en su cabeza
        const o = originFor(ev, () => [whale.state.head[0], whale.state.head[2]]);
        lhFlash = Math.min(1, lhFlash + (echo ? 0.05 : 0.4) * amp);
        anchor = [o[0], 1.2, o[1]];
        st.ripples.push({ x: o[0], z: o[1], t, amp: 0.02 * amp, speed: 3.6, k: 3, w: 0.06, glow: 1.3 * amp, col: [0.45, 1, 0.95], life: 5.5 });
        if (!echo) {
          st.lights.push({ x: o[0], y: 0.15, z: o[1], t, amp, warm: 0, life: 0.9, kind: 'ping' });
          st.beams.push({ x: o[0], z: o[1], t, amp });
        }
        break;
      }
      case 'sparks': {
        const o = originFor(ev, () => {
          const a = rand(0, TAU), r = rand(0.5, RING_R * 1.5);
          return [Math.cos(a) * r, rand(1.6, 3.4), Math.sin(a) * r];
        });
        anchor = o;
        st.lights.push({ x: o[0] + (echo ? rand(-0.25, 0.25) : 0), y: o[1] - echo * 0.14, z: o[2] + (echo ? rand(-0.25, 0.25) : 0), t, amp, warm: 0.3, life: 0.28 + ev.release, kind: 'spark' });
        break;
      }
      case 'breath': {
        const o = originFor(ev, () => {
          const { fx, fz, rx, rz } = camBasis();
          const side = (ev.pan - 0.5) * 30;
          return [fx * 14 + rx * side, fz * 14 + rz * side];
        });
        anchor = [o[0], 0.4, o[1]];
        st.mists.push({ x: o[0], z: o[1], t, amp: echo ? amp * 0.5 : amp, att: ev.attack, hold: ev.dur, rel: ev.release, lpf: ev.lpf || 600, seed: rand(0, 99) });
        break;
      }
      case 'dust': {
        const o = originFor(ev, () => {
          const { fx, fz, rx, rz } = camBasis();
          const side = (ev.pan - 0.5) * 12;
          return [fx * 2 + rx * side, fz * 2 + rz * side];
        });
        anchor = [o[0], 1.6, o[1]];
        const n = Math.round(14 + 30 * amp);
        for (let i = 0; i < n; i++) {
          st.dust.push({ x: o[0] + rand(-2.5, 2.5), y: rand(0.1, 3.5), z: o[1] + rand(-2.5, 2.5), vx: rand(-0.3, 0.3), vy: rand(-0.1, 0.3), vz: rand(-0.3, 0.3), t, life: rand(0.3, 1.3), amp });
        }
        break;
      }
      case 'sub': {
        whale.surface(t);
        anchor = [whale.state.pos[0], 0.05, whale.state.pos[2]];
        st.swells.push({ x: whale.state.pos[0], z: whale.state.pos[2], t, amp, travel: 6 + rand(0, 1.5), depth: clamp((36 - ev.midi) / 16) });
        camKick = Math.min(1, camKick + 0.6 * amp);
        break;
      }
    }
    return anchor;
  }

  // ───────────── escritura de partículas ─────────────
  let pc = 0;
  function particle(x, y, z, sx, sy, sz, r, g, b, a, em, mirror = true) {
    if (pc >= PMAX) return;
    let o = (pStart + pc++) * 16;
    D[o] = x; D[o + 1] = y; D[o + 2] = z; D[o + 3] = a;
    D[o + 4] = sx * sx; D[o + 5] = 0; D[o + 6] = 0; D[o + 7] = pack(r, g, b);
    D[o + 8] = sy * sy; D[o + 9] = 0; D[o + 10] = sz * sz; D[o + 11] = em ? 32 : 0;
    D[o + 12] = D[o + 13] = D[o + 14] = D[o + 15] = 0;
    if (mirror && y > 0.02 && pc < PMAX) {
      // gemelo bajo el agua, quebrado por las ondas
      const wob = Math.sin(z * 2.3 + st.t * 1.7) * 0.06 + Math.sin(x * 1.7 - st.t * 1.1) * 0.04;
      o = (pStart + pc++) * 16;
      D[o] = x + wob; D[o + 1] = -y; D[o + 2] = z + wob * 0.5; D[o + 3] = a * 0.55;
      D[o + 4] = sx * sx * 1.2; D[o + 5] = 0; D[o + 6] = 0; D[o + 7] = pack(r * 0.6, g * 0.65, b * 0.75);
      D[o + 8] = sy * sy * 1.4; D[o + 9] = 0; D[o + 10] = sz * sz * 1.2; D[o + 11] = em ? 32 : 0;
      D[o + 12] = D[o + 13] = D[o + 14] = D[o + 15] = 0;
    }
  }
  function clearParticles() {
    // solo hace falta limpiar lo que se usó el cuadro anterior y ahora no
    for (let i = pc; i < prevPc; i++) {
      const o = (pStart + i) * 16;
      D[o + 1] = -500;
      D[o + 3] = 0;
    }
  }

  // ───────────── cuadro ─────────────
  let last = performance.now() / 1000;
  const glints = []; // luces que se reflejan en el agua este cuadro

  function frame(width, height) {
    const nowS = performance.now() / 1000;
    const dt = Math.min(0.05, nowS - last);
    last = nowS;
    st.t += dt;
    const t = st.t;

    // cámara: deriva muy lenta alrededor del anillo
    camKick *= Math.pow(0.25, dt);
    // deriva lenta; se pausa unos segundos después de que el usuario gira
    camYaw += dt * tune.yawSpeed * smooth(4, 9, t - idleSince);
    focus = lerp(focus, focusTarget, 0.025);
    // dolly lento de "respiración", como una toma con grúa
    camDist = tune.dist * userZoom - camKick * 0.6 + Math.sin(t * 0.045) * 0.9;
    camPitch = clamp(tune.pitch + userPitch + camKick * 0.012 + Math.sin(t * 0.07) * 0.01, -0.12, 1.2);
    const { fx, fz, rx, rz } = camBasis();
    // cuando el código está visible, el anillo se corre a la derecha de la pantalla
    const shift = focus * tune.shift;
    const target = tune.follow ? [...whale.state.pos] : [-rx * shift, tune.ty, -rz * shift]; // tune.follow: depuración

    // colchón → cielo
    let hx = 0, hy = 0, sumA = 0, light = 0;
    st.pad = st.pad.filter((v) => {
      const e = env(t - v.t, v.att, v.hold, v.rel) * v.amp;
      hx += Math.cos((v.hue * Math.PI) / 180) * e;
      hy += Math.sin((v.hue * Math.PI) / 180) * e;
      light += clamp((v.lpf - 300) / 900) * e;
      sumA += e;
      return t - v.t < v.att + v.hold + v.rel + 0.1;
    });
    if (sumA > 0.001) {
      const h = (Math.atan2(hy, hx) * 180) / Math.PI;
      let d = (((h + 360) % 360) - padHue + 540) % 360 - 180;
      padHue += d * 0.02;
      padLight = lerp(padLight, light / sumA, 0.02);
    }
    padAmt = lerp(padAmt, clamp(sumA / 1.6), 0.03);

    let dAmt = 0;
    st.drone = st.drone.filter((v) => {
      const e = env(t - v.t, v.att, v.hold, v.rel) * v.amp;
      if (e > dAmt) { dAmt = e; droneHue = 26 + (v.midi - 35) * 1.6; }
      return t - v.t < v.att + v.hold + v.rel + 0.1;
    });
    droneAmt = lerp(droneAmt, dAmt, 0.05);

    // ─── cielo (cada 3 cuadros) ───
    skyTick = (skyTick + 1) % 3;
    if (skyTick === 0) {
      const zen = hsl(padHue + 14, 0.5, 0.05 + padAmt * 0.04);
      const mid = hsl(padHue, 0.45, 0.11 + padAmt * (0.06 + padLight * 0.07));
      const hor = hsl(padHue - 18, 0.38, 0.22 + padAmt * (0.08 + padLight * 0.1));
      const glow = hsl(droneHue, 0.6, 0.35 + droneAmt * 0.25);
      let k = skyStart;
      for (const y of skyY) {
        const ay = Math.abs(y);
        const u = smooth(0, 22, ay); // 0 en el horizonte, 1 arriba
        const below = y < 0 ? 0.55 : 1;
        for (let i = 0; i < SKY_N; i++, k++) {
          const o = k * 16;
          const a = (i / SKY_N) * TAU;
          // el resplandor del drone se concentra detrás del anillo (lado opuesto a la cámara)
          const facing = Math.max(0, -(Math.cos(a) * -fx + Math.sin(a) * -fz));
          const band = Math.exp(-ay / 2.2) * (0.25 + 0.75 * Math.pow(facing, 3)) * (0.4 + droneAmt * 1.0);
          let r = lerp(hor[0], lerp(mid[0], zen[0], smooth(0.3, 1, u)), smooth(0, 0.35, u));
          let g = lerp(hor[1], lerp(mid[1], zen[1], smooth(0.3, 1, u)), smooth(0, 0.35, u));
          let b = lerp(hor[2], lerp(mid[2], zen[2], smooth(0.3, 1, u)), smooth(0, 0.35, u));
          r += glow[0] * band; g += glow[1] * band; b += glow[2] * band;
          // vía láctea: franja inclinada de polvo violeta-rosado
          const yb = 16 + 12 * Math.sin(a - 0.6);
          const mw = y > 3 ? Math.exp(-(((y - yb) / 5.5) ** 2)) * (0.6 + 0.4 * Math.sin(a * 7 + y * 0.3)) : 0;
          r += 0.09 * mw; g += 0.05 * mw; b += 0.1 * mw;
          D[o + 7] = pack(r * below, g * below, b * below);
        }
      }
    }

    // ─── luces (orbes, pings, chispas) ───
    glints.length = 0;
    pc = 0;

    // ─── ballena ───
    for (const e of whale.update(t, dt)) {
      const ws = whale.state;
      if (e.kind === 'splash') st.ripples.push({ x: ws.pos[0], z: ws.pos[2], t, amp: 0.09, speed: 1.4, k: 4, w: 0.2, glow: 0.5, col: [0.7, 0.85, 1], life: 6 });
      if (e.kind === 'spout') {
        // soplido: columna de vapor desde el espiráculo
        const bx = ws.pos[0] + ws.fwd[0] * 1.9, bz = ws.pos[2] + ws.fwd[2] * 1.9;
        for (let i = 0; i < 160; i++) spouts.push({ x: bx, y: 0.3, z: bz, vx: rand(-0.35, 0.35), vy: rand(2.4, 4.6), vz: rand(-0.35, 0.35), t, life: rand(1.2, 2.6) });
      }
      if (e.kind === 'breach-out' || e.kind === 'breach-in') {
        // salto: salpicadura grande al salir y al caer
        const big = e.kind === 'breach-in';
        const bx = ws.pos[0], bz = ws.pos[2];
        st.ripples.push({ x: bx, z: bz, t, amp: big ? 0.16 : 0.1, speed: 1.6, k: 3.5, w: 0.25, glow: big ? 0.9 : 0.5, col: [0.75, 0.9, 1], life: 7 });
        for (let i = 0; i < (big ? 220 : 110); i++) {
          const ang = rand(0, TAU), sp = rand(0.4, big ? 2.4 : 1.4);
          spouts.push({ x: bx + Math.cos(ang) * rand(0, 1.2), y: 0.2, z: bz + Math.sin(ang) * rand(0, 1.2), vx: Math.cos(ang) * sp, vy: rand(1.2, big ? 4.5 : 3), vz: Math.sin(ang) * sp, t, life: rand(0.8, 1.8) });
        }
        if (big) camKick = Math.min(1, camKick + 0.5);
      }
      if (e.kind === 'fluke') {
        const tx = ws.pos[0] - ws.fwd[0] * 3.6, tz = ws.pos[2] - ws.fwd[2] * 3.6;
        st.ripples.push({ x: tx, z: tz, t, amp: 0.08, speed: 1.2, k: 5, w: 0.15, glow: 0.45, col: [0.7, 0.85, 1], life: 5 });
        for (let i = 0; i < 40; i++) spouts.push({ x: tx + rand(-0.6, 0.6), y: 0.4, z: tz + rand(-0.6, 0.6), vx: rand(-0.6, 0.6), vy: rand(0.5, 1.8), vz: rand(-0.6, 0.6), t, life: rand(0.6, 1.3) });
      }
    }
    for (let i = spouts.length - 1; i >= 0; i--) {
      const p = spouts[i];
      const age = t - p.t;
      if (age > p.life) { spouts.splice(i, 1); continue; }
      const k = 1 - age / p.life;
      const y = p.y + p.vy * age - 0.9 * age * age;
      const sz = 0.025 + age * 0.05;
      particle(p.x + p.vx * age * (1 + age), Math.max(0.05, y), p.z + p.vz * age * (1 + age), sz, sz, sz, 0.85, 0.9, 0.97, 1.6 * k * k, false);
    }

    // ─── faro: linterna, haz que gira una vuelta por frase, destello con el sonar ───
    {
      lhFlash *= Math.pow(0.35, dt); // el destello se apaga despacio
      // giro lento y continuo: una vuelta cada ~25 s (la forma completa de la pieza, 16 ciclos)
      lhSpeed += ((clockCycle !== null ? TAU / 25 : TAU / 40) - lhSpeed) * Math.min(1, dt * 0.5);
      lhAngle += dt * lhSpeed;
      const lamp = lighthouse.lamp;
      const camAng = Math.atan2((pose ? pose.eye[2] : 0) - lamp[2], (pose ? pose.eye[0] : 0) - lamp[0]);
      const I = 0.6 + lhFlash * 0.5 + droneAmt * 0.25;
      const flareRaw = drawBeam(particle, lamp, lhAngle, I, 0.5 + droneAmt * 0.5, camAng);
      lhFlare += (flareRaw - lhFlare) * Math.min(1, dt * 2);
      const flare = lhFlare;
      const core = 1 + flare * 1.6 + lhFlash * 0.6;
      particle(lamp[0], lamp[1], lamp[2], 0.12 * core, 0.12 * core, 0.12 * core, 1, 0.9, 0.7, 3, true, true);
      particle(lamp[0], lamp[1], lamp[2], 0.45 * core, 0.45 * core, 0.45 * core, 1, 0.78, 0.5, 0.35 * core, true, true);
      glints.push({ x: lamp[0], z: lamp[2], y: lamp[1], I: 0.55 + flare * 0.8 + lhFlash * 0.5, r: 1, g: 0.82, b: 0.55 });
    }

    // ─── luna: halo que respira con el colchón y estela sobre el mar ───
    {
      const h = 0.55 + padAmt * 0.3 + droneAmt * 0.15 + Math.sin(t * 0.21) * 0.05;
      const mc = hsl(padHue - 10, 0.25, 0.8);
      particle(MOON[0], MOON[1], MOON[2], MOON_R * 2.2, MOON_R * 2.2, MOON_R * 2.2, mc[0], mc[1], mc[2], 0.22 * h, true, true);
      particle(MOON[0], MOON[1], MOON[2], MOON_R * 4.5, MOON_R * 4.5, MOON_R * 4.5, mc[0] * 0.7, mc[1] * 0.7, mc[2] * 0.8, 0.08 * h, true, true);
      glints.push({ x: MOON[0], z: MOON[2], y: MOON[1], I: 0.45 * h, r: 0.85, g: 0.9, b: 1 });
    }

    // ─── estrellas de la vía láctea ───
    for (const s of stars) {
      const tw = 0.55 + 0.45 * Math.sin(t * (1.3 + s.tw) + s.tw * 9);
      particle(s.x, s.y, s.z, s.s, s.s, s.s, 0.9, 0.88, 1, 2.2 * s.b * tw, true, false);
    }
    st.lights = st.lights.filter((L) => {
      const age = t - L.t;
      if (age > L.life) return false;
      const k = 1 - age / L.life;
      const flash = Math.exp(-age * 7);
      let I;
      if (L.kind === 'orb') I = L.amp * (k * k * 0.8 + flash * 0.9);
      else if (L.kind === 'ping') I = L.amp * Math.exp(-age * 4);
      else I = L.amp * k * (0.7 + 0.3 * Math.sin(age * 18 + L.x * 9));
      if (I < 0.01) return true;
      const warm = L.warm;
      const cr = lerp(0.75, 1, warm), cg = lerp(1, 0.86, warm), cb = lerp(1, 0.66, warm);
      const sz = L.kind === 'spark' ? 0.025 : 0.05;
      const y = L.kind === 'orb' ? L.y + age * 0.05 : L.y;
      particle(L.x, y, L.z, sz * (1 + I), sz * (1 + I), sz * (1 + I), 1, 0.98, 0.94, 3 * Math.min(1, I * 1.6), true);
      particle(L.x, y, L.z, 0.1 * (0.6 + I), 0.1 * (0.6 + I), 0.1 * (0.6 + I), cr, cg, cb, 0.7 * I, true);
      glints.push({ x: L.x, z: L.z, y, I: I * (L.kind === 'spark' ? 0.5 : 1), r: cr, g: cg, b: cb });
      return true;
    });

    // ─── blob central: reacciona a cada capa, con envolventes lentas ───
    {
      for (const k of BLOB_KINDS) {
        lv[k] *= Math.pow(1 - BLOB_DECAY[k] * 0.9, dt * 1.6);
        const up = lv[k] > bl[k] ? 3.2 : 0.9; // sube rápido, se va de a poco
        bl[k] += (lv[k] - bl[k]) * Math.min(1, dt * up);
      }
      blobEnergy *= Math.pow(0.45, dt);
      blobPoke *= Math.pow(0.08, dt);
      blobAlive += ((blobPlaying ? 1 : 0) - blobAlive) * Math.min(1, dt * 1.2);
      const live = blobAlive;
      // flota: sube y baja lento (dos ondas que no coinciden, nunca se repite igual);
      // con música oscila más amplio y los subgraves la empujan hacia arriba
      const bob = Math.sin(t * 0.42) * (0.22 + 0.14 * live) + Math.sin(t * 0.17 + 1.3) * 0.12 + bl.sub * 0.18;
      const cy = BLOB.y + bob;
      blobY = cy;
      // tamaño: respira con el colchón, se infla con los subgraves
      const breathe = (blobPlaying ? 0.03 : 0.07) * Math.sin(t * (blobPlaying ? 1.1 : 0.9));
      const R = BLOB.r * (0.72 + 0.28 * live) * (1 + breathe + bl.pad * 0.06 * Math.sin(t * 0.8) + bl.sub * 0.14 + blobPoke * 0.18 + blobHover * 0.05);
      // aplastamiento vertical con los subgraves
      const squash = 1 - bl.sub * 0.12;
      // color: base del cielo, núcleo cálido con el drone, tinte violeta con la nube
      const baseHue = lerp(padHue, 268, clamp(bl.cloud * 0.6));
      const coreHue = lerp(baseHue, droneHue + 10, clamp(bl.drone * 0.9));
      const glow = (0.3 + 0.45 * live) * (0.85 + 0.2 * bl.pad); // más tenue: presencia, no protagonismo
      const wob = 0.04 + 0.05 * live;
      const shimmer = bl.arp * 0.05;
      bumps.splice(0, bumps.length, ...bumps.filter((b) => t - b.t < b.life));
      // inclinación: el centro se corre un poco hacia donde tiran las notas
      let lx = 0, ly = 0, lz = 0;
      for (const b of bumps) {
        const age = t - b.t;
        const e = Math.min(1, age * 4) * Math.pow(Math.max(0, 1 - age / b.life), 2) * b.amp;
        lx += b.d[0] * e; ly += b.d[1] * e; lz += b.d[2] * e;
      }
      leanX += (lx * 0.1 - leanX) * Math.min(1, dt * 3);
      leanY += (ly * 0.07 - leanY) * Math.min(1, dt * 3);
      leanZ += (lz * 0.1 - leanZ) * Math.min(1, dt * 3);
      bands.splice(0, bands.length, ...bands.filter((b) => t - b.t < 1.6));
      const sizeP = 0.05 * (1 + bl.breath * 0.4);
      for (let i = 0; i < BLOB_N; i++) {
        const [dx, dy, dz] = blobDirs[i];
        const n = Math.sin(dx * 3.1 + t * 1.3) * Math.cos(dz * 2.7 - t * 1.1) + Math.sin(dy * 4.2 + t * 1.7 + dx * 1.5) * 0.6;
        const fine = Math.sin(dx * 11 + t * 9 + blobSeed[i] * 6) * Math.sin(dz * 9 - t * 7);
        let push = 0, warm = 0, ring = 0;
        for (const b of bumps) {
          const age = t - b.t;
          const e = Math.min(1, age * 5) * Math.pow(Math.max(0, 1 - age / b.life), 2) * b.amp;
          const dot = Math.max(0, dx * b.d[0] + dy * b.d[1] + dz * b.d[2]);
          const k = dot ** 3 * e;
          push += k * 0.45;
          warm += k * dot;
        }
        for (const b of bands) {
          const age = t - b.t;
          const front = 1 - (age / 1.6) * 2.2;
          ring += Math.exp(-((dy - front) ** 2) / 0.02) * (1 - age / 1.6) * b.amp;
        }
        const rr = R * (1 + wob * n + shimmer * fine + push + ring * 0.06);
        const x = BLOB.x + leanX + dx * rr, y = cy + leanY + dy * rr * squash, z = BLOB.z + leanZ + dz * rr;
        const rim = 0.55 + 0.45 * n;
        let c = hsl(baseHue + n * 14, 0.42, (0.42 + rim * 0.22) * glow);
        // calor de la melodía, anillo cian del sonar, destellos de chispas y polvo
        const sp = (bl.sparks + bl.dust) * (blobSeed[i] > 0.86 ? 1 : 0) * (0.5 + 0.5 * Math.sin(t * 23 + i));
        c = [
          c[0] + warm * 0.55 + ring * 0.15 + sp * 0.5,
          c[1] + warm * 0.4 + ring * 0.45 + sp * 0.5,
          c[2] + warm * 0.2 + ring * 0.45 + sp * 0.55,
        ];
        particle(x, y, z, sizeP, sizeP, sizeP, c[0], c[1], c[2], 1.8 - bl.breath * 0.4, true);
      }
      // núcleo: se entibia y brilla con el drone
      const core = hsl(coreHue, 0.4 + bl.drone * 0.2, 0.62 + bl.drone * 0.2);
      const cg = glow * (0.8 + bl.drone * 0.5);
      particle(BLOB.x + leanX, cy + leanY, BLOB.z + leanZ, R * 0.55, R * 0.55 * squash, R * 0.55, core[0] * cg, core[1] * cg, core[2] * cg, 1.6, true);
      // halo difuso con la bruma
      if (bl.breath > 0.05) particle(BLOB.x, cy, BLOB.z, R * 1.5, R * 1.3, R * 1.5, core[0] * 0.5, core[1] * 0.5, core[2] * 0.6, 0.25 * bl.breath, false);
      glints.push({ x: BLOB.x, z: BLOB.z, y: cy, I: 0.12 + 0.25 * glow * (0.4 + bl.drone + bl.melody * 0.5), r: core[0], g: core[1], b: core[2] });
    }

    // hilo melódico entre orbes consecutivos
    st.threads = st.threads.filter((th) => {
      const age = t - th.t;
      if (age > 7) return false;
      const a = Math.pow(1 - age / 7, 2);
      const grow = clamp(age / 0.25);
      const N = 22;
      for (let i = 0; i <= N * grow; i++) {
        const u = i / N;
        const x = lerp(th.a.x, th.b.x, u), y = lerp(th.a.y, th.b.y, u) - Math.sin(u * Math.PI) * 0.12, z = lerp(th.a.z, th.b.z, u);
        particle(x, y, z, 0.014, 0.014, 0.014, 0.95, 0.88, 0.72, 2.2 * a, true);
      }
      return true;
    });

    // piedras: brillo en la cara que mira al centro
    // los pilares del acorde que suena quedan levemente encendidos
    for (let f = 0; f < N_STONES; f++) {
      harmonyLevel[f] += ((harmonyOn.has(SCALE[f]) ? 1 : 0) - harmonyLevel[f]) * Math.min(1, dt * 2.5);
      st.stoneGlow[f] = Math.max(st.stoneGlow[f], harmonyLevel[f] * 0.16);
    }
    if (hover >= 0) st.stoneGlow[hover] = Math.max(st.stoneGlow[hover], 0.24);
    for (let f = 0; f < N_STONES; f++) {
      const g = st.stoneGlow[f];
      st.stoneGlow[f] *= Math.pow(0.35, dt);
      if (g < 0.03) continue;
      const [sx, sz] = stonePos(f);
      const h = STONE_H(f);
      for (let j = 0; j < 5; j++) {
        const yy = h * (0.15 + j * 0.18);
        particle(sx * 0.93, yy, sz * 0.93, 0.08, 0.16, 0.08, 1, 0.8, 0.55, 0.55 * g, true);
      }
    }

    // haz del sonar
    st.beams = st.beams.filter((b) => {
      const age = t - b.t;
      if (age > 1.2) return false;
      const k = Math.pow(1 - age / 1.2, 2) * b.amp;
      for (let j = 0; j < 26; j++) particle(b.x, j * 0.14, b.z, 0.018, 0.08, 0.018, 0.55, 1, 0.95, 1.6 * k * (1 - j / 26), true);
      return true;
    });

    // nubes agudas
    st.clouds = st.clouds.filter((c) => {
      const age = t - c.t;
      const e = env(age, c.att, c.hold, c.rel) * c.amp;
      if (age > c.att + c.hold + c.rel) return false;
      const x = c.x + c.drift * age;
      // una nube hecha de puntos: polvo de estrellas tenue que titila
      for (let j = 0; j < 34; j++) {
        const a = j * 2.399 + c.t, rr = Math.sqrt(j / 34) * c.s * 2.2;
        const ox = Math.cos(a) * rr * 1.6, oy = Math.sin(a * 1.7) * rr * 0.35, oz = Math.sin(a) * rr;
        const tw = 0.5 + 0.5 * Math.sin(t * (2 + (j % 5)) + j);
        particle(x + ox, c.y + oy, c.z + oz, 0.06, 0.06, 0.06, 0.78, 0.76, 1, 2.2 * e * tw, true, true);
      }
      return true;
    });

    // bruma que respira
    st.mists = st.mists.filter((m) => {
      const age = t - m.t;
      if (age > m.att + m.hold + m.rel) return false;
      const e = env(age, m.att, m.hold, m.rel) * m.amp;
      const warm = clamp((m.lpf - 300) / 900);
      for (let j = 0; j < 9; j++) {
        const a = m.seed + j * 1.7;
        const x = m.x + Math.cos(a) * (3 + j * 1.3) + Math.sin(t * 0.15 + j) * 1.2;
        const z = m.z + Math.sin(a) * (3 + j * 1.3);
        const c = hsl(padHue - 30 + warm * 40, 0.2, 0.45 + warm * 0.15);
        particle(x, 0.35 + j * 0.05, z, 3.2, 0.35, 3.2, c[0], c[1], c[2], 0.16 * e, false, false);
      }
      return true;
    });

    // polvo eléctrico
    st.dust = st.dust.filter((d) => {
      const age = t - d.t;
      if (age > d.life) return false;
      const k = 1 - age / d.life;
      const fl = 0.55 + 0.45 * Math.sin(age * 14 + d.x * 7); // titila suave, sin saltos por cuadro
      particle(d.x + d.vx * age, d.y + d.vy * age, d.z + d.vz * age, 0.012, 0.012, 0.012, 0.88, 0.94, 1, 2.6 * k * fl * d.amp, true, false);
      return true;
    });

    // ─── mar ───
    st.ripples = st.ripples.filter((r) => t - r.t < r.life);
    st.swells = st.swells.filter((s) => t - s.t < s.travel + 2.5);
    const ripples = st.ripples, swells = st.swells;
    const deep = hsl(padHue - 6, 0.5, 0.06 + padAmt * 0.03);
    const far = hsl(padHue - 16, 0.36, 0.18 + padAmt * 0.07 + droneAmt * 0.05);
    const dglow = hsl(droneHue, 0.55, 0.4);
    for (let k = seaStart, i = 0; k < seaEnd; k++, i++) {
      const o = k * 16;
      const x = D[o], z = D[o + 2], R = seaR[i];
      let h = Math.sin(x * 0.8 + t * 0.55 + seaS[i] * 0.2) * 0.022 + Math.sin(z * 1.15 - t * 0.42 + x * 0.3) * 0.018;
      let lr = 0, lg = 0, lb = 0;
      for (let j = 0; j < ripples.length; j++) {
        const rp = ripples[j];
        const dx = x - rp.x, dz = z - rp.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const age = t - rp.t;
        const u = d - rp.speed * age;
        if (u > 0.6 || u < -2.5) continue;
        const fade = Math.pow(1 - age / rp.life, 2) / (1 + d * 0.35);
        const w = Math.exp(-(u * u) / (rp.w + age * 0.04));
        h += rp.amp * fade * Math.cos(u * rp.k) * w;
        const gl = rp.glow * fade * w * (0.5 + 0.5 * Math.cos(u * rp.k));
        lr += rp.col[0] * gl; lg += rp.col[1] * gl; lb += rp.col[2] * gl;
      }
      for (let j = 0; j < swells.length; j++) {
        const sw = swells[j];
        const age = t - sw.t;
        const front = (age / sw.travel) * 30;
        const u = Math.hypot(x - sw.x, z - sw.z) - front;
        const fade = clamp(age / 0.5) * clamp((sw.travel + 2.5 - age) / 2.5);
        const w = Math.exp(-(u * u) / (3 + sw.depth * 4));
        h += sw.amp * fade * w * (0.22 + sw.depth * 0.18);
        const gl = sw.amp * fade * w * 0.12;
        lr += gl * 0.4; lg += gl * 0.55; lb += gl;
      }
      // brillos: reflejo de cada luz estirado hacia la cámara (como la luna en el mar)
      for (let j = 0; j < glints.length; j++) {
        const L = glints[j];
        const dx = x - L.x, dz = z - L.z;
        const along = dx * fx + dz * fz;
        if (along < -1.5) continue;
        const across = dx * rx + dz * rz;
        const spread = 0.05 + Math.max(0, along) * 0.012;
        const ea = (across * across) / spread + (along * along) / (6 + L.y * 4);
        if (ea > 7) continue; // aporte despreciable: no calcular exp/sin
        const g = L.I * Math.exp(-ea) * (0.6 + 0.4 * Math.sin(x * 9 + z * 7 + t * 3));
        lr += L.r * g; lg += L.g * g; lb += L.b * g;
      }
      D[o + 1] = h;
      // color base: profundo cerca, refleja el horizonte lejos (Fresnel)
      const fr = smooth(4, 55, R);
      const crest = clamp(h * 6 + 0.1);
      const facing = Math.max(0, -(x * fx + z * fz) / (R + 1e-3));
      const dg = droneAmt * fr * facing * 0.4;
      D[o + 7] = pack(
        lerp(deep[0], far[0], fr) * (0.8 + crest * 0.6) + lr + dglow[0] * dg,
        lerp(deep[1], far[1], fr) * (0.8 + crest * 0.6) + lg + dglow[1] * dg,
        lerp(deep[2], far[2], fr) * (0.8 + crest * 0.6) + lb + dglow[2] * dg,
      );
    }

    clearParticles();
    const used = Math.max(pc, prevPc);
    prevPc = pc;
    const frameRows = () => {
      const r = rowsAlways.slice();
      if (skyTick === 0) r.push(...rowsSky);
      if (used > 0) r.push(...rowSpan(pStart, pStart + used));
      return [...new Set(r)];
    };
    const frameOpts = {
      width,
      height,
      time: t,
      changedRows: frameRows(),
      camera: { target, dist: camDist, yaw: camYaw, pitch: camPitch, ...(tune.fov && { fov: tune.fov }) },
      damp: false,
      ...tune.opts,
    };
    lastFrame = frameOpts;
    renderer.render(world, frameOpts);
    pose = captureStreamingCamera(world, { ...frameOpts, changedRows: [] }, width, height).camera;
    camM = makeCamera(world, { ...frameOpts, changedRows: [] }, width, height);
  }

  return {
    spawn,
    frame,
    setFocus(on) { focusTarget = on ? 1 : 0; },
    // girar / inclinar / acercar con el mouse
    orbit(dx, dy) {
      camYaw -= dx * 0.005;
      userPitch = clamp(userPitch + dy * 0.003, -0.05, 0.9);
      idleSince = st.t;
    },
    zoom(f) { userZoom = clamp(userZoom * f, 0.45, 1.8); idleSince = st.t; },
    setHover(f) { hover = f; },
    // rayo desde el cursor (coordenadas 0..1 del canvas) contra los doce pilares
    pick(u, v) {
      const ray = rayFrom(u, v);
      if (!ray) return null;
      const dir = ray.d, o = ray.o;
      let best = null;
      for (let f = 0; f < N_STONES; f++) {
        const [sx, sz] = stonePos(f);
        const H = STONE_H(f), R = 0.3;
        const ox = o[0] - sx, oz = o[2] - sz;
        const a = dir[0] * dir[0] + dir[2] * dir[2];
        const b = 2 * (ox * dir[0] + oz * dir[2]);
        const c = ox * ox + oz * oz - R * R;
        const disc = b * b - 4 * a * c;
        if (disc < 0) continue;
        for (const tt of [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)]) {
          if (tt <= 0) continue;
          const y = o[1] + dir[1] * tt;
          // también responde el reflejo bajo el agua
          if (y > -H - 0.1 && y < H + 0.15) {
            if (!best || tt < best.t) best = { f, t: tt, y01: clamp(Math.abs(y) / H) };
            break;
          }
        }
      }
      return best;
    },
    stonePc(f) { return SCALE[f]; },
    setHarmony(pcs) { harmonyOn = new Set(pcs); },
    setClock(c) { clockCycle = c; },
    surfaceWhale() { return whale.surface(st.t); },
    counts: () => ({ total: world.count, whale: whaleRange.end - whaleRange.start, sea: seaEnd - seaStart, sky: skyEnd - skyStart }),
    whale,
    setPlaying(on) { if (on !== blobPlaying) blobPoke = 1; blobPlaying = on; },
    setBlobHover(on) { blobHover = on ? 1 : 0; },
    // ¿el cursor toca el blob? (rayo contra una esfera algo más grande que el blob)
    pickBlob(u, v) {
      const ray = rayFrom(u, v);
      if (!ray) return false;
      const d = ray.d, o = ray.o, len = Math.hypot(...d);
      const c = [BLOB.x - o[0], blobY - o[1], BLOB.z - o[2]];
      const along = (c[0] * d[0] + c[1] * d[1] + c[2] * d[2]) / len;
      if (along < 0) return false;
      const dist2 = c[0] ** 2 + c[1] ** 2 + c[2] ** 2 - along * along;
      return dist2 < Math.max(BLOB.r * 1.4, 0.5) ** 2; // área de click algo mayor que la orbe
    },
    // mundo → pantalla (0..1)
    project(p) {
      if (!camM) return null;
      const V = camM.view, P = camM.projection;
      const vx = V[0] * p[0] + V[4] * p[1] + V[8] * p[2] + V[12];
      const vy = V[1] * p[0] + V[5] * p[1] + V[9] * p[2] + V[13];
      const vz = V[2] * p[0] + V[6] * p[1] + V[10] * p[2] + V[14];
      const vw = V[3] * p[0] + V[7] * p[1] + V[11] * p[2] + V[15];
      const cx = P[0] * vx + P[4] * vy + P[8] * vz + P[12] * vw;
      const cy = P[1] * vx + P[5] * vy + P[9] * vz + P[13] * vw;
      const cw = P[3] * vx + P[7] * vy + P[11] * vz + P[15] * vw;
      if (cw < 0.05) return null;
      return [(cx / cw + 1) / 2, (1 - cy / cw) / 2, cw];
    },
    tune,
    setYaw(y) { camYaw = y; },
    world,
  };
}
