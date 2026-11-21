import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const { secureArchiveUrl } = createRequire(import.meta.url)('../src/main/online.js');

test('the Cover Art Archive\'s http:// picture addresses are asked over https (Android allows no plain HTTP)', () => {
  assert.strictEqual(secureArchiveUrl('http://coverartarchive.org/release/x/1-1200.jpg'), 'https://coverartarchive.org/release/x/1-1200.jpg');
  assert.strictEqual(secureArchiveUrl('http://ia800101.us.archive.org/1/items/x/y.jpg'), 'https://ia800101.us.archive.org/1/items/x/y.jpg');
  assert.strictEqual(secureArchiveUrl('https://coverartarchive.org/a.jpg'), 'https://coverartarchive.org/a.jpg');
  assert.strictEqual(secureArchiveUrl('http://example.com/coverartarchive.org/a.jpg'), 'http://example.com/coverartarchive.org/a.jpg');
  assert.strictEqual(secureArchiveUrl('http://notarchive.org/a.jpg'), 'http://notarchive.org/a.jpg');
});
