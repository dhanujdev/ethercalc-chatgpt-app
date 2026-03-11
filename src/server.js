import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { schemas, validateArgs, makeAppContext } from "./tool-logic.js";

const port = Number(process.env.PORT ?? 8787);
const MCP_PATH = process.env.MCP_PATH ?? "/mcp";
const ethercalcBaseUrl = (process.env.ETHERCALC_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");
const appBaseUrl = (process.env.APP_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, "");
const widgetUri = "ui://widget/ethercalc-assistant-v1.html";
const widgetTemplate = readFileSync(join(process.cwd(), "public", "widget.html"), "utf8")
  .replaceAll("__ETHERCALC_BASE_URL__", ethercalcBaseUrl)
  .replaceAll("__APP_BASE_URL__", appBaseUrl);

const ctx = makeAppContext({ ethercalcBaseUrl });

const toolSpecs = [
  {
    name: "create_sheet",
    title: "Create sheet",
    description: "Create a new EtherCalc spreadsheet, optionally with headers and starter rows.",
    inputSchema: schemas.createSheet,
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    handler: ctx.createSheet,
  },
  {
    name: "open_sheet",
    title: "Open sheet",
    description: "Load a spreadsheet by sheet ID and return a preview for the ChatGPT UI.",
    inputSchema: schemas.openSheet,
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    handler: ctx.openSheet,
  },
  {
    name: "get_sheet_snapshot",
    title: "Get sheet snapshot",
    description: "Read a preview of the current spreadsheet without modifying it.",
    inputSchema: schemas.getSnapshot,
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    handler: ctx.getSnapshot,
  },
  {
    name: "set_range_values",
    title: "Set range values",
    description: "Write a 2D matrix of values into a sheet starting at an A1 cell reference.",
    inputSchema: schemas.setRangeValues,
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    handler: ctx.setRangeValues,
  },
  {
    name: "append_rows",
    title: "Append rows",
    description: "Append one or more rows to the bottom of a sheet.",
    inputSchema: schemas.appendRows,
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    handler: ctx.appendRowsTool,
  },
  {
    name: "clear_range",
    title: "Clear range",
    description: "Clear a rectangular range like A2:C10 in an existing sheet.",
    inputSchema: schemas.clearRange,
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true },
    handler: ctx.clearRangeTool,
  },
  {
    name: "sort_sheet",
    title: "Sort sheet",
    description: "Sort spreadsheet rows by a column label or zero-based column index.",
    inputSchema: schemas.sortSheet,
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    handler: ctx.sortSheet,
  },
  {
    name: "summarize_sheet",
    title: "Summarize sheet",
    description: "Summarize the shape and sample contents of a spreadsheet.",
    inputSchema: schemas.summarizeSheet,
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    handler: ctx.summarizeSheet,
  },
];

function schemaToJsonSchema(schema) {
  return schema;
}

function serializeTool(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: schemaToJsonSchema(tool.inputSchema),
    annotations: tool.annotations,
    _meta: {
      ui: { resourceUri: widgetUri },
      "openai/outputTemplate": widgetUri,
    },
  };
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, { "content-type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(payload));
}

function errorResponse(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

const resource = {
  uri: widgetUri,
  name: "ethercalc-widget",
  title: "EtherCalc Spreadsheet Assistant",
  mimeType: "text/html;profile=mcp-app",
  _meta: {
    ui: {
      prefersBorder: true,
      domain: appBaseUrl,
      csp: {
        connectDomains: [appBaseUrl, ethercalcBaseUrl],
        frameDomains: [ethercalcBaseUrl],
        resourceDomains: ["https://persistent.oaistatic.com", "https://*.oaistatic.com"],
      },
    },
  },
};

async function handleRpc(body) {
  const id = body?.id ?? null;
  const method = body?.method;
  const params = body?.params ?? {};

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "ethercalc-spreadsheet-assistant", version: "1.0.0" },
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
        },
      },
    };
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: toolSpecs.map(serializeTool) } };
  }

  if (method === "resources/list") {
    return { jsonrpc: "2.0", id, result: { resources: [resource] } };
  }

  if (method === "resources/read") {
    if (params.uri !== widgetUri) return errorResponse(id, -32004, "Unknown resource URI");
    return {
      jsonrpc: "2.0",
      id,
      result: {
        contents: [
          {
            uri: widgetUri,
            mimeType: resource.mimeType,
            text: widgetTemplate,
            _meta: resource._meta,
          },
        ],
      },
    };
  }

  if (method === "tools/call") {
    const name = params.name;
    const tool = toolSpecs.find((item) => item.name === name);
    if (!tool) return errorResponse(id, -32004, `Unknown tool: ${name}`);
    try {
      const args = validateArgs(tool.inputSchema, params.arguments ?? {});
      const result = await tool.handler(args);
      result._meta = {
        ...(result._meta ?? {}),
        "openai/outputTemplate": widgetUri,
      };
      return { jsonrpc: "2.0", id, result };
    } catch (error) {
      return errorResponse(id, -32010, error instanceof Error ? error.message : "Tool failed");
    }
  }

  return errorResponse(id, -32601, `Method not found: ${method}`);
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? `localhost:${port}`}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    sendJson(res, {
      name: "ethercalc-spreadsheet-assistant",
      status: "ok",
      mcp: MCP_PATH,
      ethercalcBaseUrl,
      compatibility: "lightweight-mcp-json-rpc",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/widget-preview") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(widgetTemplate);
    return;
  }

  if (req.method === "POST" && url.pathname === MCP_PATH) {
    let raw = "";
    for await (const chunk of req) raw += chunk;

    try {
      const parsed = JSON.parse(raw || "{}");
      if (Array.isArray(parsed)) {
        const batch = await Promise.all(parsed.map(handleRpc));
        sendJson(res, batch);
      } else {
        const response = await handleRpc(parsed);
        sendJson(res, response);
      }
    } catch (error) {
      sendJson(res, errorResponse(null, -32700, error instanceof Error ? error.message : "Parse error"), 400);
    }
    return;
  }

  if (["/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource"].includes(url.pathname)) {
    res.writeHead(404).end("Not Found");
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(port, () => {
  console.log(`EtherCalc MCP server listening on http://localhost:${port}${MCP_PATH}`);
});
