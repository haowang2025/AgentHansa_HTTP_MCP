# Azure Container Apps deployment from GHCR

This repository publishes its Docker image to GitHub Container Registry (GHCR), then Azure Container Apps pulls that image directly.

## 0. Publish the image first

The workflow `.github/workflows/publish-ghcr.yml` runs on every push to `main` and can also be started manually from GitHub Actions.

Published image:

```text
ghcr.io/haowang2025/agenthansa-http-mcp:latest
```

It also publishes an immutable `sha-...` tag for every commit.

### First GHCR publish only: make the package Public

GitHub Container Registry packages are private on first publish even when the source repository is public. After the first successful workflow run:

1. Open the repository on GitHub.
2. Open the linked package `agenthansa-http-mcp`.
3. Package settings -> Change visibility -> Public.

Once public, GHCR allows anonymous pulls and Azure can pull it without storing a GitHub PAT.

Quick check from any machine with Docker:

```bash
docker pull ghcr.io/haowang2025/agenthansa-http-mcp:latest
```

## 1. Create Azure resources

```bash
az extension add --name containerapp --upgrade
az login

RG='rg-agent-hansa'
APP='agent-hansa-mcp'
ENV='agent-hansa-env'
LOCATION='eastus'
IMAGE='ghcr.io/haowang2025/agenthansa-http-mcp:latest'

az group create \
  --name "$RG" \
  --location "$LOCATION"

az containerapp env create \
  --name "$ENV" \
  --resource-group "$RG" \
  --location "$LOCATION"
```

## 2. Create the Container App with both secrets

Keep the AgentHansa identity key and the remote MCP access token separate.

```bash
read -s -p 'AgentHansa API key: ' AGENTHANSA_API_KEY
printf '\n'
read -s -p 'Remote MCP access token: ' MCP_ACCESS_TOKEN
printf '\n'

az containerapp create \
  --name "$APP" \
  --resource-group "$RG" \
  --environment "$ENV" \
  --image "$IMAGE" \
  --ingress external \
  --target-port 8080 \
  --min-replicas 1 \
  --max-replicas 1 \
  --cpu 0.5 \
  --memory 1.0Gi \
  --secrets \
    agenthansa-api-key="$AGENTHANSA_API_KEY" \
    mcp-access-token="$MCP_ACCESS_TOKEN" \
  --env-vars \
    AGENTHANSA_API_KEY=secretref:agenthansa-api-key \
    MCP_ACCESS_TOKEN=secretref:mcp-access-token \
    MCP_AUTH_MODE=bearer \
    PORT=8080 \
    HOST=0.0.0.0 \
    MCP_BLOCKED_TOOLS=register_agent
```

Why one replica: the MCP endpoint now keeps a separate Streamable HTTP session for each client, and the upstream AgentHansa daemon/inbox also keeps local state under `~/.agent-hansa`. Do not scale beyond one replica until session/state routing is externalized.

## 3. Get the endpoint and test health

```bash
FQDN=$(az containerapp show \
  --name "$APP" \
  --resource-group "$RG" \
  --query properties.configuration.ingress.fqdn \
  --output tsv)

echo "MCP:    https://$FQDN/mcp"
echo "Health: https://$FQDN/health"
echo "Ready:  https://$FQDN/readyz"

curl -fsS "https://$FQDN/health"
curl -fsS "https://$FQDN/readyz"
```

`/health` reports process liveness and always returns 200 while the bridge is running. `/readyz` returns 200 only after the bridge can start the upstream AgentHansa MCP and load its tool list.

A healthy response should eventually show:

```json
{
  "ok": true,
  "service": "agent-hansa-remote-mcp",
  "upstream": "agent-hansa-mcp@0.10.0",
  "upstream_ready": true,
  "tool_count": 1,
  "active_sessions": 0,
  "auth_mode": "bearer"
}
```

The exact `tool_count` can change as AgentHansa changes its live MCP tool surface.

## 4. Generic MCP client configuration

Use:

```text
URL: https://<fqdn>/mcp
Authorization: Bearer <MCP_ACCESS_TOKEN>
```

Every authorized client still acts as the same AgentHansa identity because only the Azure container holds `AGENTHANSA_API_KEY`.

## 5. Deploy a new image revision

The GitHub workflow publishes both `latest` and an immutable `sha-...` image tag. For reproducible production deployments, prefer the SHA tag after validating it.

```bash
IMAGE='ghcr.io/haowang2025/agenthansa-http-mcp:sha-<commit-sha-prefix>'

az containerapp update \
  --name "$APP" \
  --resource-group "$RG" \
  --image "$IMAGE"
```

If you intentionally use `:latest`, force Azure to create a new revision by running the same `az containerapp update --image ...` command after the new image has been published.

## 6. Troubleshooting

### Image pull fails

First verify the GHCR package itself is Public. A public GitHub repository does not automatically make a newly published GHCR package public.

### 502 / ingress errors

Verify the target port is 8080:

```bash
az containerapp ingress show \
  --name "$APP" \
  --resource-group "$RG" \
  --query targetPort
```

### Container starts but AgentHansa is not ready

Check readiness and logs:

```bash
curl -i "https://$FQDN/readyz"

az containerapp logs show \
  --name "$APP" \
  --resource-group "$RG" \
  --follow
```

Common causes are a missing/invalid `AGENTHANSA_API_KEY` or temporary inability to reach AgentHansa.

## ChatGPT Web authentication note

This repository now provides the remote Streamable HTTP transport and a bearer-token gate for generic MCP clients. A production ChatGPT custom app should add an OAuth/OIDC-compatible authorization layer instead of disabling endpoint authentication or exposing `AGENTHANSA_API_KEY`.
