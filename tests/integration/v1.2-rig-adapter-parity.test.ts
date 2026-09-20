import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createAuthoringClient } from '@inochi-agent-tools/sdk';
import { afterEach, describe, expect, it } from 'vitest';

const enabled = process.env.IAT_V12_RIG_TESTS === '1';
const describeRig = enabled ? describe : describe.skip;
const temporaryDirectories: string[] = [];

const topology = {
  vertices: [[-20, -18], [20, -18], [20, 18], [-20, 18]],
  uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
  indices: [0, 1, 2, 0, 2, 3],
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

interface Envelope {
  ok: boolean;
  result?: any;
  error?: { code: string; message: string };
}

function structuredResult(result: Awaited<ReturnType<Client['callTool']>>): Envelope {
  if ('structuredContent' in result && result.structuredContent !== undefined) {
    return result.structuredContent as Envelope;
  }
  const text = result.content.find((item) => item.type === 'text');
  if (text?.type === 'text') return JSON.parse(text.text) as Envelope;
  throw new Error('MCP tool result did not include structured content');
}

function runCli(args: string[]): { status: number | null; envelope: Envelope; stderr: string } {
  const cliMain = path.resolve('packages/cli/dist/main.js');
  const result = spawnSync(process.execPath, [cliMain, '--json', ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  });
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  expect(lines).toHaveLength(1);
  return {
    status: result.status,
    envelope: JSON.parse(lines[0]) as Envelope,
    stderr: result.stderr,
  };
}

function rigProjection(inspection: any) {
  return inspection.nodes
    .filter((node: any) => node.path.includes('/Warp'))
    .map((node: any) => ({
      path: node.path,
      kind: node.kind,
      childCount: node.childCount,
      mesh: node.mesh,
    }));
}

describeRig('v1.2 rig adapter parity', () => {
  it('authors the same semantic mesh-deformer relationship through SDK, CLI, and MCP', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'iat-v12-rig-parity-'));
    temporaryDirectories.push(directory);
    const imagePath = path.resolve('tests/fixtures/generated/m2-checker.png');
    const operations = [
      {
        type: 'deformer.create',
        kind: 'mesh',
        parentPath: '/Root',
        name: 'Warp',
        mesh: topology,
      },
      { type: 'texture.import', key: 'face', imagePath },
      {
        type: 'part.create',
        parentPath: '/Root/Warp',
        name: 'Face',
        textureKey: 'face',
      },
    ];

    const sdk = createAuthoringClient();
    const sdkSource = path.join(directory, 'sdk-source.inp');
    const sdkOutput = path.join(directory, 'sdk-output.inp');
    await sdk.createPuppet({ outputPath: sdkSource, name: 'v1.2 SDK Rig' });
    const sdkEdited = await sdk.editPuppet({
      inputPath: sdkSource,
      outputPath: sdkOutput,
      operations: operations as never,
    });

    const cliSource = path.join(directory, 'cli-source.inp');
    const cliOutput = path.join(directory, 'cli-output.inp');
    const cliOperations = path.join(directory, 'cli-operations.json');
    await writeFile(cliOperations, JSON.stringify(operations), 'utf8');
    const cliCreate = runCli(['puppet', 'create', '--output', cliSource, '--name', 'v1.2 CLI Rig']);
    expect(cliCreate.status).toBe(0);
    expect(cliCreate.stderr).toBe('');
    const cliEdit = runCli([
      'puppet', 'edit',
      '--input', cliSource,
      '--output', cliOutput,
      '--operations', cliOperations,
    ]);
    expect(cliEdit.status, JSON.stringify(cliEdit.envelope.error)).toBe(0);
    expect(cliEdit.stderr).toBe('');

    const mcpSource = path.join(directory, 'mcp-source.inp');
    const mcpOutput = path.join(directory, 'mcp-output.inp');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('packages/mcp/dist/main.js')],
      env: process.env,
      stderr: 'pipe',
    });
    const mcp = new Client({ name: 'inochi-agent-tools-v1.2-rig-parity', version: '0.1.0' });
    try {
      await mcp.connect(transport);
      const created = structuredResult(await mcp.callTool({
        name: 'puppet.create',
        arguments: { outputPath: mcpSource, name: 'v1.2 MCP Rig' },
      }));
      expect(created.ok).toBe(true);
      const edited = structuredResult(await mcp.callTool({
        name: 'puppet.edit',
        arguments: { inputPath: mcpSource, outputPath: mcpOutput, operations },
      }));
      expect(edited.ok, JSON.stringify(edited.error)).toBe(true);

      expect(rigProjection(cliEdit.envelope.result?.inspection)).toEqual(
        rigProjection(sdkEdited.inspection),
      );
      expect(rigProjection(edited.result?.inspection)).toEqual(
        rigProjection(sdkEdited.inspection),
      );
    } finally {
      await mcp.close();
    }
  });

  it('returns the same stable unsupported-capability code through SDK, CLI, and MCP', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'iat-v12-rig-unsupported-'));
    temporaryDirectories.push(directory);
    const sdk = createAuthoringClient();
    const source = path.join(directory, 'source.inp');
    await sdk.createPuppet({ outputPath: source, name: 'v1.2 Unsupported Rig' });

    await expect(sdk.editPuppet({
      inputPath: source,
      outputPath: path.join(directory, 'sdk-bone.inp'),
      operations: [{ type: 'bone.create' } as never],
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_AUTHORING_CAPABILITY' });

    const cliOperations = path.join(directory, 'bone-operations.json');
    await writeFile(cliOperations, JSON.stringify([{ type: 'bone.create' }]), 'utf8');
    const cli = runCli([
      'puppet', 'edit',
      '--input', source,
      '--output', path.join(directory, 'cli-bone.inp'),
      '--operations', cliOperations,
    ]);
    expect(cli.status).toBe(19);
    expect(cli.stderr).toBe('');
    expect(cli.envelope).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_AUTHORING_CAPABILITY' },
    });

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('packages/mcp/dist/main.js')],
      env: process.env,
      stderr: 'pipe',
    });
    const mcp = new Client({ name: 'inochi-agent-tools-v1.2-rig-unsupported', version: '0.1.0' });
    try {
      await mcp.connect(transport);
      const result = structuredResult(await mcp.callTool({
        name: 'puppet.edit',
        arguments: {
          inputPath: source,
          outputPath: path.join(directory, 'mcp-bone.inp'),
          operations: [{ type: 'bone.create' }],
        },
      }));
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'UNSUPPORTED_AUTHORING_CAPABILITY' },
      });
    } finally {
      await mcp.close();
    }
  });
});
