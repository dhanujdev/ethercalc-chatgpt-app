import { readFileSync, writeFileSync } from "node:fs";
import { EtherCalcClient } from "./ethercalc-client.js";
import {
  appendRows,
  clearRange,
  parseRange,
  setRangeValues,
  sortByColumn,
  stringifyCsv,
  tablePreview,
} from "./csv-utils.js";

const SESSIONS_FILE = process.env.SESSIONS_FILE ?? ".ethercalc-sessions.json";
const MAX_RECENT = 50;

// history: Map<sheetId, lastAccessedISOString>  (insertion order = least-recent first)
function loadHistory() {
  try {
    const raw = readFileSync(SESSIONS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    // support both legacy plain-array format and new { id, lastAccessed } format
    if (Array.isArray(parsed)) {
      const now = new Date().toISOString();
      return new Map(parsed.map((entry) => (typeof entry === "string" ? [entry, now] : [entry.id, entry.lastAccessed])));
    }
  } catch {
    // file missing or invalid — start fresh
  }
  return new Map();
}

function persistHistory(history) {
  try {
    const entries = [...history.entries()]
      .slice(-MAX_RECENT)
      .map(([id, lastAccessed]) => ({ id, lastAccessed }));
    writeFileSync(SESSIONS_FILE, JSON.stringify(entries), "utf8");
  } catch {
    // non-fatal: persist is best-effort
  }
}

export const schemas = {
  createSheet: {
    type: "object",
    properties: {
      sheetId: { type: "string" },
      headers: { type: "array", items: {} },
      rows: { type: "array", items: { type: "array", items: {} } },
    },
  },
  openSheet: {
    type: "object",
    required: ["sheetId"],
    properties: {
      sheetId: { type: "string" },
      maxRows: { type: "number" },
    },
  },
  getSnapshot: {
    type: "object",
    required: ["sheetId"],
    properties: {
      sheetId: { type: "string" },
      maxRows: { type: "number" },
    },
  },
  setRangeValues: {
    type: "object",
    required: ["sheetId", "startCell", "values"],
    properties: {
      sheetId: { type: "string" },
      startCell: { type: "string" },
      values: { type: "array", items: { type: "array", items: {} } },
    },
  },
  appendRows: {
    type: "object",
    required: ["sheetId", "rows"],
    properties: {
      sheetId: { type: "string" },
      rows: { type: "array", items: { type: "array", items: {} } },
    },
  },
  clearRange: {
    type: "object",
    required: ["sheetId", "range"],
    properties: {
      sheetId: { type: "string" },
      range: { type: "string" },
    },
  },
  sortSheet: {
    type: "object",
    required: ["sheetId", "column"],
    properties: {
      sheetId: { type: "string" },
      column: {},
      hasHeader: { type: "boolean" },
      direction: { type: "string", enum: ["asc", "desc"] },
    },
  },
  summarizeSheet: {
    type: "object",
    required: ["sheetId"],
    properties: {
      sheetId: { type: "string" },
      maxRows: { type: "number" },
    },
  },
  listSheets: {
    type: "object",
    properties: {
      limit: { type: "number" },
    },
  },
  applyFormula: {
    type: "object",
    required: ["sheetId", "cell", "formula"],
    properties: {
      sheetId: { type: "string" },
      cell: { type: "string" },
      formula: { type: "string" },
    },
  },
  getRangeSnapshot: {
    type: "object",
    required: ["sheetId", "range"],
    properties: {
      sheetId: { type: "string" },
      range: { type: "string" },
    },
  },
  findReplace: {
    type: "object",
    required: ["sheetId", "find"],
    properties: {
      sheetId: { type: "string" },
      find: { type: "string" },
      replace: { type: "string" },
      caseSensitive: { type: "boolean" },
      rangeOnly: { type: "string" },
    },
  },
  addColumn: {
    type: "object",
    required: ["sheetId", "header"],
    properties: {
      sheetId: { type: "string" },
      header: { type: "string" },
      values: { type: "array", items: { type: "string" } },
      position: { type: "number" },
    },
  },
  computeColumn: {
    type: "object",
    required: ["sheetId", "targetColumn", "formula"],
    properties: {
      sheetId: { type: "string" },
      targetColumn: { type: "string" },
      formula: { type: "string" },
    },
  },
  deleteRows: {
    type: "object",
    required: ["sheetId", "rows"],
    properties: {
      sheetId: { type: "string" },
      rows: { type: "array", items: { type: "number" } },
    },
  },
  renameSheet: {
    type: "object",
    required: ["sheetId", "newSheetId"],
    properties: {
      sheetId: { type: "string" },
      newSheetId: { type: "string" },
    },
  },
};

export function validateArgs(schema, args) {
  const data = args ?? {};
  for (const key of schema.required ?? []) {
    if (data[key] === undefined || data[key] === null || data[key] === "") {
      throw new Error(`Missing required argument: ${key}`);
    }
  }
  return data;
}

export function makeAppContext({ ethercalcBaseUrl }) {
  const client = new EtherCalcClient(ethercalcBaseUrl);
  const history = loadHistory();

  function trackSheet(id) {
    history.delete(id); // remove then re-add so it moves to end (most recent)
    history.set(id, new Date().toISOString());
    persistHistory(history);
  }

  function widgetMeta(sheetId, action, extra = {}) {
    return {
      sheetId,
      action,
      ethercalcUrl: client.viewUrl(sheetId),
      ...extra,
    };
  }

  return {
    async createSheet({ sheetId, headers = [], rows = [] }) {
      const table = [];
      if (headers.length) table.push(headers);
      table.push(...rows);
      const result = await client.createSheet({ sheetId, table: table.length ? table : [[""]] });
      trackSheet(result.sheetId);
      return {
        content: [{ type: "text", text: `Opened sheet ${result.sheetId}.` }],
        structuredContent: {
          sheetId: result.sheetId,
          preview: tablePreview(table.length ? table : [[""]]),
          rowCount: table.length || 1,
          columnCount: Math.max(headers.length, ...rows.map((r) => r.length), 1),
        },
        _meta: widgetMeta(result.sheetId, "create"),
      };
    },

    async openSheet({ sheetId, maxRows = 20 }) {
      const table = await client.getTable(sheetId);
      trackSheet(sheetId);
      return {
        content: [{ type: "text", text: `Loaded sheet ${sheetId}.` }],
        structuredContent: {
          sheetId,
          preview: tablePreview(table, maxRows),
          rowCount: table.length,
          columnCount: Math.max(...table.map((row) => row.length), 0),
          csv: stringifyCsv(table),
        },
        _meta: widgetMeta(sheetId, "open"),
      };
    },

    async getSnapshot({ sheetId, maxRows = 20 }) {
      const table = await client.getTable(sheetId);
      return {
        content: [{ type: "text", text: `Fetched a ${Math.min(table.length, maxRows)}-row preview for ${sheetId}.` }],
        structuredContent: {
          sheetId,
          preview: tablePreview(table, maxRows),
          rowCount: table.length,
          columnCount: Math.max(...table.map((row) => row.length), 0),
        },
        _meta: widgetMeta(sheetId, "snapshot"),
      };
    },

    async setRangeValues({ sheetId, startCell, values }) {
      const table = await client.getTable(sheetId);
      const updated = setRangeValues(table, startCell, values);
      await client.putTable(sheetId, updated);
      trackSheet(sheetId);
      return {
        content: [{ type: "text", text: `Updated ${values.length} row(s) starting at ${startCell} in ${sheetId}.` }],
        structuredContent: {
          sheetId,
          startCell,
          values,
          preview: tablePreview(updated),
        },
        _meta: widgetMeta(sheetId, "set-range", { startCell }),
      };
    },

    async appendRowsTool({ sheetId, rows }) {
      const table = await client.getTable(sheetId);
      const updated = appendRows(table, rows);
      await client.putTable(sheetId, updated);
      trackSheet(sheetId);
      return {
        content: [{ type: "text", text: `Appended ${rows.length} row(s) to ${sheetId}.` }],
        structuredContent: {
          sheetId,
          appendedRows: rows.length,
          preview: tablePreview(updated),
        },
        _meta: widgetMeta(sheetId, "append-rows"),
      };
    },

    async clearRangeTool({ sheetId, range }) {
      const table = await client.getTable(sheetId);
      const updated = clearRange(table, range);
      await client.putTable(sheetId, updated);
      trackSheet(sheetId);
      return {
        content: [{ type: "text", text: `Cleared ${range} in ${sheetId}.` }],
        structuredContent: {
          sheetId,
          range,
          preview: tablePreview(updated),
        },
        _meta: widgetMeta(sheetId, "clear-range", { range }),
      };
    },

    async sortSheet({ sheetId, column, hasHeader = true, direction = "asc" }) {
      const table = await client.getTable(sheetId);
      const updated = sortByColumn(table, column, hasHeader, direction);
      await client.putTable(sheetId, updated);
      trackSheet(sheetId);
      return {
        content: [{ type: "text", text: `Sorted ${sheetId} by ${column} (${direction}).` }],
        structuredContent: {
          sheetId,
          column,
          direction,
          preview: tablePreview(updated),
        },
        _meta: widgetMeta(sheetId, "sort", { column, direction }),
      };
    },

    async summarizeSheet({ sheetId, maxRows = 20 }) {
      const table = await client.getTable(sheetId);
      const header = table[0] ?? [];
      const nonEmptyRows = table.filter((row) => row.some((value) => String(value ?? "").trim() !== ""));
      return {
        content: [{ type: "text", text: `Summary for ${sheetId}: ${nonEmptyRows.length} non-empty rows, ${header.length} columns.` }],
        structuredContent: {
          sheetId,
          header,
          rowCount: table.length,
          nonEmptyRows: nonEmptyRows.length,
          sample: tablePreview(table, maxRows),
        },
        _meta: widgetMeta(sheetId, "summary"),
      };
    },

    listSheets({ limit } = {}) {
      // Return sheets sorted most-recently-used first, with lastAccessed timestamps
      const all = [...history.entries()]
        .reverse()
        .map(([id, lastAccessed]) => ({ id, lastAccessed }));
      const sheets = limit ? all.slice(0, limit) : all;
      const ids = sheets.map((s) => s.id);
      return {
        content: [{ type: "text", text: `Known sheets: ${ids.join(", ") || "(none)"}` }],
        structuredContent: { sheets },
        _meta: { action: "list-sheets" },
      };
    },

    async applyFormula({ sheetId, cell, formula }) {
      let table;
      try {
        await client.postCommand(sheetId, `set ${cell} formula ${formula}\n`);
        table = await client.getTable(sheetId);
      } catch {
        table = await client.getTable(sheetId);
        const updated = setRangeValues(table, cell, [[formula]]);
        await client.putTable(sheetId, updated);
        table = updated;
      }
      trackSheet(sheetId);
      return {
        content: [{ type: "text", text: `Applied formula ${formula} to ${cell} in ${sheetId}.` }],
        structuredContent: {
          sheetId,
          cell,
          formula,
          preview: tablePreview(table),
        },
        _meta: widgetMeta(sheetId, "apply-formula", { cell, formula }),
      };
    },

    async getRangeSnapshot({ sheetId, range }) {
      const table = await client.getTable(sheetId);
      const { startRow, endRow, startCol, endCol } = parseRange(range);
      const subTable = table
        .slice(startRow, endRow + 1)
        .map((row) => row.slice(startCol, endCol + 1));
      trackSheet(sheetId);
      return {
        content: [{ type: "text", text: `Range ${range} in ${sheetId}: ${subTable.length} row(s), ${subTable[0]?.length ?? 0} column(s).` }],
        structuredContent: {
          sheetId,
          range,
          data: subTable,
          rowCount: subTable.length,
          columnCount: subTable[0]?.length ?? 0,
          preview: tablePreview(subTable),
        },
        _meta: widgetMeta(sheetId, "range-snapshot", { range }),
      };
    },

    async findReplace({ sheetId, find, replace = "", caseSensitive = false, rangeOnly }) {
      const table = await client.getTable(sheetId);
      let bounds = null;
      if (rangeOnly) {
        bounds = parseRange(rangeOnly);
      }
      let changedCells = 0;
      const updated = table.map((row, r) =>
        row.map((cell, c) => {
          if (bounds && (r < bounds.startRow || r > bounds.endRow || c < bounds.startCol || c > bounds.endCol)) {
            return cell;
          }
          const cellStr = String(cell ?? "");
          const findStr = find;
          const haystack = caseSensitive ? cellStr : cellStr.toLowerCase();
          const needle = caseSensitive ? findStr : findStr.toLowerCase();
          if (!haystack.includes(needle)) return cell;
          changedCells += 1;
          if (caseSensitive) {
            return cellStr.split(findStr).join(replace);
          }
          return cellStr.replace(new RegExp(findStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), replace);
        })
      );
      await client.putTable(sheetId, updated);
      trackSheet(sheetId);
      return {
        content: [{ type: "text", text: `Replaced "${find}" with "${replace}" in ${changedCells} cell(s) in ${sheetId}.` }],
        structuredContent: {
          sheetId,
          find,
          replace,
          changedCells,
          preview: tablePreview(updated),
        },
        _meta: widgetMeta(sheetId, "find-replace", { find, replace }),
      };
    },

    async addColumn({ sheetId, header, values = [], position }) {
      const table = await client.getTable(sheetId);
      const insertAt = position != null ? position : Math.max(0, ...table.map((row) => row.length));
      const updated = table.map((row, r) => {
        const newRow = [...row];
        const val = r === 0 ? header : (values[r - 1] ?? "");
        newRow.splice(insertAt, 0, val);
        return newRow;
      });
      await client.putTable(sheetId, updated);
      trackSheet(sheetId);
      return {
        content: [{ type: "text", text: `Added column "${header}" at position ${insertAt} in ${sheetId}.` }],
        structuredContent: {
          sheetId,
          header,
          position: insertAt,
          preview: tablePreview(updated),
        },
        _meta: widgetMeta(sheetId, "add-column", { header, position: insertAt }),
      };
    },

    async computeColumn({ sheetId, targetColumn, formula }) {
      const table = await client.getTable(sheetId);
      const dataRows = table.length > 1 ? table.length - 1 : 0;

      // Try postCommand path first; if it fails, fall back to a single batch CSV write.
      let usedCommandApi = true;
      for (let i = 1; i <= dataRows; i += 1) {
        const cell = `${targetColumn}${i + 1}`;
        const resolvedFormula = formula.replace(/\{row\}/g, String(i + 1));
        try {
          await client.postCommand(sheetId, `set ${cell} formula ${resolvedFormula}\n`);
        } catch {
          usedCommandApi = false;
          break;
        }
      }

      if (!usedCommandApi) {
        // Batch fallback: write all formula strings in one putTable call.
        const current = await client.getTable(sheetId);
        const startCell = `${targetColumn}2`;
        const formulaValues = Array.from({ length: dataRows }, (_, i) => [
          formula.replace(/\{row\}/g, String(i + 2)),
        ]);
        const patched = setRangeValues(current, startCell, formulaValues);
        await client.putTable(sheetId, patched);
      }

      const finalTable = await client.getTable(sheetId);
      trackSheet(sheetId);
      return {
        content: [{ type: "text", text: `Computed column ${targetColumn} for ${dataRows} row(s) in ${sheetId}.` }],
        structuredContent: {
          sheetId,
          targetColumn,
          rowsUpdated: dataRows,
          preview: tablePreview(finalTable),
        },
        _meta: widgetMeta(sheetId, "compute-column", { targetColumn }),
      };
    },

    async deleteRows({ sheetId, rows }) {
      const table = await client.getTable(sheetId);
      const indicesSet = new Set(rows.map((r) => r - 1));
      const updated = table.filter((_, idx) => !indicesSet.has(idx));
      await client.putTable(sheetId, updated);
      trackSheet(sheetId);
      return {
        content: [{ type: "text", text: `Deleted ${indicesSet.size} row(s) from ${sheetId}.` }],
        structuredContent: {
          sheetId,
          deletedRows: indicesSet.size,
          preview: tablePreview(updated),
        },
        _meta: widgetMeta(sheetId, "delete-rows", { rows }),
      };
    },

    async renameSheet({ sheetId, newSheetId }) {
      const table = await client.getTable(sheetId);
      await client.putTable(newSheetId, table);
      history.delete(sheetId);
      trackSheet(newSheetId);
      return {
        content: [{ type: "text", text: `Renamed sheet "${sheetId}" to "${newSheetId}".` }],
        structuredContent: {
          oldSheetId: sheetId,
          newSheetId,
          preview: tablePreview(table),
        },
        _meta: widgetMeta(newSheetId, "rename-sheet", { oldSheetId: sheetId }),
      };
    },
  };
}
