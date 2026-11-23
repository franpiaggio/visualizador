/*
 * ARCHIPIÉLAGO — la música como un mapa grabado.
 *
 * Un campo de alturas h(u, v) se recalcula cada cuadro: un fondo marino suave
 * más lo que aporta cada evento de la música (islas, bajíos, pozos, anillos).
 * De ese campo salen:
 *   · el relieve sombreado y las tintas hipsométricas (agua → tierra)
 *   · las curvas de nivel (marching squares), la costa y las líneas de agua
 *   · los rótulos: cada curva lleva escrita la línea de código que levantó esa
 *     isla; lo que está sonando se pinta en bermellón y con recuadro, como en Strudel.
 *
 * Coordenadas: u ∈ [0, 1] a lo ancho del marco, v ∈ [0, H/W] (misma escala).
 */

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ───────────────────────── paleta (tintas de imprenta) ─────────────────────────
const C = {
  paper: [238, 231, 216],
  ink: '#2a2620',
  inkSoft: 'rgba(42, 38, 32, 0.55)',
  contour: 'rgba(110, 72, 42, 0.42)',
  contourIdx: 'rgba(110, 72, 42, 0.78)',
  coast: 'rgba(38, 44, 52, 0.92)',
  water: (a) => `rgba(43, 92, 138, ${a})`,
  grat: 'rgba(43, 92, 138, 0.13)',
  verm: '#c8452c',
  vermSoft: 'rgba(200, 69, 44, 0.18)',
  halo: 'rgba(238, 231, 216, 0.92)',
};
const WATER_SHALLOW = [214, 225, 226], WATER_DEEP = [162, 186, 198];
const LAND_LOW = [236, 228, 208], LAND_HIGH = [214, 190, 146], LAND_TOP = [196, 160, 112];

// ───────────────────────── ruido de valor (fondo marino) ─────────────────────────
function hash2(i, j) {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y);
  const fx = x - i, fy = y - j;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy) * 2 - 1;
}

export function createMap(canvas, layers = {}) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  let frame = { x: 0, y: 0, w: 1, h: 1 }; // marco del mapa en px CSS
  let paperTex = null;

  // grilla del campo
  let cols = 0, rows = 0, field = null, sum = null, aspect = 0.56;
  // el relieve y el papel son canvases propios: el navegador los compone (escalado suave
  // y multiply) sin redibujarlos en el canvas principal cada cuadro
  const relief = layers.relief || document.createElement('canvas');
  const paperEl = layers.paper || null;
  const rctx = relief.getContext('2d', { willReadFrequently: true }); // en CPU: putImageData por cuadro sin sincronizar con la GPU
  let reliefImg = null;

  // estado musical
  const bumps = []; // {u, v, h, s, t0, att, hold, rel, kind, loc}
  const rings = []; // {u, v, amp, w, speed, t0, life, dashed}
  let uplift = 0, upliftT = 0; // drone: el fondo sube lento
  let rough = 0; // masa de ruido: rugosidad del fondo
  let jitter = 0; // ruido agudo: temblor fino
  let tide = 0; // subgraves: marea
  let playing = false;
  let compassSpin = 0;

  // código
  let code = '';
  let lines = []; // {start, text}
  let active = []; // rangos que suenan ahora

  function setCode(c) {
    if (c === code) return;
    code = c;
    lines = [];
    let off = 0;
    for (const raw of c.split('\n')) {
      const lead = raw.length - raw.trimStart().length;
      const text = raw.trim();
      if (text && text !== '<' && text !== '>' && text !== '`)' && text !== '~ ~ ~ ~') lines.push({ start: off + lead, text });
      off += raw.length + 1;
    }
  }
  const lineAt = (pos) => {
    let best = null;
    for (const L of lines) if (L.start <= pos) best = L; else break;
    return best && pos <= best.start + best.text.length ? best : null;
  };
  const isActive = (pos) => {
    for (const r of active) if (pos >= r.start && pos < r.end) return true;
    return false;
  };

  // ───────────────────────── tamaño ─────────────────────────
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const d = Math.min(2, window.devicePixelRatio || 1);
    if (w === W && h === H && d === dpr) return;
    W = w; H = h; dpr = d;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const m = Math.round(clamp(Math.min(W, H) * 0.045, 16, 44));
    frame = { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
    aspect = frame.h / frame.w;
    cols = Math.round(clamp(frame.w / 9, 80, 150));
    rows = Math.max(2, Math.round(cols * aspect));
    field = new Float32Array((cols + 1) * (rows + 1));
    sum = new Float32Array((cols + 1) * (rows + 1));
    relief.width = cols + 1;
    relief.height = rows + 1;
    reliefImg = rctx.createImageData(cols + 1, rows + 1);
    paperTex = makePaper(W, H, dpr, paperEl);
    Object.assign(relief.style, { left: `${frame.x}px`, top: `${frame.y}px`, width: `${frame.w}px`, height: `${frame.h}px` });
  }

  // textura de papel: grano + fibras, una sola vez por tamaño
  function makePaper(w, h, d, el) {
    const c = el || document.createElement('canvas');
    c.width = Math.round(w * d); c.height = Math.round(h * d);
    const g = c.getContext('2d');
    const img = g.createImageData(c.width, c.height);
    const px = img.data;
    for (let i = 0; i < px.length; i += 4) {
      const n = Math.random();
      const v = 255 - n * n * 34;
      px[i] = v; px[i + 1] = v * 0.985; px[i + 2] = v * 0.955; px[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // fibras
    g.globalAlpha = 0.05;
    g.strokeStyle = '#6b5a40';
    for (let k = 0; k < (w * h) / 900; k++) {
      const x = Math.random() * c.width, y = Math.random() * c.height, a = Math.random() * TAU, l = (4 + Math.random() * 14) * d;
      g.lineWidth = 0.6 * d;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    // manchas suaves de envejecido en los bordes
    const grd = g.createRadialGradient(c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.3, c.width / 2, c.height / 2, Math.max(c.width, c.height) * 0.75);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(1, 'rgba(150,120,80,0.35)');
    g.globalAlpha = 1;
    g.fillStyle = grd;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  // ───────────────────────── eventos ─────────────────────────
  // dónde vive cada altura: graves a la izquierda, agudos a la derecha; la altura
  // en el mapa sale de un ángulo áureo, así la misma nota siempre levanta la misma isla
  function posForMidi(midi) {
    const u = 0.1 + 0.8 * clamp((midi - 38) / (86 - 38));
    const v = aspect * (0.5 + 0.3 * Math.sin(midi * 2.39996));
    return [u, v];
  }
  function midiForU(u) {
    return Math.round(38 + clamp((u - 0.1) / 0.8) * (86 - 38));
  }

  function event(ev, t) {
    if (rings.length > 48) rings.splice(0, rings.length - 48);
    if (bumps.length > 160) bumps.splice(0, bumps.length - 160);
    const a = ev.amp ?? 1;
    const pan = ev.pan ?? 0.5;
    const at = ev.at || null;
    const loc = ev.loc || null;
    switch (ev.kind) {
      case 'melody': {
        const [u, v] = at || posForMidi(ev.midi);
        if (ev.echo) {
          rings.push({ u, v, amp: 0.1 * a, w: 0.012, speed: 0.05, t0: t, life: 4 });
        } else {
          bumps.push({ u, v, h: 0.55 * a, s: 0.04, t0: t, att: 0.25, hold: ev.dur || 0.4, rel: 4.5, kind: 'melody', loc, peak: true, midi: ev.midi, user: !!ev.user });
          rings.push({ u, v, amp: 0.06, w: 0.01, speed: 0.07, t0: t, life: 3.5 });
        }
        break;
      }
      case 'arp': {
        const [u, v] = posForMidi(ev.midi);
        if (ev.echo) rings.push({ u, v, amp: 0.07 * a, w: 0.012, speed: 0.04, t0: t, life: 4 });
        else bumps.push({ u, v, h: 0.26 * a, s: 0.045, t0: t, att: 0.3, hold: ev.dur || 0.5, rel: 4, kind: 'arp', loc });
        break;
      }
      case 'pad': {
        if (ev.echo) break;
        const [u] = posForMidi(ev.midi);
        bumps.push({ u, v: aspect * (0.5 + 0.12 * Math.sin(ev.midi)), h: 0.12 * a, s: 0.12, t0: t, att: 2.5, hold: ev.dur || 2, rel: 6, kind: 'pad', loc });
        break;
      }
      case 'drone':
        if (!ev.echo) upliftT = Math.min(0.16, upliftT + 0.1 * a);
        break;
      case 'cloud': {
        const u = 0.08 + 0.84 * pan + (Math.random() - 0.5) * 0.08;
        const v = aspect * (0.12 + Math.random() * 0.2);
        bumps.push({ u, v, h: (ev.echo ? 0.18 : 0.42) * a, s: 0.022, t0: t, att: 0.7, hold: 0.5, rel: 5, kind: 'cloud', loc: ev.echo ? null : loc });
        break;
      }
      case 'sonar': {
        // ecolocalización: cada eco es otro anillo desde el mismo punto
        const u = 0.08 + 0.84 * pan, v = aspect * (0.72 + 0.12 * Math.sin(ev.midi));
        rings.push({ u, v, amp: 0.2 * Math.max(0.25, a), w: 0.008, speed: 0.11, t0: t, life: 6, dashed: true, sonar: true });
        break;
      }
      case 'sparks': {
        const u = 0.08 + 0.84 * pan + (Math.random() - 0.5) * 0.1;
        const v = aspect * (0.25 + Math.random() * 0.55);
        bumps.push({ u, v, h: -0.4 * a, s: 0.012, t0: t, att: 0.02, hold: 0.05, rel: 1.6, kind: 'sparks', loc: ev.echo ? null : loc });
        break;
      }
      case 'breath':
        rough = Math.min(1.2, rough + 0.6 * a);
        break;
      case 'dust':
        jitter = Math.min(1, jitter + 0.7 * a);
        break;
      case 'sub':
        if (ev.echo) break;
        tide = Math.min(1, tide + 0.8 * a);
        rings.push({ u: 0.5, v: aspect * 0.5, amp: 0.22 * a, w: 0.05, speed: 0.06, t0: t, life: 10, dashed: false, sub: true });
        break;
    }
  }

  // toque del usuario sobre el mapa → posición y nota
  function pick(x, y) {
    const u = (x - frame.x) / frame.w, v = (y - frame.y) / frame.w;
    if (u < 0 || u > 1 || v < 0 || v > aspect) return null;
    return { u, v, midi: midiForU(u) };
  }

  // ───────────────────────── campo de alturas ─────────────────────────
  const env = (b, t) => {
    const p = t - b.t0;
    if (p < 0) return 0;
    const up = b.att > 0 ? smooth(0, b.att, p) : 1;
    const down = p > b.att + b.hold ? Math.exp(-(p - b.att - b.hold) / (b.rel * 0.45)) : 1;
    return up * down;
  };

  function computeField(t) {
    const N = cols, M = rows;
    const sea = 0.06 * tide; // la marea sube: todo queda un poco más bajo
    const rg = 0.5 + 0.28 * rough;
    const drift = t * 0.012;
    // contribuciones de eventos precalculadas por evento (caja acotada)
    for (let j = 0; j <= M; j++) {
      const v = (j / M) * aspect;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        // fondo: fbm que deriva lento, más hondo hacia los bordes
        let n = vnoise(u * 3.2 + drift, v * 3.2 - drift * 0.6) * 0.62 + vnoise(u * 7 - drift, v * 7 + 3.1) * 0.26;
        n += vnoise(u * 15 + 9.3, v * 15 - drift * 2) * (0.12 + 0.18 * rough);
        if (jitter > 0.02) n += vnoise(u * 38 + t * 1.7, v * 38 - t * 1.3) * 0.07 * jitter;
        const ex = (u - 0.5) * 2, ey = (v / aspect - 0.5) * 2;
        const edge = ex * ex * 0.7 + ey * ey * 0.9;
        field[j * (N + 1) + i] = n * rg - 0.42 - 0.42 * edge + uplift - sea;
      }
    }
    const step = 1 / N;
    sum.fill(0);
    for (let k = bumps.length - 1; k >= 0; k--) {
      const b = bumps[k];
      const e = env(b, t);
      b.e = e;
      if (t - b.t0 > b.att + b.hold + b.rel * 3 || (t - b.t0 > b.att + b.hold && e < 0.01)) { bumps.splice(k, 1); continue; }
      const A = b.h * e;
      if (Math.abs(A) < 0.004) continue;
      const R = b.s * 3;
      const i0 = Math.max(0, Math.floor((b.u - R) / step)), i1 = Math.min(N, Math.ceil((b.u + R) / step));
      const j0 = Math.max(0, Math.floor(((b.v - R) / aspect) * M)), j1 = Math.min(M, Math.ceil(((b.v + R) / aspect) * M));
      const inv = 1 / (2 * b.s * b.s);
      for (let j = j0; j <= j1; j++) {
        const dv = (j / M) * aspect - b.v;
        for (let i = i0; i <= i1; i++) {
          const du = i * step - b.u;
          sum[j * (N + 1) + i] += A * Math.exp(-(du * du + dv * dv) * inv);
        }
      }
    }
    for (let k = rings.length - 1; k >= 0; k--) {
      const r = rings[k];
      const p = t - r.t0;
      if (p > r.life) { rings.splice(k, 1); continue; }
      if (p <= 0) { r.rad = 0; continue; } // nació después del tiempo de este cuadro
      const rad = p * r.speed;
      const fade = Math.pow(1 - p / r.life, 1.6);
      r.rad = rad; r.fade = fade;
      const A = r.amp * fade;
      const R = rad + r.w * 3;
      const i0 = Math.max(0, Math.floor((r.u - R) / step)), i1 = Math.min(N, Math.ceil((r.u + R) / step));
      const j0 = Math.max(0, Math.floor(((r.v - R) / aspect) * M)), j1 = Math.min(M, Math.ceil(((r.v + R) / aspect) * M));
      const inv = 1 / (2 * r.w * r.w);
      if (A < 0.008) continue;
      const band = r.w * 3, rIn = Math.max(0, rad - band);
      for (let j = j0; j <= j1; j++) {
        const dv = (j / M) * aspect - r.v;
        // tramo de la fila que cae dentro del anillo (se saltea el centro)
        const outer = R * R - dv * dv;
        if (outer < 0) continue;
        const ox = Math.sqrt(outer);
        const inner = rIn * rIn - dv * dv;
        const ix = inner > 0 ? Math.sqrt(inner) : -1;
        const a0 = Math.max(i0, Math.floor((r.u - ox) / step)), a1 = Math.min(i1, Math.ceil((r.u + ox) / step));
        for (let i = a0; i <= a1; i++) {
          const du = i * step - r.u;
          if (ix > 0 && Math.abs(du) < ix - step) { i = Math.max(i, Math.floor((r.u + ix) / step) - 1); continue; }
          const d = Math.sqrt(du * du + dv * dv) - rad;
          sum[j * (N + 1) + i] += A * Math.exp(-d * d * inv);
        }
      }
    }
    // saturación suave: muchas notas en el mismo lugar no hacen una montaña infinita
    for (let k = 0; k < field.length; k++) {
      const x = sum[k];
      field[k] += x > 0 ? 1.05 * Math.tanh(x / 1.05) : x;
    }
  }

  // relieve sombreado + tintas, a resolución de grilla (se escala suave)
  function paintRelief() {
    const N = cols, M = rows, px = reliefImg.data;
    for (let j = 0; j <= M; j++) {
      for (let i = 0; i <= N; i++) {
        const k = j * (N + 1) + i;
        const h = field[k];
        const hx = field[j * (N + 1) + Math.min(N, i + 1)] - field[j * (N + 1) + Math.max(0, i - 1)];
        const hy = field[Math.min(M, j + 1) * (N + 1) + i] - field[Math.max(0, j - 1) * (N + 1) + i];
        // luz desde el noroeste, como en los mapas
        const shade = clamp(1 - (hx + hy) * 2.2, 0.72, 1.22);
        let r, g, b;
        if (h < 0) {
          const d = smooth(0, 0.7, -h);
          r = lerp(WATER_SHALLOW[0], WATER_DEEP[0], d); g = lerp(WATER_SHALLOW[1], WATER_DEEP[1], d); b = lerp(WATER_SHALLOW[2], WATER_DEEP[2], d);
          const s = lerp(1, shade, 0.25);
          r *= s; g *= s; b *= s;
        } else {
          const e1 = smooth(0, 0.5, h), e2 = smooth(0.5, 1.1, h);
          r = lerp(lerp(LAND_LOW[0], LAND_HIGH[0], e1), LAND_TOP[0], e2);
          g = lerp(lerp(LAND_LOW[1], LAND_HIGH[1], e1), LAND_TOP[1], e2);
          b = lerp(lerp(LAND_LOW[2], LAND_HIGH[2], e1), LAND_TOP[2], e2);
          r *= shade; g *= shade; b *= shade;
        }
        const o = k * 4;
        px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
      }
    }
    rctx.putImageData(reliefImg, 0, 0);
  }

  // ───────────────────────── curvas de nivel ─────────────────────────
  // marching squares + encadenado de segmentos en polilíneas (px CSS)
  function contours(level) {
    const N = cols, M = rows;
    const sx = frame.w / N, sy = frame.h / M;
    const segs = []; // pares de ids de arista
    const pts = new Map(); // id de arista → [x, y]
    const edgePt = (id, x, y) => { if (!pts.has(id)) pts.set(id, [x, y]); return id; };
    // aristas: horizontal (i,j)-(i+1,j) id = (j*(N+1)+i)*2 ; vertical (i,j)-(i,j+1) id = ...*2+1
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < N; i++) {
        const a = field[j * (N + 1) + i] - level, b = field[j * (N + 1) + i + 1] - level;
        const c = field[(j + 1) * (N + 1) + i + 1] - level, d = field[(j + 1) * (N + 1) + i] - level;
        const idx = (a > 0 ? 8 : 0) | (b > 0 ? 4 : 0) | (c > 0 ? 2 : 0) | (d > 0 ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const x0 = frame.x + i * sx, y0 = frame.y + j * sy;
        const top = () => edgePt((j * (N + 1) + i) * 2, x0 + sx * (a / (a - b)), y0);
        const right = () => edgePt((j * (N + 1) + i + 1) * 2 + 1, x0 + sx, y0 + sy * (b / (b - c)));
        const bottom = () => edgePt(((j + 1) * (N + 1) + i) * 2, x0 + sx * (d / (d - c)), y0 + sy);
        const left = () => edgePt((j * (N + 1) + i) * 2 + 1, x0, y0 + sy * (a / (a - d)));
        switch (idx) {
          case 1: case 14: segs.push(left(), bottom()); break;
          case 2: case 13: segs.push(bottom(), right()); break;
          case 3: case 12: segs.push(left(), right()); break;
          case 4: case 11: segs.push(top(), right()); break;
          case 6: case 9: segs.push(top(), bottom()); break;
          case 7: case 8: segs.push(left(), top()); break;
          case 5: case 10: {
            const center = (a + b + c + d) / 4 > 0;
            if ((idx === 5) === center) { segs.push(left(), top(), bottom(), right()); }
            else { segs.push(left(), bottom(), top(), right()); }
            break;
          }
        }
      }
    }
    // encadenar
    const adj = new Map();
    const nseg = segs.length / 2;
    for (let s = 0; s < nseg; s++) {
      for (const e of [segs[s * 2], segs[s * 2 + 1]]) {
        const l = adj.get(e);
        if (l) l.push(s); else adj.set(e, [s]);
      }
    }
    const used = new Uint8Array(nseg);
    const polys = [];
    for (let s = 0; s < nseg; s++) {
      if (used[s]) continue;
      used[s] = 1;
      const chain = [segs[s * 2], segs[s * 2 + 1]];
      // extender hacia adelante y hacia atrás
      for (const dir of [1, -1]) {
        for (;;) {
          const end = dir === 1 ? chain[chain.length - 1] : chain[0];
          const l = adj.get(end);
          let next = -1;
          if (l) for (const q of l) if (!used[q]) { next = q; break; }
          if (next < 0) break;
          used[next] = 1;
          const e0 = segs[next * 2], e1 = segs[next * 2 + 1];
          const other = e0 === end ? e1 : e0;
          if (dir === 1) chain.push(other); else chain.unshift(other);
        }
      }
      if (chain.length < 3) continue;
      const closed = chain[0] === chain[chain.length - 1];
      let p = chain.map((id) => pts.get(id));
      p = chaikin(p, closed);
      polys.push({ p, closed, level });
    }
    return polys;
  }
  function chaikin(p, closed) {
    if (p.length < 3) return p;
    const out = [];
    const n = p.length;
    if (!closed) out.push(p[0]);
    for (let i = 0; i < n - 1; i++) {
      const a = p[i], b = p[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (closed) out.push(out[0]); else out.push(p[n - 1]);
    return out;
  }
  function strokePolys(polys, style, width, dash) {
    if (!opts.lines) return;
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    for (const { p } of polys) {
      ctx.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ───────────────────────── rótulos de código sobre las curvas ─────────────────────────
  // Semillas fijas repartidas en el marco: cada una busca la curva más cercana y escribe
  // ahí una línea del código. Como las semillas no se mueven, los rótulos se deslizan
  // con la curva en lugar de saltar.
  let seeds = [];
  function makeSeeds() {
    seeds = [];
    const sp = 128;
    const nx = Math.max(2, Math.round(frame.w / sp)), ny = Math.max(2, Math.round(frame.h / (sp * 0.62)));
    let k = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const jx = hash2(i * 7 + 1, j * 13 + 5) - 0.5, jy = hash2(i * 3 + 11, j * 5 + 2) - 0.5;
        seeds.push({
          x: frame.x + ((i + 0.5 + jx * 0.7 + (j % 2) * 0.5) / nx) * frame.w,
          y: frame.y + ((j + 0.5 + jy * 0.6) / ny) * frame.h,
          k: k++,
        });
      }
    }
  }

  function arcInfo(p) {
    const L = new Float32Array(p.length);
    for (let i = 1; i < p.length; i++) L[i] = L[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    return L;
  }
  function pointAt(p, L, s) {
    // búsqueda binaria del tramo
    let lo = 0, hi = L.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= s) lo = m; else hi = m; }
    const seg = L[hi] - L[lo] || 1;
    const f = (s - L[lo]) / seg;
    const a = p[lo], b = p[hi];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.atan2(b[1] - a[1], b[0] - a[0])];
  }

  // el evento que más pesa en un punto (para elegir qué línea de código escribir)
  function dominant(x, y, t) {
    const u = (x - frame.x) / frame.w, v = (y - frame.y) / frame.w;
    let best = null, bw = 0.05;
    for (const b of bumps) {
      if (!b.loc || !b.e) continue;
      const du = u - b.u, dv = v - b.v;
      const w = Math.abs(b.h * b.e) * Math.exp(-(du * du + dv * dv) / (2 * (b.s * 1.6) ** 2));
      if (w > bw) { bw = w; best = b; }
    }
    return best;
  }

  let charW = 6.6;
  const FONT = 10.5;

  // Atlas de glyphs: cada carácter del código pre-dibujado una vez (halo de papel y
  // tinta en tres colores). Escribir sobre las curvas pasa a ser drawImage por letra,
  // mucho más barato que strokeText/fillText rotados.
  const atlas = { key: '', cv: null, map: new Map(), cw: 0, ch: 0 };
  const INKS = () => [C.ink, C.water(0.85), C.verm];
  function ensureAtlas() {
    const chars = [...new Set(code + '[]~<>.0123456789abcdefg#')].filter((c) => c.trim());
    const key = `${dpr}|${charW.toFixed(2)}|${chars.join('')}`;
    if (key === atlas.key) return;
    atlas.key = key;
    const cw = Math.ceil((charW + 6) * dpr), ch = Math.ceil(FONT * 1.8 * dpr);
    const per = 4; // halo + 3 tintas
    const cv = atlas.cv || document.createElement('canvas');
    cv.width = cw * chars.length;
    cv.height = ch * per;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    g.font = `${FONT * dpr}px "JetBrains Mono", ui-monospace, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    atlas.map = new Map();
    chars.forEach((c, i) => {
      const x = i * cw + cw / 2;
      g.lineWidth = 3.2 * dpr;
      g.strokeStyle = C.halo;
      g.strokeText(c, x, ch / 2 + 0.5 * dpr);
      INKS().forEach((ink, k) => {
        g.fillStyle = ink;
        g.fillText(c, x, ch * (k + 1) + ch / 2 + 0.5 * dpr);
      });
      atlas.map.set(c, i * cw);
    });
    atlas.cv = cv; atlas.cw = cw; atlas.ch = ch;
  }
  function drawLabels(polys, t) {
    // índice espacial de vértices
    const CELL = 40;
    const grid = new Map();
    polys.forEach((poly, pi) => {
      const p = poly.p;
      for (let i = 0; i < p.length; i += 2) {
        const key = ((p[i][0] / CELL) | 0) * 4096 + ((p[i][1] / CELL) | 0);
        const l = grid.get(key);
        const e = pi * 65536 + i;
        if (l) l.push(e); else grid.set(key, [e]);
      }
    });
    const placed = [];
    const arcs = new Map();
    ctx.font = `${FONT}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const boxes = [];
    const glyphs = [];
    for (const sd of seeds) {
      // vértice más cercano
      const cx = (sd.x / CELL) | 0, cy = (sd.y / CELL) | 0;
      let best = -1, bd = 70 * 70;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
        const l = grid.get((cx + a) * 4096 + (cy + b));
        if (!l) continue;
        for (const e of l) {
          const pi = (e / 65536) | 0, i = e % 65536;
          const q = polys[pi].p[i];
          const d = (q[0] - sd.x) ** 2 + (q[1] - sd.y) ** 2;
          if (d < bd) { bd = d; best = e; }
        }
      }
      if (best < 0) continue;
      const pi = (best / 65536) | 0, vi = best % 65536;
      const poly = polys[pi];
      let L = arcs.get(pi);
      if (!L) { L = arcInfo(poly.p); arcs.set(pi, L); }
      const total = L[L.length - 1];
      // qué escribir: la línea del evento que levantó esta zona, o una línea fija de la semilla
      const q = poly.p[vi];
      const dom = dominant(q[0], q[1], t);
      let line = dom ? lineAt(dom.loc.start) : null;
      if (!line && lines.length) line = lines[(sd.k * 11 + 3) % lines.length];
      if (!line) continue;
      let text = line.text, start = line.start;
      if (text.length > 30) {
        // recortar alrededor de lo que suena (o del principio)
        const focus = dom ? dom.loc.start - line.start : 0;
        const a = clamp(focus - 10, 0, text.length - 30);
        text = text.slice(a, a + 30); start += a;
      }
      const w = text.length * charW;
      if (total < w + 24) continue;
      let s0 = L[vi] - w / 2;
      if (!poly.closed) s0 = clamp(s0, 6, total - w - 6);
      const wrap = (s) => (poly.closed ? ((s % total) + total) % total : s);
      // dirección legible: si el tramo va hacia la izquierda, escribirlo al revés
      const pa = pointAt(poly.p, L, wrap(s0)), pb = pointAt(poly.p, L, wrap(s0 + w));
      const rev = pb[0] < pa[0];
      // curvatura: no rotular curvas muy cerradas
      let turn = 0, prevA = null;
      const samples = [];
      for (let c = 0; c < text.length; c++) {
        const s = wrap(s0 + (rev ? w - (c + 0.5) * charW : (c + 0.5) * charW));
        const g = pointAt(poly.p, L, s);
        let ang = g[2] + (rev ? Math.PI : 0);
        if (prevA !== null) {
          let d = ang - prevA;
          while (d > Math.PI) d -= TAU;
          while (d < -Math.PI) d += TAU;
          turn = Math.max(turn, Math.abs(d));
        }
        prevA = ang;
        samples.push([g[0], g[1], ang]);
      }
      if (turn > 0.5) continue;
      // colisiones con otros rótulos
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const g of samples) { x0 = Math.min(x0, g[0]); y0 = Math.min(y0, g[1]); x1 = Math.max(x1, g[0]); y1 = Math.max(y1, g[1]); }
      x0 -= 8; y0 -= 8; x1 += 8; y1 += 8;
      if (x0 < frame.x || y0 < frame.y || x1 > frame.x + frame.w || y1 > frame.y + frame.h) continue;
      if (placed.some((r) => !(x1 < r[0] || x0 > r[2] || y1 < r[1] || y0 > r[3]))) continue;
      placed.push([x0, y0, x1, y1]);
      const water = poly.level < 0;
      for (let c = 0; c < text.length; c++) {
        const on = isActive(start + c);
        glyphs.push({ ch: text[c], g: samples[c], on, water });
      }
      // recuadro tipo Strudel alrededor de lo que suena (sigue la curva)
      let runStart = -1;
      for (let c = 0; c <= text.length; c++) {
        const on = c < text.length && isActive(start + c) && text[c] !== ' ';
        if (on && runStart < 0) runStart = c;
        if (!on && runStart >= 0) { boxes.push(samples.slice(runStart, c)); runStart = -1; }
      }
    }
    // halo de papel → recuadros → tinta (el halo "corta" la curva debajo, como en los mapas)
    ensureAtlas();
    const tr = (g) => {
      const c = Math.cos(g[2]) * dpr, s = Math.sin(g[2]) * dpr;
      ctx.setTransform(c, s, -s, c, g[0] * dpr, g[1] * dpr);
    };
    const { cv, cw, ch } = atlas;
    const dw = cw / dpr, dh = ch / dpr;
    const stamp = (gl, row) => {
      const sx = atlas.map.get(gl.ch);
      if (sx === undefined) return;
      tr(gl.g);
      ctx.drawImage(cv, sx, row * ch, cw, ch, -dw / 2, -dh / 2, dw, dh);
    };
    for (const gl of glyphs) if (gl.ch !== ' ') stamp(gl, 0);
    // recuadros tipo Strudel sobre lo que suena
    ctx.lineWidth = 1;
    ctx.fillStyle = C.vermSoft;
    ctx.strokeStyle = C.verm;
    const hh = FONT * 0.78;
    for (const run of boxes) {
      for (let i = 0; i < run.length; i++) {
        tr(run[i]);
        ctx.fillRect(-charW / 2 - 0.5, -hh, charW + 1, hh * 2);
        ctx.beginPath();
        ctx.moveTo(-charW / 2 - 0.5, -hh); ctx.lineTo(charW / 2 + 0.5, -hh);
        ctx.moveTo(-charW / 2 - 0.5, hh); ctx.lineTo(charW / 2 + 0.5, hh);
        if (i === 0) { ctx.moveTo(-charW / 2 - 0.5, -hh); ctx.lineTo(-charW / 2 - 0.5, hh); }
        if (i === run.length - 1) { ctx.moveTo(charW / 2 + 0.5, -hh); ctx.lineTo(charW / 2 + 0.5, hh); }
        ctx.stroke();
      }
    }
    for (const gl of glyphs) if (gl.ch !== ' ') stamp(gl, gl.on ? 3 : gl.water ? 2 : 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // cimas: triángulo de cota + la nota escrita como en el código
  function drawSummits(t) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const b of bumps) {
      if (!b.peak || !b.e || b.e < 0.25) continue;
      const x = frame.x + b.u * frame.w, y = frame.y + b.v * frame.w;
      const a = smooth(0.25, 0.6, b.e);
      ctx.globalAlpha = a;
      ctx.fillStyle = C.ink;
      ctx.beginPath();
      ctx.moveTo(x, y - 4); ctx.lineTo(x + 3.6, y + 2.4); ctx.lineTo(x - 3.6, y + 2.4); ctx.closePath();
      ctx.fill();
      // el token de la nota (de la notación mini del código)
      let tok = null, on = false;
      if (b.loc && code) {
        tok = code.slice(b.loc.start, b.loc.end);
        on = isActive(b.loc.start);
      }
      if (!tok) tok = b.midi != null ? noteName(b.midi) : null;
      if (tok) {
        ctx.font = `italic 12px "JetBrains Mono", ui-monospace, monospace`;
        const tw = ctx.measureText(tok).width;
        const tx = x + 8, ty = y - 9;
        ctx.lineWidth = 3;
        ctx.strokeStyle = C.halo;
        ctx.strokeText(tok, tx, ty);
        const fresh = on || t - b.t0 < 0.45;
        if (fresh) {
          ctx.fillStyle = C.vermSoft;
          ctx.fillRect(tx - 3, ty - 8, tw + 6, 16);
          ctx.strokeStyle = C.verm;
          ctx.lineWidth = 1;
          ctx.strokeRect(tx - 3, ty - 8, tw + 6, 16);
        }
        ctx.fillStyle = fresh ? C.verm : C.ink;
        ctx.fillText(tok, tx, ty);
      }
      ctx.globalAlpha = 1;
    }
  }
  const NOTE = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  const noteName = (m) => NOTE[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

  // anillos de sonar y de subgrave dibujados como sondeos (punteados)
  function drawRings() {
    for (const r of rings) {
      if (!(r.rad > 0) || !(r.sonar || r.sub)) continue;
      const x = frame.x + r.u * frame.w, y = frame.y + r.v * frame.w;
      ctx.strokeStyle = r.sub ? C.water(0.35 * r.fade) : C.water(0.6 * r.fade);
      ctx.lineWidth = r.sub ? 1.2 : 0.8;
      ctx.setLineDash(r.sub ? [1, 5] : [2, 3]);
      ctx.beginPath();
      ctx.arc(x, y, r.rad * frame.w, 0, TAU);
      ctx.stroke();
      if (r.sonar && r.rad * frame.w < 6) {
        ctx.fillStyle = C.water(0.8);
        ctx.beginPath(); ctx.arc(x, y, 1.6, 0, TAU); ctx.fill();
      }
    }
    ctx.setLineDash([]);
  }

  // ───────────────────────── marco, retícula y rosa de los vientos ─────────────────────────
  function drawGraticule() {
    ctx.strokeStyle = C.grat;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    const n = 8;
    for (let i = 1; i < n; i++) {
      const x = frame.x + (frame.w * i) / n;
      ctx.moveTo(x, frame.y); ctx.lineTo(x, frame.y + frame.h);
    }
    const m = Math.max(2, Math.round(n * aspect));
    for (let j = 1; j < m; j++) {
      const y = frame.y + (frame.h * j) / m;
      ctx.moveTo(frame.x, y); ctx.lineTo(frame.x + frame.w, y);
    }
    ctx.stroke();
  }
  function drawFrame() {
    const { x, y, w, h } = frame;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = 0.6;
    ctx.strokeRect(x - 5, y - 5, w + 10, h + 10);
    // borde de grados: tramos alternados blanco / negro, como en las cartas náuticas
    const seg = 24;
    ctx.fillStyle = C.ink;
    for (let i = 0; i * seg < w; i++) if (i % 2 === 0) { ctx.fillRect(x + i * seg, y - 5, Math.min(seg, w - i * seg), 3.2); ctx.fillRect(x + i * seg, y + h + 1.8, Math.min(seg, w - i * seg), 3.2); }
    for (let j = 0; j * seg < h; j++) if (j % 2 === 0) { ctx.fillRect(x - 5, y + j * seg, 3.2, Math.min(seg, h - j * seg)); ctx.fillRect(x + w + 1.8, y + j * seg, 3.2, Math.min(seg, h - j * seg)); }
  }
  function compassPos() {
    const R = clamp(frame.w * 0.04, 26, 44);
    return { x: frame.x + frame.w - R * 1.8, y: frame.y + frame.h - R * 1.8, R };
  }
  function drawCompass(t, hover) {
    const { x, y, R } = compassPos();
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.92, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, R * 0.84, 0, TAU); ctx.stroke();
    // marcas de rumbo
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * TAU, l = i % 8 === 0 ? 0.14 : i % 4 === 0 ? 0.09 : 0.05;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R * 0.84, Math.sin(a) * R * 0.84);
      ctx.lineTo(Math.cos(a) * R * (0.84 - l), Math.sin(a) * R * (0.84 - l));
      ctx.stroke();
    }
    ctx.rotate(compassSpin);
    // estrella de 8 puntas: mitades claras y oscuras
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU - Math.PI / 2;
      const len = i % 2 === 0 ? R * 0.78 : R * 0.42;
      const wdt = i % 2 === 0 ? R * 0.13 : R * 0.09;
      const tip = [Math.cos(a) * len, Math.sin(a) * len];
      const l = [Math.cos(a - Math.PI / 2) * wdt, Math.sin(a - Math.PI / 2) * wdt];
      const r = [Math.cos(a + Math.PI / 2) * wdt, Math.sin(a + Math.PI / 2) * wdt];
      ctx.fillStyle = i === 0 && playing ? C.verm : C.ink;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(...tip); ctx.lineTo(...l); ctx.closePath(); ctx.fill();
      ctx.fillStyle = `rgb(${C.paper.join(',')})`;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(...tip); ctx.lineTo(...r); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = `rgb(${C.paper.join(',')})`;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.06, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.restore();
    if (hover) {
      ctx.strokeStyle = C.verm;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.arc(x, y, R * 1.06, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  function hitCompass(px, py) {
    const { x, y, R } = compassPos();
    return Math.hypot(px - x, py - y) < R;
  }

  // ───────────────────────── cuadro ─────────────────────────
  const LEVELS = [];
  for (let l = 0.12; l < 1.3; l += 0.12) LEVELS.push(+l.toFixed(2));
  const WATERLINES = [-0.035, -0.08, -0.135, -0.2, -0.28];
  let lastSeedsFor = '';
  const prof = {};
  const opts = { paper: true, labels: true, relief: true, lines: true };
  let hoverCompass = false;

  function draw(t, dt) {
    resize();
    const key = `${W}x${H}`;
    if (key !== lastSeedsFor) { makeSeeds(); lastSeedsFor = key; }
    ctx.font = `${FONT}px "JetBrains Mono", ui-monospace, monospace`;
    charW = ctx.measureText('M').width;

    // estados lentos
    uplift = lerp(uplift, upliftT, 1 - Math.pow(0.5, dt / 2.5));
    upliftT *= Math.pow(0.5, dt / 9);
    rough *= Math.pow(0.5, dt / 3);
    jitter *= Math.pow(0.5, dt / 0.8);
    tide *= Math.pow(0.5, dt / 3.5);
    compassSpin += dt * (playing ? 0.05 : 0);

    const P0 = performance.now();
    computeField(t);
    const P1 = performance.now();
    paintRelief();
    const P2 = performance.now();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // fondo transparente: debajo está el relieve (otro canvas) y el color del papel
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = `rgb(${C.paper.join(',')})`;
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.rect(frame.x, frame.y + frame.h, frame.w, -frame.h); // agujero en el marco
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.rect(frame.x, frame.y, frame.w, frame.h);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = 0.9;
    ctx.globalAlpha = 1;
    drawGraticule();

    // líneas de agua: la costa repetida hacia afuera, cada vez más tenue (grabado clásico)
    WATERLINES.forEach((l, i) => strokePolys(contours(l), C.water(0.5 - i * 0.085), 0.7));
    drawRings();
    // curvas de nivel; cada cuarta, maestra (más gruesa)
    const land = [];
    LEVELS.forEach((l, i) => {
      const ps = contours(l);
      strokePolys(ps, i % 4 === 3 ? C.contourIdx : C.contour, i % 4 === 3 ? 1.1 : 0.6);
      for (const p of ps) land.push(p);
    });
    const coast = contours(0);
    strokePolys(coast, C.coast, 1.5);
    // rótulos: costa y curvas de tierra
    const P3 = performance.now();
    if (opts.labels) drawLabels(coast.concat(land), t);
    const P4 = performance.now();
    drawSummits(t);
    ctx.restore();

    drawFrame();
    drawCompass(t, hoverCompass);

    // papel encima: grano, fibras y bordes gastados
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    if (!paperEl && opts.paper) ctx.drawImage(paperTex, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // tiempos por etapa (ms), para MAP.prof
    Object.assign(prof, { field: P1 - P0, relief: P2 - P1, contours: P3 - P2, labels: P4 - P3, rest: performance.now() - P4 });
  }

  return {
    setCode,
    setActive(r) { active = r; },
    event,
    draw,
    pick,
    hitCompass,
    setHoverCompass(on) { hoverCompass = on; },
    setPlaying(on) { playing = on; },
    posForMidi,
    prof,
    opts,
    debug: () => ({ bumps: bumps.length, rings: rings.length, cols, rows }),
  };
}
