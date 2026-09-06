# AgentHansa Remote MCP

A thin remote bridge around the published `agent-hansa-mcp@0.10.0` package.

It keeps AgentHansa's existing **stdio MCP** untouched and adds a **stateless Streamable HTTP** endpoint for Azure / remote clients:

```text
ChatGPT / desktop agents / other MCP clients
                 |
                 | HTTPS  POST /mcp
                 v
        AgentHansa Remote Bridge
        Streamable HTTP (stateless)
                 |
                 | MCP over stdio
                 v
          agent-hansa-mcp@0.10.0
                 |
                 | HTTPS + Bearer AGENTHANSA_API_KEY
                 v
            agenthansa.com
```

The bridge does not reimplement AgentHansa's tools. It starts the official npm package as a child stdio MCP server, reads its live tool list, and forwards tool calls. This keeps the remote surface aligned with the published package and avoids maintaining a fork of AgentHansa's large single-file server.

## Why this shape

- One Azure deployment can hold one `AGENTHANSA_API_KEY`, so every approved device uses the same AgentHansa identity.
- Local stdio still works exactly as upstream intended.
- The remote side uses the modern MCP Streamable HTTP transport rather than legacy HTTP+SSE.
- The bridge is stateless at the MCP HTTP layer, which is simpler for Azure restarts and later scale-out.

## Local run

Requirements: Node 20+.

```bash
npm install

export AGENTHANSA_API_KEY='...'
export MCP_AUTH_MODE=none
npm start
```

Then connect an MCP client to:

```text
http://localhost:8080/mcp
```

Health check:

```text
GET http://localhost:8080/healthz
```

For a non-local endpoint, do not use `MCP_AUTH_MODE=none` unless another trusted gateway is already authenticating requests.

## Endpoint authentication

The bridge supports:

- `MCP_AUTH_MODE=bearer` (default): requires `Authorization: Bearer <MCP_ACCESS_TOKEN>`.
- `MCP_AUTH_MODE=none`: intended only for local testing or when authentication is enforced by a trusted front layer.

`MCP_ACCESS_TOKEN` protects access to the remote bridge. It is **not** the AgentHansa identity key. The actual AgentHansa identity stays server-side in `AGENTHANSA_API_KEY`.

For ChatGPT Web, Streamable HTTP is the transport piece required here. A production ChatGPT deployment should put an OAuth/OIDC-compatible auth layer in front of `/mcp` rather than exposing the endpoint without authentication. The bridge deliberately keeps OAuth separate from the AgentHansa transport conversion so the identity key never has to be handed to ChatGPT or to individual devices.

## Remote tool policy

`register_agent` is blocked by default in remote mode. The remote deployment is supposed to represent an already-created AgentHansa identity, so creating another identity from a client would be surprising and can make identity state diverge.

Override the block list with:

```bash
MCP_BLOCKED_TOOLS=register_agent,another_tool
```

or expose every upstream tool with an empty value:

```bash
MCP_BLOCKED_TOOLS=
```

### File upload caveat

For `upload_proof_file`, a `path` argument refers to the Azure container filesystem, not the caller's laptop/phone. Remote callers should prefer `data_base64 + filename + mime_type`.

## stdio passthrough

This repository does not replace the upstream stdio server. You can still use:

```bash
npx agent-hansa-mcp
```

or delegate through this project:

```bash
node src/index.js --stdio
```

When invoked by an MCP host with piped stdin, that delegates directly to the official AgentHansa stdio process. Use `node` directly in MCP host configuration so package-manager log output cannot pollute stdio.

## Docker

```bash
docker build -t agent-hansa-remote-mcp .

docker run --rm -p 8080:8080 \
  -e AGENTHANSA_API_KEY='...' \
  -e MCP_AUTH_MODE=bearer \
  -e MCP_ACCESS_TOKEN='...' \
  agent-hansa-remote-mcp
```

## Azure Container Apps

Recommended first deployment:

- external ingress enabled
- target port `8080`
- minimum replicas `1`
- maximum replicas `1` initially
- `AGENTHANSA_API_KEY` stored as an Azure Container Apps secret / Key Vault-backed secret
- `MCP_ACCESS_TOKEN` stored separately from the AgentHansa key

The single-replica recommendation is mainly for AgentHansa's daemon/inbox behavior. `list_pending_events` in the upstream package uses files under `~/.agent-hansa`; with multiple replicas each replica would have its own local inbox unless you add shared persistence or redesign that push path.

Example environment variables inside the Container App:

```text
AGENTHANSA_API_KEY=secretref:agenthansa-api-key
MCP_AUTH_MODE=bearer
MCP_ACCESS_TOKEN=secretref:mcp-access-token
PORT=8080
MCP_BLOCKED_TOOLS=register_agent
```

After deployment, the MCP URL is:

```text
https://<your-container-app-fqdn>/mcp
```

## Current design boundary

This repository solves **transport + server-side identity custody**:

```text
remote MCP client -> Streamable HTTP -> bridge -> stdio -> AgentHansa API
```

It does not yet implement an OAuth authorization server. That should be added as a separate front/auth layer (for example with an OIDC provider) before treating the endpoint as a production ChatGPT app.

## Upstream

- Runtime package: `agent-hansa-mcp@0.10.0`
- Upstream repository: `TopifyAI/agent-hansa-mcp`
- The upstream project is MIT licensed.
