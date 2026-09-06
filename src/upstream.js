import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ENTRY = resolve(HERE, "../node_modules/agent-hansa-mcp/index.js");

function childEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => typeof value === "string")
  );
}

export class AgentHansaUpstream {
  constructor({ entry = process.env.AGENTHANSA_ENTRY || DEFAULT_ENTRY } = {}) {
    this.entry = entry;
    this.client = null;
    this.transport = null;
    this.tools = null;
    this.startPromise = null;
  }

  async start() {
    if (this.client && this.tools) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = (async () => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [this.entry],
        env: childEnv(),
      });
      const client = new Client(
        { name: "agent-hansa-remote-bridge", version: "0.1.0" },
        { capabilities: {} }
      );

      await client.connect(transport);
      const listed = await client.listTools();
      this.transport = transport;
      this.client = client;
      this.tools = listed.tools || [];
    })();

    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async listTools() {
    await this.start();
    return this.tools;
  }

  async callTool(name, args = {}) {
    await this.start();
    return this.client.callTool({ name, arguments: args });
  }

  async close() {
    const client = this.client;
    this.client = null;
    this.tools = null;
    if (client) {
      try { await client.close(); } catch {}
    }
  }
}
