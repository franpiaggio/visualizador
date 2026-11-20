/*
 * SONAR — puente entre Strudel y la escena 3D.
 *
 * Se engancha al mismo loop de dibujo que Strudel usa para resaltar el código:
 * cada "hap" (evento) que empieza a sonar se clasifica por capa (según el
 * comentario // que lo precede en el código) y se manda a la escena.
 * Los ecos (delay / delaytime / delayfeedback) se modelan literalmente: cada
 * nota se re-dispara en t + k·delaytime con ganancia feedback^k.
 *
 *   MOTIVO PRINCIPAL     → orbe de luz sobre el monolito de su nota + hilo melódico
 *   ARPEGIO INFERIOR     → ondas en el agua cerca de la piedra de su nota
 *   GRAN COLCHÓN         → color y luz del cielo
 *   DRONE PROFUNDO       → resplandor del horizonte detrás del anillo
 *   NUBE AGUDA           → nubes de luz difusa
 *   ECOS CASI COMO SONAR → ping: haz vertical + anillo veloz que barre el mar
 *   CHISPAS / REFLEJOS   → destellos en el aire que se repiten y caen
 *   MASA DE RUIDO        → bruma baja sobre el agua
 *   RUIDO AGUDO          → polvo eléctrico
 *   PULSOS SUBGRAVES     → oleadas que suben desde el centro + empuje de cámara
 */

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const now = () => performance.now() / 1000;

// ───────────────────────── notas ─────────────────────────
const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function toMidi(n) {
  if (typeof n === 'number') return n;
  if (typeof n !== 'string') return 60;
  const m = /^([a-gA-G])([#sb]*)(-?\d+)?$/.exec(n.trim());
  if (!m) return 60;
  let pc = PC[m[1].toLowerCase()];
  for (const ch of m[2]) pc += ch === 'b' ? -1 : 1;
  const oct = m[3] !== undefined ? parseInt(m[3], 10) : 3;
  return (oct + 1) * 12 + pc;
}
const NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const midiName = (m) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
// índice en el círculo de quintas (C=0, G=1, D=2, A=3, E=4, B=5, F#=6 ...)
const fifths = (m) => (((m % 12) + 12) * 7) % 12;
// tono de color: Mi = azul frío; las quintas vecinas se corren hacia violeta o verde agua
const hueOf = (m) => {
  let d = fifths(m) - 4;
  if (d > 6) d -= 12;
  if (d < -6) d += 12;
  return 208 + d * 15;
};

// ───────────────────────── capas ─────────────────────────
const KINDS = [
  ['melody', /MOTIVO|MELOD/i],
  ['arp', /ARPEG/i],
  ['pad', /COLCH|PAD/i],
  ['drone', /DRONE/i],
  ['cloud', /NUBE/i],
  ['sonar', /ECO|SONAR/i],
  ['sparks', /CHISP|REFLEJ/i],
  ['breath', /MASA|RESPIR/i],
  ['dust', /AGUD|POLVO|ELECTR/i],
  ['sub', /SUBGRAV|PULSO/i],
];
const KIND_COLOR = {
  melody: '#efe4cf',
  arp: '#9fc3d9',
  pad: '#6f8fd0',
  drone: '#c6a46a',
  cloud: '#b9b2e6',
  sonar: '#7fe0e0',
  sparks: '#ffffff',
  breath: '#8a9bb0',
  dust: '#d8e6ff',
  sub: '#4f6fa8',
};

// lee los comentarios "// NOMBRE" del código y arma rangos de capa
function parseLayers(code) {
  const out = [];
  const re = /\/\/[ \t]*(.+)/g;
  let m;
  let lastEnd = -1;
  while ((m = re.exec(code))) {
    const between = lastEnd >= 0 ? code.slice(lastEnd, m.index) : 'x';
    const text = m[1].trim();
    if (out.length && /^\s*$/.test(between)) {
      out[out.length - 1].sub = (out[out.length - 1].sub || '') + ' ' + text;
    } else {
      const kind = (KINDS.find(([, r]) => r.test(text)) || [null])[0];
      out.push({ start: m.index, label: text, kind });
    }
    lastEnd = m.index + m[0].length;
  }
  return out;
}

let layerCache = { code: null, layers: [] };
function layersFor(code) {
  if (layerCache.code !== code) layerCache = { code, layers: parseLayers(code) };
  return layerCache.layers;
}

function classify(hap, code) {
  const v = hap.value || {};
  const locs = hap.context?.locations || [];
  const layers = layersFor(code);
  if (locs.length && layers.length) {
    const pos = Math.min(...locs.map((l) => l.start));
    let found = null;
    for (const L of layers) if (L.start < pos) found = L;
    if (found?.kind) return found;
  }
  // respaldo: deducir por el sonido
  const s = v.s || '';
  const m = toMidi(v.note ?? v.n ?? 60);
  let kind = 'melody';
  if (s === 'noise') kind = v.hpf ? 'dust' : 'breath';
  else if (s === 'sawtooth') kind = 'pad';
  else if (s === 'piano') kind = m >= 64 ? 'melody' : 'arp';
  else if (s === 'sine') kind = m < 30 ? 'sub' : m < 50 ? 'drone' : 'sonar';
  else if (s === 'triangle') kind = (v.release ?? 1) < 0.5 ? 'sparks' : 'cloud';
  return { kind, label: kind, start: -1 };
}

// ───────────────────────── escena 3D ─────────────────────────
import { createScene } from './scene3d.js';
import { createCodeView } from './codeview.js';

const canvas = document.getElementById('stage');
const scene = createScene(canvas);
window.SCENE = scene;
const level = {}; // nivel por capa para la leyenda
const pending = []; // ecos programados

let uidSeq = 0;

const codeCanvas = document.getElementById('codeart');
const codeView = createCodeView(codeCanvas, KIND_COLOR);
let activeRanges = [];

function spawn(ev) {
  level[ev.layerKey] = Math.max(level[ev.layerKey] || 0, ev.echo ? clamp(ev.amp) * 0.6 : 1);
  const anchor = scene.spawn(ev);
  if (!ev.echo && ev.loc) codeView.event({ start: ev.loc.start, end: ev.loc.end, kind: ev.kind, anchor, t: now() });
  return anchor;
}

// resolución "de arte": el canvas se agranda con image-rendering: pixelated
function artSize() {
  const w = window.innerWidth, h = window.innerHeight;
  const AW = Math.round(Math.min(720, Math.max(420, w / 2.4)));
  return [AW, Math.round((AW * h) / w)];
}

let lastT = now();
function frame() {
  const t = now();
  const dt = Math.min(0.05, t - lastT);
  lastT = t;
  if (pending.length) {
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].at <= t) {
        spawn(pending[i].ev);
        pending.splice(i, 1);
      }
    }
  }
  const column = !document.body.classList.contains('hide-ui') && !document.body.classList.contains('show-editor');
  scene.setFocus(false); // la escena queda centrada: el anillo es el sujeto de la foto
  const [w, h] = artSize();
  scene.frame(w, h);
  // el código, a doble resolución de arte para que se lea, pero igual de pixelado
  codeView.setActive(activeRanges);
  codeView.draw({ width: w * 2, height: h * 2, t, dt, project: scene.project, column });
  scene.setHarmony(consonant());
  scene.setPlaying(playing);
  updateLegend(dt);
  requestAnimationFrame(frame);
}

// el rango de código que originó el hap: el primero en el texto es el de la notación mini
function noteLoc(hap) {
  const locs = hap.context?.locations || [];
  let best = null;
  for (const l of locs) if (!best || l.start < best.start) best = l;
  return best;
}

// convierte un hap de Strudel en eventos visuales (incluyendo sus ecos de delay)
function onHap(hap, code, cps) {
  const v = hap.value || {};
  const layer = classify(hap, code);
  const kind = layer.kind || 'melody';
  const midi = toMidi(v.note ?? v.n ?? (v.s === 'noise' ? 100 : 60));
  const gain = v.gain ?? 0.5;
  const durSec = (hap.duration?.valueOf?.() ?? 1) / (cps || 0.6);
  // normalizamos ganancias muy distintas entre capas (0.018 … 0.38)
  const REF = { melody: 0.38, arp: 0.2, pad: 0.055, drone: 0.11, cloud: 0.075, sonar: 0.065, sparks: 0.045, breath: 0.025, dust: 0.018, sub: 0.14 };
  const amp = clamp(gain / (REF[kind] || gain || 1));
  const base = {
    kind,
    layerKey: layer.start >= 0 ? layer.label : kind,
    midi,
    gain,
    amp,
    pan: v.pan ?? 0.5,
    attack: v.attack ?? 0.01,
    release: v.release ?? 0.1,
    dur: durSec,
    lpf: v.lpf ?? v.cutoff,
    echo: 0,
    uid: ++uidSeq,
    loc: noteLoc(hap),
  };
  spawn(base);
  noteHarmony(base);
  const d = v.delay ?? 0;
  const dt = v.delaytime ?? 0.25;
  const fb = v.delayfeedback ?? 0.5;
  if (d > 0 && dt > 0) {
    const t0 = now();
    let a = d;
    for (let k = 1; k <= 14 && a > 0.04; k++) {
      pending.push({ at: t0 + k * dt, ev: { ...base, amp: base.amp * a, echo: k } });
      a *= fb;
    }
  }
}

// ───────────────────────── barras de capas (sin texto) ─────────────────────────
const legendEl = document.getElementById('legend');
let legendRows = new Map();
function buildLegend(code) {
  const layers = layersFor(code).filter((l) => l.kind);
  legendEl.innerHTML = '';
  legendRows = new Map();
  for (const L of layers) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.setProperty('--c', KIND_COLOR[L.kind]);
    const fill = document.createElement('i');
    bar.appendChild(fill);
    legendEl.append(bar);
    legendRows.set(L.label, { bar, fill });
  }
}
function updateLegend(dt) {
  for (const [key, row] of legendRows) {
    const v = (level[key] = (level[key] || 0) * Math.pow(0.04, dt));
    row.fill.style.width = `${Math.round(v * 100)}%`;
    row.bar.style.opacity = 0.35 + Math.min(1, v * 1.5) * 0.65;
  }
}

// ───────────────────────── Strudel ─────────────────────────
const editorEl = document.querySelector('strudel-editor');
let mirror = null;
let playing = false;

function waitFor(fn) {
  return new Promise((res) => {
    const tick = () => (fn() ? res(fn()) : requestAnimationFrame(tick));
    tick();
  });
}

async function boot() {
  mirror = await waitFor(() => editorEl.editor);
  await waitFor(() => mirror.code && !mirror.code.startsWith('// LOADING'));

  // tipografía del editor
  mirror.setFontSize(12.5);
  mirror.setFontFamily('"JetBrains Mono", ui-monospace, monospace');
  buildLegend(mirror.code);
  codeView.setCode(mirror.code);

  // "noise" no existe en Strudel (sus ruidos son white / pink / brown / crackle):
  // lo registro como alias de "white" para que las dos capas de ruido suenen sin tocar el código.
  await mirror.prebaked;
  if (globalThis.getSound && !globalThis.getSound('noise')) globalThis.soundAlias?.('white', 'noise');

  // engancho el dibujado de Strudel: mismo loop que resalta el código
  const seen = new WeakSet();
  const original = mirror.onDraw.bind(mirror);
  mirror.onDraw = (haps, time, painters) => {
    original(haps, time, painters);
    const sch = mirror.repl.scheduler;
    const cps = sch.cps;
    codeView.setCode(mirror.code);
    activeRanges = [];
    for (const h of haps) {
      if (!h.isActive?.(time)) continue;
      const kind = classify(h, mirror.code).kind;
      for (const l of h.context?.locations || []) activeRanges.push({ start: l.start, end: l.end, kind });
    }
    for (const h of haps) {
      if (seen.has(h) || !h.hasOnset?.()) continue;
      const b = h.whole.begin.valueOf();
      if (b > time + 0.001) continue; // todavía no sonó
      seen.add(h);
      if (time - b > 0.25) continue; // viejo (p. ej. tras re-evaluar)
      try { onHap(h, mirror.code, cps); } catch (e) { console.warn(e); }
    }
  };

  editorEl.addEventListener('update', (e) => {
    const st = e.detail || {};
    if ('started' in st) playing = st.started;
    if (st.code !== undefined || st.activeCode !== undefined) buildLegend(mirror.code);
  });
  ready = true;
  if (wantStart) start();
}

// ───────────────────────── controles ─────────────────────────
let ready = false;
let starting = false;
let wantStart = false;
async function start() {
  if (!ready) { wantStart = true; return; } // se pidió antes de que carguen los sonidos: arranca al terminar
  if (playing || starting) return;
  starting = true;
  try { await mirror.evaluate(); } finally { starting = false; }
}
function toggle() {
  if (!mirror) { wantStart = true; return; }
  if (playing) mirror.stop();
  else start();
}
// ───────────────────────── teclado ─────────────────────────
// letras = notas (siempre del acorde que suena) · Shift+C/H/F = interfaz · espacio = tocar/detener
const KEY_ROWS = [
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'], // grave
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'], // medio
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'], // agudo
];
const KEY_BASE = [52, 64, 76]; // E3, E4, E5: cada fila arranca en su Mi
const SCALE_STEPS = [0, 2, 3, 5, 7, 8, 10]; // Mi menor natural desde Mi: E F# G A B C D
const keyNote = new Map();
KEY_ROWS.forEach((row, r) => row.forEach((code, i) => keyNote.set(code, { base: KEY_BASE[r], step: i })));

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('.cm-editor')) return; // dentro del editor mandan los atajos de Strudel
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); return; }
  if (e.shiftKey) {
    if (e.code === 'KeyC') document.body.classList.toggle('show-editor');
    if (e.code === 'KeyH') document.body.classList.toggle('hide-ui');
    if (e.code === 'KeyF') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    }
    return;
  }
  const k = keyNote.get(e.code);
  if (!k || e.repeat) return;
  e.preventDefault();
  // cada tecla = un grado de Mi menor = un pilar; la fila recorre el anillo entero
  const deg = k.step % 7, oct = Math.floor(k.step / 7);
  playNote(k.base + SCALE_STEPS[deg] + 12 * oct, false);
});

// ───────────────────────── cámara y pilares ─────────────────────────
// arrastrar = girar · rueda = acercar · click en un pilar = tocar su nota
let drag = null;
const uv = (e) => {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
};
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: 0 };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (drag && e.buttons === 0) drag = null; // se perdió el soltar: no dejar el arrastre pegado
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.moved > 4) scene.orbit(dx, dy);
    return;
  }
  const onBlob = scene.pickBlob(...uv(e));
  const hit = onBlob ? null : scene.pick(...uv(e));
  scene.setBlobHover(onBlob);
  scene.setHover(hit ? hit.f : -1);
  canvas.style.cursor = hit || onBlob ? 'pointer' : 'grab';
});
canvas.addEventListener('pointerup', (e) => {
  const click = drag && drag.moved <= 4;
  drag = null;
  if (!click) return;
  if (scene.pickBlob(...uv(e))) { toggle(); return; } // el blob frena / arranca
  const hit = scene.pick(...uv(e));
  if (hit) playStone(hit);
  else start();
});
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('pointerleave', () => { scene.setHover(-1); scene.setBlobHover(false); });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  scene.zoom(Math.exp(e.deltaY * 0.001));
}, { passive: false });

// ───────────────────────── armonía viva ─────────────────────────
// El acorde actual = clases de altura que tocaron el colchón y el arpegio en el último ciclo.
// Todo lo que toca el usuario (pilares, teclado) se ajusta a ese acorde y a la grilla rítmica.
const FALLBACK = [4, 7, 9, 11, 2]; // pentatónica de Mi menor
const recentHarmony = []; // {pc, at}
function noteHarmony(ev) {
  if (ev.echo || (ev.kind !== 'pad' && ev.kind !== 'arp')) return;
  recentHarmony.push({ pc: ((Math.round(ev.midi) % 12) + 12) % 12, at: now() });
  if (recentHarmony.length > 40) recentHarmony.shift();
}
function cycleSec() {
  const cps = mirror?.repl?.scheduler?.cps || 38 / 60;
  return 1 / cps;
}
function consonant() {
  if (!playing) return FALLBACK;
  const win = cycleSec() * 1.05, t = now();
  const set = new Set(recentHarmony.filter((h) => t - h.at < win).map((h) => h.pc));
  return set.size >= 2 ? [...set] : FALLBACK;
}
// la nota consonante más cercana (en semitonos) a la pedida
function snap(midi) {
  const pcs = consonant();
  let best = midi, bestD = 99;
  for (let d = 0; d <= 6; d++) {
    for (const m of [midi + d, midi - d]) {
      if (pcs.includes(((m % 12) + 12) % 12) && d < bestD) { best = m; bestD = d; }
    }
    if (bestD < 99) break;
  }
  return best;
}
// próxima corchea del ciclo (8 por ciclo) si la música está sonando
function quantizeDelay() {
  const sch = mirror?.repl?.scheduler;
  if (!playing || !sch) return 0;
  const c = sch.now();
  const next = Math.ceil(c * 8 + 0.02) / 8;
  return Math.max(0, (next - c) * cycleSec());
}

function playNote(midi, snapToChord = false) {
  if (!ready) return; // los samples todavía no cargaron
  if (snapToChord) midi = snap(midi);
  const wait = quantizeDelay();
  const value = { s: 'piano', note: midi, gain: 0.42, release: 2.7, room: 0.85, delay: 0.28, delaytime: 0.375, delayfeedback: 0.38 };
  try {
    const ctx = globalThis.getAudioContext?.();
    ctx?.resume?.();
    globalThis.superdough?.(value, (ctx?.currentTime ?? 0) + 0.03 + wait, 0.6);
  } catch (err) { console.warn(err); }
  const ev = { kind: 'melody', layerKey: 'MOTIVO PRINCIPAL', midi, gain: 0.42, amp: 1, pan: 0.5, attack: 0.01, release: 2.7, dur: 0.4, echo: 0, uid: ++uidSeq };
  const t0 = now() + wait;
  pending.push({ at: t0, ev });
  let a = 0.28;
  for (let k = 1; k <= 6 && a > 0.04; k++) {
    pending.push({ at: t0 + k * 0.375, ev: { ...ev, amp: a, echo: k } });
    a *= 0.38;
  }
}

// el pilar suena con su propia nota (siempre de Mi menor) en el piano del motivo;
// la altura del toque elige la octava.
function playStone(hit) {
  const pc = scene.stonePc(hit.f);
  const octave = 4 + Math.min(2, Math.floor(hit.y01 * 3));
  playNote((octave + 1) * 12 + pc);
}

requestAnimationFrame(frame);
boot();
