// Tests for softglaze-browser-mcp. The "AI app" is the official SDK Client over stdio, and SoftGlaze is
// test/mock-softglaze.js (the SDK's own server transport behind the app's Host and token checks).
// Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startMock, TEST_TOKEN } from './mock-softglaze.js';
import { resolveConfig } from '../lib/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(here, '..', 'bin', 'softglaze-browser-mcp.js');
const NO_FILE = path.join(os.tmpdir(), `softglaze-no-such-file-${process.pid}.json`);
const baseEnv = () => ({ PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT || '', SOFTGLAZE_CONNECTION_FILE: NO_FILE });

async function connect(env) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN], env: { ...baseEnv(), ...env }, stderr: 'pipe' });
  const client = new Client({ name: 'helper-test', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
};

test('config: environment first, then the connection file, then the default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgh-cfg-'));
  const file = path.join(dir, 'conn.json');
  fs.writeFileSync(file, JSON.stringify({ url: 'http://localhost:9123/mcp', token: TEST_TOKEN }));
  let c = resolveConfig({ SOFTGLAZE_CONNECTION_FILE: file });
  assert.equal(c.url.href, 'http://localhost:9123/mcp');
  assert.equal(c.tokenSource, file);
  c = resolveConfig({ SOFTGLAZE_CONNECTION_FILE: file, SOFTGLAZE_PORT: '8099', SOFTGLAZE_TOKEN: `sgai_${'E'.repeat(40)}` });
  assert.equal(c.url.href, 'http://127.0.0.1:8099/mcp');
  assert.equal(c.tokenSource, 'SOFTGLAZE_TOKEN');
  c = resolveConfig({ SOFTGLAZE_CONNECTION_FILE: NO_FILE, SOFTGLAZE_TOKEN: '${SOFTGLAZE_TOKEN}' });
  assert.equal(c.url.href, 'http://127.0.0.1:8080/mcp');
  assert.match(c.problems.join(' '), /No SoftGlaze AI token/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('config: only addresses on this computer, and only AI tokens', () => {
  for (const url of ['http://example.com/mcp', 'http://10.0.0.2:8080/mcp', 'https://softglaze.com/mcp']) {
    const c = resolveConfig({ SOFTGLAZE_CONNECTION_FILE: NO_FILE, SOFTGLAZE_MCP_URL: url, SOFTGLAZE_TOKEN: TEST_TOKEN });
    assert.equal(c.url, null, url);
  }
  const c = resolveConfig({ SOFTGLAZE_CONNECTION_FILE: NO_FILE, SOFTGLAZE_TOKEN: `sg_${'k'.repeat(32)}` });
  assert.match(c.problems.join(' '), /Developer API key/);
});

test('an SDK client gets tools, a tool result, prompts and resources through the helper', async () => {
  const mock = await startMock();
  const { client } = await connect({ SOFTGLAZE_MCP_URL: mock.url, SOFTGLAZE_TOKEN: mock.token });
  try {
    assert.equal(client.getServerVersion().name, 'softglaze');
    assert.match(client.getInstructions() || '', /Mock SoftGlaze/);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ['start_profile', 'workspace_summary']);
    const r = await client.callTool({ name: 'workspace_summary', arguments: {} });
    assert.match(r.content[0].text, /mock data/);
    const waiting = await client.callTool({ name: 'start_profile', arguments: { id: 7 } });
    assert.equal(waiting.isError, true);
    assert.match(waiting.content[0].text, /Waiting for approval/);
    const { prompts } = await client.listPrompts();
    assert.equal(prompts[0].name, 'daily_health_check');
    const p = await client.getPrompt({ name: 'daily_health_check', arguments: { group: 'Clients DE' } });
    assert.match(p.messages[0].content.text, /Clients DE/);
    const res = await client.readResource({ uri: 'softglaze://memory/workspace' });
    assert.match(res.contents[0].text, /Rules/);
    const posts = mock.log.filter((x) => x.method === 'POST');
    assert.ok(posts.every((x) => x.headers.authorization === `Bearer ${mock.token}`));
    assert.ok(posts.filter((x) => x.body && x.body.method !== 'initialize').every((x) => x.headers['mcp-session-id'] && x.headers['mcp-protocol-version']));
  } finally {
    await client.close();
    await mock.close();
  }
});

test('the session is ended with DELETE when the AI app closes', async () => {
  const mock = await startMock();
  const { client } = await connect({ SOFTGLAZE_MCP_URL: mock.url, SOFTGLAZE_TOKEN: mock.token });
  assert.equal(mock.sessions.size, 1);
  await client.close();
  assert.ok(await until(() => mock.log.some((x) => x.method === 'DELETE')));
  assert.ok(await until(() => mock.sessions.size === 0));
  await mock.close();
});

test('after SoftGlaze restarts, the next call opens a new session by itself', async () => {
  const mock = await startMock();
  const { client } = await connect({ SOFTGLAZE_MCP_URL: mock.url, SOFTGLAZE_TOKEN: mock.token });
  try {
    await mock.dropSessions();
    const r = await client.callTool({ name: 'workspace_summary', arguments: {} });
    assert.match(r.content[0].text, /mock data/);
    assert.equal(mock.sessions.size, 1);
  } finally {
    await client.close();
    await mock.close();
  }
});

test('a wrong token fails with a plain answer about the token', async () => {
  const mock = await startMock();
  try {
    await assert.rejects(connect({ SOFTGLAZE_MCP_URL: mock.url, SOFTGLAZE_TOKEN: `sgai_${'W'.repeat(40)}` }), /did not accept the token/);
  } finally {
    await mock.close();
  }
});

test('SoftGlaze not running: the answer says how to start it', async () => {
  const port = await freePort();
  await assert.rejects(connect({ SOFTGLAZE_MCP_URL: `http://127.0.0.1:${port}/mcp`, SOFTGLAZE_TOKEN: TEST_TOKEN }), /not reachable/);
});

test('no token: the answer gives the setup steps and nothing is sent', async () => {
  const mock = await startMock();
  try {
    await assert.rejects(connect({ SOFTGLAZE_MCP_URL: mock.url }), /No SoftGlaze AI token/);
    assert.equal(mock.log.length, 0);
  } finally {
    await mock.close();
  }
});

test('the token can come from the connection file', async () => {
  const mock = await startMock();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgh-conn-'));
  const file = path.join(dir, 'mcp-connection.json');
  fs.writeFileSync(file, JSON.stringify({ url: mock.url, token: mock.token }));
  const { client } = await connect({ SOFTGLAZE_CONNECTION_FILE: file });
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 2);
  } finally {
    await client.close();
    await mock.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--check reports the connection and the tool count without printing the token', async () => {
  const mock = await startMock();
  try {
    const out = await new Promise((resolve) => {
      const c = spawn(process.execPath, [BIN, '--check'], { env: { ...baseEnv(), SOFTGLAZE_MCP_URL: mock.url, SOFTGLAZE_TOKEN: mock.token } });
      let s = '';
      c.stdout.on('data', (d) => { s += d; });
      c.on('exit', (code) => resolve({ code, s }));
    });
    assert.equal(out.code, 0, out.s);
    assert.match(out.s, /OK: connected to SoftGlaze Browser \(mock\)/);
    assert.match(out.s, /Tools this token may use: 2/);
    assert.ok(!out.s.includes(mock.token));
  } finally {
    await mock.close();
  }
});
