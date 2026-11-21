import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { createSharing } = createRequire(import.meta.url)('../src/android/share.js');

test('Android: COPY shares through the phone, SAVE puts the picture or video in the gallery — one export file at a time', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-share-'));
  const calls = [];
  const phone = { share: async (o) => calls.push(['share', o]), saveToGallery: async (o) => calls.push(['save', o]) };
  const s = createSharing({ fs, dataDir, phone });
  await s.copyImage(new Uint8Array([1, 2, 3]));
  assert.deepStrictEqual(calls[0], ['share', { path: `${dataDir}/exports/CDPlayer.png`, mime: 'image/png' }]);
  assert.deepStrictEqual([...fs.readFileSync(`${dataDir}/exports/CDPlayer.png`)], [1, 2, 3]);
  assert.strictEqual(await s.saveCard(new Uint8Array([4]), 'AC/DC - Back: in Black'), true);
  assert.deepStrictEqual(calls[1], ['save', { path: `${dataDir}/exports/AC DC - Back in Black.png`, mime: 'image/png', name: 'AC DC - Back in Black.png' }]);
  assert.deepStrictEqual(fs.readdirSync(`${dataDir}/exports`), ['AC DC - Back in Black.png'], 'the shared one cleared at the next');
  assert.strictEqual(await s.saveVideo(new Uint8Array([5]), '', 'webm'), true);
  assert.deepStrictEqual(calls[2][1].mime, 'video/webm');
  const failing = createSharing({ fs, dataDir, phone: { saveToGallery: async () => { throw new Error('full'); } } });
  assert.strictEqual(await failing.saveCard(new Uint8Array([6]), 'x'), false, 'a failed save says so (no CARD SAVED)');
});
