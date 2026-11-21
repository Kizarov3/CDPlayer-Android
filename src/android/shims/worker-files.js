// fs and zlib for the desktop's karaoke code inside a Web Worker (word-fit-worker.entry.js), which has no NativeFs:
// a file of the app's is read from beside the worker by a synchronous request (allowed in a worker). The build puts
// the .gz ones there unzipped (Android's packaging would unzip them anyway), so they're asked for without .gz and
// gunzipSync gives back what it's given.
const { Buffer } = require('buffer');

function readFileSync(p, opts) {
  const url = String(p).replace(/^\/+/, '').replace(/\.gz$/, '');
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);
  xhr.responseType = 'arraybuffer';
  xhr.send();
  if (xhr.status !== 200 && xhr.status !== 0) throw Object.assign(new Error(`ENOENT: ${url}`), { code: 'ENOENT' });
  const b = Buffer.from(xhr.response);
  const enc = typeof opts === 'string' ? opts : opts && opts.encoding;
  return enc ? b.toString(enc) : b;
}

module.exports = { readFileSync, gunzipSync: (b) => b, default: { readFileSync } };
