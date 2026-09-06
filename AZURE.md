# Azure Container Apps deployment

This repository is designed for Azure Container Apps.

## 1. Build/deploy from the repository source

The fastest Azure CLI path is `az containerapp up`. For a first deployment, keep ingress internal while secrets are being configured.

```bash
az extension add --name containerapp --upgrade
az login

RG='rg-agent-hansa'
APP='agent-hansa-mcp'
ENV='agent-hansa-env'
LOCATION='eastus'

az group create --name "$RG" --location "$LOCATION"

az containerapp up \
  --name "$APP" \
  --resource-group "$RG" \
  --location "$LOCATION" \
  --environment "$ENV" \
  --source . \
  --ingress internal \
  --env-vars MCP_AUTH_MODE=none PORT=8080
```

`az containerapp up --source .` uses the Dockerfile in this repository, builds the image, pushes it to Azure Container Registry, and creates/updates the Container App.

## 2. Store the two secrets separately

Do not use the AgentHansa identity key itself as the public MCP access token.

```bash
read -s -p 'AgentHansa API key: ' AGENTHANSA_API_KEY
printf '\n'
read -s -p 'Remote MCP access token: ' MCP_ACCESS_TOKEN
printf '\n'

az containerapp secret set \
  --name "$APP" \
  --resource-group "$RG" \
  --secrets \
    agenthansa-api-key="$AGENTHANSA_API_KEY" \
    mcp-access-token="$MCP_ACCESS_TOKEN"

az containerapp update \
  --name "$APP" \
  --resource-group "$RG" \
  --set-env-vars \
    AGENTHANSA_API_KEY=secretref:agenthansa-api-key \
    MCP_ACCESS_TOKEN=secretref:mcp-access-token \
    MCP_AUTH_MODE=bearer \
    PORT=8080 \
    MCP_BLOCKED_TOOLS=register_agent
```

After this command succeeds, the service is no longer running in no-auth mode.

## 3. Expose HTTPS ingress

```bash
az containerapp ingress enable \
  --name "$APP" \
  --resource-group "$RG" \
  --type external \
  --target-port 8080 \
  --transport auto \
  --allow-insecure false
```

Get the FQDN:

```bash
FQDN=$(az containerapp show \
  --name "$APP" \
  --resource-group "$RG" \
  --query properties.configuration.ingress.fqdn \
  --output tsv)

echo "MCP:    https://$FQDN/mcp"
echo "Health: https://$FQDN/healthz"
```

## 4. Keep one replica initially

The HTTP MCP bridge is stateless, but upstream AgentHansa 0.10.0 also has daemon/inbox behavior that writes under `~/.agent-hansa` inside the container. Until that state is moved to shared persistence, keep one replica:

```bash
az containerapp update \
  --name "$APP" \
  --resource-group "$RG" \
  --min-replicas 1 \
  --max-replicas 1
```

## 5. Generic MCP client configuration

Clients that support an Authorization header should use:

```text
URL: https://<fqdn>/mcp
Authorization: Bearer <MCP_ACCESS_TOKEN>
```

All clients still act as the same AgentHansa identity because the container uses the single server-side `AGENTHANSA_API_KEY`.

## ChatGPT Web authentication note

The server transport itself is ready for remote ChatGPT/MCP use. The built-in bearer mode is useful for generic MCP clients, but a production ChatGPT custom app should use an OAuth/OIDC-compatible authorization layer rather than turning endpoint authentication off.

The next auth step can be implemented with an OIDC provider while leaving the AgentHansa bridge unchanged.
