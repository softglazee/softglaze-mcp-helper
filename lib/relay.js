// Passes MCP messages between an AI app (stdio) and SoftGlaze Browser (Streamable HTTP on
// 127.0.0.1), using the official MCP TypeScript SDK's transports on both sides. The relay does not
// interpret tools, prompts or resources: everything SoftGlaze offers reaches the AI app unchanged,
// and SoftGlaze's own checks (token scope, approvals, plan limits, audit) apply to every call.
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const RECONNECT_TIMEOUT_MS = 15000;

function hasId(m) {
  return m && typeof m === 'object' && m.id !== undefined && m.id !== null && typeof m.method === 'string';
}

// Plain-language text for a failed request to SoftGlaze.
export function describeError(e, url) {
  if (e instanceof StreamableHTTPError) {
    const body = String(e.message || '').replace(/^Streamable HTTP error: Error POSTing to endpoint: /, '');
    let detail = '';
    try { const j = JSON.parse(body); detail = j.message || (j.error && j.error.message) || ''; } catch { detail = ''; }
    const d = detail ? ` (${detail})` : '';
    switch (e.code) {
      case 401: return `SoftGlaze did not accept the token${d}. Check that the whole sgai_ token was entered, and that it is not revoked or expired on the SoftGlaze AI page.`;
      case 403: return `SoftGlaze refused the request${d}.`;
      case 404: return `SoftGlaze has no such session${d}. Reconnect the SoftGlaze server in your AI app.`;
      case 423: return `The SoftGlaze workspace is locked${d}. Unlock it in the app and try again.`;
      case 429: return `Too many requests${d}. Wait a moment and try again.`;
      case 503: return `SoftGlaze AI is switched off${d}. Switch on the AI server on the SoftGlaze AI page.`;
      default: return detail ? `SoftGlaze answered HTTP ${e.code}: ${detail}` : `SoftGlaze answered HTTP ${e.code}.`;
    }
  }
  const code = e && e.cause && e.cause.code ? e.cause.code : (e && e.code) || '';
  if (code === 'ECONNREFUSED' || (e instanceof TypeError && /fetch failed/i.test(String(e.message)))) {
    return `SoftGlaze is not reachable at ${url} (${code || 'no answer'}). Open SoftGlaze Browser, switch on the AI server on the SoftGlaze AI page, and check the port.`;
  }
  return `Connection to SoftGlaze failed: ${(e && e.message) || e}`;
}

export class Relay {
  // url: URL of SoftGlaze's /mcp; toClient(message) sends a message to the AI app; log(text) -> stderr.
  constructor({ url, token, toClient, log = () => {} }) {
    this.url = url;
    this.token = token;
    this.toClient = toClient;
    this.log = log;
    this.http = null;
    this.initMessage = null;
    this.clientInitId = undefined;
    this.reconnecting = null;
    this.reconnects = 0;
    this.waiters = new Map();
    this.pending = new Set();
  }

  makeTransport() {
    const t = new StreamableHTTPClientTransport(this.url, {
      requestInit: { headers: { Authorization: `Bearer ${this.token}` } }
    });
    t.onmessage = (m) => this.fromServer(t, m);
    // Errors of a send are handled where it is awaited; this only sees the background event stream.
    t.onerror = (e) => { if (!(e instanceof StreamableHTTPError)) this.log(`Event stream: ${e && e.message ? e.message : e}`); };
    return t;
  }

  async transport() {
    if (!this.http) {
      this.http = this.makeTransport();
      await this.http.start();
    }
    return this.http;
  }

  fromServer(t, m) {
    if (m && m.id !== undefined && this.waiters.has(m.id)) {
      const resolve = this.waiters.get(m.id);
      this.waiters.delete(m.id);
      resolve(m);
      return;
    }
    if (m && m.id === this.clientInitId && m.result && m.result.protocolVersion) t.setProtocolVersion(String(m.result.protocolVersion));
    this.toClient(m);
  }

  replyError(m, text, code = -32000) {
    if (hasId(m)) this.toClient({ jsonrpc: '2.0', id: m.id, error: { code, message: text } });
    else this.log(text);
  }

  // One message from the AI app.
  handle(m) {
    const p = this.forward(m).catch((e) => this.replyError(m, `Relay error: ${e && e.message ? e.message : e}`));
    this.pending.add(p);
    p.finally(() => this.pending.delete(p));
    return p;
  }

  async forward(m, retried = false) {
    const isInit = m && m.method === 'initialize';
    if (isInit) {
      this.initMessage = m;
      this.clientInitId = m.id;
      // A second initialize means a new session: end the old one first.
      if (this.http && this.http.sessionId) {
        const old = this.http;
        this.http = null;
        try { await old.terminateSession(); } catch { /* already gone */ }
        try { await old.close(); } catch { /* ignore */ }
      }
    } else if (this.reconnecting) {
      try { await this.reconnecting; } catch { /* the retry below reports it */ }
    }
    const t = await this.transport();
    const usedSession = t.sessionId;
    try {
      await t.send(m);
    } catch (e) {
      // 404 on a known session: SoftGlaze restarted, or AI was switched off and on. Open a new
      // session with the AI app's own initialize request and send this message again, once.
      if (!isInit && !retried && usedSession && this.initMessage && e instanceof StreamableHTTPError && e.code === 404) {
        try {
          if (this.http === t) await this.reconnect();
        } catch (re) {
          this.replyError(m, `The SoftGlaze session ended and a new one could not start: ${re.message}`);
          return;
        }
        // The new session already got its own "initialized" notification.
        if (m && m.method === 'notifications/initialized') return;
        await this.forward(m, true);
        return;
      }
      // Another message started a new session while this one was in flight on the old one, which
      // aborted it: send it again on the new session, once.
      if (!retried && e && e.name === 'AbortError' && (this.http !== t || this.reconnecting)) {
        await this.forward(m, true);
        return;
      }
      this.replyError(m, describeError(e, this.url.href));
    }
  }

  reconnect() {
    if (this.reconnecting) return this.reconnecting;
    this.reconnecting = (async () => {
      const old = this.http;
      this.http = null;
      if (old) { try { await old.close(); } catch { /* ignore */ } }
      const t = await this.transport();
      this.reconnects += 1;
      const id = `softglaze-mcp-reconnect-${this.reconnects}`;
      let timer;
      const answer = new Promise((resolve, reject) => {
        this.waiters.set(id, resolve);
        timer = setTimeout(() => { this.waiters.delete(id); reject(new Error('SoftGlaze did not answer in time.')); }, RECONNECT_TIMEOUT_MS);
      });
      try {
        await t.send({ ...this.initMessage, id });
        const r = await answer;
        if (r.error) throw new Error(String(r.error.message));
        if (r.result && r.result.protocolVersion) t.setProtocolVersion(String(r.result.protocolVersion));
      } catch (e) {
        throw new Error(e instanceof StreamableHTTPError ? describeError(e, this.url.href) : e.message);
      } finally {
        clearTimeout(timer);
      }
      await t.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      this.log('Reconnected to SoftGlaze with a new session.');
    })();
    const p = this.reconnecting;
    p.then(() => { this.reconnecting = null; }, () => { this.reconnecting = null; });
    return p;
  }

  // Waits briefly for calls in flight, then ends the session (HTTP DELETE).
  async close() {
    try { await Promise.race([Promise.allSettled([...this.pending]), new Promise((r) => setTimeout(r, 2000))]); } catch { /* ignore */ }
    const t = this.http;
    this.http = null;
    if (t) {
      try { await t.terminateSession(); } catch { /* app already closed */ }
      try { await t.close(); } catch { /* ignore */ }
    }
  }
}
