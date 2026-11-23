/*
 * BOSQUE — escena con Ink Studio (splats gaussianos, pixel-art, WebGL2).
 *
 * Una campiña de tarde vista desde un dron que avanza de costado. La partitura está
 * plantada en ella: cada capa del código es un prado abierto en el bosque, y cada letra
 * son flores (un punto de la tipografía de 3×5 = una flor). El color de la flor sigue la
 * sintaxis: notas en crema, funciones en amarillo, textos en rosa, números en naranja,
 * comentarios en lavanda. Donde el código cae sobre el agua, las letras son camalotes.
 *
 * Alrededor de los prados, un paisaje que no se repite en toda la vuelta: un arroyo que
 * baja al lago, un islote, un estanque, una bahía, un camino de tierra con una aldea
 * (humo en las chimeneas), campos de cultivo en parches con cercos de árboles y un árbol
 * enorme junto al camino. Cúmulos bajos pasan entre el dron y el suelo con su sombra.
 *
 * El terreno se genera por tramos (CH unidades) a medida que avanza el dron y se escribe
 * directo en splats reservados. Los árboles se mecen en la GPU (tipo 14), el humo sube
 * solo (tipo 3) y el agua titila (tipo 4).
 */
import { createRenderer } from './vendor/ink/webgl.mjs';
import { makeCamera } from './vendor/ink/src/webgl/view.mjs';
import { glyph } from './font3x5.js';
import { DOT, CHAR_W, LINE_H } from './codemap.js';

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const pack = (r, g, b) => (clamp(r) * 255 | 0) + (clamp(g) * 255 | 0) * 256 + (clamp(b) * 255 | 0) * 65536;
const unpack = (p) => [(p & 255) / 255, ((p >> 8) & 255) / 255, ((p >> 16) & 255) / 255];
const hexRGB = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ───────────── paleta: tarde de verano pintada ─────────────
const PAL = [
  0x14261e, // 0 fondo
  // follaje: sombra verde azulada → verde → amarillo verdoso → luz
  0x0f2a26, 0x173a2c, 0x1f4d33, 0x2c6339, 0x3d7a3c, 0x55913f, 0x70a846, 0x8fbf52, 0xadd262, 0xcfe282,
  // pasto, prados, campos
  0x4f7f36, 0x6a9a44, 0x86b352, 0xa3c862, 0xd9c26a, 0xe8d58a, 0xc4a052, 0xa77e45, 0x8a6a3c,
  // camino, arena
  0xc8a978, 0xe2d2a6, 0xf0e6c6,
  // agua: turquesa de orilla → azul profundo
  0x9fd6d0, 0x6fbcc4, 0x4a9db8, 0x2f7aa6, 0x205b8a, 0x16426a,
  // casas: paredes, techos rojos, pizarra, teja
  0xf3e9d2, 0xd9c7a6, 0xb5462f, 0x8e3424, 0x4e6a8a, 0x3a5070, 0xc97a3d, 0x5a3a26,
  // flores del código: crema, amarillo, rosa, naranja, lavanda, blanco
  0xfff4d8, 0xffd24a, 0xffa9bd, 0xff9a48, 0xc8b4f0, 0xffffff,
  // nubes: blanco, sombra lavanda
  0xfffaf0, 0xe4e6f2, 0xc6c6dc, 0xa4a6c4,
  // luces
  0xfff2a0, 0xbfffd0, 0xa8e8ff,
  // sombras del suelo
  0x0c1c14, 0x163024,
];

// ───────────── ruido ─────────────
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v) * 2 - 1;
}
const fbm0 = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1 + 7, y * 2.1 - 3) * 0.28 + vnoise(x * 4.3 - 11, y * 4.3 + 5) * 0.17;

function inv4(a) {
  const o = new Float64Array(16);
  const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4];
  const b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
  const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12];
  const b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
  const d = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
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

// colores de las flores según el tipo de carácter (ver codemap.js)
const FLOWER = [
  [0.95, 0.97, 0.92], // signo
  [0.8, 0.72, 0.97], // comentario
  [1.0, 0.96, 0.85], // nota / mini-notación
  [1.0, 0.83, 0.3], // función
  [1.0, 0.68, 0.76], // texto
  [1.0, 0.62, 0.3], // número
];
// color de las letras que suenan, por capa (más saturado que las flores, para que se note)
const BLOOM = {
  melody: [1.0, 0.74, 0.22], arp: [0.35, 0.88, 1.0], pad: [0.62, 0.66, 1.0], drone: [1.0, 0.56, 0.2], cloud: [0.86, 0.62, 1.0],
  sonar: [0.3, 1.0, 0.86], sparks: [1.0, 0.5, 0.72], breath: [0.8, 0.95, 0.6], dust: [0.9, 0.97, 1.0], sub: [0.42, 0.56, 1.0],
};
// rampa de luz del follaje (sombra → luz): cuatro familias de árbol
const RAMP = {
  broad: [[0.07, 0.19, 0.19], [0.13, 0.31, 0.22], [0.24, 0.46, 0.24], [0.44, 0.65, 0.28], [0.68, 0.82, 0.4]],
  pine: [[0.05, 0.15, 0.16], [0.08, 0.23, 0.19], [0.15, 0.34, 0.22], [0.27, 0.48, 0.26], [0.42, 0.6, 0.3]],
  light: [[0.15, 0.32, 0.2], [0.3, 0.5, 0.22], [0.5, 0.7, 0.28], [0.7, 0.84, 0.38], [0.86, 0.92, 0.55]],
  blossom: [[0.45, 0.3, 0.38], [0.7, 0.48, 0.55], [0.92, 0.66, 0.72], [1.0, 0.82, 0.86], [1.0, 0.93, 0.95]],
};

export function createForest(canvas, layout, kindColor) {
  const L = layout;
  const H = L.H;
  const CH = 8;
  const PER = Math.ceil(L.W / CH) * CH;
  const Z0 = -8.5, Z1 = H + 7.5;
  const ZM = H * 0.5;
  const wrapX = (x) => ((x % PER) + PER) % PER;
  const wd = (x, cx) => { let d = wrapX(x) - cx; if (d > PER / 2) d -= PER; if (d < -PER / 2) d += PER; return d; };
  const fbm = (x, z) => {
    const u = wrapX(x), w = smooth(PER - 14, PER, u);
    return w > 0 ? lerp(fbm0(u, z), fbm0(u - PER, z), w) : fbm0(u, z);
  };
  const vn = (x, z, k = 0) => {
    const u = wrapX(x), w = smooth(PER - 10, PER, u);
    return w > 0 ? lerp(vnoise(u + k, z), vnoise(u - PER + k, z), w) : vnoise(u + k, z);
  };
  const SUN = (() => { const v = [-0.5, 0.78, -0.42]; const l = Math.hypot(...v); return v.map((c) => c / l); })();
  const SHX = -SUN[0] / SUN[1], SHZ = -SUN[2] / SUN[1]; // corrimiento de sombra por unidad de altura

  // ───────────── geografía: una escena distinta en cada hueco entre prados ─────────────
  // Entre prado y prado hay ~7 unidades de paisaje. Cada hueco es una escena propia, en este
  // orden: arroyo con puente, campos, lago con islote, aldea, estanque con muelle, el árbol
  // grande en su loma, lavanda, caserío, bahía, pinar. Abajo corre un camino de tierra.
  const gaps = L.cols.map((c, i) => {
    const nx = i + 1 < L.cols.length ? L.cols[i + 1].x : L.cols[0].x + PER;
    const x0 = c.x + c.width + 1.2, x1 = nx - 1.2;
    return { x0, x1, cx: wrapX((x0 + x1) / 2), w: x1 - x0 };
  });
  const SCENES = ['stream', 'fields', 'lake', 'village', 'pond', 'hero', 'lavender', 'hamlet', 'bay', 'pines'];
  gaps.forEach((g, i) => (g.type = SCENES[i % SCENES.length]));
  const gapAt = (x) => { for (const g of gaps) if (Math.abs(wd(x, g.cx)) < g.w / 2 + 1.6) return g; return null; };
  const byType = (t) => gaps.filter((g) => g.type === t);
  const roadZ = (x) => H + 2.6 + Math.sin(TAU * wrapX(x) / PER * 4) * 0.9 + Math.sin(x * 0.41) * 0.25;
  // senderos que suben desde el camino: por la aldea, el caserío y hasta el árbol grande
  const laneX = (g, z) => g.cx + Math.sin(z * 0.35 + g.cx) * 0.6;
  const lane = (x, z) => {
    const g = gapAt(x);
    if (!g || !(g.type === 'village' || g.type === 'hamlet' || g.type === 'hero')) return false;
    if (z > roadZ(x) || z < (g.type === 'hero' ? ZM + 1.6 : 0.6)) return false;
    return Math.abs(wd(x, laneX(g, z))) < 0.2;
  };
  const fieldGap = (x) => { const g = gapAt(x); return g && (g.type === 'fields' || g.type === 'lavender') ? g : null; };

  // agua: >0 adentro (aprox. profundidad), <0 tierra
  function water(x, z) {
    let w = -9;
    const g = gapAt(x);
    if (!g) return w;
    const dx = wd(x, g.cx);
    if (g.type === 'stream') {
      // arroyo que cruza la franja de arriba abajo, serpenteando
      const xs = Math.sin(z * 0.38 + 1) * g.w * 0.26 + Math.sin(z * 1.1) * 0.3;
      w = (0.55 + 0.12 * Math.sin(z * 1.7) + 0.08 * vn(z * 0.8, 2, 4) - Math.abs(dx - xs)) * 1.4;
    } else if (g.type === 'lake') {
      const ex = dx / (g.w * 0.55 + 1.4), ez = (z + 1.2) / 7.4;
      w = (1 - ex * ex - ez * ez + 0.2 * vn(x * 0.3, z * 0.3, 5)) * 1.6;
      const di = Math.hypot(dx - g.w * 0.12, z + 3.2); // islote
      if (di < 0.95) w = Math.min(w, (di - 0.95) * 1.5);
    } else if (g.type === 'pond') {
      const d = Math.hypot(dx * 1.1, z - (ZM - 1.5));
      w = (Math.min(2.4, g.w * 0.33) - d + 0.25 * vn(x * 0.6, z * 0.6, 9)) * 0.6;
    } else if (g.type === 'bay') {
      const fall = smooth(g.w / 2 + 1.5, g.w / 2 - 1.5, Math.abs(dx));
      const edge = 3.2 + Math.cos(dx / (g.w * 0.5 + 2) * Math.PI * 0.5) * 3 + 0.6 * vn(x * 0.35, 3, 2);
      if (fall > 0.01) w = (edge - z) * 0.5 * fall + (fall - 1) * 3;
    }
    return w;
  }
  const heightAt = (x, z, w = water(x, z)) => {
    if (w > 0) return -0.2 - Math.min(1, w) * 0.5;
    let hill = 0;
    const g = gapAt(x);
    if (g && g.type === 'hero') hill = 0.4 * Math.exp(-((wd(x, g.cx) / 2.4) ** 2 + ((z - (ZM + 0.2)) / 2.4) ** 2));
    return 0.04 + 0.08 * smooth(0, 0.6, -w) + fbm(x * 0.2, z * 0.2) * 0.05 + hill;
  };

  // Prados del código: el claro abraza el contorno del texto línea por línea (cada línea
  // abre lo que ocupa, suavizado con sus vecinas), con un borde roto por ruido. Así el prado
  // tiene la silueta irregular de un claro real y no la de un rectángulo.
  const hull = L.cols.map((c) => {
    const n = c.cells.length, lo = new Float32Array(n).fill(NaN), hi = new Float32Array(n).fill(NaN);
    c.cells.forEach((row, li) => {
      const vis = row.filter((r) => r.ch.trim());
      if (vis.length) { lo[li] = vis[0].c * CHAR_W; hi[li] = (vis[vis.length - 1].c + 1) * CHAR_W; }
    });
    const L2 = new Float32Array(n), R2 = new Float32Array(n);
    for (let li = 0; li < n; li++) {
      let l = Infinity, r = -Infinity;
      for (let k = -3; k <= 3; k++) {
        const j = li + k;
        if (j < 0 || j >= n || isNaN(lo[j])) continue;
        const fall = Math.abs(k) * 0.12; // las vecinas lejanas abren un poco menos
        l = Math.min(l, lo[j] + fall); r = Math.max(r, hi[j] - fall);
      }
      L2[li] = isFinite(l) ? l : c.width * 0.3; R2[li] = isFinite(r) ? r : c.width * 0.6;
    }
    return { L: L2, R: R2, n };
  });
  function meadow(x, z, grow = 0) {
    const u = wrapX(x);
    for (let ci = 0; ci < L.cols.length; ci++) {
      const c = L.cols[ci], hc = hull[ci];
      if (u < c.x - 3 || u > c.x + c.width + 3) continue;
      // margen mínimo ~0,45: las copas de los árboles del borde no tapan letras
      const m = 0.88 + 0.32 * vn(x * 0.6, z * 0.6, ci * 13) + 0.12 * vn(x * 2.3, z * 2.3, ci * 7) + grow;
      const z0 = c.z - m, z1 = c.z + hc.n * LINE_H + m;
      if (z < z0 || z > z1) continue;
      const fl = clamp((z - c.z) / LINE_H - 0.5, 0, hc.n - 1), l0 = Math.floor(fl), l1 = Math.min(hc.n - 1, l0 + 1), t = fl - l0;
      const x0 = c.x + lerp(hc.L[l0], hc.L[l1], t) - m, x1 = c.x + lerp(hc.R[l0], hc.R[l1], t) + m;
      if (u > x0 && u < x1) return { ci, edge: Math.min(u - x0, x1 - u, z - z0, z1 - z) };
    }
    return null;
  }

  // casas: aldea a lo largo del sendero, caserío chico, cabaña del estanque, la del islote
  const ROOFS = [[0.71, 0.27, 0.18], [0.31, 0.42, 0.55], [0.79, 0.48, 0.24], [0.56, 0.21, 0.14], [0.36, 0.5, 0.38]];
  const houses = [];
  gaps.forEach((g, gi) => {
    const add = (x, z, k, extra = {}) => {
      if (meadow(x, z) || water(x, z) > -0.4) return;
      houses.push({ x: wrapX(x), z, rot: (hash2(gi, k) - 0.5) * 0.7 + (hash2(k, gi) < 0.5 ? 0 : Math.PI / 2),
        w: 0.42 + hash2(k, 5 + gi) * 0.2, d: 0.6 + hash2(k, 6 + gi) * 0.3, roof: ROOFS[Math.floor(hash2(k, 7 + gi) * ROOFS.length)], smoke: hash2(k, 8 + gi) < 0.55, ...extra });
    };
    if (g.type === 'village' || g.type === 'hamlet') {
      const n = g.type === 'village' ? 8 : 3;
      for (let k = 0; k < n; k++) {
        const z = (g.type === 'village' ? 1.2 : ZM - 1) + k * (g.type === 'village' ? (H - 1) / n : 1.6);
        const side = k % 2 ? 1 : -1;
        add(laneX(g, z) + side * (0.75 + hash2(k, gi) * 0.35), z, k);
      }
    }
    if (g.type === 'pond') add(g.cx - Math.min(2.4, g.w * 0.33) - 0.6, ZM + 0.6, 1, { dock: true, smoke: true });
    if (g.type === 'lake') add(g.cx + g.w * 0.12, -3.2, 2, { smoke: false });
  });
  const nearHouse = (x, z, r = 0.75) => houses.some((h) => Math.hypot(wd(x, h.x), z - h.z) < r);
  const heroAt = (x, z) => byType('hero').some((g) => Math.hypot(wd(x, g.cx), z - (ZM + 0.2)) < 2.7);

  // ───────────── construcción ─────────────
  const B = makeBuilder(5, PAL);
  const NSLOT = 7;
  const CAP = 18500;
  const WPOOL = 9000;
  const PMAX = 5200;
  const placeholder = (n) => { const s = B.count(); for (let i = 0; i < n; i++) B.disc(0, -500, 0, [0, 1, 0], 0.05, 0.05, [0, 0, 0], 3); return s; };
  const slotStart = [];
  for (let k = 0; k < NSLOT; k++) slotStart.push(placeholder(CAP));
  const waterStart = placeholder(WPOOL);
  const waterEnd = B.count();
  const waterFree = [];
  for (let i = waterEnd - 1; i >= waterStart; i--) waterFree.push(i);
  const pStart = placeholder(PMAX);

  const world = B.finish({
    cam: { target: [0, 0, ZM], dist: 30, yaw: 0, pitch: 0.9, sway: 0 },
    detail: 30,
    dither: 0.45,
    radius: 140,
    // render suave por defecto: el pixelado con paleta posterizaba el pasto en manchas planas (?pixel lo vuelve)
    look: new URLSearchParams(location.search).has('pixel') ? { pixel: true, outline: false, clean: true } : { pixel: false, outline: false, clean: false },
  });
  const D = world.data;
  const renderer = createRenderer(canvas, { toolkit: { KIT, PixelLook } });
  const rowOf = (i) => Math.floor(i / 512);
  const rowSpan = (a, b) => { const r = []; for (let q = rowOf(a); q <= rowOf(b - 1); q++) r.push(q); return r; };
  const rowsWater = rowSpan(waterStart, waterEnd);

  function put(i, x, y, z, nx, ny, nz, st, sn, c, a, kind = 0, ph = 0, sp = 0, rg = 0, ex = 0) {
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const o = i * 16, s2 = st * st, d = sn * sn - s2;
    D[o] = x; D[o + 1] = y; D[o + 2] = z; D[o + 3] = a;
    D[o + 4] = s2 + d * nx * nx; D[o + 5] = d * nx * ny; D[o + 6] = d * nx * nz;
    D[o + 7] = pack(c[0], c[1], c[2]);
    D[o + 8] = s2 + d * ny * ny; D[o + 9] = d * ny * nz; D[o + 10] = s2 + d * nz * nz;
    D[o + 11] = kind; D[o + 12] = ph; D[o + 13] = sp; D[o + 14] = rg; D[o + 15] = ex;
  }
  // mancha plana alargada (sombras): a lo largo de (ux, uz) mide a, a lo ancho b
  function putFlat(i, x, y, z, ux, uz, a, b, c, alpha) {
    const o = i * 16, l = Math.hypot(ux, uz) || 1;
    ux /= l; uz /= l;
    const vx = -uz, vz = ux, a2 = a * a, b2 = b * b, n2 = 0.0004;
    D[o] = x; D[o + 1] = y; D[o + 2] = z; D[o + 3] = alpha;
    D[o + 4] = a2 * ux * ux + b2 * vx * vx; D[o + 5] = 0; D[o + 6] = a2 * ux * uz + b2 * vx * vz;
    D[o + 7] = pack(c[0], c[1], c[2]);
    D[o + 8] = n2; D[o + 9] = 0; D[o + 10] = a2 * uz * uz + b2 * vz * vz;
    D[o + 11] = 0; D[o + 12] = D[o + 13] = D[o + 14] = D[o + 15] = 0;
  }
  const hide = (i) => { const o = i * 16; D[o + 1] = -500; D[o + 3] = 0; D[o + 11] = 0; };
  const lit = (nx, ny, nz) => nx * SUN[0] + ny * SUN[1] + nz * SUN[2];
  // sombreado de caricatura: cuatro escalones + brillo en el borde que da al sol
  const toon = (ramp, l, r) => {
    // escalones suaves: entre tono y tono se mezcla un poco según la luz (pincelada, no recorte)
    const f = clamp((l + 0.15) / 1.05) * 3.2 + (r - 0.5) * 0.5;
    const k = Math.max(0, Math.min(3, Math.floor(f))), t = smooth(0.55, 1, f - k);
    const c = mixc(ramp[k], ramp[Math.min(4, k + 1)], t);
    return l > 0.9 && r > 0.75 ? mixc(c, ramp[4], 0.6) : c;
  };

  // ───────────── tramos ─────────────
  const slots = Array.from({ length: NSLOT }, () => ({ chunk: null, water: [], chars: [], used: 0 }));
  const charSplats = new Map(); // offset del código → [{i0, i1}]
  const basePack = new Float32Array(D.length / 16); // color original de cada splat (para devolverlo tras brillar)

  // densidad de bosque (0 = abierto, 1 = cerrado), según la escena del hueco
  function forestAt(x, z, md) {
    if (md) return 0;
    const n = fbm(x * 0.09 + 20, z * 0.09 - 4);
    let d = clamp(0.95 - smooth(0.05, 0.4, n));
    const g = gapAt(x);
    if (g) {
      if (g.type === 'fields' || g.type === 'lavender') d *= hedgerow(x, z) ? 1 : 0.03;
      else if (g.type === 'village' || g.type === 'hamlet') d *= 0.3;
      else if (g.type === 'hero') d *= 0.12;
      // pinar: grupos cerrados con claros entre medio, no una alfombra pareja
      else if (g.type === 'pines') d = clamp(0.35 + 0.75 * smooth(-0.3, 0.25, vn(x * 0.35, z * 0.35, 33)));
    }
    return d;
  }
  // parcelas de cultivo, levemente giradas
  const FA = 0.14, fcos = Math.cos(FA), fsin = Math.sin(FA);
  const plot = (x, z) => {
    const a = wrapX(x) * fcos - z * fsin, b = wrapX(x) * fsin + z * fcos;
    const fa = a / 2.4 - Math.floor(a / 2.4), fb = b / 1.7 - Math.floor(b / 1.7);
    return { i: Math.floor(a / 2.4), j: Math.floor(b / 1.7), fa, fb, a, b };
  };
  const hedgerow = (x, z) => { const p = plot(x, z); return p.fa < 0.06 || p.fb < 0.08; };
  function fieldColor(x, z, n2, type) {
    const p = plot(x, z);
    const t = type === 'lavender' ? 0.7 + hash2(p.i, p.j) * 0.12 : hash2(p.i, p.j) * 0.7 + (hash2(p.j, p.i) < 0.3 ? 0.12 : 0);
    const rows = Math.sin(p.a * 26) > 0;
    if (t < 0.3) return rows ? [0.86, 0.74, 0.38] : [0.8, 0.66, 0.32]; // trigo
    if (t < 0.55) return rows ? [0.56, 0.74, 0.3] : [0.48, 0.67, 0.27]; // brotes
    if (t < 0.7) return rows ? [0.62, 0.48, 0.3] : [0.55, 0.42, 0.27]; // arado
    if (t < 0.82) return rows ? [0.72, 0.62, 0.86] : [0.48, 0.62, 0.3]; // lavanda en hileras
    return [0.6, 0.76, 0.34 + n2 * 0.04]; // pradera
  }

  function buildChunk(slot, c) {
    const S = slots[slot];
    S.chunk = c;
    for (const w of S.water) { hide(w.i); waterFree.push(w.i); }
    S.water = [];
    // las letras de este tramo dejan de existir (las copias en otros tramos siguen)
    const lo = slotStart[slot], hi = lo + CAP;
    for (const off of S.chars) {
      const list = (charSplats.get(off) || []).filter((e) => e.i0 < lo || e.i0 >= hi);
      if (list.length) charSplats.set(off, list); else charSplats.delete(off);
    }
    S.chars = [];
    const xa = c * CH, xb = xa + CH;
    const lapShift = Math.floor(xa / PER) * PER;
    let i = slotStart[slot];
    const end = i + CAP;
    const room = (n) => i + n < end;

    // 1 · el código plantado (primero: nunca se queda sin lugar)
    for (const shift of [lapShift - PER, lapShift, lapShift + PER]) {
      L.cols.forEach((col) => {
        const cx0 = col.x + shift;
        if (cx0 > xb || cx0 + col.width < xa) return;
        col.cells.forEach((row, li) => {
          const zl = col.z + li * LINE_H;
          for (const cell of row) {
            const gx = cx0 + cell.c * CHAR_W;
            const mid = gx + CHAR_W * 0.5;
            if (mid < xa || mid >= xb) continue;
            const pts = glyph(cell.ch);
            if (!pts.length || !room(pts.length)) continue;
            const i0 = i;
            const fc = FLOWER[cell.k] || FLOWER[0];
            for (const [px, py] of pts) {
              const x = gx + (px + 0.5) * DOT, z = zl + (py + 0.5) * DOT;
              const w = water(x, z);
              if (w > 0) {
                // camalote: hoja verde clara con la flor apenas teñida
                put(i, x, 0.02, z, 0, 1, 0, DOT * 0.5, 0.01, mixc([0.62, 0.84, 0.5], fc, 0.35), 3);
              } else {
                const qx = Math.round(x * 40), qz = Math.round(z * 40);
                const v = 0.84 + 0.2 * hash2(qx, qz), hue = (hash2(qz, qx) - 0.5) * 0.12;
                const jx = (hash2(qx + 5, qz) - 0.5) * 0.016, jz = (hash2(qx, qz + 5) - 0.5) * 0.016;
                put(i, x + jx, heightAt(x, z, w) + 0.03, z + jz, 0, 1, 0, DOT * (0.38 + 0.12 * hash2(qx + 9, qz)), 0.01,
                  [fc[0] * v + hue, fc[1] * v, fc[2] * v - hue], 3);
              }
              basePack[i] = D[i * 16 + 7];
              i++;
            }
            const list = charSplats.get(cell.off) || [];
            list.push({ i0, i1: i });
            charSplats.set(cell.off, list);
            S.chars.push(cell.off);
          }
        });
      });
    }

    // 2 · suelo, agua y caminos
    const GS = 0.3;
    for (let z = Z0; z < Z1; z += GS) for (let ig = Math.ceil(xa / GS); ig * GS < xb; ig++) {
      const x0 = ig * GS;
      const hx = Math.round(wrapX(x0) / GS), hz = Math.round((z - Z0) / GS);
      const px = x0 + (hash2(hx, hz) - 0.5) * GS * 0.7, pz = z + (hash2(hz, hx + 7) - 0.5) * GS * 0.7;
      const w = water(px, pz);
      if (w > 0) {
        if (Math.abs(pz - roadZ(px)) < 0.32 && room(1)) put(i++, px, 0.1, pz, 0, 1, 0, GS * 0.75, 0.02, (hx & 1) ? [0.55, 0.4, 0.27] : [0.62, 0.47, 0.32], 3); // puente
        if (waterFree.length) {
          const g = gapAt(px);
          let fx = 1, fz = 0.25, stream = false;
          if (g && g.type === 'stream') {
            fx = Math.cos(pz * 0.38 + 1) * 0.38 * g.w * 0.26 + Math.cos(pz * 1.1) * 0.33; fz = 1; stream = true;
          }
          S.water.push({ i: waterFree.pop(), x: px, z: pz, depth: clamp(w / 1.4), ph: hash2(hx, hz * 5) * TAU, glint: hash2(hx + 3, hz), fx, fz, stream });
        }
        continue;
      }
      if (!room(2)) continue;
      const md = meadow(px, pz);
      const rz = roadZ(px);
      const onRoad = Math.abs(pz - rz) < 0.28 + 0.05 * vn(px * 2, 1, 3) || lane(px, pz);
      const fd = forestAt(px, pz, md);
      const under = fd > 0.5 && !md && !onRoad;
      if (under && (hx % 2 || hz % 2)) continue; // bajo el bosque casi no se ve: discos grandes y espaciados
      const h = heightAt(px, pz, w);
      const n = fbm(px * 0.4, pz * 0.4), n2 = hash2(hx * 7, hz * 3);
      let col;
      if (onRoad) col = mixc([0.78, 0.66, 0.47], [0.86, 0.78, 0.6], n2 * 0.6);
      else if (w > -0.12) col = mixc([0.89, 0.83, 0.66], [0.8, 0.76, 0.56], n2 * 0.4);
      else if (md) {
        // prado segado: hileras un poco más claras, como surcos de un cantero
        // prado: pasto natural, más claro y cálido al centro, en sombra contra el bosque
        const big = fbm(px * 0.15 + 3, pz * 0.15), small = fbm(px * 0.9, pz * 0.9 + 3);
        col = mixc([0.4, 0.52, 0.25], [0.52, 0.6, 0.3], clamp(0.5 + big));
        col = mixc(col, [0.62, 0.62, 0.38], clamp(small * 1.3 - 0.25) * 0.5);
        col = mixc(col, [0.24, 0.34, 0.19], smooth(0.9, 0, md.edge) * 0.65);
        col = col.map((v) => v * (0.95 + 0.08 * n2));
      } else if (fieldGap(px) && fd < 0.3) col = fieldColor(px, pz, n2, fieldGap(px).type);
      else if (under) col = mixc([0.2, 0.31, 0.18], [0.26, 0.38, 0.2], n2 * 0.6 + clamp(0.5 + n) * 0.4); // pasto en sombra del bosque
      else {
        // pasto abierto: manchas de sol y de sombra a dos escalas, como pinceladas
        const big = fbm(px * 0.12 + 7, pz * 0.12), small = fbm(px * 0.7, pz * 0.7 + 3);
        col = mixc([0.28, 0.4, 0.21], [0.44, 0.55, 0.27], clamp(0.5 + big * 1.2));
        col = mixc(col, [0.6, 0.6, 0.36], clamp(small * 1.4 - 0.15) * 0.55);
        // a la sombra del bosque cercano
        if (meadow(px, pz, 1.2) === null && fd > 0.3) col = mixc(col, [0.2, 0.3, 0.17], 0.35);
        col = col.map((v) => v * (0.94 + 0.1 * n2));
      }
      // bajo el texto el suelo baja un poco: si no, al ordenar por profundidad sus discos tapan las flores
      const sink = md && md.edge > 0.25 ? 0.2 : 0;
      const shore = w > -0.12;
      const fg = !md && !onRoad && !shore && fd < 0.3 ? fieldGap(px) : null;
      if (fg && room(3)) {
        // campo: surcos dibujados como pinceladas finas a lo largo de la hilera
        for (const off of [-0.06, 0.06]) {
          const qx = px + fcos * off, qz = pz - fsin * off;
          put(i++, qx, h, qz, 0, 1, 0, 0.001, 0.001, fieldColor(qx, qz, n2, fg.type), 2.6); // se reemplaza abajo
          putFlat(i - 1, qx, h, qz, fsin, fcos, 0.2, 0.07, fieldColor(qx, qz, n2, fg.type), 2.6);
        }
        continue;
      }
      put(i++, px, h - sink, pz, 0, 1, 0, GS * (under ? 1.15 : shore ? 0.5 : 0.78), 0.02, col, 2.6);
      // orillas: piedritas y juncos
      if (w > -0.32 && !onRoad && room(4)) {
        const q = hash2(hx * 5, hz * 7);
        if (q < 0.22) put(i++, px + 0.05, h + 0.02, pz, 0, 1, 0, 0.03 + 0.03 * q, 0.02, mixc([0.6, 0.6, 0.56], [0.78, 0.76, 0.7], hash2(hz, hx)), 3);
        else if (q > 0.8) {
          for (let k = 0; k < 3; k++) {
            const rx = px + (hash2(k, hx) - 0.5) * 0.18, rzz = pz + (hash2(hz, k) - 0.5) * 0.18, rh = 0.12 + 0.1 * hash2(k, hz);
            putStick(i++, rx, h + rh / 2, rzz, (hash2(k + 3, hx) - 0.5) * 0.3, 1, 0, rh / 2, 0.012, mixc([0.42, 0.5, 0.24], [0.6, 0.6, 0.32], hash2(k, hx + hz)), 3, 14, hx + k, 1.6, 0.06, h);
          }
        }
      }
      // flores silvestres sueltas en el pasto abierto
      if (!under && !md && !onRoad && w < -0.15 && n2 > 0.84 && fbm(px * 0.3 + 50, pz * 0.3) > -0.1) {
        const fl = [[1, 0.95, 0.85], [1, 0.82, 0.3], [0.86, 0.72, 0.98], [1, 0.62, 0.7]][Math.floor(hash2(hx, hz + 9) * 4)];
        put(i++, px + 0.08, h + 0.04, pz, 0, 1, 0, 0.035, 0.01, fl, 3);
      }
    }

    // 3 · casas (con humo que sube solo) y muelle
    for (const hs of houses) {
      for (const sx of [hs.x + lapShift, hs.x + lapShift + PER]) {
        if (sx >= xa && sx < xb) i = house(i, end, sx, hs);
      }
    }

    // 4 · el árbol grande, en su loma
    for (const g of byType('hero')) for (const sx of [g.cx + lapShift, g.cx + lapShift + PER]) {
      if (sx >= xa && sx < xb && room(700)) i = bigTree(i, sx, heightAt(sx, ZM + 0.2), ZM + 0.2);
    }

    // 5 · árboles
    const TREE = 0.78;
    const cells = Math.round(PER / TREE);
    // filas del centro de la toma hacia afuera: si el tramo se llena, faltan árboles en los bordes (desenfocados), no en el medio
    const rowsZ = [];
    for (let jz = Math.floor(Z0 / TREE); jz < Z1 / TREE; jz++) rowsZ.push(jz);
    rowsZ.sort((p, q) => Math.abs(p * TREE - ZM) - Math.abs(q * TREE - ZM));
    outer: for (const jz of rowsZ) for (let ix = Math.floor(xa / TREE) - 1; ix <= xb / TREE; ix++) {
      const hx = ((ix % cells) + cells) % cells;
      const px = (ix + 0.5 + (hash2(hx, jz) - 0.5) * 0.9) * TREE;
      const pz = (jz + 0.5 + (hash2(jz + 99, hx) - 0.5) * 0.9) * TREE;
      if (px < xa || px >= xb) continue;
      const w = water(px, pz);
      if (w > -0.25) continue;
      const md = meadow(px, pz);
      if (md) continue;
      const rz = roadZ(px);
      if (Math.abs(pz - rz) < 0.55 || lane(px, pz) || nearHouse(px, pz, 0.85) || heroAt(px, pz)) continue;
      let dens = forestAt(px, pz, null);
      if (meadow(px, pz, 1.1)) dens *= 0.45; // borde del claro: árboles sueltos, no un muro
      if (hash2(hx * 5, jz) > dens) {
        // en lo abierto: algún arbusto o un árbol solitario
        const q = hash2(hx * 11, jz * 3);
        if (dens < 0.5 && q < 0.14 && room(20)) i = bush(i, px, heightAt(px, pz, w), pz, hx, jz);
        else if (dens < 0.4 && q > 0.985 && room(90)) i = roundTree(i, px, heightAt(px, pz, w), pz, 1.2 + q, hx, jz, RAMP.broad, false);
        continue;
      }
      const h = heightAt(px, pz, w);
      const r = hash2(hx * 3, jz * 7);
      const kindN = vn(px * 0.18, pz * 0.18, 70) + (r - 0.5) * 0.8;
      const g = gapAt(px);
      const nearVillage = g && (g.type === 'village' || g.type === 'hamlet');
      const type = g && g.type === 'pines' ? 'pine' : nearVillage && r > 0.7 ? 'blossom' : kindN > 0.25 ? 'pine' : kindN < -0.45 ? 'light' : 'broad';
      const sr = hash2(hx, jz + 1);
      const s = 0.7 + sr * 0.55 + (sr > 0.93 ? 0.5 : 0);
      if (!room(90)) break outer;
      i = type === 'pine' ? pine(i, px, h, pz, s, hx, jz) : roundTree(i, px, h, pz, s, hx, jz, RAMP[type], type === 'light');
    }

    S.used = i - slotStart[slot];
    for (; i < end; i++) hide(i);
    for (const w of S.water) waterSplat(w, 0, 0, 0, true);
  }

  // árbol de copa redonda: varios bultos chicos con luz de caricatura y sombra alargada
  // cada árbol con su tono: un poco más cálido o más frío, más claro o más oscuro
  const treeTint = (hx, jz) => {
    const b = 0.86 + hash2(hx * 13, jz) * 0.26, h = (hash2(jz * 17, hx) - 0.5) * 0.16;
    return (c) => [c[0] * b + h * 0.5, c[1] * b + h * 0.15, c[2] * b - h * 0.4];
  };
  // rama / aguja: splat alargado a lo largo de (dx, dy, dz)
  function putStick(i, x, y, z, dx, dy, dz, sl, sw, c, a, kind = 0, ph = 0, sp = 0, rg = 0, ex = 0) {
    const l = Math.hypot(dx, dy, dz) || 1;
    put(i, x, y, z, dx / l, dy / l, dz / l, sw, sl, c, a, kind, ph, sp, rg, ex);
  }
  // Árbol de hojas (roble, abedul, cerezo): tronco que se abre en ramas, y en la punta de
  // cada rama un racimo de hojas chicas. La copa queda lobulada, con huecos donde se ven las
  // ramas y la sombra de adentro; la sombra en el suelo repite los lóbulos.
  function roundTree(i, x, y, z, s, hx, jz, ramp, slender) {
    const tint = treeTint(hx, jz);
    const hgt = (slender ? 0.78 : 0.62) * s, R = (slender ? 0.26 : 0.4) * s;
    const sway = [hash2(hx + 1, jz) * TAU, 0.9 + hash2(hx, jz * 7) * 0.5, 0.03, y];
    const bark = slender ? [0.86, 0.84, 0.78] : [0.3, 0.22, 0.15];
    const forkY = y + hgt * (slender ? 0.55 : 0.42);
    putStick(i++, x, (y + forkY) / 2, z, 0, 1, 0, (forkY - y) / 2, 0.028 * s, bark, 3);
    const nb = slender ? 3 : 3 + Math.floor(hash2(hx * 7, jz) * 3);
    const rot = hash2(hx, jz * 3) * TAU;
    const clusters = [];
    for (let b = 0; b < nb; b++) {
      const a = rot + (b / nb) * TAU + (hash2(b, hx) - 0.5) * 0.9;
      const reach = R * (0.45 + 0.4 * hash2(jz, b + 3));
      const ey = y + hgt * (0.72 + 0.22 * hash2(b, jz));
      const ex = x + Math.cos(a) * reach, ez = z + Math.sin(a) * reach;
      putStick(i++, (x + ex) / 2, (forkY + ey) / 2, (z + ez) / 2, ex - x, ey - forkY, ez - z, Math.hypot(ex - x, ey - forkY, ez - z) / 2, 0.016 * s, bark, 3);
      clusters.push([ex, ey, ez, R * (0.36 + 0.2 * hash2(b + 7, jz))]);
    }
    clusters.push([x + (hash2(hx, 5) - 0.5) * R * 0.3, y + hgt * 0.98, z + (hash2(5, jz) - 0.5) * R * 0.3, R * 0.42]);
    // sombra: una mancha por racimo, corrida según el sol
    for (const [cx, cy, cz, cr] of clusters) putFlat(i++, cx + SHX * (cy - y), y + 0.012, cz + SHZ * (cy - y), SHX, SHZ, cr * 1.25, cr * 0.95, [0.07, 0.14, 0.1], 0.85);
    // hojas
    clusters.forEach(([cx, cy, cz, cr], ci) => {
      const n = 14;
      for (let k = 0; k < n; k++) {
        const yy = 1 - (k + 0.5) / n * 1.5;
        const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
        const b = k * 2.39996 + ci * 1.3 + hx;
        const jit = 0.78 + 0.32 * hash2(k + ci * 31, hx + jz);
        const nx = Math.cos(b) * rr, nz = Math.sin(b) * rr;
        // normal del racimo mezclada con la de la copa entera: lee volumen sin parecer una bola
        let mx = nx * 0.6 + (cx - x) / R * 0.5, my = yy * 0.7 + 0.45, mz = nz * 0.6 + (cz - z) / R * 0.5;
        const ml = Math.hypot(mx, my, mz); mx /= ml; my /= ml; mz /= ml;
        const inner = yy < -0.2 ? 0.75 : 1; // las hojas de abajo del racimo, en sombra
        const c = tint(toon(ramp, lit(mx, my, mz) * inner, hash2(k, ci + hx)));
        const lx = cx + nx * cr * jit, ly = cy + yy * cr * 0.7 * jit, lz = cz + nz * cr * jit;
        // hoja: disco chico inclinado según dónde está en el racimo
        put(i++, lx, ly, lz, mx * 0.6, 0.8, mz * 0.6, cr * 0.3, cr * 0.1, c, 3, 14, sway[0] + ci, sway[1], sway[2], sway[3]);
      }
    });
    return i;
  }
  // arbusto: tres racimos bajos de hojas
  function bush(i, x, y, z, hx, jz) {
    const R = 0.12 + hash2(hx, jz * 9) * 0.08;
    putFlat(i++, x + SHX * 0.08, y + 0.012, z + SHZ * 0.08, SHX, SHZ, R * 1.6, R * 1.1, [0.07, 0.15, 0.1], 0.9);
    for (let c = 0; c < 3; c++) {
      const a = c * 2.1 + hx, cx = x + Math.cos(a) * R * 0.6, cz = z + Math.sin(a) * R * 0.6;
      for (let k = 0; k < 5; k++) {
        const b = k * 2.39996 + c, yy = 0.6 - k * 0.25;
        const nx = Math.cos(b) * 0.6, nz = Math.sin(b) * 0.6;
        put(i++, cx + nx * R * 0.6, y + R * (0.5 + yy * 0.4), cz + nz * R * 0.6, nx, 0.8, nz, R * 0.4, R * 0.14, toon(RAMP.broad, lit(nx, 0.8, nz), hash2(k, jz + c)), 3);
      }
    }
    return i;
  }
  // Pino: pisos de ramas que salen del tronco como agujas largas, caídas hacia afuera.
  // Desde arriba se lee como una estrella, que es como se ve un pino desde un dron.
  function pine(i, x, y, z, s, hx, jz) {
    const tint = treeTint(hx, jz);
    const big = gapAt(x)?.type === 'pines' ? 1.2 + hash2(hx * 3, jz) * 0.35 : 1;
    const hgt = 1.0 * s * big, rad = 0.3 * s * big;
    const sway = [hash2(hx + 1, jz) * TAU, 1.1 + hash2(hx, jz * 7) * 0.5, 0.04, y];
    putFlat(i++, x + SHX * hgt * 0.45, y + 0.012, z + SHZ * hgt * 0.45, SHX, SHZ, rad * 0.8 + hgt * 0.4, rad * 0.55, [0.05, 0.12, 0.1], 0.95);
    putStick(i++, x, y + hgt * 0.5, z, 0, 1, 0, hgt * 0.5, 0.02 * s, [0.28, 0.19, 0.12], 3);
    const W = 5;
    for (let k = 0; k < W; k++) {
      const f = k / W;
      const yy = y + hgt * (0.18 + 0.72 * f), r = rad * (1 - f * 0.82);
      const n = Math.max(4, 7 - k);
      const off = hash2(hx + k, jz) * TAU;
      for (let b = 0; b < n; b++) {
        const a = off + (b / n) * TAU + (hash2(b, k + hx) - 0.5) * 0.5;
        const dx = Math.cos(a), dz = Math.sin(a), droop = -0.35;
        const L2 = r * (0.8 + 0.3 * hash2(b + k, jz));
        // la cara de arriba de la rama recibe el sol; la punta, un verde más claro
        const c = tint(toon(RAMP.pine, lit(dx * 0.5, 0.85, dz * 0.5), hash2(k, b + hx)));
        putStick(i++, x + dx * L2 * 0.5, yy + droop * L2 * 0.5, z + dz * L2 * 0.5, dx, droop, dz, L2 * 0.55, 0.028 * s * big + r * 0.12, c, 3, 14, sway[0], sway[1], sway[2], sway[3]);
      }
    }
    putStick(i++, x, y + hgt * 0.97, z, 0, 1, 0, hgt * 0.08, 0.018, tint(RAMP.pine[3]), 3, 14, sway[0], sway[1], sway[2], sway[3]);
    return i;
  }
  // el árbol grande: tronco grueso, ramas largas y muchos racimos; sombra lobulada
  function bigTree(i, x, y, z) {
    const hgt = 2.2, R = 1.55;
    const bark = [0.33, 0.24, 0.16];
    putStick(i++, x, y + 0.45, z, 0, 1, 0, 0.45, 0.09, bark, 3);
    const clusters = [];
    for (let b = 0; b < 9; b++) {
      const a = b * 2.39996, reach = R * (0.35 + 0.55 * hash2(b, 3));
      const ey = y + hgt * (0.62 + 0.3 * hash2(b, 4)), ex = x + Math.cos(a) * reach, ez = z + Math.sin(a) * reach;
      putStick(i++, (x + ex) / 2, (y + 0.9 + ey) / 2, (z + ez) / 2, ex - x, ey - y - 0.9, ez - z, Math.hypot(ex - x, ey - y - 0.9, ez - z) / 2, 0.045, bark, 3);
      clusters.push([ex, ey, ez, 0.42 + 0.18 * hash2(b, 5)]);
      // racimos secundarios alrededor de cada punta
      for (let q = 0; q < 2; q++) {
        const qa = a + (q ? 0.7 : -0.7);
        clusters.push([ex + Math.cos(qa) * 0.35, ey - 0.12 + q * 0.2, ez + Math.sin(qa) * 0.35, 0.3 + 0.1 * hash2(b, q)]);
      }
    }
    clusters.push([x, y + hgt * 1.02, z, 0.55]);
    for (const [cx, cy, cz, cr] of clusters) putFlat(i++, cx + SHX * (cy - y) * 0.9, y + 0.015, cz + SHZ * (cy - y) * 0.9, SHX, SHZ, cr * 1.2, cr * 0.9, [0.08, 0.16, 0.1], 0.6);
    const sway = [0.4, 0.6, 0.012, y];
    clusters.forEach(([cx, cy, cz, cr], ci) => {
      for (let k = 0; k < 18; k++) {
        const yy = 1 - (k + 0.5) / 18 * 1.5, rr = Math.sqrt(Math.max(0, 1 - yy * yy)), b = k * 2.39996 + ci;
        const nx = Math.cos(b) * rr, nz = Math.sin(b) * rr;
        let mx = nx * 0.6 + (cx - x) / R * 0.5, my = yy * 0.7 + 0.45, mz = nz * 0.6 + (cz - z) / R * 0.5;
        const ml = Math.hypot(mx, my, mz); mx /= ml; my /= ml; mz /= ml;
        const jit = 0.8 + 0.3 * hash2(k, ci);
        put(i++, cx + nx * cr * jit, cy + yy * cr * 0.7 * jit, cz + nz * cr * jit, mx * 0.6, 0.8, mz * 0.6, cr * 0.28, cr * 0.1,
          toon(RAMP.broad, lit(mx, my, mz) * (yy < -0.2 ? 0.75 : 1), hash2(ci, k)), 3, 14, sway[0] + ci, sway[1], sway[2], sway[3]);
      }
    });
    return i;
  }
  // casa: paredes claras, techo a dos aguas, chimenea con humo (tipo 3: sube solo en la GPU)
  function house(i, end, x, hs) {
    const y = heightAt(x, hs.z);
    const { w, d, rot } = hs, h = 0.3, rh = 0.24;
    const c = Math.cos(rot), s = Math.sin(rot);
    const P = (lx, ly, lz) => [x + lx * c - lz * s, y + ly, hs.z + lx * s + lz * c];
    const N = (nx, ny, nz) => [nx * c - nz * s, ny, nx * s + nz * c];
    const step = 0.055;
    if (i + 320 >= end) return i;
    putFlat(i++, x + SHX * 0.3, y + 0.012, hs.z + SHZ * 0.3, SHX, SHZ, d * 0.9, w * 0.8, [0.06, 0.12, 0.08], 1.2);
    for (const [fx, fz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const len = fx ? d : w;
      for (let u = -len / 2 + step / 2; u < len / 2; u += step) for (let v = step / 2; v < h; v += step) {
        const p = P(fx ? fx * w / 2 : u, v, fz ? fz * d / 2 : u), n = N(fx, 0, fz);
        const l = lit(...n);
        const win = Math.abs(v - h * 0.55) < step * 0.6 && Math.abs(u) < len * 0.3 && Math.abs(u) > len * 0.08;
        const col = win ? [0.25, 0.3, 0.38] : mixc([0.78, 0.7, 0.58], [0.97, 0.93, 0.83], clamp(l + 0.3));
        put(i++, p[0], p[1], p[2], n[0], n[1], n[2], step * 0.75, 0.01, col, 3);
      }
    }
    for (const side of [-1, 1]) {
      const half = w / 2 + 0.07, nl = Math.hypot(rh, half);
      const n = N(side * rh / nl, half / nl, 0);
      const l = lit(...n);
      const col = mixc(hs.roof.map((v) => v * 0.62), hs.roof.map((v) => Math.min(1, v * 1.25)), clamp(l * 1.2));
      for (let u = 0; u < 1; u += 0.13) for (let v = -d / 2 - 0.07; v < d / 2 + 0.07; v += step) {
        const p = P(side * half * (1 - u), h + rh * u, v);
        put(i++, p[0], p[1], p[2], n[0], n[1], n[2], step * 0.85, 0.012, col.map((q) => q * (u > 0.85 ? 0.9 : 1)), 3);
      }
    }
    const ch = P(w * 0.22, h + rh * 0.9, d * 0.25);
    put(i++, ch[0], ch[1], ch[2], 0, 1, 0, 0.045, 0.06, [0.45, 0.3, 0.22], 3);
    if (hs.smoke) {
      // humo: puffs que suben y se agrandan (tipo 3 de Ink: sube en la GPU)
      for (let k = 0; k < 7; k++) put(i++, ch[0], ch[1] + 0.05, ch[2], 0, 1, 0, 0.05, 0.05, [0.93, 0.93, 0.95], 1.4, 3, k / 7, 0.18, 1.1, 2.4);
    }
    if (hs.dock) {
      for (let v = 0; v < 1.4; v += 0.06) put(i++, x + 0.9 + v * 0.55, 0.05, hs.z - 0.8 - v * 0.7, 0, 1, 0, 0.06, 0.01, [0.62, 0.48, 0.32], 3);
      for (let k = -2; k <= 2; k++) put(i++, x + 1.9 + k * 0.035, 0.03, hs.z - 1.9 + k * 0.05, 0, 1, 0, 0.06, 0.02, [0.85, 0.42, 0.26], 3);
    }
    return i;
  }

  // ───────────── agua ─────────────
  const ripples = [];
  function waterSplat(w, t, swell, glintAmt, first = false) {
    const dpt = w.depth;
    // orilla turquesa clara → centro azul
    let col = mixc([0.62, 0.84, 0.8], [0.29, 0.62, 0.72], smooth(0, 0.35, dpt));
    col = mixc(col, [0.13, 0.36, 0.55], smooth(0.35, 1, dpt));
    // reflejo del cielo en franjas que corren
    const wv = Math.sin(w.x * 2.4 + w.z * 1.2 - t * 1.3 + w.ph * 0.25) * 0.5 + Math.sin(w.x * 0.9 - w.z * 2.6 + t * 0.9) * 0.5;
    let k = 1 + wv * 0.07 + swell;
    let e = 0;
    for (const rp of ripples) {
      const age = t - rp.t0;
      if (age < 0) continue;
      const dd = Math.hypot(w.x - rp.x, w.z - rp.z) - age * rp.speed;
      const band = Math.exp(-dd * dd * 30) * Math.exp(-age * 1.1) * rp.amp;
      if (band > 0.01) { k += band * 0.25; e += band * 0.35; }
    }
    const gl = w.glint > 0.84 ? glintAmt * 0.7 : 0;
    if (w.stream) {
      // arroyo: más claro y con reflejos que bajan con la corriente
      col = mixc(col, [0.5, 0.74, 0.74], 0.35);
      const flow = Math.sin(w.z * 4.2 - t * 2.4 + w.ph * 0.4 + Math.sin(w.x * 3) * 0.8);
      if (flow > 0.78) e += (flow - 0.78) * 0.9;
    }
    if (first) {
      // cada splat de agua es una pincelada alargada: con la corriente en el arroyo, con el viento en los lagos
      putFlat(w.i, w.x, 0, w.z, w.fx, w.fz, w.stream ? 0.34 : 0.32, w.stream ? 0.17 : 0.19, col, 2.6);
      const o = w.i * 16;
      D[o + 11] = w.glint > 0.72 ? 4 : 0; D[o + 12] = w.ph; D[o + 13] = 1 + w.glint * 2;
    } else D[w.i * 16 + 7] = pack(col[0] * k + e + gl, col[1] * k + e + gl, col[2] * k + e + gl * 0.9);
  }

  // ───────────── cámara y tramos ─────────────
  const cam = { x: L.cols[0].x + 4, dist: 34, zoom: 1, userX: 0, dip: 0, speed: 0.36 };
  const tune = { pitch: 0.9, fov: 0.5, z: ZM + 0.8 };
  let camM = null;
  function ensureChunks() {
    const c0 = Math.floor((cam.x + cam.userX) / CH) - Math.floor(NSLOT / 2);
    const want = new Set();
    for (let k = 0; k < NSLOT; k++) want.add(c0 + k);
    const changed = [];
    const have = new Set(slots.map((s) => s.chunk));
    const free = slots.map((s, i) => (want.has(s.chunk) ? -1 : i)).filter((i) => i >= 0);
    for (const c of want) {
      if (have.has(c)) continue;
      const slot = free.shift();
      buildChunk(slot, c);
      changed.push(...rowSpan(slotStart[slot], slotStart[slot] + CAP));
    }
    return changed;
  }

  // ───────────── partículas ─────────────
  let pc = 0, prevPc = PMAX;
  function particle(x, y, z, sx, sy, sz, c, a, em, kind = 0, ph = 0, sp = 0, rg = 0, ex = 0) {
    if (pc >= PMAX) return;
    const o = (pStart + pc++) * 16;
    D[o] = x; D[o + 1] = y; D[o + 2] = z; D[o + 3] = a;
    D[o + 4] = sx * sx; D[o + 5] = 0; D[o + 6] = 0; D[o + 7] = pack(c[0], c[1], c[2]);
    D[o + 8] = sy * sy; D[o + 9] = 0; D[o + 10] = sz * sz; D[o + 11] = kind + (em ? 32 : 0);
    D[o + 12] = ph; D[o + 13] = sp; D[o + 14] = rg; D[o + 15] = ex;
  }
  function particleFlat(x, y, z, ux, uz, a, b, c, alpha) {
    if (pc >= PMAX) return;
    putFlat(pStart + pc++, x, y, z, ux, uz, a, b, c, alpha);
  }
  function clearParticles() { for (let i = pc; i < prevPc; i++) hide(pStart + i); }

  // cúmulos: racimos de bultos chicos, blancos arriba y lavanda abajo
  function makeCloud(seed, x) {
    const lobes = [];
    const n = 6 + Math.floor(hash2(seed, 1) * 5);
    const len = 2.2 + hash2(seed, 2) * 2.4;
    for (let k = 0; k < n; k++) {
      const f = k / (n - 1) - 0.5;
      lobes.push({ x: f * len + (hash2(seed, k + 3) - 0.5) * 0.6, z: (hash2(seed, k + 20) - 0.5) * 1.2, y: (1 - 4 * f * f) * 0.45 + hash2(seed, k + 40) * 0.2, r: 0.45 + (1 - Math.abs(f) * 1.4) * 0.5 * hash2(seed, k + 60) + 0.15 });
    }
    // la mitad pasa por la franja de arriba, la otra por la de abajo; muy de vez en cuando por el centro
    const band = hash2(seed, 99);
    const z = band < 0.45 ? Z0 + 1 + hash2(seed, 98) * 4 : band < 0.9 ? H + 1.5 + hash2(seed, 97) * 4 : ZM + (hash2(seed, 96) - 0.5) * 6;
    return { x, z, y: 5.2 + hash2(seed, 95) * 1.3, lobes, seed, v: 0.12 + hash2(seed, 94) * 0.1 };
  }

  const st = {
    t: 0,
    glow: new Map(), // offset → {v, kind}
    active: new Map(), // offset → kind (lo que suena ahora)
    flies: [],
    birds: [],
    leaves: [],
    pollen: [],
    clouds: [],
    cloudSeed: 1,
    pad: 0, drone: 0, glint: 0, swell: 0,
    boxes: [],
  };
  for (let k = 0; k < 3; k++) st.clouds.push(makeCloud(st.cloudSeed++, cam.x - 10 + k * 15));

  let locShift = 0;
  const nearestCopy = (x) => x + Math.round((cam.x + cam.userX - x) / PER) * PER;
  function centerOf(loc) {
    if (!loc) return null;
    const rs = L.rects(loc.start - locShift, loc.end - locShift);
    if (!rs.length) return null;
    const r = rs[0];
    return [nearestCopy((r.x0 + r.x1) / 2), (r.z0 + r.z1) / 2];
  }

  function spawn(ev) {
    const c = centerOf(ev.loc);
    const a = ev.amp, t = st.t;
    const flies = (n, color, rise, kind) => {
      if (!c) return;
      for (let k = 0; k < n; k++) st.flies.push({ x: c[0] + (Math.random() - 0.5) * 0.5, z: c[1] + (Math.random() - 0.5) * 0.3, t0: t, ph: Math.random() * TAU, col: color, rise, kind, life: 3 + Math.random() * 2 });
    };
    switch (ev.kind) {
      case 'melody': if (ev.echo <= 1) flies(ev.echo ? 1 : 3, [1, 0.95, 0.62], 0.55, 'fly'); break;
      case 'arp': if (!ev.echo) flies(2, [0.75, 1, 0.82], 0.4, 'fly'); waterRipple(c, 0.6, 0.7 * a); break;
      case 'pad': st.pad = Math.min(1, st.pad + 0.4 * a); break;
      case 'drone': st.drone = Math.min(1, st.drone + 0.6 * a); break;
      case 'cloud': st.glint = Math.min(1.2, st.glint + 0.8 * a); break;
      case 'sonar': waterRipple(c, 1.1, (ev.echo ? 0.5 : 1) * (0.5 + 0.5 * a), true); break;
      case 'sparks':
        if (!ev.echo && c) launchBirds(c[0], c[1], 2 + Math.floor(Math.random() * 3));
        else flies(1, [1, 0.75, 0.82], 0.25, 'petal');
        break;
      case 'breath':
        for (let k = 0; k < 8 * a + 4; k++) st.leaves.push({ x: cam.x + cam.userX - 16 + Math.random() * 5, z: Z0 + 2 + Math.random() * (H + 8), y: 1.2 + Math.random() * 0.8, t0: t, ph: Math.random() * TAU, v: 2 + Math.random() * 1.4 });
        break;
      case 'dust':
        if (c) for (let k = 0; k < 2; k++) st.pollen.push({ x: c[0] + (Math.random() - 0.5) * 2, z: c[1] + (Math.random() - 0.5) * 2, t0: t });
        break;
      case 'sub': st.swell = 1; cam.dip = 1; waterRipple(null, 2.2, 0.8, true); break;
    }
  }
  // ondas: en el agua bajo el token, o en el agua más cercana a la vista
  function waterRipple(c, speed, amp, nearest = false) {
    let x = c ? c[0] : cam.x + cam.userX, z = c ? c[1] : ZM;
    if (water(x, z) <= 0) {
      if (!nearest) return;
      let best = null;
      for (const S of slots) for (let k = 0; k < S.water.length; k += 23) {
        const w = S.water[k];
        const d = Math.hypot(w.x - x, w.z - z);
        if (w.depth > 0.3 && (!best || d < best.d)) best = { x: w.x, z: w.z, d };
      }
      if (!best || best.d > 18) return;
      x = best.x; z = best.z;
    }
    ripples.push({ x, z, t0: st.t, speed, amp });
    if (ripples.length > 20) ripples.shift();
  }
  function launchBirds(x, z, n) {
    for (let k = 0; k < n && st.birds.length < 24; k++) {
      const a = -0.5 + (Math.random() - 0.5) * 1.2;
      st.birds.push({ x: x + (Math.random() - 0.5) * 0.4, z: z + (Math.random() - 0.5) * 0.4, y: 0.6, vx: Math.cos(a) * 1.2, vz: Math.sin(a) * 0.8, vy: 0.45, ph: Math.random() * TAU, t0: st.t });
    }
  }

  // lo que suena: offsets activos (con su capa) y rectángulos para los faroles
  function setActive(ranges) {
    st.active.clear();
    st.boxes = [];
    for (const r of ranges) {
      for (let o = r.start - locShift; o < r.end - locShift; o++) st.active.set(o, r.kind);
      for (const rc of L.rects(r.start - locShift, r.end - locShift)) st.boxes.push({ ...rc, kind: r.kind });
    }
  }

  // ───────────── cuadro ─────────────
  let last = performance.now() / 1000;
  let waterTick = 0;
  function frame(width, height) {
    const nowS = performance.now() / 1000;
    const dt = Math.min(0.05, nowS - last);
    last = nowS;
    st.t += dt;
    const t = st.t;

    cam.x += dt * cam.speed;
    cam.userX *= Math.pow(0.5, dt * 0.08);
    if (cam.x > PER * 2) {
      cam.x -= PER;
      for (const s of slots) s.chunk = null;
      for (const c of st.clouds) c.x -= PER;
    }
    const rows = new Set(ensureChunks());
    const cx = cam.x + cam.userX;
    cam.dip *= Math.pow(0.15, dt);

    st.pad *= Math.pow(0.75, dt);
    st.drone *= Math.pow(0.8, dt);
    st.glint *= Math.pow(0.3, dt);
    st.swell *= Math.pow(0.2, dt);
    for (let i = ripples.length - 1; i >= 0; i--) if (t - ripples[i].t0 > 4) ripples.splice(i, 1);

    // letras que suenan: florecen (más brillo, color de su capa) y se apagan despacio
    for (const [off, kind] of st.active) {
      const g = st.glow.get(off);
      if (g) g.kind = kind;
      else if (charSplats.has(off)) st.glow.set(off, { v: 0, kind });
    }
    for (const [off, g] of st.glow) {
      const on = st.active.has(off);
      g.v = on ? Math.min(1, g.v + dt * 9) : g.v * Math.pow(0.04, dt);
      const list = charSplats.get(off);
      if (!list) { st.glow.delete(off); continue; }
      const kc = BLOOM[g.kind] || [1, 1, 1];
      for (const { i0, i1 } of list) {
        for (let i = i0; i < i1; i++) {
          const o = i * 16;
          if (g.v < 0.01) { D[o + 7] = basePack[i]; D[o + 11] = 0; continue; }
          const c = mixc(unpack(basePack[i]), kc, g.v);
          const k = 1 + 0.4 * g.v;
          D[o + 7] = pack(c[0] * k, c[1] * k, c[2] * k);
          D[o + 11] = g.v > 0.25 ? 32 : 0;
        }
        rows.add(rowOf(i0)); rows.add(rowOf(i1 - 1));
      }
      if (g.v < 0.01) st.glow.delete(off);
    }

    // agua
    const swell = st.swell * 0.2 * Math.sin(t * 3);
    for (const S of slots) {
      if (S.chunk === null || Math.abs(S.chunk * CH + CH / 2 - cx) > 26) continue;
      for (const w of S.water) waterSplat(w, t, swell, st.glint);
    }

    // ── partículas ──
    pc = 0;
    // faroles alrededor de lo que suena: el recuadro de Strudel, hecho de lucecitas sobre el prado
    for (const b of st.boxes) {
      const sx = nearestCopy((b.x0 + b.x1) / 2) - (b.x0 + b.x1) / 2;
      if (Math.abs(b.x0 + sx - cx) > 24) continue;
      const kc = mixc(BLOOM[b.kind] || [1, 1, 1], [1, 1, 1], 0.25);
      const x0 = b.x0 + sx - 0.05, x1 = b.x1 + sx + 0.02, z0 = b.z0 - 0.02, z1 = b.z1 - 0.12;
      const y = heightAt((x0 + x1) / 2, (z0 + z1) / 2) + 0.06;
      const step = 0.1;
      const edge = (ax, az, bx, bz) => {
        const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step));
        for (let k = 0; k < n; k++) particle(lerp(ax, bx, k / n), y, lerp(az, bz, k / n), 0.034, 0.03, 0.034, kc, 3, true);
      };
      edge(x0, z0, x1, z0); edge(x1, z0, x1, z1); edge(x1, z1, x0, z1); edge(x0, z1, x0, z0);
      // resplandor en el pasto, debajo de la letra
      const gc = BLOOM[b.kind] || [1, 1, 1];
      particleFlat((x0 + x1) / 2, y - 0.04, (z0 + z1) / 2, 1, 0, (x1 - x0) * 0.6 + 0.08, 0.2, [gc[0] * 0.9, gc[1] * 0.9, gc[2] * 0.7], 0.55);
      D[(pStart + pc - 1) * 16 + 11] = 32;
    }
    // luciérnagas y pétalos
    st.flies = st.flies.filter((f) => t - f.t0 < f.life);
    for (const f of st.flies) {
      const age = t - f.t0;
      const fade = smooth(0, 0.3, age) * (1 - smooth(f.life - 1, f.life, age));
      const x = f.x + Math.sin(age * 1.3 + f.ph) * 0.35 + age * 0.08, z = f.z + Math.cos(age * 1.1 + f.ph) * 0.25;
      if (f.kind === 'petal') {
        particle(x + age * 0.3, 0.3 + age * f.rise + Math.sin(age * 4 + f.ph) * 0.08, z, 0.03, 0.01, 0.022, f.col, 3 * fade, false);
      } else {
        const blink = 0.55 + 0.45 * Math.sin(age * 5 + f.ph);
        particle(x, 0.25 + age * f.rise, z, 0.03, 0.03, 0.03, f.col, 3 * fade * blink, true);
      }
    }
    // aves
    st.birds = st.birds.filter((b) => t - b.t0 < 12);
    for (const b of st.birds) {
      const age = t - b.t0;
      b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt; b.vy = lerp(b.vy, 0.06, dt * 0.5);
      const fl = Math.sin(t * 13 + b.ph);
      const s = Math.min(1, age * 2) * (1 - smooth(10, 12, age));
      const px = -b.vz, pz = b.vx, pl = Math.hypot(px, pz) || 1;
      particle(b.x, b.y, b.z, 0.04 * s, 0.025 * s, 0.04 * s, [0.96, 0.95, 0.9], 3, false);
      for (const sd of [-1, 1]) particle(b.x + px / pl * 0.07 * sd * s, b.y + fl * 0.04, b.z + pz / pl * 0.07 * sd * s, 0.055 * s, 0.012, 0.03 * s, [0.9, 0.9, 0.86], 3, false);
      const gy = Math.max(0.05, heightAt(b.x, b.z)) + 0.02;
      particleFlat(b.x + SHX * (b.y - gy), gy, b.z + SHZ * (b.y - gy), b.vx, b.vz, 0.08 * s, 0.05 * s, [0.05, 0.1, 0.07], 0.8 * s);
    }
    // hojas de la ráfaga
    st.leaves = st.leaves.filter((l) => t - l.t0 < 8);
    for (const l of st.leaves) {
      const age = t - l.t0;
      const x = l.x + age * l.v, z = l.z + Math.sin(age * 2 + l.ph) * 0.4, y = l.y + Math.sin(age * 3.1 + l.ph) * 0.15 - age * 0.06;
      const f = smooth(0, 0.5, age) * (1 - smooth(6.5, 8, age));
      particle(x, y, z, 0.035, 0.01, 0.025, [0.62, 0.74, 0.3], 2.4 * f, false);
    }
    // polen
    st.pollen = st.pollen.filter((p) => t - p.t0 < 3);
    for (const p of st.pollen) {
      const age = t - p.t0, f = Math.sin(Math.PI * clamp(age / 3));
      particle(p.x + Math.sin(age + p.z) * 0.2, 0.6 + age * 0.25, p.z, 0.022, 0.022, 0.022, [1, 1, 0.85], 2.4 * f, true, 1, p.x * 3, 9, 0, 0);
    }
    // COLCHÓN: destellos de sol sobre las copas
    if (st.pad > 0.05) {
      for (let k = 0; k < 40; k++) {
        const x = cx + (hash2(k, 71) - 0.5) * 30, z = Z0 + 2 + hash2(k, 72) * (H + 10);
        particle(x, 1.15, z, 0.03, 0.02, 0.03, [1, 0.97, 0.8], 2.6 * st.pad, true, 1, k * 1.7, 2 + hash2(k, 3) * 2, 0, 0);
      }
    }
    // cúmulos y su sombra (el DRONE los vuelve más grises)
    for (const c of st.clouds) c.x += dt * c.v;
    st.clouds = st.clouds.filter((c) => c.x > cx - 30);
    while (st.clouds.length < 3) {
      const far = Math.max(cx + 22, ...st.clouds.map((c) => c.x + 9));
      st.clouds.push(makeCloud(st.cloudSeed++, far + hash2(st.cloudSeed, 7) * 6));
    }
    const shade = st.drone * 0.25;
    for (const c of st.clouds) {
      // Nube deshilachada: un núcleo chato de bultos chicos y jirones largos que se estiran
      // con el viento (a lo largo de x), translúcidos en los bordes. La sombra también se estira.
      c.lobes.forEach((lb, li) => {
        const bx = c.x + lb.x, bz = c.z + lb.z, by = c.y + lb.y * 0.6;
        particleFlat(bx + SHX * by, 1.05, bz + SHZ * by, 1, 0.15, lb.r * 1.6, lb.r * 0.75, [0.1, 0.22, 0.2], 0.16 + 0.1 * st.drone);
        // núcleo: bultos chicos, más chatos que altos
        const n = 12;
        for (let k = 0; k < n; k++) {
          const yy = 1 - (k + 0.5) / n * 1.4;
          const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
          const a = k * 2.39996 + c.seed + li;
          const nx = Math.cos(a) * rr, nz = Math.sin(a) * rr;
          const l = lit(nx, yy, nz);
          // sombra de la panza muy suave: si contrasta, se ven bolas grises
          const col = l > 0.5 ? [1, 0.99, 0.97] : l > 0.1 ? [0.95, 0.96, 0.97] : [0.89, 0.9, 0.93];
          const r = lb.r * (0.22 + 0.12 * hash2(k, c.seed + li));
          particle(bx + nx * lb.r * 0.7, by + yy * lb.r * 0.32, bz + nz * lb.r * 0.55, r * 1.3, r * 0.6, r, mixc(col, [0.72, 0.74, 0.8], shade), yy < -0.2 ? 1.1 : rr > 0.85 ? 1.3 : 2, false);
        }
        // jirones: hebras largas y finas que se desprenden hacia atrás y hacia los costados
        for (let k = 0; k < 5; k++) {
          const q = hash2(k + li * 7, c.seed);
          const ox = (q - 0.3) * lb.r * 2.2, oz = (hash2(c.seed, k + li) - 0.5) * lb.r * 1.4, oy = (hash2(k, li + c.seed) - 0.6) * lb.r * 0.5;
          const len = lb.r * (0.7 + 0.8 * hash2(li, k + c.seed));
          const col = oy > 0 ? [0.98, 0.98, 0.99] : [0.86, 0.87, 0.91];
          particle(bx + ox, by + oy, bz + oz, len, lb.r * 0.07, lb.r * 0.16, mixc(col, [0.7, 0.72, 0.8], shade), 0.9 + 0.5 * hash2(k, li), false);
        }
      });
    }
    clearParticles();
    const used = Math.max(pc, prevPc);
    prevPc = pc;

    if (waterTick++ % 2 === 0) for (const r of rowsWater) rows.add(r);
    if (used > 0) for (const r of rowSpan(pStart, pStart + used)) rows.add(r);

    const opts = {
      width,
      height,
      time: t,
      changedRows: [...rows],
      camera: { target: [cx, 0, tune.z], dist: cam.dist * cam.zoom - cam.dip * 0.8, yaw: Math.sin(t * 0.03) * 0.012, pitch: tune.pitch, fov: tune.fov },
      damp: false,
    };
    renderer.render(world, opts);
    camM = makeCamera(world, { ...opts, changedRows: [] }, width, height);
  }

  function pickPlane(u, v, y = 0.1) {
    if (!camM) return null;
    const inv = inv4(mul4(camM.projection, camM.view));
    const nx = u * 2 - 1, ny = 1 - v * 2;
    const a = xform(inv, nx, ny, -1, 1), b = xform(inv, nx, ny, 1, 1);
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    if (Math.abs(d[1]) < 1e-6) return null;
    const k = (y - a[1]) / d[1];
    return [a[0] + d[0] * k, a[2] + d[2] * k];
  }

  return {
    frame,
    spawn,
    setActive,
    pickPlane,
    wrapX,
    PER,
    st,
    cam,
    tune,
    world,
    setLocShift(s) { locShift = s; },
    pan(dx) { cam.userX -= dx * 0.02 * cam.zoom; },
    zoom(f) { cam.zoom = clamp(cam.zoom * f, 0.55, 1.6); },
    view: () => ({ x: cam.x + cam.userX }),
    counts: () => ({ total: world.count, per: PER, slots: slots.map((s) => [s.chunk, s.used, s.water.length]), houses: houses.length }),
  };
}
