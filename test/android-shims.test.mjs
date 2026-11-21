// The Android build's stand-ins for Node's built-ins (src/android/shims), checked against Node's own.
import test from 'node:test';
import assert from 'node:assert';
import nodeCrypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const shimCrypto = require('../src/android/shims/crypto.js');
const shimPath = require('../src/android/shims/path.js');
const shimUrl = require('../src/android/shims/url.js');

test('hashes match Node\'s: sha1, sha256, md5 — strings (UTF-8), buffers, hex input, empty, block edges', () => {
  const inputs = ['', 'a', '4\nradiohead\nok computer', 'Кино — Группа крови', 'オノガミ', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(1000)];
  for (const algo of ['sha1', 'sha256', 'md5']) {
    for (const s of inputs) {
      assert.strictEqual(shimCrypto.createHash(algo).update(s).digest('hex'), nodeCrypto.createHash(algo).update(s).digest('hex'), `${algo}(${s.slice(0, 12)})`);
    }
    const buf = nodeCrypto.randomBytes(777);
    assert.strictEqual(shimCrypto.createHash(algo).update(buf).digest('base64'), nodeCrypto.createHash(algo).update(buf).digest('base64'));
    assert.strictEqual(shimCrypto.createHash(algo).update('ab').update('c').digest('hex'), nodeCrypto.createHash(algo).update('abc').digest('hex'));
  }
  assert.strictEqual(shimCrypto.createHash('sha1').update('a').digest('hex'), '86f7e437faa5a7fce15d1ddcb9eaeaea377667b8');
});

test('hmac-sha256 matches Node\'s, short and long keys', () => {
  for (const key of ['k', 'z'.repeat(100)]) {
    assert.strictEqual(shimCrypto.createHmac('sha256', key).update('message').digest('hex'), nodeCrypto.createHmac('sha256', key).update('message').digest('hex'));
  }
});

test('path is POSIX; file URLs round-trip names with spaces, # and non-Latin letters', () => {
  assert.strictEqual(shimPath.join('/storage/emulated/0', 'Music', '../Music/a.flac'), '/storage/emulated/0/Music/a.flac');
  assert.strictEqual(shimPath.basename('/x/Кино — Группа крови #1.flac', '.flac'), 'Кино — Группа крови #1');
  assert.strictEqual(shimPath.extname('a.b.FLAC'), '.FLAC');
  assert.strictEqual(shimPath.relative('/a/b', '/a/c/d'), '../c/d');
  const p = '/storage/emulated/0/Music/Кино — Группа крови #1?.flac';
  assert.strictEqual(shimUrl.fileURLToPath(shimUrl.pathToFileURL(p)), p);
  assert.strictEqual(shimUrl.fileURLToPath('file:///storage/x%20y.mp3'), '/storage/x y.mp3');
});
