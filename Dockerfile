FROM node:22-alpine AS build

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY test ./test

RUN npm test && npm run check

FROM node:22-alpine AS runtime

LABEL org.opencontainers.image.source="https://github.com/haowang2025/AgentHansa_HTTP_MCP" \
      org.opencontainers.image.title="AgentHansa HTTP MCP" \
      org.opencontainers.image.description="Remote Streamable HTTP bridge for AgentHansa MCP"

WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    MCP_AUTH_MODE=bearer

EXPOSE 8080

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/index.js", "--http"]
