import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createProxyMcpServer } from "./proxy-server.js";
import { getAuthConfig, isAuthorized } from "./auth.js";

const MAX_BODY_BYTES = Number(process.env.MCP_MAX_BODY_BYTES || 4 * 1024 * 1024);

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

function unauthorized(res) {
  json(
    res,
    401,
    { error: "unauthorized" },
    { "www-authenticate": 'Bearer realm="agent-hansa-mcp"' }
  );
}

export async function startHttpServer(upstream) {
  const auth = getAuthConfig();
  await upstream.start();
  const tools = await upstream.listTools();

  if (auth.mode === "none") {
    console.warn("WARNING: MCP_AUTH_MODE=none exposes AgentHansa tools without endpoint authentication.");
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/healthz") {
      return json(res, 200, {
        ok: true,
        service: "agent-hansa-remote-mcp",
        upstream: "agent-hansa-mcp@0.10.0",
        tool_count: tools.length,
        auth_mode: auth.mode,
      });
    }

    if (url.pathname !== "/mcp") {
      return json(res, 404, { error: "not_found" });
    }

    if (!isAuthorized(req, auth)) return unauthorized(res);

    if (req.method !== "POST") {
      return json(
        res,
        405,
        {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Stateless Streamable HTTP mode accepts POST /mcp only.",
          },
          id: null,
        },
        { allow: "POST" }
      );
    }

    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      return json(res, error.statusCode || 400, {
        jsonrpc: "2.0",
        error: { code: -32700, message: error.message },
        id: null,
      });
    }

    let mcpServer;
    let transport;
    try {
      mcpServer = await createProxyMcpServer(upstream);
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: process.env.MCP_JSON_RESPONSE !== "0",
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      console.error("MCP HTTP request failed", error);
      if (!res.headersSent) {
        json(res, 500, {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal MCP bridge error" },
          id: null,
        });
      } else if (!res.writableEnded) {
        res.end();
      }
    } finally {
      if (mcpServer) {
        try { await mcpServer.close(); } catch {}
      }
    }
  });

  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || "0.0.0.0";
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  console.log(`AgentHansa remote MCP listening on http://${host}:${port}/mcp`);
  console.log(`Loaded ${tools.length} upstream tools; auth=${auth.mode}`);
  return server;
}
