#!/usr/bin/env node
// softglaze-browser-mcp: lets AI apps that start MCP servers as a local command (Claude Desktop,
// Cursor, VS Code, Gemini CLI, Antigravity, Codex and others) use the MCP server built into
// SoftGlaze Browser on this computer. It speaks MCP over stdio to the AI app and forwards every
// message to http://127.0.0.1:<port>/mcp with your SoftGlaze AI token.
//
//   softglaze-browser-mcp            run (the AI app does this)
//   softglaze-browser-mcp --check    test the address and token, then exit
//   softglaze-browser-mcp --version | --help
import { createRequire } from 'node:module';
import process from 'node:process';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { resolveConfig } from '../lib/config.js';
import { Relay, describeError } from '../lib/relay.js';

const { version: VERSION } = createRequire(import.meta.url)('../package.json');
const log = (text) => process.stderr.write(`[softglaze-browser-mcp] ${text}\n`);

const HELP = `softglaze-browser-mcp ${VERSION}
Connects an AI app to the MCP server inside SoftGlaze Browser on this computer.

  softglaze-browser-mcp            run (your AI app starts this)
  softglaze-browser-mcp --check    test the address and token, then exit
  softglaze-browser-mcp --version

Environment:
  SOFTGLAZE_TOKEN            your SoftGlaze AI token (sgai_...), from the SoftGlaze AI page
  SOFTGLAZE_PORT             the port on the SoftGlaze AI page (default 8080)
  SOFTGLAZE_MCP_URL          full address instead of the port (127.0.0.1, localhost or [::1] only)
  SOFTGLAZE_CONNECTION_FILE  JSON file with "url" and "token" (default ~/.softglaze/mcp-connection.json)

Guide: https://browser.softglaze.com/docs/ai-agents`;

function hasId(m) {
  return m && typeof m === 'object' && m.id !== undefined && m.id !== null && typeof m.method === 'string';
}

async function run() {
  const cfg = resolveConfig();
  const stdio = new StdioServerTransport();
  const toClient = (m) => { stdio.send(m).catch((e) => log(`Could not write to the AI app: ${e.message}`)); };
  stdio.onerror = (e) => log(`Message from the AI app could not be read: ${e && e.message ? e.message : e}`);

  if (cfg.problems.length) {
    // Answer every request with the setup problem, so the AI app shows why SoftGlaze is missing.
    const text = cfg.problems.join(' ');
    log(text);
    stdio.onmessage = (m) => { if (hasId(m)) toClient({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message: text } }); };
    await stdio.start();
    process.stdin.on('end', () => process.exit(0));
    return;
  }

  const relay = new Relay({ url: cfg.url, token: cfg.token, toClient, log });
  stdio.onmessage = (m) => { relay.handle(m); };
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await relay.close();
    process.exit(0);
  };
  process.stdin.on('end', shutdown);
  process.stdin.on('close', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await stdio.start();
  log(`Connecting to ${cfg.url.href} (token from ${cfg.tokenSource}).`);
}

async function check() {
  const cfg = resolveConfig();
  const out = (s) => process.stdout.write(`${s}\n`);
  out(`softglaze-browser-mcp ${VERSION}`);
  out(`Address: ${cfg.url ? cfg.url.href : '(invalid)'} (from ${cfg.urlSource})`);
  out(`Token:   ${cfg.token ? `${cfg.token.slice(0, 7)}... (from ${cfg.tokenSource})` : '(none)'}`);
  if (cfg.problems.length) { cfg.problems.forEach((p) => out(`Problem: ${p}`)); return 1; }
  const client = new Client({ name: 'softglaze-browser-mcp-check', version: VERSION });
  const transport = new StreamableHTTPClientTransport(cfg.url, { requestInit: { headers: { Authorization: `Bearer ${cfg.token}` } } });
  try {
    await client.connect(transport);
    const info = client.getServerVersion() || {};
    const { tools } = await client.listTools();
    out(`OK: connected to ${info.title || info.name || 'SoftGlaze'} ${info.version || ''}`.trim());
    out(`Tools this token may use: ${tools.length}`);
    try { await transport.terminateSession(); } catch { /* ignore */ }
    await client.close();
    return 0;
  } catch (e) {
    out(`Problem: ${describeError(e, cfg.url.href)}`);
    try { await client.close(); } catch { /* ignore */ }
    return 1;
  }
}

const arg = process.argv[2] || '';
if (arg === '--version' || arg === '-v') process.stdout.write(`${VERSION}\n`);
else if (arg === '--help' || arg === '-h') process.stdout.write(`${HELP}\n`);
else if (arg === '--check') check().then((code) => process.exit(code));
else run().catch((e) => { log(`Could not start: ${e && e.message ? e.message : e}`); process.exit(1); });
