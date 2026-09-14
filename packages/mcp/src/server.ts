import { fromJsonSchema, McpServer } from '@modelcontextprotocol/server';
import { createAuthoringClient, type AuthoringClient } from '@inochi-agent-tools/sdk';

import { createMcpToolRegistry } from './tools.js';

export function createMcpServer(client: AuthoringClient = createAuthoringClient()): McpServer {
  const server = new McpServer({
    name: 'inochi-agent-tools',
    version: '0.1.0',
  });

  for (const semanticTool of createMcpToolRegistry(client)) {
    server.registerTool(
      semanticTool.name,
      {
        description: semanticTool.description,
        inputSchema: fromJsonSchema(semanticTool.inputSchema),
      },
      async (arguments_) => {
        const result = await semanticTool.call(arguments_);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          structuredContent: result,
          ...(result.ok ? {} : { isError: true }),
        };
      },
    );
  }

  return server;
}
