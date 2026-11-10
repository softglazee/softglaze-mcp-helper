'use strict';
// The Glama build check: glama/run.js must start the real bridge against the stand-in, answer the MCP
// handshake, list the app's real tools, and refuse tool calls with the "install the app" message.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const snapshot = require('../glama/tools.json');

function startRun() {
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'glama', 'run.cjs')], { stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = '';
  const pending = new Map();
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const m = JSON.parse(line);
      if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    }
  });
  const call = (id, method, params) => new Promise((resolve) => {
    pending.set(id, resolve);
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const notify = (method) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
  return { p, call, notify };
}

test('glama/run.cjs serves the real tool list through the real helper', { timeout: 20000 }, async () => {
  const { p, call, notify } = startRun();
  try {
    const init = await call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.ok(init.result, 'initialize answered');
    assert.match(init.result.serverInfo.title, /stand-in/i);
    notify('notifications/initialized');
    const list = await call(2, 'tools/list', {});
    assert.strictEqual(list.result.tools.length, snapshot.tools.length);
    assert.ok(list.result.tools.every((t) => t.name && t.description && t.inputSchema), 'every tool has a name, description and schema');
    assert.ok(!list.result.tools.some((t) => t.name === 'get_cdp_endpoint'), 'Expert-only tool is not listed');
    const call3 = await call(3, 'tools/call', { name: 'list_profiles', arguments: {} });
    assert.strictEqual(call3.result.isError, true);
    assert.match(call3.result.content[0].text, /install SoftGlaze Browser/);
  } finally {
    p.kill();
  }
});
