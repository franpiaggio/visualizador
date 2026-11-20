/*
 * El código como parte de la escena.
 *
 * Se dibuja en un canvas a resolución "de arte" (pixelado igual que el 3D),
 * con una tipografía de terminal de píxeles. Dos capas:
 *
 *  1. Una columna-partitura: el código completo, tenue, que se desplaza como
 *     un cabezal de lectura hacia la línea que acaba de sonar. Los tokens que
 *     están sonando llevan el recuadro de Strudel, en el color de su capa.
 *  2. Etiquetas en el espacio: cada evento deja su línea de código flotando
 *     junto a la luz que generó en 3D (con el token enmarcado y una línea guía),
 *     y su reflejo invertido y quebrado sobre el agua.
 */

const FONT_PX = 16;
const LINE_H = 15;
const FONT = `${FONT_PX}px "VT323", ui-monospace, monospace`;

export function createCodeView(canvas, colors) {
  const ctx = canvas.getContext('2d');
  let code = '';
  let lines = [];
  let lineStarts = [];
  let charW = 8;
  let active = []; // [{start,end,kind}]
  let tags = [];
  let scroll = 0, scrollTarget = 0, lastFocusAt = -99;
  let fontReady = false;
  document.fonts?.load(FONT).then(() => { fontReady = true; measure(); });

  function measure() {
    ctx.font = FONT;
    charW = ctx.measureText('m').width || 8;
  }
  measure();

  function setCode(c) {
    if (c === code) return;
    code = c;
    lines = c.split('\n');
    lineStarts = [];
    let p = 0;
    for (const l of lines) { lineStarts.push(p); p += l.length + 1; }
  }

  function lineOf(offset) {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // ubica un rango del código: línea, columna, y la línea recortada para mostrar
  function locate(start, end) {
    const ln = lineOf(start);
    const raw = lines[ln] ?? '';
    const indent = raw.length - raw.trimStart().length;
    return { ln, col: start - lineStarts[ln], len: Math.max(1, end - start), raw, indent };
  }

  function setActive(list) { active = list; }

  // un evento nuevo: mueve el cabezal de lectura y deja una etiqueta en 3D
  function event({ start, end, kind, anchor, t }) {
    if (!code) return;
    const L = locate(start, end);
    if (t - lastFocusAt > 1.6 || kind === 'melody') {
      scrollTarget = L.ln;
      lastFocusAt = t;
    }
    if (anchor) {
      tags.push({ ...L, kind, anchor, t, life: kind === 'pad' || kind === 'drone' || kind === 'breath' ? 3.2 : 2.2 });
      if (tags.length > 28) tags.shift();
    }
  }

  // coloreado sintáctico mínimo, en la paleta de la escena
  function tokenColor(lineText, i) {
    const trimmed = lineText.trimStart();
    if (trimmed.startsWith('//')) return [110, 128, 150];
    return null;
  }

  function drawLine(text, x, y, alpha, kindRanges) {
    const isComment = text.trimStart().startsWith('//');
    // tramos: método (.algo), números, notas, resto
    const re = /(\.[a-zA-Z]+)|(\d*\.?\d+)|([a-g][#sb]?\d)|(~)|([^.\da-g~]+|.)/g;
    let m;
    while ((m = re.exec(text))) {
      const s = m[0];
      let c;
      if (isComment) c = [104, 122, 146];
      else if (m[1]) c = [120, 196, 196];
      else if (m[2]) c = [214, 176, 120];
      else if (m[3]) c = [236, 228, 210];
      else if (m[4]) c = [70, 84, 104];
      else c = [150, 162, 182];
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
      ctx.fillText(s, Math.round(x + m.index * charW), y);
    }
  }

  function box(x, y, w, color, alpha, fill = 0.14) {
    const X = Math.round(x) - 1.5, Y = Math.round(y) - 1.5, H = LINE_H + 1;
    ctx.fillStyle = color.replace('A', fill * alpha);
    ctx.fillRect(X, Y, Math.round(w) + 3, H);
    ctx.strokeStyle = color.replace('A', alpha);
    ctx.lineWidth = 1;
    ctx.strokeRect(X, Y, Math.round(w) + 3, H);
  }

  const rgba = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},A)`;
  };

  function draw({ width, height, t, dt, project, column, columnWidth }) {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.clearRect(0, 0, width, height);
    if (!code) return;
    ctx.font = FONT;
    ctx.textBaseline = 'top';

    // ── columna-partitura ──
    if (column) {
      scroll += (scrollTarget - scroll) * Math.min(1, dt * 2.2);
      const x0 = 14;
      const centerY = height * 0.44;
      const first = Math.max(0, Math.floor(scroll - centerY / LINE_H) - 1);
      const last = Math.min(lines.length - 1, Math.ceil(scroll + (height - centerY) / LINE_H) + 1);
      const activeByLine = new Map();
      for (const a of active) {
        const L = locate(a.start, a.end);
        if (!activeByLine.has(L.ln)) activeByLine.set(L.ln, []);
        activeByLine.get(L.ln).push({ ...L, kind: a.kind });
      }
      for (let ln = first; ln <= last; ln++) {
        const y = Math.round(centerY + (ln - scroll) * LINE_H);
        const d = Math.abs(y - centerY) / (height * 0.5);
        const fade = Math.max(0, 1 - d * d * 1.15);
        if (fade <= 0.01) continue;
        const hits = activeByLine.get(ln);
        const alpha = (hits ? 0.95 : 0.42) * fade;
        drawLine(lines[ln], x0, y, alpha);
        if (hits) {
          for (const h of hits) {
            box(x0 + h.col * charW, y, h.len * charW, rgba(colors[h.kind] || '#e9e2d4'), 0.95 * fade);
          }
        }
      }
      // cabezal de lectura
      ctx.fillStyle = 'rgba(233,226,212,0.18)';
      ctx.fillRect(2, Math.round(centerY + (scrollTarget - scroll) * LINE_H) + 2, 3, LINE_H - 4);
      void columnWidth;
    }

    // ── etiquetas en el espacio ──
    tags = tags.filter((g) => t - g.t < g.life);
    for (const g of tags) {
      const age = t - g.t;
      const k = 1 - age / g.life;
      const a = Math.min(1, age * 8) * k * k;
      const p = project(g.anchor);
      if (!p) continue;
      const [u, v] = p;
      const ax = u * width, ay = v * height;
      const text = g.raw.trim();
      const tw = text.length * charW;
      const tx = Math.round(ax + 10), ty = Math.round(ay - 26 - age * 4);
      const col = rgba(colors[g.kind] || '#e9e2d4');
      // guía
      ctx.strokeStyle = col.replace('A', 0.45 * a);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(ax) + 0.5, Math.round(ay) + 0.5);
      ctx.lineTo(tx - 2.5, ty + LINE_H + 0.5);
      ctx.lineTo(tx + Math.min(tw, 40), ty + LINE_H + 0.5);
      ctx.stroke();
      // línea de código con el token enmarcado
      drawLine(text, tx, ty, 0.75 * a);
      const tokenX = tx + (g.col - g.indent) * charW;
      box(tokenX, ty, g.len * charW, col, a, 0.2);

      // reflejo sobre el agua
      const r = project([g.anchor[0], -g.anchor[1] - 0.25, g.anchor[2]]);
      if (r && g.anchor[1] > 0.2) {
        const rx = r[0] * width, ry = r[1] * height;
        ctx.save();
        ctx.translate(Math.round(rx + 10 + Math.sin(t * 2 + g.t) * 2), Math.round(ry + 12));
        ctx.scale(1, -0.7);
        ctx.globalAlpha = 0.22 * a;
        drawLine(text, 0, 0, 0.8);
        box((g.col - g.indent) * charW, 0, g.len * charW, col, 1, 0.2);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }
  }

  return { setCode, setActive, event, draw, get fontReady() { return fontReady; } };
}
