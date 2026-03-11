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
  };
}
