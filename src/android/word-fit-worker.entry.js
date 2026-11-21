// The desktop's karaoke/worker.js as a Web Worker for Android: the same fitWords and phones, the models from the app's
// files (karaoke/models/, next to this script) in onnxruntime-web's WebAssembly — on one thread: a WebView page isn't
// cross-origin isolated, so it has no SharedArrayBuffer for more.
const ort = require('onnxruntime-web/wasm');
const { fitWords, SPLEETER } = require('../main/karaoke/fit-words');
const { readsAsEnglish } = require('../main/karaoke/phones');

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
// (the loader as .js: the app's server doesn't name .mjs as a script)
ort.env.wasm.wasmPaths = { mjs: new URL('ort/ort-wasm-simd-threaded.js', self.location.href).href, wasm: new URL('ort/ort-wasm-simd-threaded.wasm', self.location.href).href };
ort.env.logLevel = 'error';

let sessions = null;
async function load() {
  if (sessions) return sessions;
  const open = async (name) => {
    const r = await fetch(`karaoke/models/${name}`);
    if (!r.ok) throw new Error(`${name}: ${r.status}`);
    return ort.InferenceSession.create(new Uint8Array(await r.arrayBuffer()), { executionProviders: ['wasm'] });
  };
  sessions = { vocals: await open('vocals.int8.onnx'), band: await open('accompaniment.int8.onnx'), aligner: await open('aligner.onnx') };
  return sessions;
}
const { bins, split } = SPLEETER;
async function voiceMask(mags) {
  const s = await load(), x = new Float32Array(2 * split * bins);
  x.set(mags[0], 0); x.set(mags[1], split * bins);
  const input = new ort.Tensor('float32', x, [2, 1, split, bins]);
  const v = (await s.vocals.run({ x: input })).y.data, a = (await s.band.run({ x: input })).y.data;
  const masks = [new Float32Array(split * bins), new Float32Array(split * bins)];
  for (let i = 0; i < x.length; i++) { const vv = v[i] * v[i], aa = a[i] * a[i]; masks[i < split * bins ? 0 : 1][i < split * bins ? i : i - split * bins] = (vv + 5e-11) / (vv + aa + 1e-10); }
  return masks;
}
async function phoneProbabilities(mel, T) {
  const s = await load(), out = (await s.aligner.run({ mel: new ort.Tensor('float32', mel, [1, 1, 128, T]) })).logits, [, frames, classes] = out.dims;
  const data = new Float32Array(frames * classes);
  for (let t = 0; t < frames; t++) {
    let top = -Infinity, sum = 0;
    const row = t * classes;
    for (let c = 0; c < classes; c++) if (out.data[row + c] > top) top = out.data[row + c];
    for (let c = 0; c < classes; c++) sum += Math.exp(out.data[row + c] - top);
    const norm = top + Math.log(sum);
    for (let c = 0; c < classes; c++) data[row + c] = out.data[row + c] - norm;
  }
  return { data, frames, classes };
}
self.onmessage = async ({ data: { id, left, right, lines, onlyRead } }) => {
  try {
    if (onlyRead) { self.postMessage({ id, reads: readsAsEnglish(lines.map((l) => l.words)) }); return; }
    const words = await fitWords({ left, right }, lines, { voiceMask, phoneProbabilities }, (progress) => self.postMessage({ id, progress }));
    self.postMessage({ id, words });
  } catch (e) {
    self.postMessage({ id, error: String((e && e.message) || e) });
  }
};
