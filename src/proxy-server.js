import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const DEFAULT_BLOCKED = new Set(["register_agent"]);

function blockedTools() {
  const configured = process.env.MCP_BLOCKED_TOOLS;
  if (configured === "") return new Set();
  if (!configured) return DEFAULT_BLOCKED;
  return new Set(configured.split(",").map((x) => x.trim()).filter(Boolean));
}

function adaptToolForRemote(tool) {
  if (tool.name !== "upload_proof_file") return tool;
  return {
    ...tool,
    description:
      `${tool.description || "Upload proof."} Remote deployment note: ` +
      "`path` is a path inside the Azure container, not on the caller device; " +
      "prefer data_base64 + filename + mime_type for remote clients.",
  };
}

export async function createProxyMcpServer(upstream) {
  const server = new Server(
    { name: "agent-hansa-remote-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const blocked = blockedTools();
    const tools = (await upstream.listTools())
      .filter((tool) => !blocked.has(tool.name))
      .map(adaptToolForRemote);
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (blockedTools().has(name)) {
      return {
        content: [{ type: "text", text: `Tool blocked by remote policy: ${name}` }],
        isError: true,
      };
    }

    try {
      return await upstream.callTool(name, args || {});
    } catch (error) {
      return {
        content: [{ type: "text", text: `AgentHansa upstream error: ${error.message}` }],
        isError: true,
      };
    }
  });

  return server;
}
