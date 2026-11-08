# Publishing softglaze-browser-mcp and the MCP Registry entries

Nothing here has been published. Checked on 9 Nov 2026:

- `npm view softglaze-browser-mcp` answers 404 (name free; also free: `softglaze-proxy-bridge`,
  `@softglaze/browser-mcp`; the npm scope `softglaze` does not exist, so this package is unscoped).
- `server.json` and `registry/proxy-bridge/server.npm.json` pass the registry schema
  (`npm run registry:check`, schema 2025-12-11 vendored in `registry/schema/`) and
  `mcp-publisher validate` (v1.8.8, which checks against registry.modelcontextprotocol.io).

## Decision first: the registry name

`server.json` uses **`com.softglaze/browser`**, and `package.json` carries the same value in `mcpName`
(the registry checks that they match on the published npm package). A `com.softglaze/...` name needs
proof that you control softglaze.com (a DNS TXT record). If you prefer GitHub login instead, change
both to `io.github.softglazee/softglaze-browser` **before** `npm publish`, because `mcpName` is fixed
inside each published npm version.

## 1. GitHub

```
gh repo create softglazee/softglaze-mcp-helper --public --source . --remote origin --push
```

## 2. npm

```
npm login
npm whoami
npm test
npm pack --dry-run        # expect: bin/, lib/, README.md, LICENSE, package.json only
npm publish --access public
npm view softglaze-browser-mcp version mcpName   # 1.0.0  com.softglaze/browser
```

## 3. Install mcp-publisher (Windows PowerShell, from the registry quickstart)

```
$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -eq "Arm64") { "arm64" } else { "amd64" }; Invoke-WebRequest -Uri "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_windows_$arch.tar.gz" -OutFile "mcp-publisher.tar.gz"; tar xf mcp-publisher.tar.gz mcp-publisher.exe; rm mcp-publisher.tar.gz
```

Move `mcp-publisher.exe` to a folder on your PATH (or run it as `.\mcp-publisher.exe`).

## 4. Log in to the registry

**For `com.softglaze/...` (DNS)**, in Git Bash (OpenSSL 3 is installed on this PC). Keep `key.pem`
outside every repository:

```
mkdir -p ~/.mcp-registry && cd ~/.mcp-registry
openssl genpkey -algorithm Ed25519 -out key.pem
PUBLIC_KEY="$(openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)"
echo "softglaze.com. IN TXT \"v=MCPv1; k=ed25519; p=${PUBLIC_KEY}\""
```

Add that TXT record on the **apex** `softglaze.com` (Hostinger DNS, host `@`), wait for it to show in
`nslookup -type=TXT softglaze.com`, then:

```
PRIVATE_KEY="$(openssl pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"
mcp-publisher login dns --domain softglaze.com --private-key "${PRIVATE_KEY}"
```

DNS login covers `com.softglaze/*` and its subdomains. (HTTP login is the alternative: serve
`v=MCPv1; k=ed25519; p=<PUBLIC_KEY>` at `https://softglaze.com/.well-known/mcp-registry-auth`, then
`mcp-publisher login http --domain softglaze.com --private-key "${PRIVATE_KEY}"`.)

**Or for `io.github.softglazee/...`:** `mcp-publisher login github` and follow the device code at
github.com/login/device.

## 5. Publish to the MCP Registry

```
mcp-publisher validate server.json
mcp-publisher publish server.json
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=com.softglaze/browser"
```

Each version is permanent: for a change, raise `version` in `package.json` and `server.json`, publish
to npm, then `mcp-publisher publish` again. To withdraw a version:
`mcp-publisher status --status deprecated com.softglaze/browser 1.0.0`.

## 6. After the registry

- **VS Code / GitHub Copilot**: VS Code opens a registry entry with
  `vscode:mcp/by-name/com.softglaze/browser`. The GitHub MCP Registry (github.com/mcp) is a curated
  list; GitHub's latest note (Oct 2025) says to email partnerships@github.com after publishing to the
  official registry to ask for inclusion.
- **Cursor**: an "Add to Cursor" link is
  `cursor://anysphere.cursor-deeplink/mcp/install?name=softglaze&config=<base64 of the JSON config>`, where
  the config is `{"command":"npx","args":["-y","softglaze-browser-mcp@1.0.0"],"env":{"SOFTGLAZE_TOKEN":""}}`.
  Cursor now points MCP authors to its plugin Marketplace (cursor.com/marketplace/publish, reviewed
  by Cursor) and community servers to cursor.directory.

## SoftGlaze Proxy Bridge (owner decision needed)

`registry/proxy-bridge/server.npm.json` is a validated draft for `com.softglaze/proxy-bridge` as the
npm package `softglaze-proxy-bridge`. The registry only lists servers that are an npm, PyPI, NuGet,
cargo, OCI or MCPB package, or a public https remote. The bridge is a download only today (decision of
8 Nov) and its package.json is `private` and `UNLICENSED`, so a registry entry needs one of:

- publish the bridge to npm (add `"mcpName": "com.softglaze/proxy-bridge"`, drop `private`, choose a
  license), then publish this draft; or
- publish an `.mcpb` of the bridge as a GitHub release asset in a public repository and list it with
  `"registryType": "mcpb"`, the release URL as `identifier`, and `fileSha256` (the registry requires
  both, and the URL must be a GitHub or GitLab release download).

Both make the bridge's code public.
