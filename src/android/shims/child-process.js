// child_process on Android: yt-dlp only — streaming.js's execFile of it is answered by the Streams plugin
// (StreamsPlugin.java: NewPipe's extractor, in yt-dlp's JSON; boot.entry.js sets it). Anything else (CDs, ripping,
// Discord…) fails plainly, as in not-on-android.js.
let ytDlp = null;
function execFile(file, args = [], opts = {}, cb = () => {}) {
  if (typeof args === 'function') { cb = args; args = []; opts = {}; }
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  if (!ytDlp || !/yt-dlp(\.exe)?$/.test(String(file))) {
    queueMicrotask(() => cb(Object.assign(new Error(`${file}: not on Android`), { code: 'ENOENT' }), '', ''));
    return { kill() {} };
  }
  ytDlp(args).then((stdout) => cb(null, stdout, ''), (e) => { const msg = String((e && e.message) || e); cb(Object.assign(new Error(msg), { code: 1 }), '', msg); });
  return { kill() {} };
}
const own = { execFile, __setYtDlp: (fn) => { ytDlp = fn; } };
const no = (name) => () => { throw new Error(`child_process.${name}: not on Android`); };
const proxy = new Proxy(own, { get: (t, key) => (key === '__esModule' ? false : key === 'default' ? proxy : key in t ? t[key] : no(String(key))) });
module.exports = proxy;
