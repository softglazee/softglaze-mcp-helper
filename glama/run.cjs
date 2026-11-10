#!/usr/bin/env node
'use strict';
// Glama build check ONLY: starts the stand-in for the SoftGlaze Browser desktop app on 127.0.0.1, then
// runs the REAL helper (bin/softglaze-browser-mcp.js) over stdio against it, so Glama can start the
// server and read its tool definitions. Real users never run this file: the helper talks to
// SoftGlaze Browser itself. Not part of the npm package ("files" in package.json).
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startStandIn } = require('./stand-in.cjs');

(async () => {
  const { port } = await startStandIn({ port: 0 });
  const helper = path.join(__dirname, '..', 'bin', 'softglaze-browser-mcp.js');
  const child = spawn(process.execPath, [helper], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SOFTGLAZE_MCP_URL: `http://127.0.0.1:${port}/mcp`,
      SOFTGLAZE_TOKEN: process.env.SOFTGLAZE_TOKEN || 'sgai_glama_build_check_placeholder',
      SOFTGLAZE_CONNECTION_FILE: path.join(__dirname, 'no-connection-file.json')
    }
  });
  child.on('exit', (code) => process.exit(code == null ? 1 : code));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
})().catch((e) => { process.stderr.write(`glama/run.cjs: ${e.message}\n`); process.exit(1); });
