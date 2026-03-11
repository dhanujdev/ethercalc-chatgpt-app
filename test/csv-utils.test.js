import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, stringifyCsv, setRangeValues, clearRange, sortByColumn } from '../src/csv-utils.js';

test('parse/stringify roundtrip handles commas and quotes', () => {
  const input = [['Name', 'Note'], ['Ada', 'hello, "world"']];
  const csv = stringifyCsv(input);
  assert.deepEqual(parseCsv(csv), input);
});

test('setRangeValues writes at A1 coordinates', () => {
  const out = setRangeValues([['a']], 'B2', [['x', 'y']]);
  assert.equal(out[1][1], 'x');
  assert.equal(out[1][2], 'y');
});

test('clearRange clears the targeted rectangle', () => {
  const out = clearRange([['1','2'],['3','4']], 'A1:B1');
  assert.deepEqual(out[0], ['', '']);
  assert.deepEqual(out[1], ['3', '4']);
});

test('sortByColumn keeps header row intact', () => {
  const out = sortByColumn([
    ['Name', 'Qty'],
    ['b', '2'],
    ['a', '1'],
  ], 'A', true, 'asc');
  assert.deepEqual(out, [
    ['Name', 'Qty'],
    ['a', '1'],
    ['b', '2'],
  ]);
});
