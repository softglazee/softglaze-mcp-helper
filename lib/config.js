// Where SoftGlaze Browser's MCP server is and which token to use.
//
// Settings, first match wins:
//   address  SOFTGLAZE_MCP_URL, then SOFTGLAZE_PORT, then "url" in the connection file,
//            then http://127.0.0.1:8080/mcp
//   token    SOFTGLAZE_TOKEN, then "token" in the connection file
// The connection file is SOFTGLAZE_CONNECTION_FILE, or ~/.softglaze/mcp-connection.json:
//   { "url": "http://127.0.0.1:8080/mcp", "token": "sgai_..." }
// Only addresses on this computer are accepted (127.0.0.1, localhost, [::1]): the token is never
// sent anywhere else.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_PORT = 8080;
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]', '::1'];
const AI_TOKEN = /^sgai_[A-Za-z0-9]{20,}$/;
const API_TOKEN = /^sg_[A-Za-z0-9_-]{20,}$/;

// A value an AI app could not fill in, such as "${user_config.token}" or "${SOFTGLAZE_TOKEN}",
// counts as empty.
export function clean(value) {
  const v = String(value == null ? '' : value).trim();
  return /^\$\{[^}]*\}$/.test(v) ? '' : v;
}

export function defaultConnectionFile() {
  return path.join(os.homedir(), '.softglaze', 'mcp-connection.json');
}

export function readConnectionFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { found: false, url: '', token: '' }; }
  try {
    const j = JSON.parse(text.replace(/^﻿/, ''));
    return {
      found: true,
      url: typeof j.url === 'string' ? j.url.trim() : '',
      token: typeof j.token === 'string' ? j.token.trim() : ''
    };
  } catch {
    return { found: true, url: '', token: '', error: `${file} is not valid JSON.` };
  }
}

export function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return { ok: false, message: `"${raw}" is not a valid address.` }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, message: `"${raw}" must start with http://.` };
  if (!LOOPBACK_HOSTS.includes(u.hostname.toLowerCase())) {
    return { ok: false, message: `SoftGlaze runs on this computer only, so this helper connects to 127.0.0.1, localhost or [::1], not "${u.hostname}".` };
  }
  return { ok: true, url: u };
}

export function resolveConfig(env = process.env) {
  const connectionFile = clean(env.SOFTGLAZE_CONNECTION_FILE) || defaultConnectionFile();
  const conn = readConnectionFile(connectionFile);
  const problems = [];
  if (conn.error) problems.push(conn.error);

  let rawUrl = clean(env.SOFTGLAZE_MCP_URL);
  let urlSource = rawUrl ? 'SOFTGLAZE_MCP_URL' : '';
  const port = clean(env.SOFTGLAZE_PORT);
  if (!rawUrl && port) {
    const n = Number(port);
    if (Number.isInteger(n) && n >= 1 && n <= 65535) { rawUrl = `http://127.0.0.1:${n}/mcp`; urlSource = 'SOFTGLAZE_PORT'; }
    else problems.push(`The port "${port}" is not a number from 1 to 65535.`);
  }
  if (!rawUrl && conn.url) { rawUrl = conn.url; urlSource = connectionFile; }
  if (!rawUrl) { rawUrl = `http://127.0.0.1:${DEFAULT_PORT}/mcp`; urlSource = 'default'; }
  const checked = checkUrl(rawUrl);
  if (!checked.ok) problems.push(checked.message);

  let token = clean(env.SOFTGLAZE_TOKEN);
  let tokenSource = token ? 'SOFTGLAZE_TOKEN' : '';
  if (!token && conn.token) { token = conn.token; tokenSource = connectionFile; }
  if (!token) {
    problems.push('No SoftGlaze AI token. Create one in SoftGlaze Browser (SoftGlaze AI page, Tokens tab) and set it as SOFTGLAZE_TOKEN in your AI app\'s settings for this server, '
      + `or save it in ${connectionFile} as {"token": "sgai_..."}.`);
  } else if (API_TOKEN.test(token) && !AI_TOKEN.test(token)) {
    problems.push('This is a Developer API key (sg_...). The MCP server needs a SoftGlaze AI token (sgai_...) from the SoftGlaze AI page.');
  }
  return { url: checked.ok ? checked.url : null, urlSource, token, tokenSource, connectionFile, problems };
}
