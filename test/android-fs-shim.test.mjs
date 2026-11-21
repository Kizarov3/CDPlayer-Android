// src/android/shims/fs.js over a stand-in for NativeFs.java (same answers: strings, JSON errors), on a temp dir.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-fs-shim-'));
const err = (code) => JSON.stringify({ error: code, message: code });
globalThis.CdpNativeFs = {
  dataDir: () => root,
  stat: (p) => { try { const s = fs.statSync(p); return JSON.stringify({ size: s.size, mtimeMs: s.mtimeMs, isDir: s.isDirectory() }); } catch { return err('ENOENT'); } },
  readdir: (p) => { try { return JSON.stringify(fs.readdirSync(p, { withFileTypes: true }).map((d) => [d.name, d.isDirectory()])); } catch (e) { return err(e.code); } },
  read: (p, off, len) => { try { const b = fs.readFileSync(p); return b.subarray(off, len < 0 ? undefined : off + len).toString('base64'); } catch (e) { return err(e.code); } },
  write: (p, b64, append) => { try { (append ? fs.appendFileSync : fs.writeFileSync)(p, Buffer.from(b64, 'base64')); return ''; } catch (e) { return err(e.code); } },
  mkdirs: (p) => { fs.mkdirSync(p, { recursive: true }); return ''; },
  remove: (p, rec) => { try { fs.rmSync(p, { recursive: rec }); return ''; } catch (e) { return err(e.code); } },
  rename: (a, b) => { try { fs.renameSync(a, b); return ''; } catch (e) { return err(e.code); } },
  realpath: (p) => { try { return JSON.stringify({ path: fs.realpathSync(p) }); } catch (e) { return err(e.code); } },
};
const require = createRequire(import.meta.url);
const sfs = require('../src/android/shims/fs.js');

test('text and binary round-trip; append; non-Latin names with # and spaces', () => {
  const dir = path.join(root, 'Music', 'Кино');
  sfs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'Кино — Группа крови #1.txt');
  sfs.writeFileSync(f, 'один\n');
  sfs.appendFileSync(f, 'два\n');
  assert.strictEqual(sfs.readFileSync(f, 'utf8'), 'один\nдва\n');
  const bin = Buffer.from([0, 255, 128, 7]);
  sfs.writeFileSync(path.join(dir, 'b.bin'), bin);
  assert.deepStrictEqual(sfs.readFileSync(path.join(dir, 'b.bin')), bin);
  assert.ok(sfs.existsSync(f));
  assert.strictEqual(sfs.statSync(f).isFile(), true);
  assert.strictEqual(sfs.statSync(dir).isDirectory(), true);
});

test('readdir with file types; missing things throw ENOENT, or answer undefined when asked to', () => {
  const dir = path.join(root, 'list');
  sfs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  sfs.writeFileSync(path.join(dir, 'a.flac'), 'x');
  const ents = sfs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  assert.deepStrictEqual(ents.map((d) => [d.name, d.isDirectory()]), [['a.flac', false], ['sub', true]]);
  assert.deepStrictEqual(sfs.readdirSync(dir).sort(), ['a.flac', 'sub']);
  assert.throws(() => sfs.statSync(path.join(root, 'nope')), (e) => e.code === 'ENOENT');
  assert.strictEqual(sfs.statSync(path.join(root, 'nope'), { throwIfNoEntry: false }), undefined);
  assert.strictEqual(sfs.existsSync(path.join(root, 'nope')), false);
});

test('promises: readFile, rename, rm with force; a FileHandle reads a range (what music-metadata uses)', async () => {
  const f = path.join(root, 'range.bin');
  sfs.writeFileSync(f, Buffer.from('0123456789'));
  const h = await sfs.promises.open(f, 'r');
  assert.strictEqual((await h.stat()).size, 10);
  const buf = new Uint8Array(4);
  const { bytesRead } = await h.read(buf, 0, 4, 3);
  assert.strictEqual(bytesRead, 4);
  assert.strictEqual(Buffer.from(buf).toString(), '3456');
  await h.close();
  await sfs.promises.rename(f, `${f}.2`);
  assert.strictEqual(await sfs.promises.readFile(`${f}.2`, 'utf8'), '0123456789');
  await sfs.promises.rm(`${f}.2`);
  await sfs.promises.rm(`${f}.2`, { force: true });
  await assert.rejects(sfs.promises.stat(`${f}.2`), (e) => e.code === 'ENOENT');
});

test('a long run of awaited calls gives the event loop turns; small reads come from one block', async () => {
  // (a fresh copy on setTimeout: Node drains a MessagePort's messages ahead of its timers, which a browser doesn't)
  const MC = globalThis.MessageChannel;
  globalThis.MessageChannel = undefined;
  delete require.cache[require.resolve('../src/android/shims/fs.js')];
  const sfs = require('../src/android/shims/fs.js');
  globalThis.MessageChannel = MC;
  const f = path.join(root, 'many.bin');
  sfs.writeFileSync(f, Buffer.alloc(200000, 7));
  let reads = 0;
  const real = globalThis.CdpNativeFs.read;
  globalThis.CdpNativeFs.read = (...a) => { reads++; const t = Date.now(); while (Date.now() - t < 1); return real(...a); }; // (a millisecond a trip)
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 0);
  const h = await sfs.promises.open(f);
  const buf = new Uint8Array(10);
  for (let i = 0; i < 300; i++) await h.read(buf, 0, 10, i * 400); // (120 KB in small pieces: one block)
  for (let i = 0; i < 60; i++) await sfs.promises.stat(f).then(() => globalThis.CdpNativeFs.read(f, 0, 1));
  clearInterval(timer);
  globalThis.CdpNativeFs.read = real;
  assert.ok(reads <= 61 + 1, `reads ${reads}`);
  assert.ok(ticks >= 3, `the timer ran ${ticks} times`);
});

test('file descriptors as node-taglib-sharp uses them: read in blocks; r+ edits in memory, written back on close', () => {
  const f = path.join(root, 'song.mp3');
  const original = Buffer.from(Array.from({ length: 300 * 1024 }, (_, i) => i % 251));
  fs.writeFileSync(f, original);
  const r = sfs.openSync(f, 'r');
  assert.strictEqual(sfs.fstatSync(r).size, original.length);
  const b = Buffer.alloc(10);
  assert.strictEqual(sfs.readSync(r, b, 0, 10, 200 * 1024), 10); // (past the first block)
  assert.deepStrictEqual(b, original.subarray(200 * 1024, 200 * 1024 + 10));
  assert.strictEqual(sfs.readSync(r, b, 0, 10, original.length - 4), 4); // (at the end: what's there)
  assert.strictEqual(sfs.readSync(r, b, 0, 10, original.length), 0);
  assert.throws(() => sfs.writeSync(r, b, 0, 1, 0), { code: 'EBADF' });
  sfs.closeSync(r);
  assert.throws(() => sfs.readSync(r, b, 0, 1, 0), { code: 'EBADF' });

  const w = sfs.openSync(f, 'r+');
  sfs.writeSync(w, Buffer.from('ID3'), 0, 3, 0);
  sfs.writeSync(w, Buffer.from('TAIL'), 0, 4, original.length + 6); // (grows it, the gap zeros)
  assert.strictEqual(sfs.fstatSync(w).size, original.length + 10);
  assert.deepStrictEqual(fs.readFileSync(f), original); // (nothing written until it's closed)
  sfs.closeSync(w);
  const now = fs.readFileSync(f);
  assert.strictEqual(now.subarray(0, 3).toString(), 'ID3');
  assert.deepStrictEqual(now.subarray(3, original.length), original.subarray(3));
  assert.deepStrictEqual(now.subarray(original.length, original.length + 6), Buffer.alloc(6));
  assert.strictEqual(now.subarray(original.length + 6).toString(), 'TAIL');

  const t = sfs.openSync(f, 'r+');
  sfs.ftruncateSync(t, 5);
  sfs.closeSync(t);
  assert.strictEqual(fs.readFileSync(f).toString(), 'ID3' + original.subarray(3, 5).toString('latin1'));
  assert.throws(() => sfs.openSync(path.join(root, 'none.mp3'), 'r'), { code: 'ENOENT' });
});
