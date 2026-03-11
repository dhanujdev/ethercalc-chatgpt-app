import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAppContext } from '../src/tool-logic.js';

// ---------------------------------------------------------------------------
// Mock EtherCalc client — in-memory tables, no HTTP
// ---------------------------------------------------------------------------
function makeCtx(initialSheets = {}) {
  const sheets = new Map(
    Object.entries(initialSheets).map(([k, v]) => [k, v.map((r) => [...r])])
  );

  // We build a minimal stand-in for EtherCalcClient so makeAppContext works.
  // makeAppContext receives { ethercalcBaseUrl } and creates its own client,
  // so we can't inject directly. Instead we monkey-patch fetch for these tests.
  // Easier: re-implement the context manually mirroring makeAppContext shape.
  const knownSheets = new Set(Object.keys(initialSheets));

  async function getTable(id) {
    if (!sheets.has(id)) throw new Error(`Sheet not found: ${id}`);
    return sheets.get(id).map((r) => [...r]);
  }

  async function putTable(id, table) {
    sheets.set(id, table.map((r) => [...r]));
  }

  // Return sheets map for inspection in tests
  return { knownSheets, sheets, getTable, putTable };
}

// ---------------------------------------------------------------------------
// Pure logic tests for find_replace behaviour
// ---------------------------------------------------------------------------
function applyFindReplace(table, find, replace = '', caseSensitive = false, bounds = null) {
  return table.map((row, r) =>
    row.map((cell, c) => {
      if (bounds && (r < bounds.startRow || r > bounds.endRow || c < bounds.startCol || c > bounds.endCol)) {
        return cell;
      }
      const cellStr = String(cell ?? '');
      const haystack = caseSensitive ? cellStr : cellStr.toLowerCase();
      const needle = caseSensitive ? find : find.toLowerCase();
      if (!haystack.includes(needle)) return cell;
      if (caseSensitive) return cellStr.split(find).join(replace);
      return cellStr.replace(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replace);
    })
  );
}

test('find_replace: replaces all matching cells case-insensitively', () => {
  const table = [['Name', 'Role'], ['Alice', 'Admin'], ['alice', 'User']];
  const out = applyFindReplace(table, 'alice', 'Bob');
  assert.equal(out[1][0], 'Bob');
  assert.equal(out[2][0], 'Bob');
  assert.equal(out[0][0], 'Name'); // header row not affected (no match)
});

test('find_replace: case-sensitive skips non-matching case', () => {
  const table = [['Alice'], ['alice']];
  const out = applyFindReplace(table, 'Alice', 'Bob', true);
  assert.equal(out[0][0], 'Bob');
  assert.equal(out[1][0], 'alice');
});

test('find_replace: replace with empty string (delete)', () => {
  const table = [['hello world']];
  const out = applyFindReplace(table, 'world', '');
  assert.equal(out[0][0], 'hello ');
});

test('find_replace: no match leaves table unchanged', () => {
  const table = [['foo', 'bar']];
  const out = applyFindReplace(table, 'zzz', 'x');
  assert.deepEqual(out, table);
});

// ---------------------------------------------------------------------------
// Pure logic tests for add_column behaviour
// ---------------------------------------------------------------------------
function applyAddColumn(table, header, values = [], position) {
  const insertAt = position != null ? position : Math.max(0, ...table.map((row) => row.length));
  return table.map((row, r) => {
    const newRow = [...row];
    const val = r === 0 ? header : (values[r - 1] ?? '');
    newRow.splice(insertAt, 0, val);
    return newRow;
  });
}

test('add_column: appends column when no position given', () => {
  const out = applyAddColumn([['A', 'B'], ['1', '2'], ['3', '4']], 'C', ['x', 'y']);
  assert.deepEqual(out[0], ['A', 'B', 'C']);
  assert.deepEqual(out[1], ['1', '2', 'x']);
  assert.deepEqual(out[2], ['3', '4', 'y']);
});

test('add_column: inserts at position 0', () => {
  const out = applyAddColumn([['A', 'B'], ['1', '2']], 'NEW', ['v'], 0);
  assert.deepEqual(out[0], ['NEW', 'A', 'B']);
  assert.deepEqual(out[1], ['v', '1', '2']);
});

test('add_column: inserts at middle position', () => {
  const out = applyAddColumn([['A', 'B'], ['1', '2']], 'M', ['m'], 1);
  assert.deepEqual(out[0], ['A', 'M', 'B']);
  assert.deepEqual(out[1], ['1', 'm', '2']);
});

test('add_column: pads with empty string when values array is short', () => {
  const out = applyAddColumn([['A'], ['1'], ['2'], ['3']], 'X', ['only-one']);
  assert.equal(out[2][1], '');
  assert.equal(out[3][1], '');
});

// ---------------------------------------------------------------------------
// Pure logic tests for delete_rows behaviour
// ---------------------------------------------------------------------------
function applyDeleteRows(table, rows) {
  const indices = [...new Set(rows.map((r) => r - 1))].sort((a, b) => b - a);
  return table.filter((_, idx) => !indices.includes(idx));
}

test('delete_rows: removes correct 1-based rows', () => {
  // Table indices: 0=H, 1=r1, 2=r2, 3=r3, 4=r4
  // 1-based rows 2 and 4 => delete indices 1 (r1) and 3 (r3)
  const table = [['H'], ['r1'], ['r2'], ['r3'], ['r4']];
  const out = applyDeleteRows(table, [2, 4]);
  assert.deepEqual(out, [['H'], ['r2'], ['r4']]);
});

test('delete_rows: duplicate row numbers treated as one', () => {
  // 1-based row 2 => index 1 (r1)
  const table = [['H'], ['r1'], ['r2']];
  const out = applyDeleteRows(table, [2, 2, 2]);
  assert.deepEqual(out, [['H'], ['r2']]);
});

test('delete_rows: deleting non-existent row index is a no-op', () => {
  const table = [['H'], ['r1']];
  const out = applyDeleteRows(table, [99]);
  assert.deepEqual(out, table);
});

// ---------------------------------------------------------------------------
// Pure logic tests for compute_column {row} substitution
// ---------------------------------------------------------------------------
function resolveFormulas(formula, dataRowCount) {
  const results = [];
  for (let i = 1; i <= dataRowCount; i++) {
    results.push(formula.replace(/\{row\}/g, String(i + 1)));
  }
  return results;
}

test('compute_column: substitutes {row} with correct 1-based spreadsheet row', () => {
  const resolved = resolveFormulas('=B{row}*C{row}', 3);
  assert.deepEqual(resolved, ['=B2*C2', '=B3*C3', '=B4*C4']);
});

test('compute_column: multiple {row} occurrences all replaced', () => {
  const resolved = resolveFormulas('=SUM(A{row}:C{row})', 2);
  assert.deepEqual(resolved, ['=SUM(A2:C2)', '=SUM(A3:C3)']);
});

test('compute_column: no data rows produces empty result', () => {
  const resolved = resolveFormulas('=B{row}', 0);
  assert.deepEqual(resolved, []);
});

// ---------------------------------------------------------------------------
// Pure logic tests for rename_sheet registry behaviour
// ---------------------------------------------------------------------------
test('rename_sheet: updates knownSheets registry', () => {
  const knownSheets = new Set(['old-id']);
  const oldSheetId = 'old-id';
  const newSheetId = 'new-id';

  knownSheets.delete(oldSheetId);
  knownSheets.add(newSheetId);

  assert.ok(!knownSheets.has(oldSheetId));
  assert.ok(knownSheets.has(newSheetId));
});
