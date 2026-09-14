#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { createMcpServer } from './server.js';

const server = createMcpServer();
const transport = new StdioServerTransport();

await server.connect(transport);
