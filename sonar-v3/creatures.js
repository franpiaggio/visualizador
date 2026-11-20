/*
 * Objetos modelados de Sonar v2, esculpidos con Ink Studio (SDF → splats).
 *
 *  · Faro: torre de piedra clara con linterna cálida sobre un farallón,
 *    lejos, detrás del anillo. Su haz gira una vuelta por frase (4 ciclos)
 *    y destella con cada ping del sonar.
 *  · Ballena jorobada: cuerpo largo, vientre claro, aletas pectorales largas,
 *    tubérculos en la cabeza, aleta dorsal pequeña y caudal ancha. Nada en
 *    círculos bajo el agua; los subgraves la hacen salir a respirar (soplido),
 *    y al sumergirse levanta la cola. El sonar pasa a ser su ecolocalización.
 *
 * La ballena se hornea una vez en su espacio local y en cada cuadro sus splats
 * se reescriben con una transformación rígida (más la flexión de la cola).
 */

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ───────────────────────── faro ─────────────────────────
// Cada forma se esculpe dos veces: la real y su gemelo invertido bajo el agua (reflejo).
export function buildLighthouse(B, S, at, mats) {
  const [ox, oz] = at;
  const ball = (c, r, mat, res) => {
    S.ball([ox + c[0], c[1], oz + c[2]], r, mat, { res });
    S.ball([ox + c[0], -c[1], oz + c[2]], r, mat, { res: res * 2 });
  };
  const lathe = (y0, h, rf, mat, res) => {
    S.lathe([ox, y0, oz], h, rf, mat, { res });
    S.lathe([ox, -(y0 + h), oz], h, [rf[1], rf[0]], mat, { res: res * 2 });
  };
  // farallón: base ancha y baja, cuello angosto, se abre arriba (como un hongo de piedra)
  ball([0, 0.05, 0], [3.1, 0.45, 2.4], mats.rock, 0.16);
  ball([0.3, 0.75, 0.1], [1.0, 0.9, 0.9], mats.rock, 0.12);
  ball([-0.2, 1.55, -0.1], [1.25, 0.7, 1.1], mats.rock, 0.12);
  ball([0, 2.25, 0], [1.75, 0.55, 1.45], mats.rock, 0.12);
  ball([0.1, 2.75, 0], [1.2, 0.18, 1.05], mats.rock, 0.1);
  // rocas sueltas alrededor
  for (const [x, z, r] of [[-4.2, 1.6, 0.6], [3.9, -1.2, 0.45], [5.3, 2.4, 0.35], [-2.6, -3.1, 0.4]]) {
    ball([x, 0.02, z], [r * 1.6, r * 0.45, r], mats.rock, 0.12);
  }
  // torre de piedra clara, levemente cónica
  lathe(2.85, 3.9, [0.62, 0.48], mats.tower, 0.1);
  // balcón y linterna
  lathe(6.72, 0.14, [0.72, 0.72], mats.dark, 0.06);
  lathe(6.86, 0.35, [0.52, 0.52], mats.tower, 0.06);
  lathe(7.21, 0.7, [0.47, 0.47], mats.lamp, 0.05);
  lathe(7.91, 0.12, [0.58, 0.58], mats.dark, 0.05);
  lathe(8.03, 0.5, [0.55, 0.08], mats.dark, 0.05);
  return { lamp: [ox, 7.56, oz] };
}

// ───────────────────────── ballena ─────────────────────────
// Modelo local: largo sobre +x (cabeza adelante), y arriba. Unos 7,2 de largo.
// Referencia de proporciones: yubarta esbelta (largo ≈ 5,5 × alto), cabeza ancha
// y chata con la garganta profunda, aletas pectorales de un tercio del largo,
// pedúnculo fino y cola delgada en flecha.
const WHALE_PROFILE = [
  // x, medio alto, medio ancho, centro vertical de la sección
  [3.5, 0.1, 0.2, -0.14], [3.25, 0.2, 0.36, -0.15], [2.95, 0.3, 0.5, -0.16], [2.6, 0.4, 0.6, -0.17],
  [2.2, 0.5, 0.66, -0.17], [1.75, 0.6, 0.7, -0.15], [1.25, 0.66, 0.72, -0.12], [0.7, 0.68, 0.7, -0.08],
  [0.1, 0.65, 0.64, -0.04], [-0.5, 0.58, 0.55, 0], [-1.1, 0.49, 0.43, 0.03], [-1.65, 0.4, 0.31, 0.06],
  // pedúnculo: más alto que ancho, como una quilla
  [-2.2, 0.31, 0.2, 0.08], [-2.7, 0.23, 0.13, 0.09], [-3.15, 0.16, 0.09, 0.1], [-3.55, 0.1, 0.065, 0.1],
];
// Ballena en voxels finos: el volumen se talla con una función de "adentro/afuera"
// (cuerpo + aletas + cola), se quedan los voxels de la superficie y cada uno se vuelve
// un disco chico orientado según una normal suavizada.
const VOX = 0.038; // escamas chicas: la piel se lee continua
const profileAt = (x) => {
  const P = WHALE_PROFILE;
  if (x > P[0][0] || x < P[P.length - 1][0]) return null;
  for (let i = 0; i < P.length - 1; i++) {
    const [x0, h0, w0, y0] = P[i], [x1, h1, w1, y1] = P[i + 1];
    if (x <= x0 && x >= x1) {
      const u = (x0 - x) / (x0 - x1);
      return [lerp(h0, h1, u), lerp(w0, w1, u), lerp(y0, y1, u)];
    }
  }
  return null;
};
// la cabeza es chata arriba: la mitad superior de la sección se aplasta hacia el hocico
const topScale = (x) => 1 - 0.32 * clamp((x - 1.0) / 2.3);
// hoja plana (aleta) a lo largo de un segmento: ancho variable, espesor fijo.
// scallop > 0 ondula el borde (los tubérculos del borde de ataque de la pectoral)
function blade(p, a, b, w0, w1, thick, widthAxis, scallop = 0) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const r0 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const u = (r0[0] * d[0] + r0[1] * d[1] + r0[2] * d[2]) / L2;
  if (u < 0 || u > 1) return false;
  const r = [r0[0] - d[0] * u, r0[1] - d[1] * u, r0[2] - d[2] * u];
  const L = Math.sqrt(L2), dn = [d[0] / L, d[1] / L, d[2] / L];
  const k = widthAxis[0] * dn[0] + widthAxis[1] * dn[1] + widthAxis[2] * dn[2];
  let e = [widthAxis[0] - dn[0] * k, widthAxis[1] - dn[1] * k, widthAxis[2] - dn[2] * k];
  const el = Math.hypot(...e);
  e = [e[0] / el, e[1] / el, e[2] / el];
  const nb = [dn[1] * e[2] - dn[2] * e[1], dn[2] * e[0] - dn[0] * e[2], dn[0] * e[1] - dn[1] * e[0]];
  const along = r[0] * e[0] + r[1] * e[1] + r[2] * e[2]; // >0 borde de ataque
  let w = lerp(w0, w1, u) * Math.sqrt(1 - Math.pow(Math.max(0, u * 1.15 - 0.15), 2) * 0.6);
  if (scallop && along > 0) w *= 1 - scallop * (0.5 + 0.5 * Math.sin(u * 44));
  // espesor que se afina hacia la punta y hacia los bordes (perfil de ala)
  const th = thick * (1 - 0.5 * u) * Math.sqrt(Math.max(0, 1 - (along / w) ** 2)) + VOX * 0.3;
  return Math.abs(r[0] * nb[0] + r[1] * nb[1] + r[2] * nb[2]) < th && Math.abs(along) < w;
}
const SHOULDER = [1.1, -0.5, 0.55];
const PEC = (s) => [[SHOULDER[0], SHOULDER[1], s * SHOULDER[2]], [-0.55, -0.95, s * 2.6]];
const FLUKE = (s) => [[-3.45, 0.1, 0], [-4.3, 0.06, s * 1.55]];
function whaleInside(x, y, z) {
  const pr = profileAt(x);
  if (pr) {
    const [h, w, yc] = pr;
    const hy = y > yc ? h * topScale(x) : h;
    if (((y - yc) / hy) ** 2 + (z / w) ** 2 <= 1) return 1;
    // aleta dorsal pequeña sobre la joroba
    if (x < -1.5 && x > -2.1 && Math.abs(z) < 0.07) {
      const top = yc + h + 0.17 * (1 - Math.abs(x + 1.72) / 0.38);
      if (y < top && y > yc + h - 0.05) return 1;
    }
  }
  for (const s of [-1, 1]) {
    const [a, b] = PEC(s);
    if (blade([x, y, z], a, b, 0.34, 0.1, 0.03, [1, 0.25, 0], 0.16)) return 2;
    const [fa, fb] = FLUKE(s);
    if (blade([x, y, z], fa, fb, 0.4, 0.08, 0.035, [1, 0, 0])) return 3;
  }
  return 0;
}
const hash = (i, j, k) => {
  let h = (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const hex = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const WC = {
  back: [0x16233a, 0x1d3150, 0x264066].map(hex),
  flank: [0x2f5280, 0x3a6496, 0x4d79ab].map(hex),
  spark: [0x7fa6cf, 0xa9c6e2].map(hex),
  belly: [0xa9c4dc, 0xc9dae8, 0xe3ebf1].map(hex),
  pleat: hex(0x6f93b8),
  knob: hex(0x5d7fa8),
  eye: hex(0x070b14),
  fin: [0x8fb0d2, 0xbcd1e6, 0xe3ebf1].map(hex),
  finTop: [0x3a6496, 0x5a86b6].map(hex),
};

export function buildWhale(B) {
  const start = B.count();
  const X0 = -4.5, X1 = 3.6, Y0 = -1.45, Y1 = 0.95, Z0 = -2.8, Z1 = 2.8;
  const nx = Math.round((X1 - X0) / VOX), ny = Math.round((Y1 - Y0) / VOX), nz = Math.round((Z1 - Z0) / VOX);
  const grid = new Uint8Array(nx * ny * nz);
  const id = (i, j, k) => (i * ny + j) * nz + k;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    grid[id(i, j, k)] = whaleInside(X0 + (i + 0.5) * VOX, Y0 + (j + 0.5) * VOX, Z0 + (k + 0.5) * VOX);
  }
  const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? 0 : grid[id(i, j, k)]);
  const fins = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    const part = grid[id(i, j, k)];
    if (!part) continue;
    // solo la cáscara: voxels con algún vecino vacío
    if (at(i + 1, j, k) && at(i - 1, j, k) && at(i, j + 1, k) && at(i, j - 1, k) && at(i, j, k + 1) && at(i, j, k - 1)) continue;
    // normal suavizada: gradiente de ocupación en un entorno de 5×5×5
    // (las aletas solo miran su propia parte, así no heredan la normal del cuerpo)
    let n = [0, 0, 0];
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) {
      const q = at(i + a, j + b, k + c);
      if (q && (part === 1 ? true : q === part)) { n[0] -= a; n[1] -= b; n[2] -= c; }
    }
    const nl = Math.hypot(...n) || 1;
    n = [n[0] / nl, n[1] / nl, n[2] / nl];
    const x = X0 + (i + 0.5) * VOX, y = Y0 + (j + 0.5) * VOX, z = Z0 + (k + 0.5) * VOX;
    const rnd = hash(i, j, k);
    let col;
    if (part === 2) {
      // pectorales de yubarta: blancas abajo, algo más oscuras arriba, borde de ataque luminoso
      const lead = !at(i + 1, j, k);
      col = lead ? WC.fin[2] : n[1] > 0.5 ? WC.finTop[rnd < 0.5 ? 0 : 1] : WC.fin[rnd < 0.6 ? 1 : 0];
    } else if (part === 3) {
      col = n[1] < -0.3 ? WC.belly[rnd < 0.5 ? 0 : 1] : WC.back[rnd < 0.5 ? 1 : 2];
    } else {
      const pr = profileAt(x) || [0.2, 0.2, 0];
      const v = (y - pr[2]) / pr[0]; // -1 abajo … 1 arriba
      if (v < -0.3 && x > -1.3) {
        // garganta con pliegues ventrales: surcos a lo largo, desde el mentón hasta el ombligo
        const ang = Math.atan2(z, -(y - pr[2]));
        const groove = Math.abs(Math.sin(ang * 13)) < 0.28;
        col = x > -0.9 && groove ? WC.pleat : WC.belly[rnd < 0.4 ? 0 : rnd < 0.85 ? 1 : 2];
      } else if (v > 0.45) {
        col = WC.back[rnd < 0.2 ? 0 : rnd < 0.85 ? 1 : 2];
        // tubérculos sobre el hocico
        if (x > 2.0 && rnd < 0.09) col = WC.knob;
      } else {
        col = rnd > 0.975 ? WC.spark[rnd > 0.99 ? 1 : 0] : WC.flank[rnd < 0.2 ? 0 : rnd < 0.85 ? 1 : 2];
      }
      // ojo y comisura de la boca (la boca baja en arco hasta debajo del ojo)
      if (Math.abs(x - 1.6) < 0.05 && Math.abs(y + 0.06) < 0.05 && Math.abs(z) > 0.5) col = WC.eye;
      const my = -0.13 - (3.4 - x) * 0.035;
      if (x > 1.75 && x < 3.4 && Math.abs(y - my) < 0.032 && Math.abs(z) > 0.12) col = WC.back[0];
    }
    // luz desde arriba (luna y cielo), con un poco de luz rasante desde adelante
    const light = 0.55 + 0.45 * Math.max(0, n[1]) + 0.08 * n[0];
    B.disc(x, y, z, n, VOX * 0.72, VOX * 0.14, [col[0] * light, col[1] * light, col[2] * light], 3);
    fins.push(part === 2 ? Math.sign(z) : 0);
  }
  return { start, end: B.count(), fin: Int8Array.from(fins) };
}

// Animación de la ballena: escribe su pose en world.data cada cuadro.
export function createWhale(D, range, mirror, path) {
  const n = range.end - range.start;
  // copia del modelo local (posición + covarianza)
  const P = new Float32Array(n * 3), C = new Float32Array(n * 6), A = new Float32Array(n);
  const fin = new Int8Array(n); // -1 / 1: splat de aleta pectoral izquierda / derecha
  for (let i = 0; i < n; i++) {
    const o = (range.start + i) * 16;
    P[i * 3] = D[o]; P[i * 3 + 1] = D[o + 1]; P[i * 3 + 2] = D[o + 2];
    C[i * 6] = D[o + 4]; C[i * 6 + 1] = D[o + 5]; C[i * 6 + 2] = D[o + 6];
    C[i * 6 + 3] = D[o + 8]; C[i * 6 + 4] = D[o + 9]; C[i * 6 + 5] = D[o + 10];
    A[i] = D[o + 3];
    const x = D[o], y = D[o + 1], z = D[o + 2];
    fin[i] = range.fin ? range.fin[i] : 0;
  }
  // el gemelo del espejo copia color y flags del original
  for (let i = 0; i < n; i++) {
    const a = (range.start + i) * 16, m = (mirror.start + i) * 16;
    D[m + 7] = D[a + 7];
    D[m + 11] = D[a + 11];
    for (let k = 12; k < 16; k++) D[m + k] = 0;
  }

  const st = {
    s: path.phase, // parámetro del recorrido
    mode: 'fly',
    t0: 0,
    lastDance: -99,
    events: [],
    head: [0, 0, 0],
    pos: [0, 6, 0],
    fwd: [1, 0, 0],
    up: 0,
    prevF: null,
    bank: 0,
  };

  // Recorrido de vuelo: una elipse amplia y lenta que pasa sobre el anillo y se aleja
  // hacia el faro. La altura sube y baja muy despacio (dos ondulaciones por vuelta).
  const flight = (s) => [
    path.center[0] + Math.cos(s) * path.rx,
    path.height + Math.sin(s * 2 + 0.7) * 0.9,
    path.center[1] + Math.sin(s) * path.rz,
  ];

  // danza: la dispara un pulso subgrave (balanceo amplio hacia un costado + bajada suave)
  function surface(t) {
    if (st.mode !== 'fly' || t - st.lastDance < 12) return false;
    st.mode = 'dance';
    st.t0 = t;
    st.lastDance = t;
    st.danceSide = Math.random() < 0.5 ? -1 : 1;
    return true;
  }

  function update(t, dt) {
    const OMEGA = TAU / 90; // una vuelta cada ~90 s
    st.s += dt * OMEGA;
    const s = st.s;
    let [cx, y, cz] = flight(s);
    // derivadas analíticas de la elipse → rumbo y curvatura
    const dx = -Math.sin(s) * path.rx, dz = Math.cos(s) * path.rz;
    const ddx = -Math.cos(s) * path.rx, ddz = -Math.sin(s) * path.rz;
    const hl = Math.hypot(dx, dz);
    const dy = Math.cos(s * 2 + 0.7) * 1.8;
    // nado: batida lenta de la cola; el cuerpo compensa con un leve cabeceo y sube/baja apenas
    const phi = t * 0.85;
    let pitch = clamp(Math.atan2(dy, hl), -0.12, 0.12) - Math.sin(phi - 0.7) * 0.045;
    y += Math.cos(phi) * 0.07;
    // inclinación en la curva, proporcional a la curvatura (suave y constante)
    const kappa = (dx * ddz - dz * ddx) / Math.pow(hl, 3);
    st.bank += (clamp(kappa * 2.6, -0.32, 0.32) - st.bank) * Math.min(1, dt * 0.5);
    let roll = st.bank;
    let flex = 0.3; // amplitud de la onda de nado hacia la cola
    let finAmp = 0.16;
    let archExtra = 0;
    if (st.mode === 'dance') {
      const p = t - st.t0;
      const e = Math.sin(Math.PI * clamp(p / 9)); // entra y sale suave en 9 s
      roll += st.danceSide * 0.7 * e;
      y -= 1.1 * e;
      pitch += 0.08 * Math.sin(Math.PI * clamp(p / 4.5)) * (p < 4.5 ? -1 : 1) * e;
      flex = 0.3 + 0.18 * e;
      archExtra = 0.28 * e * Math.sin(t * 0.9);
      finAmp = 0.16 + 0.3 * e;
      if (p > 9) st.mode = 'fly';
    }
    const hx = dx / hl, hz = dz / hl;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const F = [hx * cp, sp, hz * cp];
    if (path.debugY !== undefined) { y = path.debugY; roll = 0; }

    // base: adelante, arriba (ortogonalizado contra el mundo) y costado; rolido sobre el eje adelante
    let U = [-F[0] * F[1], 1 - F[1] * F[1], -F[2] * F[1]];
    const ul = Math.hypot(...U) || 1;
    U = [U[0] / ul, U[1] / ul, U[2] / ul];
    let Rt = [F[1] * U[2] - F[2] * U[1], F[2] * U[0] - F[0] * U[2], F[0] * U[1] - F[1] * U[0]];
    const cr = Math.cos(roll), sr = Math.sin(roll);
    [U, Rt] = [
      [U[0] * cr + Rt[0] * sr, U[1] * cr + Rt[1] * sr, U[2] * cr + Rt[2] * sr],
      [Rt[0] * cr - U[0] * sr, Rt[1] * cr - U[1] * sr, Rt[2] * cr - U[2] * sr],
    ];
    st.pos = [cx, y, cz];
    st.head = [cx + F[0] * 3.3, y + F[1] * 3.3, cz + F[2] * 3.3];
    st.fwd = F;

    // Curva de la columna en el plano vertical local:
    //  · onda de nado: viaja de cabeza a cola, su amplitud crece hacia la cola
    //  · arco global en "U": cabeza y cola suben y bajan juntas, lento
    // La batida de una yubarta es vertical y casi toda en el último tercio: la cabeza
    // queda quieta, el pedúnculo sube y baja y la cola llega con retraso.
    const W_K = 1.1, W_OM = 0.85, X_HINGE = 0.4, SPAN = 4.7, GAIN = 1.1;
    const arch = 0.1 * Math.sin(t * W_OM * 0.45 + 1.3) + archExtra;
    const spine = (x) => {
      const ta = Math.max(0, X_HINGE - x) / SPAN; // 0 detrás de la aleta → 1 en la punta de la cola
      const amp = 0.025 + flex * ta * ta * GAIN;
      const wave = amp * Math.sin(W_K * x - t * W_OM);
      const u = (x - 0.3) / 3.7;
      return wave + arch * u * u;
    };
    const spineSlope = (x) => {
      const ta = Math.max(0, X_HINGE - x) / SPAN;
      const amp = 0.025 + flex * ta * ta * GAIN;
      const dAmp = x < X_HINGE ? -flex * GAIN * 2 * ta / SPAN : 0;
      const u = (x - 0.3) / 3.7;
      return dAmp * Math.sin(W_K * x - t * W_OM) + amp * W_K * Math.cos(W_K * x - t * W_OM) + arch * 2 * u / 3.7;
    };
    const finA = Math.sin(t * 0.85 + 1.2) * finAmp; // remo lento de las pectorales, desfasado de la cola
    for (let i = 0; i < n; i++) {
      let x = P[i * 3], yy = P[i * 3 + 1], z = P[i * 3 + 2];
      // aletas: giran alrededor del hombro (eje x local)
      let fc = 1, fs = 0;
      if (fin[i]) {
        const ang = finA * fin[i];
        fc = Math.cos(ang); fs = Math.sin(ang);
        const dy = yy - SHOULDER[1], dz = z - fin[i] * SHOULDER[2];
        yy = SHOULDER[1] + dy * fc - dz * fs;
        z = fin[i] * SHOULDER[2] + dy * fs + dz * fc;
      }
      // doblez: la sección en x se desplaza con la columna y rota con su pendiente
      const ax = fin[i] ? SHOULDER[0] : x; // las aletas siguen la sección del hombro
      const beta = Math.atan(spineSlope(ax));
      const c = Math.cos(beta), s = Math.sin(beta);
      const dy0 = spine(ax);
      const lx = x - ax;
      x = ax + lx * c - yy * s;
      yy = dy0 + lx * s + yy * c;
      // M = [F U Rt] · Rz(beta) · Rx(aleta)
      let m00 = F[0] * c + U[0] * s, m01 = -F[0] * s + U[0] * c, m02 = Rt[0];
      let m10 = F[1] * c + U[1] * s, m11 = -F[1] * s + U[1] * c, m12 = Rt[1];
      let m20 = F[2] * c + U[2] * s, m21 = -F[2] * s + U[2] * c, m22 = Rt[2];
      if (fin[i]) {
        [m01, m02] = [m01 * fc + m02 * fs, -m01 * fs + m02 * fc];
        [m11, m12] = [m11 * fc + m12 * fs, -m11 * fs + m12 * fc];
        [m21, m22] = [m21 * fc + m22 * fs, -m21 * fs + m22 * fc];
      }
      const wx = cx + F[0] * x + U[0] * yy + Rt[0] * z;
      const wy = y + F[1] * x + U[1] * yy + Rt[1] * z;
      const wz = cz + F[2] * x + U[2] * yy + Rt[2] * z;
      // covarianza: M C Mᵀ
      const a00 = C[i * 6], a01 = C[i * 6 + 1], a02 = C[i * 6 + 2], a11 = C[i * 6 + 3], a12 = C[i * 6 + 4], a22 = C[i * 6 + 5];
      const t00 = m00 * a00 + m01 * a01 + m02 * a02, t01 = m00 * a01 + m01 * a11 + m02 * a12, t02 = m00 * a02 + m01 * a12 + m02 * a22;
      const t10 = m10 * a00 + m11 * a01 + m12 * a02, t11 = m10 * a01 + m11 * a11 + m12 * a12, t12 = m10 * a02 + m11 * a12 + m12 * a22;
      const t20 = m20 * a00 + m21 * a01 + m22 * a02, t21 = m20 * a01 + m21 * a11 + m22 * a12, t22 = m20 * a02 + m21 * a12 + m22 * a22;
      const c00 = t00 * m00 + t01 * m01 + t02 * m02, c01 = t00 * m10 + t01 * m11 + t02 * m12, c02 = t00 * m20 + t01 * m21 + t02 * m22;
      const c11 = t10 * m10 + t11 * m11 + t12 * m12, c12 = t10 * m20 + t11 * m21 + t12 * m22, c22 = t20 * m20 + t21 * m21 + t22 * m22;
      let o = (range.start + i) * 16;
      D[o] = wx; D[o + 1] = wy; D[o + 2] = wz; D[o + 3] = A[i];
      D[o + 4] = c00; D[o + 5] = c01; D[o + 6] = c02; D[o + 8] = c11; D[o + 9] = c12; D[o + 10] = c22;
      // gemelo bajo el agua: solo para lo que está fuera del agua
      o = (mirror.start + i) * 16;
      if (wy > 0.02) {
        D[o] = wx; D[o + 1] = -wy; D[o + 2] = wz; D[o + 3] = A[i] * 0.5;
        D[o + 4] = c00; D[o + 5] = -c01; D[o + 6] = c02; D[o + 8] = c11; D[o + 9] = -c12; D[o + 10] = c22;
      } else {
        D[o + 1] = -500; D[o + 3] = 0;
      }
    }

    const due = st.events.filter((e) => e.at <= t);
    st.events = st.events.filter((e) => e.at > t);
    return due;
  }

  return { update, surface, dance: surface, state: st, path };
}

// Haz del faro: dos conos opuestos que giran. Devuelve la intensidad de la linterna.
export function drawBeam(particle, lamp, angle, I, warm, toCam) {
  for (const side of [0, Math.PI]) {
    const a = angle + side;
    const dx = Math.cos(a), dz = Math.sin(a), dy = -0.035;
    for (let j = 1; j <= 40; j++) {
      const d = j * 0.7;
      const k = Math.sin(Math.PI * Math.min(1, j / 6)) * 0.35 + (1 - j / 40) ** 1.6 * 0.65; // entra suave, se disuelve lejos
      const s = 0.1 + j * 0.05;
      particle(lamp[0] + dx * d, lamp[1] + dy * d, lamp[2] + dz * d, s, s * 0.55, s, lerp(0.95, 1, warm), lerp(0.93, 0.82, warm), lerp(0.85, 0.6, warm), 0.2 * k * I, true, true);
    }
  }
  // destello cuando el haz apunta a la cámara
  const facing = Math.max(Math.cos(angle - toCam), Math.cos(angle + Math.PI - toCam));
  return Math.pow(Math.max(0, facing), 6);
}
