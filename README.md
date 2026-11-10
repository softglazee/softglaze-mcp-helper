# softglaze-browser-mcp

Connects AI apps to the MCP server built into [SoftGlaze Browser](https://browser.softglaze.com) on
your computer, for apps that start MCP servers as a local command (stdio).

SoftGlaze Browser (Windows, 1.0.22 or newer) serves MCP at `http://127.0.0.1:<port>/mcp` while its AI
server is switched on, and every request needs a SoftGlaze AI token (`sgai_...`). Many apps can
connect to that address directly with an `Authorization` header; the SoftGlaze AI page shows the
setup for each. Use this package when your app only runs local commands, or when you install
SoftGlaze from an MCP registry.

Every change an AI app asks for still waits for your approval in SoftGlaze, and **Stop all AI** in the
app cuts every AI app off at once.

## Before you start

1. SoftGlaze Browser: SoftGlaze AI page, switch on **AI server**, note the port (8080 by default).
2. Tokens tab, **Create token**. Copy the `sgai_` token; it is shown once.
3. Node.js 18 or newer.

## Configure your AI app

The token goes in `SOFTGLAZE_TOKEN`. Set `SOFTGLAZE_PORT` only if the port is not 8080.

**Claude Desktop** (`claude_desktop_config.json`; or install `softglaze-browser.mcpb` instead):

```json
{
  "mcpServers": {
    "softglaze": {
      "command": "npx",
      "args": ["-y", "softglaze-browser-mcp@1.0.0"],
      "env": { "SOFTGLAZE_TOKEN": "<YOUR_TOKEN>" }
    }
  }
}
```

**Cursor** (`~/.cursor/mcp.json`): the same `mcpServers` entry.

**VS Code** (`.vscode/mcp.json`; VS Code asks for the token once and stores it securely):

```json
{
  "inputs": [
    { "type": "promptString", "id": "softglaze-token", "description": "SoftGlaze AI token", "password": true }
  ],
  "servers": {
    "softglaze": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "softglaze-browser-mcp@1.0.0"],
      "env": { "SOFTGLAZE_TOKEN": "${input:softglaze-token}" }
    }
  }
}
```

**Gemini CLI** (`~/.gemini/settings.json`) and **Antigravity** (`~/.gemini/config/mcp_config.json`):
the same `mcpServers` entry as Claude Desktop.

**Claude Code**: use the SoftGlaze plugin (`/plugin marketplace add softglazee/softglaze-claude-plugin`),
or connect over HTTP without this package:
`claude mcp add --transport http softglaze http://127.0.0.1:8080/mcp --header "Authorization: Bearer <YOUR_TOKEN>"`.

### Keeping the token out of config files

Instead of `SOFTGLAZE_TOKEN`, save `%USERPROFILE%\.softglaze\mcp-connection.json` (or the file named in
`SOFTGLAZE_CONNECTION_FILE`):

```json
{ "url": "http://127.0.0.1:8080/mcp", "token": "sgai_your_token" }
```

Order used: `SOFTGLAZE_MCP_URL`, then `SOFTGLAZE_PORT`, then the file's `url`, then
`http://127.0.0.1:8080/mcp`; `SOFTGLAZE_TOKEN`, then the file's `token`.

## Check the connection

```
npx -y softglaze-browser-mcp@1.0.0 --check
```

prints the address it uses, where the token came from (first characters only), and whether SoftGlaze
accepted it.

## What it does and does not do

- It relays MCP messages unchanged between your AI app (stdin/stdout) and SoftGlaze, using the official
  MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.32.2, the same version SoftGlaze Browser uses).
- It only connects to 127.0.0.1, localhost or [::1]; any other address is refused, so your token is
  never sent off your computer. It sends nothing to SoftGlaze's servers and writes nothing to disk.
- If SoftGlaze restarts, the next call opens a new session by itself.
- Tools, prompts and resources come from SoftGlaze: what your token's scope allows. SoftGlaze never
  gives AI apps cookies, 2FA codes, proxy passwords or saved-login passwords, and AI apps cannot
  delete anything.

## Develop

```
npm install
npm test                 # 11 tests: the SDK client over stdio against test/mock-softglaze.js, and the Glama build check
npm run registry:check   # server.json files against the registry schema and publish rules
```

Tests also run in GitHub Actions on Node 18, 20 and 22. Publishing steps: `PUBLISHING.md`.

**Glama build check.** Glama's automated checks run `glama/run.cjs`: it starts `glama/stand-in.cjs`, a stand-in
for SoftGlaze Browser's endpoint that answers with the app's real tool definitions (`glama/tools.json`,
exported from the app's tool registry) and refuses every tool call with "install SoftGlaze Browser", then
runs this helper against it. Real users never run these files, and they are not in the npm package.

The same bridge for Claude Code, with Claude plugins and skills: https://github.com/softglazee/softglaze-claude-plugin

## License

MIT. SoftGlaze Browser is licensed separately.
