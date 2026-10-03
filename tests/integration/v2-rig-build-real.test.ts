import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { runCli, type CliIo } from '../../packages/cli/src/run.js';
import { createMcpToolRegistry } from '../../packages/mcp/src/tools.js';
import { createAuthoringClient } from '../../packages/sdk/src/index.js';
import { RIG_PROJECT_SCHEMA_VERSION } from '../../packages/core/src/index.js';

const enabled = process.env.IAT_V2_RIG_BUILD_TESTS === '1';
const root = path.resolve('tests/fixtures/generated/v2-build');
const projectDir = path.join(root, 'project');

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function rgbaPng(width: number, height: number, color: [number, number, number], inside: (x: number, y: number) => boolean): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      const alpha = inside(x, y) ? 255 : 0;
      row[offset] = color[0];
      row[offset + 1] = color[1];
      row[offset + 2] = color[2];
      row[offset + 3] = alpha;
    }
    rows.push(row);
  }
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

function manifest() {
  return {
    schemaVersion: RIG_PROJECT_SCHEMA_VERSION,
    name: 'v2 One Command Build',
    layers: [
      { id: 'body', source: 'body.png', role: 'body' },
      { id: 'head', source: 'head.png', role: 'head', parentId: 'body' },
    ],
    motions: [
      { id: 'headX', kind: 'transform' as const, axis: 'x' as const, min: -8, max: 8, default: 0, targets: ['head'] },
    ],
  };
}

async function prepareProject(): Promise<void> {
  await rm(root, { recursive: true, force: true });
  await mkdir(projectDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(projectDir, 'body.png'), rgbaPng(96, 128, [180, 110, 80], (x, y) => x >= 18 && x < 78 && y >= 12 && y < 120)),
    writeFile(path.join(projectDir, 'head.png'), rgbaPng(80, 80, [220, 170, 120], (x, y) => {
      const dx = x - 40;
      const dy = y - 40;
      return dx * dx + dy * dy <= 30 * 30;
    })),
  ]);
}

async function assertArtifacts(result: {
  status: string;
  buildFingerprint: string;
  manifestFingerprint: string;
  planFingerprint: string;
  artifacts: { puppet: string; qaReport: string; provenance: string; previewDir: string };
  qa: { pass: boolean; summary: { sampleCount: number } };
}): Promise<void> {
  expect(result.status).toBe('green');
  expect(result.qa.pass).toBe(true);
  expect(result.qa.summary.sampleCount).toBeGreaterThan(1);
  expect(result.buildFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(result.manifestFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(result.planFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect((await readFile(result.artifacts.puppet)).length).toBeGreaterThan(100);
  expect(JSON.parse(await readFile(result.artifacts.qaReport, 'utf8')).pass).toBe(true);
  const provenance = JSON.parse(await readFile(result.artifacts.provenance, 'utf8')) as { buildFingerprint: string };
  expect(provenance.buildFingerprint).toBe(result.buildFingerprint);
}

describe.skipIf(!enabled)('v2 one-command rig build acceptance', () => {
  it('builds the same semantic project equivalently through SDK, CLI, and MCP', async () => {
    await prepareProject();
    const project = manifest();
    const sdkClient = createAuthoringClient();

    const sdk = await sdkClient.buildRigProject({
      manifest: project,
      projectDir,
      outputDir: path.join(root, 'sdk'),
      outputName: 'character',
    });
    await assertArtifacts(sdk);

    const stdout: string[] = [];
    const stderr: string[] = [];
    const io: CliIo = {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      stdin: async () => JSON.stringify(project),
    };
    const cliExit = await runCli([
      '--json',
      'rig-project',
      'build',
      '--input',
      '-',
      '--project-dir',
      projectDir,
      '--output-dir',
      path.join(root, 'cli'),
      '--name',
      'character',
    ], io);
    expect(cliExit).toBe(0);
    expect(stderr).toEqual([]);
    const cliEnvelope = JSON.parse(stdout[0]!) as { result: typeof sdk };
    const cli = cliEnvelope.result;
    await assertArtifacts(cli);

    const registry = createMcpToolRegistry(sdkClient);
    const buildTool = registry.find((candidate) => candidate.name === 'rig.project.build');
    expect(buildTool).toBeDefined();
    const mcpEnvelope = await buildTool!.call({
      manifest: project,
      projectDir,
      outputDir: path.join(root, 'mcp'),
      outputName: 'character',
    });
    expect(mcpEnvelope.ok).toBe(true);
    if (!mcpEnvelope.ok) throw new Error(mcpEnvelope.error.message);
    const mcp = mcpEnvelope.result as typeof sdk;
    await assertArtifacts(mcp);

    expect(cli.manifestFingerprint).toBe(sdk.manifestFingerprint);
    expect(mcp.manifestFingerprint).toBe(sdk.manifestFingerprint);
    expect(cli.planFingerprint).toBe(sdk.planFingerprint);
    expect(mcp.planFingerprint).toBe(sdk.planFingerprint);
    expect(cli.buildFingerprint).toBe(sdk.buildFingerprint);
    expect(mcp.buildFingerprint).toBe(sdk.buildFingerprint);
    expect(cli.qa.fingerprint).toBe(sdk.qa.fingerprint);
    expect(mcp.qa.fingerprint).toBe(sdk.qa.fingerprint);
  });
});
