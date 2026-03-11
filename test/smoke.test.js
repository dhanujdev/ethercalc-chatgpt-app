import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';

function startMockEtherCalc(port = 8000) {
  const sheets = new Map();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);

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

  return new Promise((resolve) => server.listen(port, () => resolve({ server, sheets })));
}

test('server starts and serves health endpoint', async () => {
  const { server: mock } = await startMockEtherCalc(8000);
  const child = spawn('node', ['src/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: '8787', ETHERCALC_BASE_URL: 'http://127.0.0.1:8000', APP_BASE_URL: 'http://127.0.0.1:8787' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
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
        if (text.trim()) {
          clearTimeout(timer);
          reject(new Error(text));
        }
      });
    });

    const health = await fetch('http://127.0.0.1:8787/');
    assert.equal(health.status, 200);
    const json = await health.json();
    assert.equal(json.status, 'ok');

    const widget = await fetch('http://127.0.0.1:8787/widget-preview');
    assert.equal(widget.status, 200);
    const html = await widget.text();
    assert.match(html, /EtherCalc Spreadsheet Assistant/);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await new Promise((resolve) => mock.close(resolve));
  }
});
