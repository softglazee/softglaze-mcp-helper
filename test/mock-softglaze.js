// A stand-in for SoftGlaze Browser's MCP endpoint, for tests only, built the same way as the real one
// (src/main/localApi.js + src/main/ai/mcpServer.js in the app): Host check, Bearer token, the
// official SDK's McpServer and StreamableHTTPServerTransport with one session per client, 404 for an
// unknown session, 400 for a request before initialize. Made-up data, a free port on 127.0.0.1.
import http from 'node:http';
import crypto from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

export const TEST_TOKEN = `sgai_${'T'.repeat(40)}`;

function buildServer() {
  const server = new McpServer({ name: 'softglaze', title: 'SoftGlaze Browser (mock)', version: '0.0.0-test' }, { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: 'Mock SoftGlaze server for tests.' });
  server.registerTool('workspace_summary', { title: 'Workspace summary', description: 'Counts (mock).', inputSchema: {} },
    async () => ({ content: [{ type: 'text', text: 'Workspace: 3 profiles, 2 proxies (mock data).' }] }));
  server.registerTool('start_profile', { title: 'Start a profile', description: 'Starts a profile (mock).', inputSchema: { id: z.number().int() } },
    async ({ id }) => ({ isError: true, content: [{ type: 'text', text: `Waiting for approval in SoftGlaze to start profile #${id} (mock).` }] }));
  server.registerPrompt('daily_health_check', { title: 'Daily health check', description: 'Mock prompt.', argsSchema: { group: z.string().optional() } },
    async ({ group }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Health check for ${group || 'all groups'} (mock).` } }] }));
  server.registerResource('workspace-memory', 'softglaze://memory/workspace', { title: 'Workspace memory', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: '# Rules (mock)' }] }));
  return server;
}

export function startMock({ token = TEST_TOKEN } = {}) {
  const sessions = new Map();
  const log = [];
  let port = 0;

  const send = (res, status, obj, headers = {}) => {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers });
    res.end(body);
  };

  const handler = async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const text = Buffer.concat(chunks).toString('utf8');
    let body;
    try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
    log.push({ method: req.method, headers: req.headers, body });
    const host = String(req.headers.host || '');
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 403, { ok: false, error: 'Forbidden', message: 'Invalid Host header.' });
    if (!req.url.startsWith('/mcp')) return send(res, 404, { ok: false, error: 'NotFound', message: 'Unknown endpoint.' });
    if (String(req.headers.authorization || '') !== `Bearer ${token}`) {
      return send(res, 401, { ok: false, error: 'Unauthorized', message: 'Unknown token.' }, { 'WWW-Authenticate': 'Bearer realm="SoftGlaze"' });
    }
    const sid = req.headers['mcp-session-id'];
    const existing = sid ? sessions.get(String(sid)) : null;
    if (existing) return existing.handleRequest(req, res, body);
    if (sid) return send(res, 404, { jsonrpc: '2.0', error: { code: -32001, message: 'Session not found. Start a new session.' }, id: null });
    if (req.method !== 'POST' || !isInitializeRequest(body)) return send(res, 400, { jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: send an initialize request first.' }, id: null });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => { sessions.set(id, transport); }
    });
    transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
    await buildServer().connect(transport);
    return transport.handleRequest(req, res, body);
  };

  const server = http.createServer((req, res) => { handler(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch { /* ignore */ } }); });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve({
        port,
        url: `http://127.0.0.1:${port}/mcp`,
        token,
        log,
        sessions,
        // What a SoftGlaze restart looks like to a client: every session is gone.
        dropSessions: async () => { for (const t of [...sessions.values()]) { try { await t.close(); } catch { /* ignore */ } } sessions.clear(); },
        close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); })
      });
    });
  });
}
