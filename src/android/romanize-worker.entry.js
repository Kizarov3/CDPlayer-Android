// The desktop's romanize-worker.js as a Web Worker for Android: the same romanizeLines, kuromoji's browser build
// reading its dictionary from the app's files (kuromoji-dict/, next to this script, unzipped).
const { romanizeLines } = require('../main/karaoke/romanize');
const BrowserDictionaryLoader = require('kuromoji/src/loader/BrowserDictionaryLoader');

// The dictionary's files are unzipped in the app (scripts/build-android.mjs): asked for without .gz, taken as they come.
BrowserDictionaryLoader.prototype.loadArrayBuffer = (url, callback) => {
  fetch(url.replace(/\.gz$/, '')).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${url}: ${r.status}`))))
    .then((buffer) => callback(null, buffer), (e) => callback(e, null));
};

let reader = null;
const tokenizer = () => reader || (reader = new Promise((resolve, reject) => {
  const kuromoji = require('kuromoji');
  kuromoji.builder({ dicPath: 'kuromoji-dict/' }).build((e, t) => (e ? reject(e) : resolve(t)));
}));
self.onmessage = async ({ data: { id, texts } }) => {
  try { self.postMessage({ id, lines: await romanizeLines(texts, { tokenizer }) }); }
  catch (e) { self.postMessage({ id, error: String((e && e.message) || e) }); }
};
