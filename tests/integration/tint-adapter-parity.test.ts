import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createAuthoringClient } from '@inochi-agent-tools/sdk';
import { afterEach, describe, expect, it } from 'vitest';

const enabled = process.env.IAT_TINT_BINDING_TESTS === '1';
const describeTint = enabled ? describe : describe.skip;
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
  const spawned = spawnSync(process.execPath, [cliMain, '--json', ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  });
  const lines = spawned.stdout.trim().split('\n').filter(Boolean);
  expect(lines).toHaveLength(1);
  return {
    status: spawned.status,
    envelope: JSON.parse(lines[0]) as Envelope,
    stderr: spawned.stderr,
  };
}

function tintProjection(inspection: any) {
  const parameter = inspection.parameters.find((item: any) => item.name === 'Face Tint R');
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

describeTint('semantic tint adapter parity', () => {
  it('authors, reopens, and visibly evaluates a real Part tint binding through SDK, CLI, and MCP', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'iat-tint-parity-'));
    temporaryDirectories.push(directory);
    const imagePath = path.resolve('tests/fixtures/generated/m2-checker.png');
    const operations = [
      { type: 'texture.import', key: 'face', imagePath },
      { type: 'part.create', parentPath: '/Root', name: 'Face', textureKey: 'face' },
      {
        type: 'parameter.create',
        name: 'Face Tint R',
        dimensions: 1,
        min: [-1, 0],
        max: [1, 0],
        defaultValue: [0, 0],
      },
      {
        type: 'parameter.bind',
        parameterName: 'Face Tint R',
        targetPath: '/Root/Face',
        property: 'tint.r',
        keypoints: [
          { at: [-1, 0], value: 0.15 },
          { at: [1, 0], value: 1 },
        ],
      },
    ];

    const sdk = createAuthoringClient();
    const sdkSource = path.join(directory, 'sdk-source.inp');
    const sdkOutput = path.join(directory, 'sdk-output.inp');
    await sdk.createPuppet({ outputPath: sdkSource, name: 'Tint SDK' });
    const sdkEdited = await sdk.editPuppet({
      inputPath: sdkSource,
      outputPath: sdkOutput,
      operations: operations as never,
    });
    const reopened = await sdk.inspectPuppet({ inputPath: sdkOutput });
    expect(tintProjection(reopened)).toEqual(tintProjection(sdkEdited.inspection));

    const cliSource = path.join(directory, 'cli-source.inp');
    const cliOutput = path.join(directory, 'cli-output.inp');
    const cliOperations = path.join(directory, 'cli-operations.json');
    await writeFile(cliOperations, JSON.stringify(operations), 'utf8');
    expect(runCli(['puppet', 'create', '--output', cliSource, '--name', 'Tint CLI']).status).toBe(0);
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
    const mcp = new Client({ name: 'inochi-agent-tools-tint-parity', version: '0.1.0' });
    try {
      await mcp.connect(transport);
      expect(structuredResult(await mcp.callTool({
        name: 'puppet.create',
        arguments: { outputPath: mcpSource, name: 'Tint MCP' },
      })).ok).toBe(true);
      const edited = structuredResult(await mcp.callTool({
        name: 'puppet.edit',
        arguments: { inputPath: mcpSource, outputPath: mcpOutput, operations },
      }));
      expect(edited.ok, JSON.stringify(edited.error)).toBe(true);

      expect(tintProjection(cliEdit.envelope.result?.inspection)).toEqual(tintProjection(sdkEdited.inspection));
      expect(tintProjection(edited.result?.inspection)).toEqual(tintProjection(sdkEdited.inspection));
    } finally {
      await mcp.close();
    }

    const lowPath = path.join(directory, 'tint-low.png');
    const highPath = path.join(directory, 'tint-high.png');
    const low = await sdk.renderPreview({
      inputPath: sdkOutput,
      outputPath: lowPath,
      width: 256,
      height: 256,
      parameters: { 'Face Tint R': [-1, 0] },
    });
    const high = await sdk.renderPreview({
      inputPath: sdkOutput,
      outputPath: highPath,
      width: 256,
      height: 256,
      parameters: { 'Face Tint R': [1, 0] },
    });
    expect(low.hasRenderableContent).toBe(true);
    expect(high.hasRenderableContent).toBe(true);
    expect(low.coveredPixelSamples ?? 0).toBeGreaterThan(0);
    expect(high.coveredPixelSamples ?? 0).toBeGreaterThan(0);
    const [lowBytes, highBytes] = await Promise.all([readFile(lowPath), readFile(highPath)]);
    expect(createHash('sha256').update(lowBytes).digest('hex'))
      .not.toBe(createHash('sha256').update(highBytes).digest('hex'));
  });
});
