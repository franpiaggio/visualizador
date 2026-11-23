/*
 * Ambiente del video de referencia: agua, viento en las hojas y aves (grabaciones CC0).
 * Suena debajo de la música, en loop, con un fundido cruzado entre vueltas para que
 * no se note el corte. Usa el mismo AudioContext que Strudel.
 */
const GAIN = 0.55;
const XFADE = 3; // segundos de fundido entre una vuelta y la siguiente

export function createAmbience(url) {
  let started = false;
  let buf = null;
  let ctx = null;
  let out = null;
  const data = fetch(url).then((r) => r.arrayBuffer()).catch(() => null);

  async function start(audioCtx) {
    if (started) return;
    ctx = audioCtx || (globalThis.__ambCtx ||= new AudioContext());
    started = true;
    try {
      await ctx.resume?.();
      const ab = await data;
      if (!ab) return;
      buf = await ctx.decodeAudioData(ab.slice(0));
      out = ctx.createGain();
      out.gain.value = GAIN;
      out.connect(ctx.destination);
      loop(ctx.currentTime + 0.1);
    } catch (e) {
      console.warn('ambiente', e);
    }
  }

  // cada vuelta entra con fundido mientras la anterior se apaga
  function loop(at) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(1, at + XFADE);
    g.gain.setValueAtTime(1, at + buf.duration - XFADE);
    g.gain.linearRampToValueAtTime(0, at + buf.duration);
    src.connect(g).connect(out);
    src.start(at);
    src.stop(at + buf.duration + 0.05);
    const next = at + buf.duration - XFADE;
    setTimeout(() => loop(next), Math.max(0, (next - ctx.currentTime - 1) * 1000));
  }

  return { start };
}
