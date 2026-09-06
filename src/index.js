#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { AgentHansaUpstream } from "./upstream.js";
import { startHttpServer } from "./http-server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const UPSTREAM_ENTRY = process.env.AGENTHANSA_ENTRY || resolve(HERE, "../node_modules/agent-hansa-mcp/index.js");

function runStdioDelegate() {
  const child = spawn(process.execPath, [UPSTREAM_ENTRY], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

async function runHttp() {
  const upstream = new AgentHansaUpstream({ entry: UPSTREAM_ENTRY });
  const httpServer = await startHttpServer(upstream);

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await new Promise((resolve) => httpServer.close(resolve));
    await upstream.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

const args = new Set(process.argv.slice(2));
if (args.has("--stdio") || args.has("stdio")) {
  runStdioDelegate();
} else {
  runHttp().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
