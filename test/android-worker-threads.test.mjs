import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Worker } = require('../src/android/shims/worker-threads.js');
const { createRomanize } = require('../src/main/romanize.js');

// A Web Worker stand-in that answers each message as romanize-worker does.
class FakeWebWorker {
  constructor(url) { this.url = url; FakeWebWorker.last = this; this.terminated = false; }
  postMessage({ id, texts }) { setTimeout(() => this.onmessage({ data: { id, lines: texts.map((t) => t.toUpperCase()) } }), 1); }
  terminate() { this.terminated = true; }
}

test('Android: worker_threads.Worker runs romanize-worker as a Web Worker, behind the desktop\'s API', async () => {
  const romanize = createRomanize({ createWorker: () => new Worker('/app/src/main/karaoke/romanize-worker.js', { WebWorker: FakeWebWorker }), idleMs: 5 });
  assert.deepStrictEqual(await romanize.lines(['a', 'b']), ['A', 'B']);
  assert.strictEqual(FakeWebWorker.last.url, 'workers/romanize-worker.js');
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(FakeWebWorker.last.terminated, 'let go once idle');
});

test('Android: a worker without a page-side build fails plainly, and an error reaches the caller', async () => {
  assert.throws(() => new Worker('/app/src/main/decoders/worker.js', { WebWorker: FakeWebWorker }), /worker\.js not on Android/);
  const w = new Worker('/app/src/main/karaoke/romanize-worker.js', { WebWorker: FakeWebWorker });
  const got = new Promise((resolve) => w.once('error', resolve));
  FakeWebWorker.last.onerror({ message: 'boom', preventDefault() {} });
  assert.match((await got).message, /boom/);
});

test('Android: karaoke/worker.js (word timing) is its Web Worker build — told apart from the other folders\' worker.js', () => {
  new Worker('/app/src/main/karaoke/worker.js', { WebWorker: FakeWebWorker });
  assert.strictEqual(FakeWebWorker.last.url, 'workers/word-fit-worker.js');
  assert.throws(() => new Worker('/app/src/main/encoders/worker.js', { WebWorker: FakeWebWorker }), /not on Android/);
});

test('Android: the word-timing worker runs the models as the desktop\'s does (its two model calls, line for line)', async () => {
  const { readFileSync } = await import('node:fs');
  const bodies = (file) => {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    return ['voiceMask', 'phoneProbabilities'].map((name) => src.slice(src.indexOf(`async function ${name}`)).split('\n}\n')[0]);
  };
  assert.deepStrictEqual(bodies('../src/android/word-fit-worker.entry.js'), bodies('../src/main/karaoke/worker.js'));
});
