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
  const knownSheets = new Set();

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
      knownSheets.add(result.sheetId);
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
      knownSheets.add(sheetId);
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
      knownSheets.add(sheetId);
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
      knownSheets.add(sheetId);
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
      knownSheets.add(sheetId);
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
      knownSheets.add(sheetId);
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
      const all = [...knownSheets];
      const sheets = limit ? all.slice(0, limit) : all;
      return {
        content: [{ type: "text", text: `Known sheets: ${sheets.join(", ") || "(none)"}` }],
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
      knownSheets.add(sheetId);
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
      knownSheets.add(sheetId);
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
      knownSheets.add(sheetId);
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
      knownSheets.add(sheetId);
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
      for (let i = 1; i <= dataRows; i += 1) {
        const cell = `${targetColumn}${i + 1}`;
        const resolvedFormula = formula.replace(/\{row\}/g, String(i + 1));
        try {
          await client.postCommand(sheetId, `set ${cell} formula ${resolvedFormula}\n`);
        } catch {
          const current = await client.getTable(sheetId);
          const patched = setRangeValues(current, cell, [[resolvedFormula]]);
          await client.putTable(sheetId, patched);
        }
      }
      const finalTable = await client.getTable(sheetId);
      knownSheets.add(sheetId);
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
      const indices = [...new Set(rows.map((r) => r - 1))].sort((a, b) => b - a);
      const updated = table.filter((_, idx) => !indices.includes(idx));
      await client.putTable(sheetId, updated);
      knownSheets.add(sheetId);
      return {
        content: [{ type: "text", text: `Deleted ${indices.length} row(s) from ${sheetId}.` }],
        structuredContent: {
          sheetId,
          deletedRows: indices.length,
          preview: tablePreview(updated),
        },
        _meta: widgetMeta(sheetId, "delete-rows", { rows }),
      };
    },

    async renameSheet({ sheetId, newSheetId }) {
      const table = await client.getTable(sheetId);
      await client.putTable(newSheetId, table);
      knownSheets.delete(sheetId);
      knownSheets.add(newSheetId);
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
