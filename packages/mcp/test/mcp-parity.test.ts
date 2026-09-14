import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createAuthoringClient } from '@inochi-agent-tools/sdk';
import { afterEach, describe, expect, it } from 'vitest';

const enabled = process.env.IAT_MCP_PROTOCOL_TESTS === '1';
const describeProtocol = enabled ? describe : describe.skip;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function structuredResult(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  if ('structuredContent' in result && result.structuredContent !== undefined) {
    return result.structuredContent;
  }

  const text = result.content.find((item) => item.type === 'text');
  if (text?.type === 'text') return JSON.parse(text.text);
  throw new Error('MCP tool result did not include structured content');
}

describeProtocol('stdio MCP parity', () => {
  it('lists the v1 tools and matches SDK inspection on a real created .inp', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'iat-mcp-protocol-'));
    temporaryDirectories.push(directory);
    const puppetPath = path.join(directory, 'protocol.inp');
    const serverPath = path.resolve('packages/mcp/dist/main.js');

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: process.env,
      stderr: 'pipe',
    });
    const client = new Client({ name: 'inochi-agent-tools-protocol-test', version: '0.1.0' });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
        'parameter.evaluate',
        'puppet.create',
        'puppet.edit',
        'puppet.inspect',
        'puppet.open',
        'puppet.save',
        'puppet.validate',
      ]);

      const created = structuredResult(await client.callTool({
        name: 'puppet.create',
        arguments: { outputPath: puppetPath, name: 'Protocol Parity' },
      })) as { ok: boolean };
      expect(created.ok).toBe(true);

      const mcpInspection = structuredResult(await client.callTool({
        name: 'puppet.inspect',
        arguments: { inputPath: puppetPath },
      })) as { ok: boolean; result?: unknown };
      expect(mcpInspection.ok).toBe(true);

      const sdkInspection = await createAuthoringClient().inspectPuppet({ inputPath: puppetPath });
      expect(mcpInspection.result).toEqual(sdkInspection);
    } finally {
      await client.close();
    }
  });
});
