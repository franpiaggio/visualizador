/*
 * CAJA DE MÚSICA — puente entre Strudel y el mecanismo.
 *
 * Cada capa del código es un cilindro de caja de música: cada nota es una púa. El ángulo
 * de la púa sale de en qué momento del ciclo suena; su lugar a lo largo del cilindro, de
 * qué nota es. Los cilindros giran con el reloj de Strudel (scheduler.now()), así cada púa
 * pasa por su diente del peine justo cuando suena. Los rangos activos de Strudel encienden
 * la púa y el diente; los eventos (haps) disparan chispas y polvo en la luz de la lámpara.
 */
import { layoutCode } from './codemap.js';
import { createCaja } from './caja.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
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
// colores de capa pensados para leerse sobre verde y azul de día
const KIND_COLOR = {
  melody: '#ffe9b0',
  arp: '#a9e4ff',
  pad: '#b9c8ff',
  drone: '#f2c46e',
  cloud: '#e3d6ff',
  sonar: '#8ff5ee',
  sparks: '#ffffff',
  breath: '#d9e6c8',
  dust: '#eaf6ff',
  sub: '#8fb2ff',
};

function parseLayers(code) {
  const out = [];
  const re = /\/\/[ \t]*(.+)/g;
  let m, lastEnd = -1;
  while ((m = re.exec(code))) {
    const between = lastEnd >= 0 ? code.slice(lastEnd, m.index) : 'x';
    const text = m[1].trim();
    if (out.length && /^\s*$/.test(between)) out[out.length - 1].sub = (out[out.length - 1].sub || '') + ' ' + text;
    else out.push({ start: m.index, label: text, kind: (KINDS.find(([, r]) => r.test(text)) || [null])[0] });
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
    for (const Ly of layers) if (Ly.start < pos) found = Ly;
    if (found?.kind) return found;
  }
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

// ───────────────────────── escena ─────────────────────────
// el código se lee de la página (build.py lo deja también en un <script type="text/plain">),
// así el paisaje se arma antes de que cargue Strudel
const CODE = document.getElementById('compo').textContent.replace(/^\n/, '');
const LAYERS = layersFor(CODE);
const layout = layoutCode(CODE, LAYERS);
const canvas = document.getElementById('stage');
const forest = createCaja(canvas, layout, KIND_COLOR);
window.CAJA = forest;
window.LAYOUT = layout; // depuración

const pending = [];
let uidSeq = 0;
let activeRanges = [];

function artSize() {
  const w = window.innerWidth, h = window.innerHeight;
  const AW = Math.round(Math.min(1040, Math.max(560, w / 1.6)));
  return [AW, Math.round((AW * h) / w)];
}

let lastT = now();
function frame() {
  const t = now();
  const dt = Math.min(0.05, t - lastT);
  lastT = t;
  for (let i = pending.length - 1; i >= 0; i--) {
    if (pending[i].at <= t) { forest.spawn(pending[i].ev); pending.splice(i, 1); }
  }
  const [w, h] = artSize();
  forest.setClock(playing && mirror?.repl?.scheduler ? mirror.repl.scheduler.now() : null);
  forest.frame(w, h);
  forest.setActive(activeRanges);
  requestAnimationFrame(frame);
}

function noteLoc(hap) {
  let best = null;
  for (const l of hap.context?.locations || []) if (!best || l.start < best.start) best = l;
  return best;
}

function onHap(hap, code, cps) {
  const v = hap.value || {};
  const layer = classify(hap, code);
  const kind = layer.kind || 'melody';
  const gain = v.gain ?? 0.5;
  const REF = { melody: 0.38, arp: 0.2, pad: 0.055, drone: 0.11, cloud: 0.075, sonar: 0.065, sparks: 0.045, breath: 0.025, dust: 0.018, sub: 0.14 };
  const base = {
    kind,
    layerKey: layer.start >= 0 ? layer.label : kind,
    midi: toMidi(v.note ?? v.n ?? 60),
    amp: clamp(gain / (REF[kind] || gain || 1)),
    echo: 0,
    uid: ++uidSeq,
    loc: noteLoc(hap),
    dur: (hap.duration?.valueOf?.() ?? 1) / (cps || 0.6),
  };
  forest.spawn(base);
  // ecos del delay: cada repetición vuelve a dibujarse, más débil
  const d = v.delay ?? 0, dt = v.delaytime ?? 0.25, fb = v.delayfeedback ?? 0.5;
  if (d > 0 && dt > 0) {
    const t0 = now();
    let a = d;
    for (let k = 1; k <= 12 && a > 0.05; k++) {
      pending.push({ at: t0 + k * dt, ev: { ...base, amp: base.amp * a, echo: k } });
      a *= fb;
    }
  }
}

// ───────────────────────── Strudel ─────────────────────────
const editorEl = document.querySelector('strudel-editor');
let mirror = null;
let playing = false;
let ready = false, starting = false, wantStart = false;

const waitFor = (fn) => new Promise((res) => { const tick = () => (fn() ? res(fn()) : requestAnimationFrame(tick)); tick(); });

async function boot() {
  mirror = await waitFor(() => editorEl.editor);
  await waitFor(() => mirror.code && !mirror.code.startsWith('// LOADING'));
  mirror.setFontSize(12.5);
  mirror.setFontFamily('"JetBrains Mono", ui-monospace, monospace');
  // los offsets de Strudel se cuentan sobre su copia del código: se alinean con la nuestra
  const probe = CODE.trim().slice(0, 40);
  const shift = mirror.code.indexOf(probe) - CODE.indexOf(probe);
  forest.setLocShift(shift);

  await mirror.prebaked;
  // "noise" no existe en Strudel: alias de "white" para que suenen las capas de ruido
  if (globalThis.getSound && !globalThis.getSound('noise')) globalThis.soundAlias?.('white', 'noise');

  const seen = new WeakSet();
  const original = mirror.onDraw.bind(mirror);
  mirror.onDraw = (haps, time, painters) => {
    original(haps, time, painters);
    const cps = mirror.repl.scheduler.cps;
    activeRanges = [];
    for (const h of haps) {
      if (!h.isActive?.(time)) continue;
      const kind = classify(h, mirror.code).kind;
      for (const l of h.context?.locations || []) activeRanges.push({ start: l.start, end: l.end, kind });
    }
    for (const h of haps) {
      if (seen.has(h) || !h.hasOnset?.()) continue;
      const b = h.whole.begin.valueOf();
      if (b > time + 0.001) continue;
      seen.add(h);
      if (time - b > 0.25) continue;
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

async function start() {
  if (!ready) { wantStart = true; return; }
  if (playing || starting) return;
  starting = true;
  try { await mirror.evaluate(); } finally { starting = false; }
}
function toggle() {
  if (!mirror || !ready) { wantStart = true; return; }
  if (playing) mirror.stop();
  else start();
}

// ───────────────────────── controles ─────────────────────────
// arrastrar = girar alrededor de la caja · rueda = acercar · click = arrancar · espacio = tocar/detener
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (drag && e.buttons === 0) drag = null;
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  drag.x = e.clientX; drag.y = e.clientY;
  if (drag.moved > 4) forest.orbit(dx, dy);
});
canvas.addEventListener('pointerup', () => {
  const click = drag && drag.moved <= 4;
  drag = null;
  if (click && !playing) start();
});
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); forest.zoom(Math.exp(e.deltaY * 0.001)); }, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('.cm-editor')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); return; }
  if (!e.shiftKey) return;
  if (e.code === 'KeyC') document.body.classList.toggle('show-editor');
  if (e.code === 'KeyF') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  }
});

requestAnimationFrame(frame);
boot();
