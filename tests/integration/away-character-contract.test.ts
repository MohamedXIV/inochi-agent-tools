import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createAuthoringClient } from '@inochi-agent-tools/sdk';
import { describe, expect, it } from 'vitest';

import {
  AWAY_PREVIEW_MATRIX,
  compileAwayCharacterOperations,
  resolveAwayCharacterState,
} from '../../spikes/away-character/contract.js';

const enabled = process.env.IAT_AWAY_CHARACTER_SPIKE_TESTS === '1';
const describeSpike = enabled ? describe : describe.skip;
const generated = path.resolve('tests/fixtures/generated');
const canonicalSource = path.join(generated, 'away-character-source.inp');
const canonicalPuppet = path.join(generated, 'away-character-spike.inp');

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
  throw new Error('MCP result did not include structured content');
}

function runCli(args: string[]): Envelope {
  const result = spawnSync(
    process.execPath,
    [path.resolve('packages/cli/dist/main.js'), '--json', ...args],
    { cwd: process.cwd(), env: process.env, encoding: 'utf8' },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe('');
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]!) as Envelope;
}

function semanticProjection(inspection: any) {
  return {
    nodes: [...inspection.nodes]
      .map((node: any) => ({ path: node.path, kind: node.kind }))
      .sort((a: any, b: any) => a.path.localeCompare(b.path)),
    parameters: [...inspection.parameters]
      .map((parameter: any) => ({
        name: parameter.name,
        min: parameter.min,
        max: parameter.max,
        defaultValue: parameter.defaultValue,
        bindings: [...parameter.bindings]
          .map((binding: any) => ({
            targetPath: binding.targetPath,
            property: binding.property,
            keypoints: binding.keypoints.map((keypoint: any) => ({
              parameterValue: keypoint.parameterValue,
              value: keypoint.value,
            })),
          }))
          .sort((a: any, b: any) =>
            `${a.targetPath}:${a.property}`.localeCompare(`${b.targetPath}:${b.property}`)),
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name)),
  };
}

describeSpike('Away downstream character contract integration spike', () => {
  it('maps semantic Away state onto generic authoring primitives across SDK, CLI, and MCP', async () => {
    await mkdir(generated, { recursive: true });
    const imagePath = path.resolve('tests/fixtures/generated/m2-checker.png');
    const operations = compileAwayCharacterOperations(imagePath);

    for (const file of [
      canonicalSource,
      canonicalPuppet,
      ...AWAY_PREVIEW_MATRIX.map((entry) => path.join(generated, `away-character-${entry.id}.png`)),
    ]) {
      await rm(file, { force: true });
    }

    const sdk = createAuthoringClient();
    await sdk.createPuppet({ outputPath: canonicalSource, name: 'Away Character Spike' });
    const sdkEdited = await sdk.editPuppet({
      inputPath: canonicalSource,
      outputPath: canonicalPuppet,
      operations,
    });
    const reopened = await sdk.inspectPuppet({ inputPath: canonicalPuppet });
    expect(semanticProjection(reopened)).toEqual(semanticProjection(sdkEdited.inspection));

    const expectedNodes = [
      '/Root/Body',
      '/Root/Face',
      '/Root/Mouth',
      '/Root/HairFront',
      '/Root/HairAlt',
      '/Root/Top',
      '/Root/Jacket',
    ];
    for (const nodePath of expectedNodes) {
      expect(reopened.nodes.some((node) => node.path === nodePath)).toBe(true);
    }

    const expectedParameters = [
      'Head X',
      'Head Y',
      'Body Mass',
      'Face Roundness',
      'Hair Style',
      'Top Style',
      'Smile',
      'Hair Tint R',
      'Hair Tint G',
      'Hair Tint B',
    ];
    for (const name of expectedParameters) {
      expect(reopened.parameters.some((parameter) => parameter.name === name)).toBe(true);
    }

    const scratch = path.join(generated, 'away-character-adapter-scratch');
    await rm(scratch, { recursive: true, force: true });
    await mkdir(scratch, { recursive: true });

    const operationsPath = path.join(scratch, 'operations.json');
    await writeFile(operationsPath, JSON.stringify(operations), 'utf8');

    const cliSource = path.join(scratch, 'cli-source.inp');
    const cliOutput = path.join(scratch, 'cli-output.inp');
    expect(runCli(['puppet', 'create', '--output', cliSource, '--name', 'Away CLI']).ok).toBe(true);
    const cliEdited = runCli([
      'puppet', 'edit',
      '--input', cliSource,
      '--output', cliOutput,
      '--operations', operationsPath,
    ]);
    expect(cliEdited.ok, JSON.stringify(cliEdited.error)).toBe(true);

    const mcpSource = path.join(scratch, 'mcp-source.inp');
    const mcpOutput = path.join(scratch, 'mcp-output.inp');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('packages/mcp/dist/main.js')],
      env: process.env,
      stderr: 'pipe',
    });
    const mcp = new Client({ name: 'away-character-spike', version: '0.1.0' });
    try {
      await mcp.connect(transport);
      const created = structuredResult(await mcp.callTool({
        name: 'puppet.create',
        arguments: { outputPath: mcpSource, name: 'Away MCP' },
      }));
      expect(created.ok).toBe(true);
      const edited = structuredResult(await mcp.callTool({
        name: 'puppet.edit',
        arguments: { inputPath: mcpSource, outputPath: mcpOutput, operations },
      }));
      expect(edited.ok, JSON.stringify(edited.error)).toBe(true);

      expect(semanticProjection(cliEdited.result?.inspection))
        .toEqual(semanticProjection(sdkEdited.inspection));
      expect(semanticProjection(edited.result?.inspection))
        .toEqual(semanticProjection(sdkEdited.inspection));
    } finally {
      await mcp.close();
    }

    expect(() => resolveAwayCharacterState({
      morphs: { 'face.roundness': 0 },
      slots: { 'hair.front': 'long', 'clothing.top': 'jacket' },
      tints: { hair: '#70452c' },
      expression: 'neutral',
    })).toThrow(/incompatible slot combination/);

    const digests = new Set<string>();
    for (const entry of AWAY_PREVIEW_MATRIX) {
      const outputPath = path.join(generated, `away-character-${entry.id}.png`);
      const preview = await sdk.renderPreview({
        inputPath: canonicalPuppet,
        outputPath,
        width: 256,
        height: 256,
        parameters: resolveAwayCharacterState(entry.state),
      });
      expect(preview.hasRenderableContent).toBe(true);
      expect(preview.coveredPixelSamples ?? 0).toBeGreaterThan(0);
      digests.add(createHash('sha256').update(await readFile(outputPath)).digest('hex'));
    }
    expect(digests.size).toBe(AWAY_PREVIEW_MATRIX.length);

    await rm(scratch, { recursive: true, force: true });
  });
});
