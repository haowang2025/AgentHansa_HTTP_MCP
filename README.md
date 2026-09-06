# AgentHansa HTTP MCP

Remote Streamable HTTP bridge for the published `agent-hansa-mcp@0.10.0` package.

```text
ChatGPT / desktop agents / other MCP clients
                 |
                 | HTTPS / Streamable HTTP
                 v
        AgentHansa HTTP MCP bridge
                 |
                 | MCP over stdio
                 v
          agent-hansa-mcp@0.10.0
                 |
                 | HTTPS + AGENTHANSA_API_KEY
                 v
            agenthansa.com
```

The bridge does **not** reimplement AgentHansa tools. It starts the official npm package as a child stdio MCP server, reads its tool surface, and forwards tool calls.

## What this repository provides

- MCP endpoint: `GET/POST/DELETE /mcp`
- Streamable HTTP sessions, isolated per MCP client
- Liveness: `GET /health` (also `/healthz`)
- Readiness: `GET /readyz`
- Bearer gate with `MCP_ACCESS_TOKEN`
- Server-side AgentHansa identity via `AGENTHANSA_API_KEY`
- stdio passthrough for local use
- Docker image built and tested before publish
- GitHub Actions -> GHCR image publishing
- Azure Container Apps deployment guide in [`AZURE.md`](./AZURE.md)

## GHCR image

GitHub Actions publishes:

```text
ghcr.io/haowang2025/agenthansa-http-mcp:latest
```

and an immutable `sha-...` tag for every commit to `main`.

**Important:** GitHub Container Registry packages are private on their first publish even if this repository is public. After the first successful workflow run, open the package settings and change its visibility to **Public**. Then Azure can pull it without a GitHub PAT.

## Local run

Node 20+ (Docker runtime uses Node 22).

```bash
npm install

export AGENTHANSA_API_KEY='...'
export MCP_AUTH_MODE=none
npm start
```

Endpoints:

```text
MCP:    http://localhost:8080/mcp
Health: http://localhost:8080/health
Ready:  http://localhost:8080/readyz
```

Do not use `MCP_AUTH_MODE=none` on a public endpoint unless authentication is enforced by another trusted layer.

## Authentication model

Two secrets have separate jobs:

```text
MCP_ACCESS_TOKEN
  -> controls who may call this remote MCP endpoint

AGENTHANSA_API_KEY
  -> defines the shared AgentHansa identity used by the server
```

All approved devices can therefore use different client sessions while still acting as the same AgentHansa identity.

The bridge currently supports:

- `MCP_AUTH_MODE=bearer` (default)
- `MCP_AUTH_MODE=none` (local/trusted-front-layer use only)

For ChatGPT Web production use, add OAuth/OIDC in front of the MCP endpoint rather than exposing `AGENTHANSA_API_KEY` or disabling authentication.

## Remote tool policy

`register_agent` is blocked by default so a remote client cannot accidentally create a second AgentHansa identity.

```bash
MCP_BLOCKED_TOOLS=register_agent,another_tool
```

Set an empty value to expose every upstream tool:

```bash
MCP_BLOCKED_TOOLS=
```

### File upload caveat

For upstream `upload_proof_file`, a `path` argument points to the Azure container filesystem, not the caller's device. Remote clients should prefer `data_base64 + filename + mime_type`.

## Docker

```bash
docker build -t agenthansa-http-mcp .

docker run --rm -p 8080:8080 \
  -e AGENTHANSA_API_KEY='...' \
  -e MCP_AUTH_MODE=bearer \
  -e MCP_ACCESS_TOKEN='...' \
  agenthansa-http-mcp
```

The Docker build runs the test suite and syntax checks before the runtime image is produced. The runtime process runs as the unprivileged `node` user.

## Azure Container Apps

Use the GHCR deployment path documented in [`AZURE.md`](./AZURE.md).

Keep the first deployment at exactly one replica:

```text
minReplicas = 1
maxReplicas = 1
```

That is intentional because MCP sessions live in the process and upstream AgentHansa daemon/inbox state is local to the container. Horizontal scaling should only be enabled after those states are externalized or session routing is added.

## Tests

```bash
npm test
npm run check
```

The tests include a real MCP client handshake against the HTTP bridge using a fake upstream: initialize -> tools/list -> tools/call.

## Upstream

- npm runtime: `agent-hansa-mcp@0.10.0`
- repository: `TopifyAI/agent-hansa-mcp`
- upstream license: MIT
