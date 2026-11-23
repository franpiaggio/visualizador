/*
 * El código como paisaje: layout.
 *
 * Cada capa de la composición (cada bloque "// NOMBRE") es una columna de texto, y cada
 * columna es un prado abierto en el bosque donde el código está plantado con flores
 * (ver font3x5.js: un punto = una flor). Las columnas se tienden una al lado de la otra
 * a lo largo de la franja; el dron, al avanzar, lee la partitura.
 *
 * Además del layout, clasifica cada carácter (comentario, nota, función, texto, número,
 * signo) para plantarlo con la flor que le corresponde.
 */
import { GLYPH_W, GLYPH_H } from './font3x5.js';

export const DOT = 0.075; // distancia entre flores
export const CHAR_W = GLYPH_W * DOT; // 0,3
export const LINE_H = GLYPH_H * DOT; // 0,525
const COL_GAP = 8.5; // entre prado y prado, una escena del paisaje (ver forest.js)
const MARGIN_X = 2.1;
const isMark = (ch) => /[̀-ͯ]/.test(ch);

// tipo de cada carácter, con estado entre líneas (la mini-notación vive entre backticks)
function classifyChars(code) {
  const kind = new Uint8Array(code.length); // 0 signo, 1 comentario, 2 nota/mini, 3 función, 4 texto, 5 número
  let inTick = false, inStr = false, inCom = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '\n') { inCom = false; continue; }
    if (inCom) { kind[i] = 1; continue; }
    if (!inStr && !inTick && ch === '/' && code[i + 1] === '/') { inCom = true; kind[i] = 1; continue; }
    if (!inStr && ch === '`') { inTick = !inTick; kind[i] = 0; continue; }
    if (!inTick && ch === '"') { inStr = !inStr; kind[i] = 4; continue; }
    if (inStr) { kind[i] = 4; continue; }
    if (inTick) { kind[i] = /[\[\]<>~]/.test(ch) ? 0 : 2; continue; }
    if (/[\d.]/.test(ch) && /[\d.(,\s]/.test(code[i - 1] || ' ')) { kind[i] = 5; continue; }
    if (/[A-Za-z_]/.test(ch)) { kind[i] = 3; continue; }
    kind[i] = 0;
  }
  return kind;
}

export function layoutCode(code, layers) {
  const cuts = layers.map((l) => l.start);
  if (!cuts.length) cuts.push(0);
  cuts[0] = 0;
  const blocks = cuts.map((s, i) => ({ start: s, end: i + 1 < cuts.length ? cuts[i + 1] : code.length, layer: layers[i] }));
  const ckind = classifyChars(code);

  const charPos = new Int32Array(code.length * 3).fill(-1); // columna, línea, posición
  let x = MARGIN_X;
  const cols = [];
  let maxLines = 0;
  blocks.forEach((b, ci) => {
    const text = code.slice(b.start, b.end);
    let lines = text.split('\n');
    let off = b.start;
    while (lines.length && !lines[0].trim()) { off += lines[0].length + 1; lines.shift(); }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
    const cells = []; // por línea: [{ch, c, off, k}]
    const shown = [];
    const offsets = [];
    let width = 0;
    lines.forEach((ln, li) => {
      const row = [];
      let c = 0;
      for (let k = indent; k < ln.length; k++) {
        const o = off + k, ch = ln[k];
        if (isMark(ch)) { // la tilde combinada comparte el lugar de su letra
          if (row.length) { charPos[o * 3] = ci; charPos[o * 3 + 1] = li; charPos[o * 3 + 2] = c - 1; }
          continue;
        }
        charPos[o * 3] = ci; charPos[o * 3 + 1] = li; charPos[o * 3 + 2] = c;
        row.push({ ch, c, off: o, k: ckind[o] });
        c++;
      }
      cells.push(row);
      shown.push(row.map((r) => r.ch).join(''));
      offsets.push(off + indent);
      off += ln.length + 1;
      width = Math.max(width, c);
    });
    cols.push({ x, cells, lines: shown, offsets, width: width * CHAR_W, nlines: lines.length, kind: b.layer?.kind || null, label: b.layer?.label || '' });
    maxLines = Math.max(maxLines, lines.length);
    x += width * CHAR_W + COL_GAP;
  });
  const W = x - COL_GAP + MARGIN_X * 2 + COL_GAP * 0.5;
  const H = maxLines * LINE_H;
  // las columnas cortas se centran en z: los prados no quedan alineados como una grilla
  for (const c of cols) c.z = (maxLines - c.nlines) * LINE_H * 0.5;

  function rects(start, end) {
    const out = [];
    let cur = null;
    for (let o = start; o < end && o < code.length; o++) {
      const ci = charPos[o * 3];
      if (ci < 0) continue;
      const li = charPos[o * 3 + 1], c = charPos[o * 3 + 2];
      if (cur && cur.ci === ci && cur.li === li && c <= cur.c1) cur.c1 = Math.max(cur.c1, c + 1);
      else {
        if (cur) out.push(cur);
        cur = { ci, li, c0: c, c1: c + 1 };
      }
    }
    if (cur) out.push(cur);
    return out.map(({ ci, li, c0, c1 }) => {
      const col = cols[ci];
      return { x0: col.x + c0 * CHAR_W, x1: col.x + c1 * CHAR_W, z0: col.z + li * LINE_H, z1: col.z + (li + 1) * LINE_H, col: ci };
    });
  }

  // carácter en una posición del suelo; x ya viene dentro de [0, período)
  function charAt(wx, wz) {
    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci];
      if (wx < col.x - 0.2 || wx > col.x + col.width + 0.2) continue;
      const li = Math.floor((wz - col.z) / LINE_H);
      if (li < 0 || li >= col.lines.length) return null;
      return { ci, li, c: Math.floor((wx - col.x) / CHAR_W), line: col.lines[li] };
    }
    return null;
  }

  // Tokens que suenan: lo que está dentro de la mini-notación (backticks) o de un patrón entre
  // comillas. Cada uno es un objeto en el paisaje. Tipos: nota, silencio (~), número, palabra.
  // También los corchetes de cada línea: cada [...] es un cantero.
  for (const col of cols) {
    col.tokens = [];
    col.beds = [];
    col.cells.forEach((row, li) => {
      let cur = null;
      const flush = () => {
        if (!cur) return;
        const t = cur.text;
        cur.type = /^[a-g][#bs]*-?\d+$/i.test(t) ? 'note' : /^-?\.?\d/.test(t) ? 'num' : 'word';
        col.tokens.push(cur);
        cur = null;
      };
      let open = null;
      for (const cell of row) {
        const inPat = cell.k === 2 || cell.k === 4;
        if (cell.ch === '[') open = cell.c;
        if (cell.ch === ']' && open !== null) { col.beds.push({ li, c0: open, c1: cell.c + 1 }); open = null; }
        if (cell.ch === '~' ) { flush(); col.tokens.push({ li, c0: cell.c, c1: cell.c + 1, off0: cell.off, off1: cell.off + 1, text: '~', type: 'rest' }); continue; }
        if (inPat && /[A-Za-z0-9#.\-]/.test(cell.ch)) {
          if (cur && cur.c1 === cell.c) { cur.c1++; cur.off1 = cell.off + 1; cur.text += cell.ch; }
          else { flush(); cur = { li, c0: cell.c, c1: cell.c + 1, off0: cell.off, off1: cell.off + 1, text: cell.ch }; }
        } else flush();
      }
      flush();
    });
  }

  return { cols, W, H, rects, charAt, charPos };
}
