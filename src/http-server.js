import http from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createProxyMcpServer } from "./proxy-server.js";
import { getAuthConfig, isAuthorized } from "./auth.js";

const MAX_BODY_BYTES = Number(process.env.MCP_MAX_BODY_BYTES || 4 * 1024 * 1024);
const SESSION_TTL_MS = Number(process.env.MCP_SESSION_TTL_MS || 6 * 60 * 60 * 1000);

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

function sessionIdFrom(req) {
  const value = req.headers["mcp-session-id"];
  return Array.isArray(value) ? value[0] : value;
}

export async function startHttpServer(upstream) {
  const auth = getAuthConfig();
  const sessions = new Map();

  let upstreamReady = false;
  let upstreamError = null;
  let toolCount = null;
  let warmupPromise = null;

  const warmUpstream = async () => {
    if (warmupPromise) return warmupPromise;
    warmupPromise = (async () => {
      try {
        const tools = await upstream.listTools();
        toolCount = tools.length;
        upstreamReady = true;
        upstreamError = null;
      } catch (error) {
        upstreamReady = false;
        upstreamError = error?.message || String(error);
        console.error("AgentHansa upstream warmup failed; will retry on demand:", upstreamError);
      }
    })();

    try {
      await warmupPromise;
    } finally {
      warmupPromise = null;
    }
  };

  const closeSession = async (entry) => {
    if (!entry || entry.closed) return;
    entry.closed = true;
    if (entry.sessionId) sessions.delete(entry.sessionId);
    try { await entry.transport.close(); } catch {}
    try { await entry.mcpServer.close(); } catch {}
  };

  const createSession = async () => {
    const mcpServer = await createProxyMcpServer(upstream);
    const entry = {
      sessionId: null,
      transport: null,
      mcpServer,
      lastSeenAt: Date.now(),
      closed: false,
    };

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: process.env.MCP_JSON_RESPONSE !== "0",
      onsessioninitialized: (sessionId) => {
        entry.sessionId = sessionId;
        entry.lastSeenAt = Date.now();
        sessions.set(sessionId, entry);
      },
    });

    entry.transport = transport;
    transport.onclose = () => {
      if (entry.sessionId) sessions.delete(entry.sessionId);
      if (!entry.closed) {
        entry.closed = true;
        void mcpServer.close().catch(() => {});
      }
    };

    await mcpServer.connect(transport);
    return entry;
  };

  if (auth.mode === "none") {
    console.warn("WARNING: MCP_AUTH_MODE=none exposes AgentHansa tools without endpoint authentication.");
  }

  // Do not block the HTTP listener on AgentHansa/network availability. Azure can
  // start the container, health-check it, and the bridge can retry upstream later.
  void warmUpstream();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/health" || url.pathname === "/healthz") {
      return json(res, 200, {
        ok: true,
        service: "agent-hansa-remote-mcp",
        upstream: "agent-hansa-mcp@0.10.0",
        upstream_ready: upstreamReady,
        tool_count: toolCount,
        active_sessions: sessions.size,
        auth_mode: auth.mode,
      });
    }

    if (url.pathname === "/readyz") {
      if (!upstreamReady) void warmUpstream();
      return json(res, upstreamReady ? 200 : 503, {
        ready: upstreamReady,
        upstream: "agent-hansa-mcp@0.10.0",
        tool_count: toolCount,
        error: upstreamReady ? null : upstreamError,
      });
    }

    if (url.pathname !== "/mcp") {
      return json(res, 404, { error: "not_found" });
    }

    if (!isAuthorized(req, auth)) return unauthorized(res);

    try {
      if (req.method === "POST") {
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

        const requestedSessionId = sessionIdFrom(req);
        let entry = requestedSessionId ? sessions.get(requestedSessionId) : null;
        let createdForInitialize = false;

        if (!entry) {
          if (requestedSessionId) {
            return json(res, 404, {
              jsonrpc: "2.0",
              error: { code: -32001, message: "Unknown or expired MCP session" },
              id: null,
            });
          }
          if (!isInitializeRequest(body)) {
            return json(res, 400, {
              jsonrpc: "2.0",
              error: { code: -32000, message: "MCP session required; initialize first" },
              id: null,
            });
          }
          entry = await createSession();
          createdForInitialize = true;
        }

        entry.lastSeenAt = Date.now();
        try {
          await entry.transport.handleRequest(req, res, body);
        } catch (error) {
          if (createdForInitialize && !entry.sessionId) await closeSession(entry);
          throw error;
        }
        return;
      }

      if (req.method === "GET" || req.method === "DELETE") {
        const requestedSessionId = sessionIdFrom(req);
        const entry = requestedSessionId ? sessions.get(requestedSessionId) : null;
        if (!entry) {
          return json(res, 404, {
            jsonrpc: "2.0",
            error: { code: -32001, message: "Unknown or expired MCP session" },
            id: null,
          });
        }
        entry.lastSeenAt = Date.now();
        await entry.transport.handleRequest(req, res);
        return;
      }

      return json(res, 405, {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed" },
        id: null,
      }, { allow: "GET, POST, DELETE" });
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
    }
  });

  const sweepInterval = Math.max(60_000, Math.min(30 * 60_000, Math.floor(SESSION_TTL_MS / 2)));
  const sweeper = setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const entry of sessions.values()) {
      if (entry.lastSeenAt < cutoff) void closeSession(entry);
    }
  }, sweepInterval);
  sweeper.unref();

  server.on("close", () => {
    clearInterval(sweeper);
    for (const entry of sessions.values()) void closeSession(entry);
  });

  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || "0.0.0.0";
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  console.log(`AgentHansa remote MCP listening on http://${host}:${actualPort}/mcp`);
  console.log(`MCP transport=sessionful-streamable-http; auth=${auth.mode}`);
  return server;
}
