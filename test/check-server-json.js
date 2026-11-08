// Checks the server.json files for the official MCP Registry before publishing:
//   1. JSON Schema validation against the registry's published schema (2025-12-11), vendored in
//      registry/schema/ (downloaded 9 Nov 2026 from static.modelcontextprotocol.io, sha256 3fba0959...14de0).
//   2. Rules the registry's publish step adds on top (from the registry's docs and validator source):
//      npm mcpName must equal the server name, versions must be exact (no ranges, no "latest"),
//      websiteUrl and icons must use https, remotes may not point at localhost.
// `mcp-publisher validate` is the authoritative check; run it too before `mcp-publisher publish`.
// Run: npm run registry:check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'registry', 'schema', 'server.schema.2025-12-11.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const files = [
  { file: 'server.json', npmPackage: pkg },
  { file: path.join('registry', 'proxy-bridge', 'server.npm.json'), npmPackage: null }
];

let failed = 0;
for (const { file, npmPackage } of files) {
  const doc = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const problems = [];
  if (!validate(doc)) for (const e of validate.errors) problems.push(`schema: ${e.instancePath || '/'} ${e.message}`);
  if (doc.$schema !== schema.$id) problems.push(`$schema should be ${schema.$id}`);
  if (doc.websiteUrl && !doc.websiteUrl.startsWith('https://')) problems.push('websiteUrl must use https');
  for (const i of doc.icons || []) if (!i.src.startsWith('https://')) problems.push(`icon ${i.src} must use https`);
  for (const r of doc.remotes || []) {
    const u = new URL(r.url);
    if (u.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(u.hostname)) problems.push(`remote ${r.url} must be a public https URL`);
  }
  for (const p of doc.packages || []) {
    if (!p.version || p.version === 'latest' || /[\^~<>*x ]|\|\|/.test(p.version)) problems.push(`package ${p.identifier}: version must be exact`);
    if (p.registryType === 'npm' && npmPackage) {
      if (p.identifier !== npmPackage.name) problems.push(`package identifier ${p.identifier} is not package.json name ${npmPackage.name}`);
      if (p.version !== npmPackage.version) problems.push(`package version ${p.version} is not package.json version ${npmPackage.version}`);
      if (npmPackage.mcpName !== doc.name) problems.push(`package.json mcpName ${npmPackage.mcpName} must equal ${doc.name}`);
    }
  }
  if (npmPackage && doc.version !== npmPackage.version) problems.push(`server version ${doc.version} is not package.json version ${npmPackage.version}`);
  if (problems.length) { failed += 1; console.log(`FAIL ${file}`); problems.forEach((p) => console.log(`  - ${p}`)); }
  else console.log(`OK   ${file}`);
}
process.exit(failed ? 1 : 0);
