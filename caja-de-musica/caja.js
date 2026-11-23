/*
 * CAJA DE MÚSICA — escena con Ink Studio (splats gaussianos, WebGL2).
 *
 * Un mecanismo de caja de música sobre una mesa de madera, en una foto macro con luz de
 * lámpara. Cada capa de la composición es un cilindro con púas:
 *
 *   · cada línea de la mini-notación es un ciclo (una vuelta de 1/N del cilindro);
 *   · cada nota es una púa: su ángulo sale de en qué momento del ciclo suena (la
 *     mini-notación se subdivide como en Strudel: [a b c d] → cuartos, ~ [b5 e6] ~ ~ →
 *     la segunda negra partida en dos), y su lugar a lo largo del cilindro, de qué nota es;
 *   · frente al cilindro, un peine con un diente por nota distinta: los graves más largos.
 *
 * Los cilindros giran con el reloj de Strudel: una púa pasa por su diente justo cuando
 * suena. Lo que está sonando (los rangos activos de Strudel) enciende la púa y hace vibrar
 * el diente. No hay texto: el código está en el mecanismo.
 */
import { createRenderer } from './vendor/ink/webgl.mjs';
import { makeCamera } from './vendor/ink/src/webgl/view.mjs';

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const pack = (r, g, b) => (clamp(r) * 255 | 0) + (clamp(g) * 255 | 0) * 256 + (clamp(b) * 255 | 0) * 65536;
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const norm3 = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// materiales por capa: [color base, color del brillo]
const METAL = {
  melody: [[0.78, 0.6, 0.28], [1, 0.92, 0.66]], // bronce
  arp: [[0.72, 0.4, 0.24], [1, 0.8, 0.62]], // cobre
  pad: [[0.62, 0.66, 0.72], [0.95, 0.97, 1]], // plata
  drone: [[0.26, 0.26, 0.28], [0.7, 0.72, 0.78]], // hierro
  cloud: [[0.62, 0.8, 0.86], [0.95, 1, 1]], // vidrio
  sonar: [[0.5, 0.56, 0.6], [0.9, 0.95, 0.98]], // acero
  sparks: [[0.86, 0.7, 0.3], [1, 0.96, 0.7]], // oro
  breath: [[0.46, 0.32, 0.2], [0.8, 0.64, 0.46]], // madera
  dust: [[0.8, 0.82, 0.86], [1, 1, 1]], // cristal
  sub: [[0.16, 0.12, 0.12], [0.6, 0.3, 0.26]], // laca negra con rojo
};
const GLOW = {
  melody: [1, 0.78, 0.3], arp: [1, 0.55, 0.32], pad: [0.62, 0.72, 1], drone: [1, 0.6, 0.25], cloud: [0.6, 1, 0.95],
  sonar: [0.45, 0.95, 1], sparks: [1, 0.9, 0.4], breath: [0.9, 0.95, 0.7], dust: [0.9, 0.95, 1], sub: [1, 0.35, 0.3],
};
const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const midiOf = (t) => {
  const m = /^([a-g])([#bs]*)(-?\d+)$/i.exec(t);
  if (!m) return 60;
  let pc = PC[m[1].toLowerCase()];
  for (const ch of m[2]) pc += ch === 'b' ? -1 : 1;
  return (parseInt(m[3], 10) + 1) * 12 + pc;
};

// Tiempos de la mini-notación de una línea: secuencia separada por espacios, [..] subdivide.
// Ej.: "[e5 f#5 b4 e5]" → 0, ¼, ½, ¾ · "~ [b5 e6] ~ ~" → ~ en 0, b5 en ¼, e6 en ⅜, …
function barTimes(row) {
  let k = 0;
  const TOK = /[A-Za-z0-9#.\-~]/;
  function parseSeq(close) {
    const items = [];
    while (k < row.length) {
      const ch = row[k].ch;
      if (ch === close) { k++; return items; }
      if (ch === '[') { k++; items.push({ group: parseSeq(']') }); continue; }
      if (TOK.test(ch)) {
        const c0 = k;
        while (k < row.length && TOK.test(row[k].ch)) k++;
        items.push({ cells: row.slice(c0, k) });
        continue;
      }
      k++;
    }
    return items;
  }
  const out = [];
  (function walk(items, t0, dur) {
    const n = items.length || 1;
    items.forEach((it, i) => {
      const a = t0 + (i / n) * dur;
      if (it.group) walk(it.group, a, dur / n);
      else out.push({ t: a, cells: it.cells });
    });
  })(parseSeq(null), 0, 1);
  return out;
}

export function createCaja(canvas, layout, kindColor) {
  const L = layout;
  // ───────────── de la partitura al mecanismo ─────────────
  const drums = [];
  for (const col of L.cols) {
    if (!col.kind) continue;
    const bars = [];
    col.cells.forEach((row) => {
      // una línea es un ciclo si tiene notas, silencios o palabras dentro de la mini-notación
      if (!row.some((c) => (c.k === 2 && c.ch.trim()) || c.ch === '~')) return; // (los espacios dentro de la mini-notación no cuentan)
      const inner = row.filter((c) => c.k === 2 || /[\[\]~ ]/.test(c.ch));
      const ev = barTimes(inner).filter((e) => e.cells.length && e.cells[0].ch !== '~');
      bars.push(ev.map((e) => ({ t: e.t, text: e.cells.map((c) => c.ch).join(''), off0: e.cells[0].off, off1: e.cells[e.cells.length - 1].off + 1 })));
    });
    if (!bars.length) continue;
    const pins = [];
    bars.forEach((evs, b) => evs.forEach((e) => {
      const isNote = /^[a-g][#bs]*-?\d+$/i.test(e.text);
      pins.push({ bar: b, t: e.t, midi: isNote ? midiOf(e.text) : 0, off0: e.off0, off1: e.off1, word: !isNote });
    }));
    if (!pins.length) continue;
    const pitches = [...new Set(pins.map((p) => p.midi))].sort((a, b) => a - b);
    drums.push({ kind: col.kind, label: col.label, N: bars.length, pins, pitches });
  }

  // ───────────── geometría del conjunto ─────────────
  // los cilindros en un arco suave, de frente a la cámara
  const GAP = 0.55;
  drums.forEach((d) => {
    d.r = clamp(0.14 + d.N * 0.022, 0.2, 0.52);
    d.len = Math.max(0.55, d.pitches.length * 0.1 + 0.25);
  });
  let xx = 0;
  drums.forEach((d) => { d.cx = xx + d.len / 2; xx += d.len + GAP; });
  const total = xx - GAP;
  drums.forEach((d) => {
    d.cx -= total / 2;
    const beta = -d.cx * 0.06; // el arco: los de los costados giran hacia el centro
    d.A = [Math.cos(beta), 0, -Math.sin(beta)];
    d.O = [Math.sin(beta), 0, Math.cos(beta)];
    d.U = [0, 1, 0];
    d.cz = 0.03 * d.cx * d.cx;
    d.cy = d.r + 0.2;
    d.center = [d.cx, d.cy, d.cz];
    d.axial = (m) => {
      const k = d.pitches.indexOf(m), n = d.pitches.length;
      return n === 1 ? 0 : lerp(-d.len / 2 + 0.12, d.len / 2 - 0.12, k / (n - 1));
    };
  });
  const LIGHT = norm3([-0.45, 0.82, 0.5]);
  const VIEW = norm3([0.1, 0.35, 1]);
  const HALF = norm3([LIGHT[0] + VIEW[0], LIGHT[1] + VIEW[1], LIGHT[2] + VIEW[2]]);
  const shadeMetal = (n, base, hi) => {
    const dif = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
    const sp = Math.pow(Math.max(0, n[0] * HALF[0] + n[1] * HALF[1] + n[2] * HALF[2]), 24);
    const k = 0.28 + 0.75 * dif;
    return [base[0] * k + hi[0] * sp * 0.9, base[1] * k + hi[1] * sp * 0.9, base[2] * k + hi[2] * sp * 0.9];
  };
  const shadeMatte = (n, c) => { const l = 0.35 + 0.7 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]); return [c[0] * l, c[1] * l, c[2] * l]; };

  // ───────────── reserva de splats ─────────────
  const PAL = [0x120c08, 0x2a1a10, 0x4a2e1a, 0x6e4626, 0x98642f, 0xc8955a, 0xe8c48a, 0xf6e2b8, 0xfff6e0, 0x3a3e46, 0x7a8290, 0xc4ccd8, 0x5a7a88, 0xa6d8e0, 0x6a1c18, 0xb04030];
  const B = makeBuilder(9, PAL);
  const placeholder = (n) => { const s = B.count(); for (let i = 0; i < n; i++) B.disc(0, -500, 0, [0, 1, 0], 0.05, 0.05, [0, 0, 0], 3); return s; };
  const STATIC = 26000, DYN = 26000, PMAX = 2500;
  const sStart = placeholder(STATIC);
  const dStart = placeholder(DYN);
  const pStart = placeholder(PMAX);
  const world = B.finish({ cam: { target: [0, 0.5, 0], dist: 6, yaw: 0, pitch: 0.3, sway: 0 }, detail: 30, dither: 0.4, radius: 40, look: { pixel: false, outline: false, clean: false } });
  const D = world.data;
  const renderer = createRenderer(canvas, { toolkit: { KIT, PixelLook } });
  const rowOf = (i) => Math.floor(i / 512);
  const rowSpan = (a, b) => { const r = []; for (let q = rowOf(a); q <= rowOf(b - 1); q++) r.push(q); return r; };

  function put(i, x, y, z, nx, ny, nz, st, sn, c, a, kind = 0) {
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const o = i * 16, s2 = st * st, d = sn * sn - s2;
    D[o] = x; D[o + 1] = y; D[o + 2] = z; D[o + 3] = a;
    D[o + 4] = s2 + d * nx * nx; D[o + 5] = d * nx * ny; D[o + 6] = d * nx * nz;
    D[o + 7] = pack(c[0], c[1], c[2]);
    D[o + 8] = s2 + d * ny * ny; D[o + 9] = d * ny * nz; D[o + 10] = s2 + d * nz * nz;
    D[o + 11] = kind; D[o + 12] = D[o + 13] = D[o + 14] = D[o + 15] = 0;
  }
  // splat alargado a lo largo de (dx, dy, dz): media longitud sl, media anchura sw
  const putStick = (i, x, y, z, dx, dy, dz, sl, sw, c, a, kind = 0) => put(i, x, y, z, dx, dy, dz, sw, sl, c, a, kind);
  const hide = (i) => { const o = i * 16; D[o + 1] = -500; D[o + 3] = 0; D[o + 11] = 0; };

  // ───────────── lo fijo: mesa, fondo, soportes ─────────────
  let si = sStart;
  const sEnd = sStart + STATIC;
  const S = (fn) => { if (si < sEnd) fn(si++); };
  {
    // mesa: tablones de nogal, con veta
    const X0 = -total / 2 - 2.2, X1 = total / 2 + 2.2;
    for (let z = -1.6; z < 2.6; z += 0.06) for (let x = X0; x < X1; x += 0.06) {
      const plank = Math.floor((z + 1.6) / 0.42);
      const grain = Math.sin(x * 7 + Math.sin(z * 9 + plank * 3) * 1.6 + plank * 11) * 0.5 + 0.5;
      const seam = ((z + 1.6) % 0.42) < 0.02;
      let c = mixc([0.24, 0.14, 0.08], [0.34, 0.21, 0.12], grain * 0.7 + hash2(plank, 3) * 0.3);
      if (seam) c = [0.1, 0.06, 0.04];
      // luz de la lámpara: un charco cálido en el centro de la mesa
      const pool = Math.exp(-((x * 0.18) ** 2 + ((z - 0.4) * 0.45) ** 2));
      c = c.map((q, k) => q * (0.45 + 0.85 * pool) + [0.06, 0.035, 0.01][k] * pool);
      S((i) => put(i, x + (hash2(Math.round(x * 50), Math.round(z * 50)) - 0.5) * 0.02, 0, z, 0, 1, 0, 0.042, 0.01, c, 3));
    }
    // panel del fondo de la caja, con un filete de bronce
    for (let y = 0; y < 1.9; y += 0.06) for (let x = X0; x < X1; x += 0.06) {
      const pool = Math.exp(-((x * 0.2) ** 2 + ((y - 0.7) * 0.6) ** 2));
      let c = mixc([0.12, 0.07, 0.05], [0.2, 0.12, 0.07], Math.sin(y * 11 + Math.sin(x * 2) * 2) * 0.5 + 0.5);
      if (Math.abs(y - 1.5) < 0.025) c = [0.55, 0.42, 0.2];
      c = c.map((q) => q * (0.5 + 0.8 * pool));
      S((i) => put(i, x, y, -1.6, 0, 0, 1, 0.042, 0.01, c, 3));
    }
    // por cilindro: base, dos soportes y el bloque del peine
    for (const d of drums) {
      const [cx, cy, cz] = d.center;
      const at = (a, o, u) => [cx + d.A[0] * a + d.O[0] * o, cy + u, cz + d.A[2] * a + d.O[2] * o];
      const wood = [0.36, 0.22, 0.12];
      // base: una tabla
      for (let a = -d.len / 2 - 0.12; a <= d.len / 2 + 0.12; a += 0.05) for (let o = -d.r - 0.1; o <= d.r + 0.45; o += 0.05) {
        const p = at(a, o, -cy + 0.04);
        S((i) => put(i, p[0], p[1], p[2], 0, 1, 0, 0.034, 0.01, shadeMatte([0, 1, 0], wood.map((q) => q * (0.9 + 0.2 * hash2(Math.round(a * 20), Math.round(o * 20))))), 3));
      }
      // soportes: dos placas a los costados del eje
      for (const sd of [-1, 1]) {
        for (let u = -cy + 0.05; u < 0.05; u += 0.035) for (let o = -0.07; o <= 0.07; o += 0.035) {
          const p = at(sd * (d.len / 2 + 0.07), o, u);
          S((i) => put(i, p[0], p[1], p[2], d.A[0] * sd, 0, d.A[2] * sd, 0.026, 0.008, shadeMetal([d.A[0] * sd, 0, d.A[2] * sd], [0.5, 0.4, 0.24], [1, 0.9, 0.6]), 3));
        }
      }
      // bloque del peine
      for (let a = -d.len / 2 + 0.03; a <= d.len / 2 - 0.03; a += 0.04) for (let u = -0.12; u <= -0.02; u += 0.04) {
        const p = at(a, d.r + 0.42, u);
        S((i) => put(i, p[0], p[1], p[2], d.O[0], 0, d.O[2], 0.03, 0.01, shadeMetal(d.O, [0.42, 0.36, 0.3], [0.9, 0.85, 0.75]), 3));
      }
    }
  }
  for (let i = si; i < sEnd; i++) hide(i);

  // ───────────── lo que gira: cilindros, púas, engranajes, dientes ─────────────
  // cada splat dinámico: dueño (cilindro), tipo, coordenadas locales
  const dyn = [];
  const pinIndex = new Map(); // offset del código → [{drum, pin}]
  for (const d of drums) {
    const met = METAL[d.kind] || METAL.melody;
    d.splats = [];
    // superficie del cilindro: duelas a lo largo del eje (un cilindro torneado, no escamas),
    // en dos tramos para que la luz se lea, y tres ranuras grabadas alrededor
    const step = 0.045;
    const around = Math.max(20, Math.round((TAU * d.r) / step));
    for (const half of [-1, 1]) {
      for (let k = 0; k < around; k++) dyn.push({ d, type: 'stave', a: half * d.len / 4, half: d.len / 4, rho: d.r, phi: (k / around) * TAU, size: (TAU * d.r / around) * 0.62, base: met[0], hi: met[1] });
    }
    for (const ga of [-d.len / 3, 0, d.len / 3]) {
      for (let k = 0; k < around; k++) dyn.push({ d, type: 'groove', a: ga, rho: d.r + 0.003, phi: (k / around) * TAU, size: (TAU * d.r / around) * 0.6, base: met[0].map((q) => q * 0.45), hi: met[1].map((q) => q * 0.5) });
    }
    // engranajes en las dos tapas: dientes radiales
    const teeth = Math.round((TAU * d.r * 1.15) / 0.06);
    for (const sd of [-1, 1]) {
      for (let k = 0; k < teeth; k++) dyn.push({ d, type: 'tooth', a: sd * (d.len / 2 + 0.015), rho: d.r * 1.1, phi: (k / teeth) * TAU, size: 0.016, len: 0.03, base: [0.42, 0.33, 0.18], hi: [0.9, 0.8, 0.55] });
      for (let k = 0; k < around; k += 2) dyn.push({ d, type: 'cap', a: sd * (d.len / 2 + 0.01), rho: d.r * 0.6, phi: (k / around) * TAU, size: d.r * 0.35, base: met[0].map((q) => q * 0.8), hi: met[1], sd });
    }
    // púas
    d.pins.forEach((p, pi) => {
      p.phi = ((p.bar + p.t) / d.N) * TAU;
      p.a = d.axial(p.midi);
      const idx = dyn.length;
      dyn.push({ d, type: 'pin', a: p.a, rho: d.r + 0.04, phi: p.phi, size: 0.02, len: 0.045, base: [0.95, 0.92, 0.84], hi: [1, 1, 1], pin: p });
      p.dyn = idx;
      for (let off = p.off0; off < p.off1; off++) {
        const l = pinIndex.get(off) || [];
        l.push({ d, p });
        pinIndex.set(off, l);
      }
    });
    // peine: un diente por nota distinta (los graves, más largos), fijo pero vibra
    d.combs = d.pitches.map((m, k) => {
      const n = d.pitches.length, a = d.axial(m);
      const reach = 0.12 + 0.24 * (1 - (n === 1 ? 0.5 : k / (n - 1)));
      return { a, m, reach, idx: dyn.length, v: 0 };
    });
    for (const cb of d.combs) {
      // cada diente: cuatro splats alargados en fila, de la base hacia el cilindro
      for (let q = 0; q < 4; q++) dyn.push({ d, type: 'comb', a: cb.a, q, cb, base: [0.68, 0.7, 0.74], hi: [1, 1, 1] });
    }
  }
  const dynN = Math.min(dyn.length, DYN);
  for (let i = dStart + dynN; i < dStart + DYN; i++) hide(i);

  // ───────────── estado ─────────────
  const st = { t: 0, clock: null, idle: 0, glow: new Map(), active: new Set(), sparks: [], motes: [] };
  for (let k = 0; k < 140; k++) st.motes.push({ x: (hash2(k, 1) - 0.5) * total * 1.2, y: 0.2 + hash2(k, 2) * 1.6, z: -1 + hash2(k, 3) * 2.6, ph: hash2(k, 4) * TAU });
  let locShift = 0;
  const cam = { yaw: -0.18, pitch: 0.55, dist: 7.6, zoom: 1, userYaw: 0, userPitch: 0, x: 0 };
  let camM = null, first = true;

  function setActive(ranges) {
    st.active.clear();
    for (const r of ranges) for (let o = r.start - locShift; o < r.end - locShift; o++) {
      const l = pinIndex.get(o);
      if (l) for (const e of l) st.active.add(e.p);
    }
  }
  function spawn(ev) {
    if (!ev.loc) return;
    const l = pinIndex.get(ev.loc.start - locShift);
    if (!l) return;
    for (const { d, p } of l) {
      // chispas en la punta del diente que la púa acaba de puntear
      const cb = d.combs.find((c) => c.a === p.a);
      if (cb) cb.kick = 1;
      const n = ev.echo ? 1 : 4;
      for (let k = 0; k < n; k++) {
        const [cx, cy, cz] = d.center;
        st.sparks.push({ x: cx + d.A[0] * p.a + d.O[0] * (d.r + 0.05), y: cy + 0.02, z: cz + d.A[2] * p.a + d.O[2] * (d.r + 0.05), vx: (Math.random() - 0.5) * 0.3, vy: 0.2 + Math.random() * 0.4, vz: d.O[2] * 0.3 + (Math.random() - 0.5) * 0.2, t0: st.t, col: GLOW[d.kind] || [1, 1, 1], life: 0.8 + Math.random() * 0.8 });
      }
    }
    if (st.sparks.length > 400) st.sparks.splice(0, st.sparks.length - 400);
  }

  let last = performance.now() / 1000;
  function frame(width, height) {
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - last);
    last = now;
    st.t += dt;
    const t = st.t;
    // reloj: el de Strudel si suena; si no, un giro muy lento
    if (st.clock === null) st.idle += dt * 0.05;
    const cyc = st.clock !== null ? st.clock : st.idle;

    // brillo de las púas que suenan
    for (const d of drums) for (const p of d.pins) {
      const on = st.active.has(p);
      p.v = on ? Math.min(1, (p.v || 0) + dt * 10) : (p.v || 0) * Math.pow(0.04, dt);
      if (on) { const cb = d.combs.find((c) => c.a === p.a); if (cb) cb.v = Math.max(cb.v, p.v); }
    }
    for (const d of drums) for (const cb of d.combs) { cb.v *= Math.pow(0.08, dt); cb.kick = (cb.kick || 0) * Math.pow(0.02, dt); }

    // reescribir lo que gira
    for (let k = 0; k < dynN; k++) {
      const s = dyn[k], d = s.d, i = dStart + k;
      const th = -(cyc / d.N) * TAU; // una vuelta cada N ciclos: la púa llega al peine cuando suena
      const [cx, cy, cz] = d.center;
      if (s.type === 'comb') {
        const cb = s.cb;
        const vib = (cb.v * 0.6 + cb.kick) * 0.012 * Math.sin(t * 90 + cb.a * 20);
        const f = (s.q + 0.5) / 4;
        const ob = d.r + 0.035 + cb.reach + 0.02, oe = d.r + 0.035;
        const oo = lerp(ob, oe, f);
        const u = vib * f * f;
        const x = cx + d.A[0] * s.a + d.O[0] * oo, z = cz + d.A[2] * s.a + d.O[2] * oo;
        const seg = (ob - oe) / 8;
        const lit = cb.v > 0.05 || cb.kick > 0.05;
        const g = GLOW[d.kind] || [1, 1, 1];
        const c = lit ? mixc(shadeMetal([0, 1, 0], s.base, s.hi), g, Math.max(cb.v, cb.kick) * 0.8) : shadeMetal(norm3([d.O[0] * 0.3, 1, d.O[2] * 0.3]), s.base, s.hi);
        putStick(i, x, cy + u - 0.005, z, d.O[0], 0, d.O[2], seg * 1.15, 0.016, c, 3, lit && Math.max(cb.v, cb.kick) > 0.3 ? 32 : 0);
        continue;
      }
      const ang = s.phi + th;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      // dirección radial en el mundo: hacia el peine (O) en ángulo 0, hacia arriba (U) a 90°
      const n = [d.O[0] * ca, sa, d.O[2] * ca];
      const rho = s.rho;
      const x = cx + d.A[0] * s.a + n[0] * rho, y = cy + n[1] * rho, z = cz + d.A[2] * s.a + n[2] * rho;
      if (s.type === 'stave') {
        // duela: larga en el eje, angosta alrededor, delgada en la normal
        const tg = [d.O[0] * -sa, ca, d.O[2] * -sa]; // tangente
        const o = i * 16, la = s.half, lt = s.size, ln = 0.006;
        const A = d.A;
        D[o] = x; D[o + 1] = y; D[o + 2] = z; D[o + 3] = 3;
        const cv = (p, q) => la * la * A[p] * A[q] + lt * lt * tg[p] * tg[q] + ln * ln * n[p] * n[q];
        D[o + 4] = cv(0, 0); D[o + 5] = cv(0, 1); D[o + 6] = cv(0, 2); D[o + 8] = cv(1, 1); D[o + 9] = cv(1, 2); D[o + 10] = cv(2, 2);
        const c = shadeMetal(n, s.base, s.hi);
        D[o + 7] = pack(c[0], c[1], c[2]); D[o + 11] = 0;
      } else if (s.type === 'groove') {
        const tg = [d.O[0] * -sa, ca, d.O[2] * -sa];
        putStick(i, x, y, z, tg[0], tg[1], tg[2], s.size, 0.007, shadeMetal(n, s.base, s.hi), 3);
      }
      else if (s.type === 'tooth') putStick(i, x, y, z, n[0], n[1], n[2], s.len, s.size, shadeMetal(n, s.base, s.hi), 3);
      else if (s.type === 'cap') put(i, x, y, z, d.A[0] * s.sd, 0, d.A[2] * s.sd, s.size, 0.008, shadeMetal([d.A[0] * s.sd, 0, d.A[2] * s.sd], s.base, s.hi), 3);
      else if (s.type === 'pin') {
        const p = s.pin, v = p.v || 0;
        const g = GLOW[d.kind] || [1, 1, 1];
        const c = v > 0.02 ? mixc(shadeMetal(n, s.base, s.hi), g, v * 0.85).map((q) => q * (1 + 0.5 * v)) : shadeMetal(n, s.base, s.hi);
        putStick(i, x + n[0] * 0.01, y + n[1] * 0.01, z + n[2] * 0.01, n[0], n[1], n[2], s.len + v * 0.01, s.size + v * 0.004, c, 3, v > 0.3 ? 32 : 0);
      }
    }

    // partículas: polvo en la luz de la lámpara y chispas del peine
    let pc = 0;
    const part = (x, y, z, s, c, a, em) => {
      if (pc >= PMAX) return;
      const o = (pStart + pc++) * 16;
      D[o] = x; D[o + 1] = y; D[o + 2] = z; D[o + 3] = a;
      D[o + 4] = s * s; D[o + 5] = 0; D[o + 6] = 0; D[o + 7] = pack(c[0], c[1], c[2]);
      D[o + 8] = s * s; D[o + 9] = 0; D[o + 10] = s * s; D[o + 11] = em ? 32 : 0;
      D[o + 12] = D[o + 13] = D[o + 14] = D[o + 15] = 0;
    };
    for (const m of st.motes) {
      const x = m.x + Math.sin(t * 0.13 + m.ph) * 0.3, y = m.y + Math.sin(t * 0.21 + m.ph * 2) * 0.15, z = m.z + Math.cos(t * 0.1 + m.ph) * 0.2;
      const inLight = Math.exp(-((x * 0.25) ** 2 + ((y - 0.9) * 0.8) ** 2));
      part(x, y, z, 0.008, [1, 0.9, 0.7], 1.6 * inLight * (0.5 + 0.5 * Math.sin(t * 0.7 + m.ph)), true);
    }
    st.sparks = st.sparks.filter((p) => t - p.t0 < p.life);
    for (const p of st.sparks) {
      const age = t - p.t0, f = 1 - age / p.life;
      part(p.x + p.vx * age, p.y + p.vy * age - 0.4 * age * age, p.z + p.vz * age, 0.009, p.col, 3 * f, true);
    }
    for (let i = pStart + pc; i < pStart + PMAX; i++) { const o = i * 16; if (D[o + 3] !== 0) { D[o + 1] = -500; D[o + 3] = 0; } }

    // cámara: travelling lento a lo largo del mecanismo, con un leve paneo
    cam.x = Math.sin(t * 0.03) * total * 0.33;
    const rows = new Set(rowSpan(dStart, dStart + dynN));
    for (const r of rowSpan(pStart, pStart + PMAX)) rows.add(r);
    if (first) { for (const r of rowSpan(sStart, sEnd)) rows.add(r); }
    const opts = {
      width, height, time: t,
      changedRows: [...rows],
      camera: { target: [cam.x, 0.45, 0.3], dist: cam.dist * cam.zoom, yaw: cam.yaw + cam.userYaw + Math.sin(t * 0.05) * 0.08 - cam.x * 0.03, pitch: clamp(cam.pitch + cam.userPitch, 0.05, 1.2), fov: 0.55 },
      damp: false,
    };
    renderer.render(world, opts);
    first = false;
    camM = makeCamera(world, { ...opts, changedRows: [] }, width, height);
  }

  return {
    frame,
    spawn,
    setActive,
    setClock(c) { st.clock = c; },
    setLocShift(s) { locShift = s; },
    orbit(dx, dy) { cam.userYaw -= dx * 0.004; cam.userPitch = clamp(cam.userPitch + dy * 0.003, -0.3, 0.8); },
    zoom(f) { cam.zoom = clamp(cam.zoom * f, 0.4, 2); },
    drums,
    st,
    counts: () => ({ total: world.count, dyn: dyn.length, static: si - sStart, drums: drums.map((d) => [d.kind, d.N, d.pins.length, d.pitches.length]) }),
  };
}
