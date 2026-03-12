import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';

function startMockEtherCalc(port = 0) {
  const sheets = new Map();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${server.address().port}`);

    if (req.method === 'PUT' && url.pathname.startsWith('/_/')) {
      const id = decodeURIComponent(url.pathname.slice(3));
      let body = '';
      for await (const chunk of req) body += chunk;
      sheets.set(id, body);
      res.writeHead(200).end('ok');
      return;
    }

    if (req.method === 'POST' && url.pathname === '/_') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const id = `sheet-${sheets.size + 1}`;
      sheets.set(id, body);
      res.writeHead(201, { location: `/_/${id}` }).end('created');
      return;
    }

    if (req.method === 'GET' && url.pathname.endsWith('.csv')) {
      const id = decodeURIComponent(url.pathname.slice(1, -4));
      if (!sheets.has(id)) {
        res.writeHead(404).end('missing');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/csv' }).end(sheets.get(id));
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/_/') && url.pathname.endsWith('/cells')) {
      const id = decodeURIComponent(url.pathname.split('/')[2]);
      if (!sheets.has(id)) {
        res.writeHead(404).end('missing');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({}));
      return;
    }

    res.writeHead(404).end('not found');
  });

  return new Promise((resolve) => server.listen(port, () => resolve({ server, sheets, port: server.address().port })));
}

async function startAppServer(mockPort) {
  const appPort = await new Promise((resolve) => {
    const tmp = createServer();
    tmp.listen(0, () => { const p = tmp.address().port; tmp.close(() => resolve(p)); });
  });

  const child = spawn('node', ['src/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      ETHERCALC_BASE_URL: `http://127.0.0.1:${mockPort}`,
      APP_BASE_URL: `http://127.0.0.1:${appPort}`,
      SESSIONS_FILE: `/tmp/smoke-sessions-${appPort}.json`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('EtherCalc MCP server listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      if (text.trim()) { clearTimeout(timer); reject(new Error(text)); }
    });
  });

  return { child, appPort };
}

async function rpc(appPort, body) {
  const res = await fetch(`http://127.0.0.1:${appPort}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

const EXPECTED_TOOLS = [
  'create_sheet', 'open_sheet', 'get_sheet_snapshot', 'set_range_values',
  'append_rows', 'clear_range', 'sort_sheet', 'summarize_sheet',
  'list_sheets', 'apply_formula', 'get_range_snapshot',
  'find_replace', 'add_column', 'compute_column', 'delete_rows', 'rename_sheet',
];

test('server starts and serves health endpoint', async () => {
  const { server: mock, port: mockPort } = await startMockEtherCalc(0);
  const { child, appPort } = await startAppServer(mockPort);

  try {
    const health = await fetch(`http://127.0.0.1:${appPort}/`);
    assert.equal(health.status, 200);
    const json = await health.json();
    assert.equal(json.status, 'ok');

    const widget = await fetch(`http://127.0.0.1:${appPort}/widget-preview`);
    assert.equal(widget.status, 200);
    const html = await widget.text();
    assert.match(html, /EtherCalc Spreadsheet Assistant/);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await new Promise((resolve) => mock.close(resolve));
  }
});

test('tools/list returns all expected tools', async () => {
  const { server: mock, port: mockPort } = await startMockEtherCalc(0);
  const { child, appPort } = await startAppServer(mockPort);

  try {
    const res = await rpc(appPort, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    const names = res.result.tools.map((t) => t.name);
    for (const expected of EXPECTED_TOOLS) {
      assert.ok(names.includes(expected), `missing tool: ${expected}`);
    }
    assert.equal(names.length, EXPECTED_TOOLS.length);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await new Promise((resolve) => mock.close(resolve));
  }
});

test('create_sheet and list_sheets round-trip via MCP', async () => {
  const { server: mock, port: mockPort } = await startMockEtherCalc(0);
  const { child, appPort } = await startAppServer(mockPort);

  try {
    // Create a sheet
    const create = await rpc(appPort, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'create_sheet', arguments: { sheetId: 'smoke-test', headers: ['A', 'B'] } },
    });
    assert.equal(create.result.structuredContent.sheetId, 'smoke-test');

    // list_sheets should return it with id + lastAccessed
    const list = await rpc(appPort, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'list_sheets', arguments: {} },
    });
    const sheets = list.result.structuredContent.sheets;
    assert.ok(Array.isArray(sheets));
    assert.ok(sheets.length > 0);
    assert.ok('id' in sheets[0], 'sheet entry should have id');
    assert.ok('lastAccessed' in sheets[0], 'sheet entry should have lastAccessed');
    assert.equal(sheets[0].id, 'smoke-test');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await new Promise((resolve) => mock.close(resolve));
  }
});

test('find_replace tool modifies sheet content via MCP', async () => {
  const { server: mock, port: mockPort } = await startMockEtherCalc(0);
  const { child, appPort } = await startAppServer(mockPort);

  try {
    await rpc(appPort, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'create_sheet', arguments: { sheetId: 'fr-test', headers: ['Name'], rows: [['Alice'], ['alice']] } },
    });

    const res = await rpc(appPort, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'find_replace', arguments: { sheetId: 'fr-test', find: 'alice', replace: 'Bob' } },
    });
    assert.equal(res.result.structuredContent.changedCells, 2);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await new Promise((resolve) => mock.close(resolve));
  }
});
