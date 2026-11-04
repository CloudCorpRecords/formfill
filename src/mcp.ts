/**
 * formfill MCP server. Tool: basestation.create_autofill_job.
 *
 * Why the low-level Server instead of McpServer: the
 * high-level helper converts zod schemas to JSON Schema and
 * injects keys that are not in this tool's documented spec
 * ("$schema" and "additionalProperties"), which breaks exact
 * tool-list/schema parity with the spec. This file serves
 * tools/list with the spec's exact input schema as an
 * explicit literal, and validates every tools/call itself:
 * malformed arguments throw McpError InvalidParams, while
 * upstream and guard failures come back as isError results
 * carrying the core's error strings.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { callTool, TOOL_DEFS, TOOL_NAMES, validateArgs, VERSION } from "./formfill.js";

const server = new Server(
  { name: "formfill", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (!TOOL_NAMES.includes(name)) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
  const validationError = validateArgs((args ?? {}) as Record<string, unknown>);
  if (validationError !== null) {
    throw new McpError(ErrorCode.InvalidParams, validationError);
  }
  const result = await callTool(name, (args ?? {}) as Record<string, unknown>);
  return {
    content: result.content as Array<{ type: "text"; text: string }>,
    ...(result.isError ? { isError: true as const } : {}),
  };
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
