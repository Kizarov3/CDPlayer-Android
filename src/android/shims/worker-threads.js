// worker_threads on Android: the desktop's workers that have a page-side build (scripts/build-android.mjs WORKERS) run
// as Web Workers behind the same small API (on/off/once, postMessage, terminate); the rest stay desktop-only.
const WEB_WORKERS = { 'karaoke/romanize-worker.js': 'workers/romanize-worker.js', 'karaoke/worker.js': 'workers/word-fit-worker.js' };
// (by the folder too: decoders/ and encoders/ have a worker.js of their own)
const webWorkerFor = (file) => { const parts = String(file).split('/'); return WEB_WORKERS[parts.slice(-2).join('/')]; };

class Worker {
  constructor(file, { WebWorker = globalThis.Worker } = {}) {
    const url = webWorkerFor(file);
    if (!url) throw new Error(`worker_threads: ${String(file).split('/').pop()} not on Android`);
    this.listeners = { message: new Set(), error: new Set(), exit: new Set() };
    this.web = new WebWorker(url);
    this.web.onmessage = (e) => this.emit('message', e.data);
    this.web.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); this.emit('error', new Error((e && e.message) || 'worker failed')); };
  }
  emit(event, value) { for (const fn of [...this.listeners[event] || []]) fn(value); }
  on(event, fn) { if (this.listeners[event]) this.listeners[event].add(fn); return this; }
  off(event, fn) { if (this.listeners[event]) this.listeners[event].delete(fn); return this; }
  removeListener(event, fn) { return this.off(event, fn); }
  once(event, fn) { const once = (v) => { this.off(event, once); fn(v); }; return this.on(event, once); }
  postMessage(message) { this.web.postMessage(message); }
  terminate() { this.web.terminate(); this.emit('exit', 1); return Promise.resolve(1); }
}

module.exports = { Worker, isMainThread: true, parentPort: null };
