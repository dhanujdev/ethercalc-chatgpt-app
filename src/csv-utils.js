export function parseCsv(input) {
  if (!input) return [[]];
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = "";
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === '\r') {
      continue;
    } else {
      field += ch;
    }
  }

  row.push(field);
  rows.push(row);
  return normalizeTable(rows);
}

export function stringifyCsv(table) {
  const normalized = normalizeTable(table);
  return normalized
    .map((row) =>
      row
        .map((value) => {
          const str = value == null ? "" : String(value);
          if (/[",\n]/.test(str)) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join(",")
    )
    .join("\n");
}

export function normalizeTable(table) {
  const width = Math.max(0, ...table.map((row) => row.length));
  return table.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ""));
}

export function ensureSize(table, rows, cols) {
  while (table.length < rows) table.push([]);
  for (const row of table) {
    while (row.length < cols) row.push("");
  }
  return table;
}

export function columnLabelToIndex(label) {
  let result = 0;
  const upper = label.toUpperCase();
  for (const ch of upper) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) throw new Error(`Invalid column label: ${label}`);
    result = result * 26 + (code - 64);
  }
  return result - 1;
}

export function indexToColumnLabel(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function a1ToRowCol(cell) {
  const match = /^([A-Za-z]+)(\d+)$/.exec(cell.trim());
  if (!match) throw new Error(`Invalid A1 cell reference: ${cell}`);
  return {
    row: Number(match[2]) - 1,
    col: columnLabelToIndex(match[1]),
  };
}

export function parseRange(range) {
  const [start, end] = range.split(":");
  const s = a1ToRowCol(start);
  const e = a1ToRowCol(end ?? start);
  return {
    startRow: Math.min(s.row, e.row),
    endRow: Math.max(s.row, e.row),
    startCol: Math.min(s.col, e.col),
    endCol: Math.max(s.col, e.col),
  };
}

export function setRangeValues(table, startCell, values) {
  const normalizedValues = normalizeTable(values);
  const { row: startRow, col: startCol } = a1ToRowCol(startCell);
  const targetRows = startRow + normalizedValues.length;
  const targetCols = startCol + (normalizedValues[0]?.length ?? 0);
  ensureSize(table, targetRows, targetCols);

  for (let r = 0; r < normalizedValues.length; r += 1) {
    for (let c = 0; c < normalizedValues[r].length; c += 1) {
      table[startRow + r][startCol + c] = normalizedValues[r][c];
    }
  }

  return normalizeTable(table);
}

export function clearRange(table, range) {
  const bounds = parseRange(range);
  ensureSize(table, bounds.endRow + 1, bounds.endCol + 1);
  for (let r = bounds.startRow; r <= bounds.endRow; r += 1) {
    for (let c = bounds.startCol; c <= bounds.endCol; c += 1) {
      table[r][c] = "";
    }
  }
  return normalizeTable(table);
}

export function appendRows(table, rows) {
  const normalizedRows = normalizeTable(rows);
  const width = Math.max(0, ...table.map((r) => r.length), ...normalizedRows.map((r) => r.length));
  const paddedCurrent = normalizeTable(table.map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill("")]));
  const paddedIncoming = normalizeTable(normalizedRows.map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill("")]));
  return [...paddedCurrent, ...paddedIncoming];
}

export function sortByColumn(table, column, hasHeader = true, direction = "asc") {
  const normalized = normalizeTable(table);
  const header = hasHeader ? normalized[0] ?? [] : null;
  const body = hasHeader ? normalized.slice(1) : normalized.slice();
  const index = typeof column === "number" ? column : columnLabelToIndex(String(column));
  const sign = direction === "desc" ? -1 : 1;
  body.sort((a, b) => String(a[index] ?? "").localeCompare(String(b[index] ?? ""), undefined, { numeric: true }) * sign);
  return header ? [header, ...body] : body;
}

export function tablePreview(table, maxRows = 20) {
  const normalized = normalizeTable(table);
  return normalized.slice(0, maxRows).map((row) => {
    const obj = {};
    row.forEach((value, idx) => {
      obj[indexToColumnLabel(idx)] = value;
    });
    return obj;
  });
}
