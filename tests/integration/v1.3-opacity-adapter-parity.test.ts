import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createAuthoringClient } from '@inochi-agent-tools/sdk';
import { afterEach, describe, expect, it } from 'vitest';

const enabled = process.env.IAT_V13_VISUAL_CONTROL_TESTS === '1';
const describeVisualControls = enabled ? describe : describe.skip;
const temporaryDirectories: string[] = [];

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

function opacityProjection(inspection: any) {
  const parameter = inspection.parameters.find((item: any) => item.name === 'Visibility');
  return {
    parameter: parameter && {
      name: parameter.name,
      min: parameter.min,
      max: parameter.max,
      defaultValue: parameter.defaultValue,
      bindings: parameter.bindings,
    },
    part: inspection.nodes.find((node: any) => node.path === '/Root/Face'),
  };
}

describeVisualControls('v1.3 opacity adapter parity', () => {
  it('authors the same real opacity parameter binding through SDK, CLI, and MCP', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'iat-v13-opacity-parity-'));
    temporaryDirectories.push(directory);
    const imagePath = path.resolve('tests/fixtures/generated/m2-checker.png');
    const operations = [
      { type: 'texture.import', key: 'face', imagePath },
      {
        type: 'part.create',
        parentPath: '/Root',
        name: 'Face',
        textureKey: 'face',
      },
      {
        type: 'parameter.create',
        name: 'Visibility',
        dimensions: 1,
        min: [-1, 0],
        max: [1, 0],
        defaultValue: [0, 0],
      },
      {
        type: 'parameter.bind',
        parameterName: 'Visibility',
        targetPath: '/Root/Face',
        property: 'opacity',
        keypoints: [
          { at: [-1, 0], value: 0.25 },
          { at: [1, 0], value: 1 },
        ],
      },
    ];

    const sdk = createAuthoringClient();
    const sdkSource = path.join(directory, 'sdk-source.inp');
    const sdkOutput = path.join(directory, 'sdk-output.inp');
    await sdk.createPuppet({ outputPath: sdkSource, name: 'v1.3 SDK Opacity' });
    const sdkEdited = await sdk.editPuppet({
      inputPath: sdkSource,
      outputPath: sdkOutput,
      operations: operations as never,
    });

    const cliSource = path.join(directory, 'cli-source.inp');
    const cliOutput = path.join(directory, 'cli-output.inp');
    const cliOperations = path.join(directory, 'cli-operations.json');
    await writeFile(cliOperations, JSON.stringify(operations), 'utf8');
    expect(runCli(['puppet', 'create', '--output', cliSource, '--name', 'v1.3 CLI Opacity']).status).toBe(0);
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
    const mcp = new Client({ name: 'inochi-agent-tools-v1.3-opacity-parity', version: '0.1.0' });
    try {
      await mcp.connect(transport);
      const created = structuredResult(await mcp.callTool({
        name: 'puppet.create',
        arguments: { outputPath: mcpSource, name: 'v1.3 MCP Opacity' },
      }));
      expect(created.ok).toBe(true);
      const edited = structuredResult(await mcp.callTool({
        name: 'puppet.edit',
        arguments: { inputPath: mcpSource, outputPath: mcpOutput, operations },
      }));
      expect(edited.ok, JSON.stringify(edited.error)).toBe(true);

      expect(opacityProjection(cliEdit.envelope.result?.inspection)).toEqual(
        opacityProjection(sdkEdited.inspection),
      );
      expect(opacityProjection(edited.result?.inspection)).toEqual(
        opacityProjection(sdkEdited.inspection),
      );
    } finally {
      await mcp.close();
    }
  });

  it('returns INVALID_BINDING for opacity on a non-Part target across SDK, CLI, and MCP', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'iat-v13-opacity-invalid-'));
    temporaryDirectories.push(directory);
    const operations = [
      { type: 'node.create', parentPath: '/Root', name: 'Rig' },
      {
        type: 'parameter.create',
        name: 'Visibility',
        dimensions: 1,
        min: [-1, 0],
        max: [1, 0],
        defaultValue: [0, 0],
      },
      {
        type: 'parameter.bind',
        parameterName: 'Visibility',
        targetPath: '/Root/Rig',
        property: 'opacity',
        keypoints: [
          { at: [-1, 0], value: 0.25 },
          { at: [1, 0], value: 1 },
        ],
      },
    ];

    const sdk = createAuthoringClient();
    const source = path.join(directory, 'source.inp');
    await sdk.createPuppet({ outputPath: source, name: 'v1.3 Invalid Opacity' });
    await expect(sdk.editPuppet({
      inputPath: source,
      outputPath: path.join(directory, 'sdk-output.inp'),
      operations: operations as never,
    })).rejects.toMatchObject({ code: 'INVALID_BINDING' });

    const cliOperations = path.join(directory, 'invalid-operations.json');
    await writeFile(cliOperations, JSON.stringify(operations), 'utf8');
    const cli = runCli([
      'puppet', 'edit',
      '--input', source,
      '--output', path.join(directory, 'cli-output.inp'),
      '--operations', cliOperations,
    ]);
    expect(cli.status).toBe(16);
    expect(cli.stderr).toBe('');
    expect(cli.envelope).toMatchObject({
      ok: false,
      error: { code: 'INVALID_BINDING' },
    });

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('packages/mcp/dist/main.js')],
      env: process.env,
      stderr: 'pipe',
    });
    const mcp = new Client({ name: 'inochi-agent-tools-v1.3-opacity-invalid', version: '0.1.0' });
    try {
      await mcp.connect(transport);
      const result = structuredResult(await mcp.callTool({
        name: 'puppet.edit',
        arguments: {
          inputPath: source,
          outputPath: path.join(directory, 'mcp-output.inp'),
          operations,
        },
      }));
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'INVALID_BINDING' },
      });
    } finally {
      await mcp.close();
    }
  });
});
