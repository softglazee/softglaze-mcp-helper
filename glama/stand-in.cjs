'use strict';
// Glama build check ONLY. Not in the npm package, and never used on a real computer.
//
// The softglaze-browser-mcp helper (bin/softglaze-browser-mcp.js)
// only relays to the MCP server inside the SoftGlaze Browser desktop app on 127.0.0.1. Glama's build
// machine has no desktop app, so this stand-in plays the app's endpoint there: it answers the MCP
// handshake and tools/list with the app's real tool definitions (tools.json, exported from the app's
// own tool registry), and answers every tool call with an error that says to install the app.
// It holds no data, makes no outside requests and listens on 127.0.0.1 only.
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const SNAPSHOT = JSON.parse(fs.readFileSync(path.join(__dirname, 'tools.json'), 'utf8'));
const NOT_HERE = 'This is Glama\'s build check, not SoftGlaze Browser. To use this tool, install SoftGlaze Browser '
  + '(Windows, https://browser.softglaze.com), switch on SoftGlaze AI, create a token and connect the bridge to '
  + 'http://127.0.0.1:<port>/mcp. Guide: https://browser.softglaze.com/docs/ai-agents';

function startStandIn({ port = 0 } = {}) {
  const sessions = new Set();
  const send = (res, status, obj, headers = {}) => {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers });
    res.end(body);
  };
  const answer = (msg) => {
    switch (msg.method) {
      case 'tools/list': return { tools: SNAPSHOT.tools };
      case 'tools/call': return { isError: true, content: [{ type: 'text', text: NOT_HERE }] };
      case 'prompts/list': return { prompts: [] };
      case 'resources/list': return { resources: [] };
      case 'resources/templates/list': return { resourceTemplates: [] };
      case 'ping': return {};
      default: return null;
    }
  };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body;
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined; } catch (e) { body = undefined; }
      const listening = server.address().port;
      const host = String(req.headers.host || '');
      if (host !== `127.0.0.1:${listening}` && host !== `localhost:${listening}`) return send(res, 403, { ok: false, error: 'Forbidden' });
      if (req.method === 'GET' && req.url === '/api/v1/health') return send(res, 200, { ok: true, service: 'SoftGlaze stand-in for Glama build checks', ai: true });
      if (!req.url.startsWith('/mcp')) return send(res, 404, { ok: false, error: 'NotFound' });
      if (!/^Bearer \S+/.test(String(req.headers.authorization || ''))) return send(res, 401, { ok: false, error: 'Unauthorized' }, { 'WWW-Authenticate': 'Bearer realm="SoftGlaze"' });
      const sid = req.headers['mcp-session-id'];
      if (req.method === 'DELETE') { if (sid) sessions.delete(String(sid)); res.writeHead(200); res.end(); return undefined; }
      if (req.method !== 'POST' || !body) return send(res, 400, { jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request' }, id: null });
      if (body.method === 'initialize') {
        const id = crypto.randomUUID();
        sessions.add(id);
        return send(res, 200, { jsonrpc: '2.0', id: body.id, result: {
          protocolVersion: (body.params && body.params.protocolVersion) || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'softglaze', title: 'SoftGlaze Browser (Glama build-check stand-in)', version: String(SNAPSHOT.version || '0') },
          instructions: 'Stand-in used only for Glama\'s automated build check. Real use needs the SoftGlaze Browser desktop app.'
        } }, { 'mcp-session-id': id });
      }
      if (!sid || !sessions.has(String(sid))) return send(res, sid ? 404 : 400, { jsonrpc: '2.0', error: { code: sid ? -32001 : -32000, message: 'Session not found' }, id: body.id === undefined ? null : body.id });
      if (body.id === undefined) { res.writeHead(202); res.end(); return undefined; }
      const result = answer(body);
      return send(res, 200, result ? { jsonrpc: '2.0', id: body.id, result } : { jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, toolCount: SNAPSHOT.tools.length })));
}

module.exports = { startStandIn, NOT_HERE };
