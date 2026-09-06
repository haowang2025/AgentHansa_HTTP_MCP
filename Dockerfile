FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    MCP_AUTH_MODE=bearer

EXPOSE 8080

CMD ["node", "src/index.js", "--http"]
