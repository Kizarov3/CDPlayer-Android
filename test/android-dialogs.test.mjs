// The dialogs of src/android/shims/electron.js over stand-ins for Phone's pickers and NativeFs.java: a file saved is
// written in files/saving/ and then put where the user chose; a file opened is the picker's copy; a question is asked.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const files = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-dialogs-'));
const err = (code) => JSON.stringify({ error: code, message: code });
globalThis.CdpNativeFs = {
  dataDir: () => path.join(files, 'cdplayer'),
  stat: (p) => { try { const s = fs.statSync(p); return JSON.stringify({ size: s.size, mtimeMs: s.mtimeMs, isDir: s.isDirectory() }); } catch { return err('ENOENT'); } },
  read: (p, off, len) => { try { const b = fs.readFileSync(p); return b.subarray(off, len < 0 ? undefined : off + len).toString('base64'); } catch (e) { return err(e.code); } },
  write: (p, b64, append) => { try { (append ? fs.appendFileSync : fs.writeFileSync)(p, Buffer.from(b64, 'base64')); return ''; } catch (e) { return err(e.code); } },
  mkdirs: (p) => { fs.mkdirSync(p, { recursive: true }); return ''; },
  rename: (a, b) => { try { fs.renameSync(a, b); return ''; } catch (e) { return err(e.code); } },
};
const require = createRequire(import.meta.url);
const { dialog, __setFiles } = require('../src/android/shims/electron.js');
const sfs = require('../src/android/shims/fs.js');

test('without the phone (tests, before boot): cancelled, and a question gets its cancel button', async () => {
  assert.deepStrictEqual(await dialog.showOpenDialog({}, { properties: ['openFile'] }), { canceled: true, filePaths: [] });
  assert.strictEqual((await dialog.showSaveDialog({}, { defaultPath: '/x/a.m3u' })).canceled, true);
  assert.strictEqual((await dialog.showMessageBox({}, { buttons: ['Yes', 'No'], cancelId: 1 })).response, 1);
});

test('save: written in files/saving/ under the name suggested, then put where the user chose', async () => {
  const calls = [];
  const picked = path.join(files, 'picked'); fs.mkdirSync(picked, { recursive: true });
  fs.writeFileSync(path.join(picked, 'list.m3u'), '#EXTM3U\n');
  __setFiles({
    pick: async (o) => { calls.push(['pick', o]); return { paths: [path.join(picked, 'list.m3u')] }; },
    create: async (o) => { calls.push(['create', o]); return { uri: 'content://docs/42' }; },
    write: async (o) => { calls.push(['write', o]); },
    ask: async (o) => { calls.push(['ask', o]); return { response: 0 }; },
  });
  const r = await dialog.showSaveDialog({}, { defaultPath: '/storage/emulated/0/Music/Road trip.m3u', filters: [{ extensions: ['m3u'] }] });
  assert.strictEqual(r.canceled, false);
  assert.strictEqual(r.filePath, path.join(files, 'saving', 'Road trip.m3u'));
  assert.deepStrictEqual(calls[0], ['create', { name: 'Road trip.m3u', mime: 'audio/x-mpegurl' }]);
  sfs.writeFileSync(r.filePath, '#EXTM3U\n');
  await new Promise((done) => setImmediate(done));
  assert.deepStrictEqual(calls[1], ['write', { path: r.filePath, uri: 'content://docs/42' }]);
  sfs.writeFileSync(r.filePath, 'again'); // (once only)
  await new Promise((done) => setImmediate(done));
  assert.strictEqual(calls.length, 2);

  // A name without its extension: the desktop's code adds it, and that's the file put there.
  const b = await dialog.showSaveDialog({}, { defaultPath: 'CDPlayer 2026', filters: [{ extensions: ['cdbackup'] }] });
  sfs.writeFileSync(`${b.filePath}.cdbackup`, '{}');
  await new Promise((done) => setImmediate(done));
  assert.deepStrictEqual(calls.at(-1), ['write', { path: `${b.filePath}.cdbackup`, uri: 'content://docs/42' }]);

  const o = await dialog.showOpenDialog({}, { properties: ['openFile', 'multiSelections'] });
  assert.deepStrictEqual(o, { canceled: false, filePaths: [path.join(picked, 'list.m3u')] });
  assert.deepStrictEqual(calls.at(-1), ['pick', { multiple: true }]);
  assert.deepStrictEqual(await dialog.showOpenDialog({}, { properties: ['openDirectory'] }), { canceled: true, filePaths: [] }); // (no folders)

  const q = await dialog.showMessageBox({}, { message: 'Put back?', detail: 'd', buttons: ['Restore', 'Cancel'], cancelId: 1 });
  assert.strictEqual(q.response, 0);
  assert.deepStrictEqual(calls.at(-1), ['ask', { message: 'Put back?', detail: 'd', buttons: ['Restore', 'Cancel'], cancelId: 1 }]);
});
