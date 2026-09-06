import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttpServer } from "../src/http-server.js";

class FakeUpstream {
  async start() {}

  async listTools() {
    return [{
      name: "ping",
      description: "Use this when testing the bridge.",
      inputSchema: { type: "object", properties: {} },
    }];
  }

  async callTool(name) {
    if (name !== "ping") throw new Error("unknown tool");
    return { content: [{ type: "text", text: "pong" }] };
  }
}

test("Streamable HTTP completes initialize, tools/list, and tools/call", async () => {
  const previous = {
    auth: process.env.MCP_AUTH_MODE,
    port: process.env.PORT,
    host: process.env.HOST,
  };

  process.env.MCP_AUTH_MODE = "none";
  process.env.PORT = "0";
  process.env.HOST = "127.0.0.1";

  const httpServer = await startHttpServer(new FakeUpstream());
  const address = httpServer.address();
  assert.equal(typeof address, "object");
  const endpoint = new URL(`http://127.0.0.1:${address.port}/mcp`);

  const client = new Client(
    { name: "bridge-test-client", version: "1.0.0" },
    { capabilities: {} }
  );
  const transport = new StreamableHTTPClientTransport(endpoint);

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.equal(listed.tools.some((tool) => tool.name === "ping"), true);

    const called = await client.callTool({ name: "ping", arguments: {} });
    assert.equal(called.content[0].text, "pong");
  } finally {
    try { await client.close(); } catch {}
    await new Promise((resolve) => httpServer.close(resolve));
    if (previous.auth === undefined) delete process.env.MCP_AUTH_MODE;
    else process.env.MCP_AUTH_MODE = previous.auth;
    if (previous.port === undefined) delete process.env.PORT;
    else process.env.PORT = previous.port;
    if (previous.host === undefined) delete process.env.HOST;
    else process.env.HOST = previous.host;
  }
});
