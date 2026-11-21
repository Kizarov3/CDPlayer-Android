// What Node gives every module and the desktop's main-process code takes for granted: process, Buffer, global,
// setImmediate. Imported first by boot.entry.js, before any of that code is required.
import { Buffer } from 'buffer';

globalThis.global = globalThis;
globalThis.Buffer = Buffer;
const env = {};
globalThis.process = {
  platform: 'android', arch: 'arm64', type: 'browser', pid: 1, env, argv: [], execArgv: [],
  execPath: '/app/cdplayer', resourcesPath: '/app', versions: { node: '20.0.0', electron: '0', chrome: navigator.userAgent.replace(/.*Chrome\/([\d.]+).*/, '$1') },
  cwd: () => '/', exit() {}, on() { return this; }, once() { return this; }, off() { return this; }, removeListener() { return this; },
  emitWarning() {}, nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
  hrtime: Object.assign((prev) => { const t = performance.now() * 1e6; const s = Math.floor(t / 1e9), n = Math.floor(t % 1e9); return prev ? [s - prev[0], n - prev[1]] : [s, n]; }, { bigint: () => BigInt(Math.round(performance.now() * 1e6)) }),
  memoryUsage: () => ({ rss: 0, heapUsed: 0, heapTotal: 0 }), uptime: () => performance.now() / 1000,
  stdout: { write() {} }, stderr: { write() {} },
};
if (!globalThis.setImmediate) {
  globalThis.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args);
  globalThis.clearImmediate = (id) => clearTimeout(id);
}
