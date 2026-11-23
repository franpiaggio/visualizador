/*
 * ARCHIPIÉLAGO — puente entre Strudel y el mapa.
 *
 * Se engancha al loop de dibujo de Strudel (el mismo que resalta el código):
 * cada hap que empieza a sonar se clasifica por capa (el comentario // que lo
 * precede) y se manda al mapa. Los ecos del delay se re-disparan en
 * t + k·delaytime con ganancia feedback^k.
 *
 *   MOTIVO PRINCIPAL     → islas: cada nota levanta su isla (graves a la izquierda)
 *   ARPEGIO INFERIOR     → colinas más bajas y anchas
 *   GRAN COLCHÓN         → bajíos amplios que suben despacio
 *   DRONE PROFUNDO       → el fondo entero se eleva lento
 *   NUBE AGUDA           → islotes en la franja norte
 *   ECOS CASI COMO SONAR → sondeos: anillos punteados que se abren en el agua
 *   CHISPAS / REFLEJOS   → pozos pequeños y fugaces
 *   MASA DE RUIDO        → rugosidad del fondo
 *   RUIDO AGUDO          → temblor fino de las curvas
 *   PULSOS SUBGRAVES     → marea: el mar sube y una onda grande sale del centro
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

import { createMap } from './map.js';

const canvas = document.getElementById('map');
const map = createMap(canvas, { relief: document.getElementById('relief'), paper: document.getElementById('paper') });
window.MAP = map;
const pending = []; // ecos programados
let activeRanges = [];

function spawn(ev) {
  map.event(ev, now());
}

let lastT = now();
function frame() {
  const t = now();
  const dt = Math.min(0.05, t - lastT);
  lastT = t;
  for (let i = pending.length - 1; i >= 0; i--) {
    if (pending[i].at <= t) {
      spawn(pending[i].ev);
      pending.splice(i, 1);
    }
  }
  requestAnimationFrame(frame); // primero: un error en un cuadro no corta la animación
  map.setActive(activeRanges);
  map.setPlaying(playing);
  try { map.draw(t, dt); } catch (e) { window.__mapError = e; console.error(e); }
}

// el rango de código que originó el hap: el primero en el texto es el de la notación mini
function noteLoc(hap) {
  const locs = hap.context?.locations || [];
  let best = null;
  for (const l of locs) if (!best || l.start < best.start) best = l;
  return best;
}

// convierte un hap de Strudel en eventos del mapa (incluyendo sus ecos de delay)
function onHap(hap, code, cps) {
  const v = hap.value || {};
  const layer = classify(hap, code);
  const kind = layer.kind || 'melody';
  const midi = toMidi(v.note ?? v.n ?? (v.s === 'noise' ? 100 : 60));
  const gain = v.gain ?? 0.5;
  const durSec = (hap.duration?.valueOf?.() ?? 1) / (cps || 0.6);
  // ganancias muy distintas entre capas (0.018 … 0.38): se normalizan
  const REF = { melody: 0.38, arp: 0.2, pad: 0.055, drone: 0.11, cloud: 0.075, sonar: 0.065, sparks: 0.045, breath: 0.025, dust: 0.018, sub: 0.14 };
  const amp = clamp(gain / (REF[kind] || gain || 1));
  const base = { kind, midi, gain, amp, pan: v.pan ?? 0.5, dur: durSec, echo: 0, loc: noteLoc(hap) };
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
  mirror.setFontSize(12.5);
  mirror.setFontFamily('"JetBrains Mono", ui-monospace, monospace');
  map.setCode(mirror.code);

  // "noise" no existe en Strudel (sus ruidos son white / pink / brown / crackle):
  // se registra como alias de "white" para que las capas de ruido suenen sin tocar el código.
  await mirror.prebaked;
  if (globalThis.getSound && !globalThis.getSound('noise')) globalThis.soundAlias?.('white', 'noise');

  const seen = new WeakSet();
  const original = mirror.onDraw.bind(mirror);
  mirror.onDraw = (haps, time, painters) => {
    original(haps, time, painters); // conserva el resaltado del editor
    const cps = mirror.repl.scheduler.cps;
    map.setCode(mirror.code);
    activeRanges = [];
    for (const h of haps) {
      if (!h.isActive?.(time)) continue;
      for (const l of h.context?.locations || []) activeRanges.push({ start: l.start, end: l.end });
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
  });
  ready = true;
  if (wantStart || window.__early) start();
}

// ───────────────────────── controles ─────────────────────────
let ready = false;
let starting = false;
let wantStart = false;
async function start() {
  if (!ready) { wantStart = true; return; } // se pidió antes de que carguen los sonidos
  if (playing || starting) return;
  starting = true;
  try { await mirror.evaluate(); } finally { starting = false; }
}
function toggle() {
  if (!mirror) { wantStart = true; return; }
  if (playing) mirror.stop();
  else start();
}

// teclado: letras = notas de Mi menor (tres filas, tres octavas) · espacio = tocar/detener
// Shift+C = editor · Shift+F = pantalla completa
const KEY_ROWS = [
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'],
];
const KEY_BASE = [52, 64, 76]; // E3, E4, E5
const SCALE_STEPS = [0, 2, 3, 5, 7, 8, 10]; // Mi menor natural
const keyNote = new Map();
KEY_ROWS.forEach((row, r) => row.forEach((code, i) => keyNote.set(code, { base: KEY_BASE[r], step: i })));

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('.cm-editor')) return; // dentro del editor mandan los atajos de Strudel
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); return; }
  if (e.shiftKey) {
    if (e.code === 'KeyC') document.body.classList.toggle('show-editor');
    if (e.code === 'KeyF') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    }
    return;
  }
  const k = keyNote.get(e.code);
  if (!k || e.repeat) return;
  e.preventDefault();
  const deg = k.step % 7, oct = Math.floor(k.step / 7);
  playNote(k.base + SCALE_STEPS[deg] + 12 * oct);
});

// mouse: la rosa de los vientos frena / arranca; tocar el mapa levanta una isla ahí
// (la nota sale de la posición: graves a la izquierda, agudos a la derecha, siempre en el acorde)
canvas.addEventListener('pointermove', (e) => {
  const on = map.hitCompass(e.clientX, e.clientY);
  map.setHoverCompass(on);
  canvas.style.cursor = on ? 'pointer' : 'crosshair';
});
canvas.addEventListener('pointerdown', (e) => {
  if (map.hitCompass(e.clientX, e.clientY)) { toggle(); return; }
  if (!playing && !starting) { start(); return; }
  const p = map.pick(e.clientX, e.clientY);
  if (p) playNote(p.midi, true, [p.u, p.v]);
});

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

function playNote(midi, snapToChord = false, at = null) {
  if (!ready) return; // los samples todavía no cargaron
  if (snapToChord) midi = snap(midi);
  const wait = quantizeDelay();
  const value = { s: 'piano', note: midi, gain: 0.42, release: 2.7, room: 0.85, delay: 0.28, delaytime: 0.375, delayfeedback: 0.38 };
  try {
    const ctx = globalThis.getAudioContext?.();
    ctx?.resume?.();
    globalThis.superdough?.(value, (ctx?.currentTime ?? 0) + 0.03 + wait, 0.6);
  } catch (err) { console.warn(err); }
  const ev = { kind: 'melody', midi, gain: 0.42, amp: 1, pan: 0.5, dur: 0.4, echo: 0, at, user: true };
  const t0 = now() + wait;
  pending.push({ at: t0, ev });
  let a = 0.28;
  for (let k = 1; k <= 6 && a > 0.04; k++) {
    pending.push({ at: t0 + k * 0.375, ev: { ...ev, amp: a, echo: k } });
    a *= 0.38;
  }
}

requestAnimationFrame(frame);
boot();
