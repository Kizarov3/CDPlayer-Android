import test from 'node:test';
import assert from 'node:assert';
import { paginate, leavesFor, nearLeaves, ean13 } from '../src/renderer/js/booklet-layout.js';

test('pages fill up to what fits, then continue on the next page', () => {
  const fits = (onPage) => onPage.reduce((h, n) => h + n, 0) <= 10; // items are heights
  assert.deepStrictEqual(paginate([3, 3, 3, 3, 4, 6], fits), [[3, 3, 3], [3, 4], [6]]);
  assert.deepStrictEqual(paginate([12, 2], fits), [[12], [2]]); // too big for any page: alone, not lost
  assert.deepStrictEqual(paginate([], fits), []);
});

test('front cover first, back cover last on a leaf back, a blank page when the inside is odd', () => {
  const blank = () => '-';
  assert.deepStrictEqual(leavesFor('F', ['1', '2'], 'B', blank), [{ front: 'F', back: '1' }, { front: '2', back: 'B' }]);
  assert.deepStrictEqual(leavesFor('F', ['1'], 'B', blank), [{ front: 'F', back: '1' }, { front: '-', back: 'B' }]);
  assert.deepStrictEqual(leavesFor('F', ['1', '2', '3'], 'B', blank), [{ front: 'F', back: '1' }, { front: '2', back: '3' }, { front: '-', back: 'B' }]);
  assert.deepStrictEqual(leavesFor('F', [], 'B', blank), [{ front: 'F', back: 'B' }]);
});

test('EAN-13 and UPC-A barcodes; invalid ones print nothing', () => {
  const b = ean13('4006381333931');
  assert.strictEqual(b.bits.length, 95);
  assert.ok(b.bits.startsWith('101') && b.bits.endsWith('101') && b.bits.slice(45, 50) === '01010');
  assert.strictEqual(b.bits.slice(3, 10), '0001101'); // 2nd digit 0, first group L
  assert.strictEqual(ean13('036000291452').digits, '0036000291452'); // UPC-A
  assert.strictEqual(ean13('400638133393').digits, '4006381333931'); // check digit added
  assert.strictEqual(ean13('4006381333932'), null);
  assert.strictEqual(ean13('not a barcode'), null);
});

test('the leaves kept in the page: the two seen, and the next one either way', () => {
  assert.deepStrictEqual(nearLeaves(0, 23), { from: 0, to: 1 });
  assert.deepStrictEqual(nearLeaves(1, 23), { from: 0, to: 2 });
  assert.deepStrictEqual(nearLeaves(10, 23), { from: 8, to: 11 });
  assert.deepStrictEqual(nearLeaves(23, 23), { from: 21, to: 22 }); // read to its back cover
  assert.deepStrictEqual(nearLeaves(0, 1), { from: 0, to: 0 });
  // Whichever way it's turned, the leaf that moves and those it uncovers were there already.
  for (let t = 0; t <= 8; t++) {
    const { from, to } = nearLeaves(t, 8);
    for (const i of [t - 2, t - 1, t, t + 1]) if (i >= 0 && i < 8) assert.ok(i >= from && i <= to, `${t}: ${i}`);
  }
});
