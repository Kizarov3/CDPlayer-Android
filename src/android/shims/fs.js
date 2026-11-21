// Node's fs for the desktop's main-process code running in the page, over CdpNativeFs (NativeFs.java: synchronous, as
// Node's sync calls are). The promise and callback forms run the same synchronous calls. What isn't here throws, so a
// gap shows up in testing instead of failing quietly.

const native = () => {
  const n = globalThis.CdpNativeFs;
  if (!n) throw new Error('CdpNativeFs is missing');
  return n;
};
function fail(answer, syscall, path) {
  let info = {};
  try { info = JSON.parse(answer); } catch { /* not JSON */ }
  const code = info.error || 'EIO';
  const e = new Error(`${code}: ${info.message || 'error'}, ${syscall} '${path}'`);
  Object.assign(e, { code, syscall, path, errno: -1 });
  return e;
}
const isError = (s) => typeof s === 'string' && s.startsWith('{"error"');
const call = (syscall, path, fn) => {
  const r = fn(native());
  if (isError(r)) throw fail(r, syscall, path);
  return r;
};
const toB64 = (data, enc) => (typeof data === 'string' ? Buffer.from(data, enc && enc !== 'utf-8' ? enc : 'utf8') : Buffer.from(data.buffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data)).toString('base64');
const encOf = (o) => (typeof o === 'string' ? o : o && o.encoding) || null;
const P = (p) => (p instanceof URL ? decodeURIComponent(p.pathname) : String(p));

// The app's own files (/app/src/locales/…), read-only, from the bundle.
let bundledFiles = null;
const bundled = () => (bundledFiles ||= require('../bundled-files.js'));
const appFile = (p) => (p.startsWith('/app/') ? bundled()[p] : undefined);
const appDir = (p) => {
  if (!p.startsWith('/app/')) return null;
  const pre = p.endsWith('/') ? p : `${p}/`;
  const names = new Map();
  for (const k of Object.keys(bundled())) if (k.startsWith(pre)) { const rest = k.slice(pre.length); const i = rest.indexOf('/'); names.set(i < 0 ? rest : rest.slice(0, i), i >= 0); }
  return names.size ? [...names] : null;
};
const enoent = (syscall, p) => Object.assign(new Error(`ENOENT: no such file or directory, ${syscall} '${p}'`), { code: 'ENOENT', syscall, path: p, errno: -2 });

class Stats {
  constructor(s) {
    this.size = s.size; this.mtimeMs = s.mtimeMs; this.mtime = new Date(s.mtimeMs);
    this.atimeMs = this.ctimeMs = this.birthtimeMs = s.mtimeMs; this.atime = this.ctime = this.birthtime = this.mtime;
    this.mode = s.isDir ? 0o40755 : 0o100644; this._dir = s.isDir;
  }
  isDirectory() { return this._dir; }
  isFile() { return !this._dir; }
  isSymbolicLink() { return false; }
}
class Dirent {
  constructor(name, dir, parentPath) { this.name = name; this._dir = dir; this.parentPath = this.path = parentPath; }
  isDirectory() { return this._dir; }
  isFile() { return !this._dir; }
  isSymbolicLink() { return false; }
}

function statSync(p, opts) {
  p = P(p);
  if (p.startsWith('/app/')) {
    const f = appFile(p), d = f === undefined && appDir(p);
    if (f !== undefined || d) return new Stats({ size: f !== undefined ? f.length : 0, mtimeMs: 0, isDir: f === undefined });
    if (opts && opts.throwIfNoEntry === false) return undefined;
    throw enoent('stat', p);
  }
  const r = native().stat(p);
  if (isError(r)) { if (opts && opts.throwIfNoEntry === false && r.includes('ENOENT')) return undefined; throw fail(r, 'stat', p); }
  return new Stats(JSON.parse(r));
}
const existsSync = (p) => { try { return P(p).startsWith('/app/') ? !!statSync(p, { throwIfNoEntry: false }) : !isError(native().stat(P(p))); } catch { return false; } };
function readdirSync(p, opts) {
  p = P(p);
  const list = p.startsWith('/app/') ? appDir(p) : JSON.parse(call('scandir', p, (n) => n.readdir(p)));
  if (!list) throw enoent('scandir', p);
  if (opts && opts.recursive) throw new Error('fs.readdirSync({ recursive }) not on Android');
  return opts && opts.withFileTypes ? list.map(([name, dir]) => new Dirent(name, dir, p)) : list.map(([name]) => name);
}
function readFileSync(p, opts) {
  p = P(p);
  const own = appFile(p);
  if (p.startsWith('/app/') && own === undefined) throw enoent('open', p);
  const buf = own !== undefined ? Buffer.from(own, 'utf8') : Buffer.from(call('open', p, (n) => n.read(p, 0, -1)), 'base64');
  const enc = encOf(opts);
  return enc ? buf.toString(enc) : buf;
}
const writeFileSync = (p, data, opts) => { p = P(p); call('open', p, (n) => n.write(p, toB64(data, encOf(opts)), false)); written(p); };
const appendFileSync = (p, data, opts) => { p = P(p); call('open', p, (n) => n.write(p, toB64(data, encOf(opts)), true)); };
function mkdirSync(p, opts) {
  p = P(p);
  if (!(opts && opts.recursive) && existsSync(p)) { const e = new Error(`EEXIST: file already exists, mkdir '${p}'`); e.code = 'EEXIST'; throw e; }
  call('mkdir', p, (n) => n.mkdirs(p));
}
const renameSync = (a, b) => { a = P(a); b = P(b); call('rename', a, (n) => n.rename(a, b)); written(b); };
const unlinkSync = (p) => { p = P(p); call('unlink', p, (n) => n.remove(p, false)); };
function rmSync(p, opts = {}) {
  p = P(p);
  try { call('rm', p, (n) => n.remove(p, !!opts.recursive)); } catch (e) { if (!(opts.force && e.code === 'ENOENT')) throw e; }
}
const rmdirSync = (p, opts) => rmSync(p, opts);
const copyFileSync = (a, b) => { a = P(a); b = P(b); call('copyfile', b, (n) => n.write(b, call('copyfile', a, (m) => m.read(a, 0, -1)), false)); };
const realpathSync = (p) => { p = P(p); return JSON.parse(call('realpath', p, (n) => n.realpath(p))).path; };
const accessSync = (p) => { statSync(p); };

// A FileHandle as strtok3 uses it for music-metadata's parseFile. Tag parsers read in many small pieces; each trip
// over the bridge costs about a millisecond, so a block of READ_AHEAD bytes is fetched at a time and the small reads
// served from it.
const READ_AHEAD = 128 * 1024;
class FileHandle {
  constructor(path) { this.path = path; this.fd = 3; this.block = null; this.blockAt = 0; }
  stat() { return settle(() => statSync(this.path)); }
  read(buffer, offset = 0, length = buffer.byteLength - offset, position = 0) {
    return settle(() => {
      const at = Number(position);
      if (!this.block || at < this.blockAt || at + length > this.blockAt + this.block.length) {
        const want = Math.max(length, READ_AHEAD);
        this.block = Buffer.from(call('read', this.path, (n) => n.read(this.path, at, want)), 'base64');
        this.blockAt = at;
      }
      const from = at - this.blockAt;
      const bytes = this.block.subarray(from, Math.min(from + length, this.block.length));
      const target = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer.buffer || buffer);
      target.set(bytes, offset);
      return { bytesRead: bytes.length, buffer };
    });
  }
  readFile(opts) { return settle(() => readFileSync(this.path, opts)); }
  close() { this.block = null; return Promise.resolve(); }
}

// A file the desktop's code is saving where the user chose (dialog.showSaveDialog in electron.js): once it's written
// here, `then` puts it there. Each is watched for once.
const afterWrite = new Map();
const written = (p) => { const then = afterWrite.get(p); if (then) { afterWrite.delete(p); queueMicrotask(then); } };
const filesDir = () => { const n = native(); return typeof n.dataDir === 'function' ? String(n.dataDir()).replace(/\/cdplayer\/?$/, '') : ''; };

// File descriptors, as node-taglib-sharp uses them (TAGS): openSync 'r' or 'r+', readSync/writeSync at a position,
// fstatSync, ftruncateSync, closeSync. A file opened to read is read in blocks, as FileHandle does; one opened to write
// is held whole in memory and written back when it's closed — only ever CDPlayer's own copy of a song, which
// tag-writer.js edits before renaming it over the song.
const fds = new Map();
let nextFd = 100;
const entry = (fd, syscall) => {
  const e = fds.get(fd);
  if (!e) throw Object.assign(new Error(`EBADF: bad file descriptor, ${syscall}`), { code: 'EBADF', syscall, errno: -9 });
  return e;
};
const bytesOf = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b.buffer || b, b.byteOffset || 0, b.byteLength));
function openSync(p, flags = 'r') {
  p = P(p);
  const f = typeof flags === 'string' ? flags : 'r';
  if (/[wa]/.test(f)) throw Object.assign(new Error(`EINVAL: open '${p}' with '${f}' isn't on Android`), { code: 'EINVAL', syscall: 'open', path: p });
  const st = statSync(p);
  const e = { path: p, size: st.size, data: f.includes('+') ? readFileSync(p) : null, block: null, blockAt: 0, dirty: false };
  const fd = nextFd++;
  fds.set(fd, e);
  return fd;
}
function readSync(fd, buffer, offset = 0, length = buffer.byteLength - offset, position = null) {
  const e = entry(fd, 'read');
  const at = Number(position) || 0, want = Math.max(0, Math.min(length, e.size - at));
  if (!want) return 0;
  let bytes;
  if (e.data) bytes = e.data.subarray(at, at + want);
  else {
    if (!e.block || at < e.blockAt || at + want > e.blockAt + e.block.length) {
      e.block = Buffer.from(call('read', e.path, (n) => n.read(e.path, at, Math.max(want, READ_AHEAD))), 'base64');
      e.blockAt = at;
    }
    bytes = e.block.subarray(at - e.blockAt, at - e.blockAt + want);
  }
  bytesOf(buffer).set(bytes, offset);
  return bytes.length;
}
function writeSync(fd, buffer, offset = 0, length = buffer.byteLength - offset, position = null) {
  const e = entry(fd, 'write');
  if (!e.data) throw Object.assign(new Error('EBADF: bad file descriptor, write'), { code: 'EBADF', syscall: 'write', errno: -9 });
  const at = Number(position) || 0, end = at + length;
  if (end > e.data.length) { const grown = Buffer.alloc(Math.max(end, e.data.length * 1.25 | 0)); e.data.copy(grown, 0, 0, e.size); e.data = grown; }
  e.data.set(bytesOf(buffer).subarray(offset, offset + length), at);
  e.size = Math.max(e.size, end); e.dirty = true;
  return length;
}
function ftruncateSync(fd, length = 0) {
  const e = entry(fd, 'ftruncate');
  if (!e.data) throw Object.assign(new Error('EBADF: bad file descriptor, ftruncate'), { code: 'EBADF', syscall: 'ftruncate', errno: -9 });
  if (length > e.data.length) { const grown = Buffer.alloc(length); e.data.copy(grown, 0, 0, e.size); e.data = grown; }
  else e.data.fill(0, length, e.size);
  e.size = length; e.dirty = true;
}
const fstatSync = (fd) => new Stats({ size: entry(fd, 'fstat').size, mtimeMs: Date.now(), isDir: false });
function closeSync(fd) {
  const e = entry(fd, 'close');
  fds.delete(fd);
  if (e.dirty) writeFileSync(e.path, e.data.subarray(0, e.size));
}

// The promise forms run the synchronous calls — but a scan awaiting thousands of them would never give the page a
// turn (each resolves at once, so it all runs as one task: the shelf's first read froze the player for a minute and a
// half). After SLICE_MS of work in a row, the next call waits for a fresh task first.
const SLICE_MS = 8;
let sliceStart = 0, sliceTask = 0, taskNow = 0;
const channel = typeof MessageChannel === 'function' ? new MessageChannel() : null;
const waiting = [];
if (channel) {
  channel.port1.onmessage = () => { taskNow++; const run = waiting.shift(); if (run) run(); };
  if (channel.port1.unref) channel.port1.unref(); // (Node, in tests: an open port mustn't keep the process alive)
}
const nextTask = (run) => { if (channel) { waiting.push(run); channel.port2.postMessage(0); } else setTimeout(run, 0); };
function settle(fn) {
  return new Promise((resolve, reject) => {
    const run = () => { try { resolve(fn()); } catch (e) { reject(e); } };
    const now = typeof performance === 'object' ? performance.now() : Date.now();
    if (sliceTask !== taskNow) { sliceTask = taskNow; sliceStart = now; } // (a task of ours started since: a new slice)
    if (now - sliceStart < SLICE_MS) { run(); return; }
    nextTask(() => { sliceStart = typeof performance === 'object' ? performance.now() : Date.now(); sliceTask = taskNow; run(); });
  });
}
const promised = (fn) => (...args) => settle(() => fn(...args));
const promises = {
  stat: promised(statSync), lstat: promised(statSync), readdir: promised(readdirSync), readFile: promised(readFileSync),
  writeFile: promised(writeFileSync), appendFile: promised(appendFileSync), mkdir: promised(mkdirSync), rm: promised(rmSync),
  rmdir: promised(rmdirSync), unlink: promised(unlinkSync), rename: promised(renameSync), copyFile: promised(copyFileSync),
  realpath: promised(realpathSync), access: promised(accessSync),
  open: promised((p) => { p = P(p); statSync(p); return new FileHandle(p); }),
};
const callbacked = (fn) => (...args) => {
  const cb = typeof args[args.length - 1] === 'function' ? args.pop() : () => {};
  let r, err = null;
  try { r = fn(...args); } catch (e) { err = e; }
  queueMicrotask(() => cb(err, r));
};
const missing = (name) => () => { throw new Error(`fs.${name} not on Android`); };

module.exports = {
  existsSync, statSync, lstatSync: statSync, readdirSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, renameSync,
  unlinkSync, rmSync, rmdirSync, copyFileSync, realpathSync, accessSync,
  stat: callbacked(statSync), lstat: callbacked(statSync), readdir: callbacked(readdirSync), readFile: callbacked(readFileSync),
  writeFile: callbacked(writeFileSync), mkdir: callbacked(mkdirSync), rm: callbacked(rmSync), unlink: callbacked(unlinkSync),
  rename: callbacked(renameSync), access: callbacked(accessSync), exists: (p, cb) => queueMicrotask(() => cb(existsSync(p))),
  createReadStream: missing('createReadStream'), createWriteStream: missing('createWriteStream'), watch: missing('watch'),
  watchFile: missing('watchFile'), __afterWrite: (p, then) => afterWrite.set(P(p), then), __filesDir: filesDir, openSync, readSync, writeSync, ftruncateSync, fstatSync, closeSync,
  constants: { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 },
  promises, Stats, Dirent,
};
module.exports.default = module.exports;
