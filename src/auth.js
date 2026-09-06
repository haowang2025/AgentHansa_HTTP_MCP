import { timingSafeEqual } from "node:crypto";

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function getAuthConfig(env = process.env) {
  const mode = (env.MCP_AUTH_MODE || "bearer").toLowerCase();
  if (!new Set(["bearer", "none"]).has(mode)) {
    throw new Error(`Unsupported MCP_AUTH_MODE=${mode}. Use bearer or none.`);
  }

  const token = env.MCP_ACCESS_TOKEN || "";
  if (mode === "bearer" && !token) {
    throw new Error("MCP_AUTH_MODE=bearer requires MCP_ACCESS_TOKEN");
  }
  return { mode, token };
}

export function isAuthorized(req, config) {
  if (config.mode === "none") return true;
  const raw = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return Boolean(match && safeEqual(match[1], config.token));
}
