import { spawnSync } from 'node:child_process';
import { rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const runNative = process.env.IAT_CLI_REAL_WORKFLOW_TESTS === '1';
const cliMain = path.resolve('packages/cli/dist/main.js');
const created = 'tests/fixtures/generated/cli-lifecycle-created.inp';
const authored = 'tests/fixtures/generated/cli-lifecycle-authored.inp';
const saved = 'tests/fixtures/generated/cli-lifecycle-saved.inp';
const operationsPath = 'tests/fixtures/generated/cli-lifecycle-operations.json';
const imagePath = 'tests/fixtures/generated/m2-checker.png';

interface JsonEnvelope {
  ok: boolean;
  command: string;
  result?: unknown;
  error?: { code: string; message: string };
}

function runCli(args: string[], input?: string): JsonEnvelope {
  const result = spawnSync(process.execPath, [cliMain, '--json', ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    ...(input === undefined ? {} : { input }),
  });

  expect(result.status, result.stderr || result.stdout).toBe(0);
  expect(result.stderr).toBe('');
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]) as JsonEnvelope;
}

describe.skipIf(!runNative)('real CLI puppet lifecycle', () => {
  it('authors, evaluates, validates, saves, and reopens a real visual parameter puppet', async () => {
    for (const artifact of [created, authored, saved, operationsPath]) {
      await rm(artifact, { force: true });
    }

    const create = runCli([
      'puppet',
      'create',
      '--output',
      created,
      '--name',
      'CLI Lifecycle Fixture',
    ]);
    expect(create.ok).toBe(true);
    expect(create.command).toBe('puppet create');
    expect((await stat(created)).size).toBeGreaterThan(0);

    for (const action of ['open', 'inspect', 'validate']) {
      const envelope = runCli(['puppet', action, '--input', created]);
      expect(envelope.ok).toBe(true);
      expect(envelope.command).toBe(`puppet ${action}`);
      expect(envelope.result).toMatchObject({
        metadata: { name: 'CLI Lifecycle Fixture' },
        nodes: expect.any(Array),
        parameters: expect.any(Array),
        textures: expect.any(Array),
      });
    }

    const operations = [
      { type: 'texture.import', key: 'face', imagePath },
      { type: 'node.create', parentPath: '/Root', name: 'Art' },
      { type: 'part.create', parentPath: '/Root/Art', name: 'Face', textureKey: 'face' },
      { type: 'node.create', parentPath: '/Root', name: 'Rig' },
      {
        type: 'parameter.create',
        name: 'Move X',
        dimensions: 1,
        min: [-1, 0],
        max: [1, 0],
        defaultValue: [0, 0],
      },
      {
        type: 'parameter.create',
        name: 'Move Y',
        dimensions: 1,
        min: [-1, 0],
        max: [1, 0],
        defaultValue: [0, 0],
      },
      {
        type: 'parameter.bind',
        parameterName: 'Move X',
        targetPath: '/Root/Rig',
        property: 'transform.t.x',
        keypoints: [
          { at: [-1, 0], value: -20 },
          { at: [1, 0], value: 20 },
        ],
      },
      {
        type: 'parameter.bind',
        parameterName: 'Move Y',
        targetPath: '/Root/Rig',
        property: 'transform.t.y',
        keypoints: [
          { at: [-1, 0], value: -12 },
          { at: [1, 0], value: 12 },
        ],
      },
    ];
    await writeFile(operationsPath, JSON.stringify(operations), 'utf8');

    const edit = runCli([
      'puppet',
      'edit',
      '--input',
      created,
      '--output',
      authored,
      '--operations',
      operationsPath,
    ]);
    expect(edit.ok).toBe(true);
    expect(edit.command).toBe('puppet edit');
    expect((await stat(authored)).size).toBeGreaterThan(0);

    const inspect = runCli(['puppet', 'inspect', '--input', authored]);
    expect(inspect.result).toMatchObject({
      metadata: { name: 'CLI Lifecycle Fixture' },
      summary: { partCount: 1, parameterCount: 2, textureCount: 1 },
    });
    const inspection = inspect.result as {
      nodes: Array<{ path: string; kind: string; textures: unknown[] }>;
      parameters: Array<{
        name: string;
        bindings: Array<{ targetPath: string; property: string }>;
      }>;
    };
    expect(inspection.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/Root/Art/Face', kind: 'part' }),
        expect.objectContaining({ path: '/Root/Rig' }),
      ]),
    );
    expect(inspection.nodes.find((node) => node.path === '/Root/Art/Face')?.textures).toHaveLength(1);
    expect(inspection.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Move X',
          bindings: expect.arrayContaining([
            expect.objectContaining({ targetPath: '/Root/Rig', property: 'transform.t.x' }),
          ]),
        }),
        expect.objectContaining({
          name: 'Move Y',
          bindings: expect.arrayContaining([
            expect.objectContaining({ targetPath: '/Root/Rig', property: 'transform.t.y' }),
          ]),
        }),
      ]),
    );

    const evaluate = runCli(
      ['parameter', 'evaluate', '--input', authored, '--values', '-'],
      JSON.stringify({ 'Move X': [1, 0], 'Move Y': [-1, 0] }),
    );
    expect(evaluate.ok).toBe(true);
    expect(evaluate.command).toBe('parameter evaluate');
    expect(evaluate.result).toMatchObject({
      targets: expect.arrayContaining([
        {
          parameterName: 'Move X',
          targetPath: '/Root/Rig',
          property: 'transform.t.x',
          appliedValue: 20,
          restoredValue: 0,
        },
        {
          parameterName: 'Move Y',
          targetPath: '/Root/Rig',
          property: 'transform.t.y',
          appliedValue: -12,
          restoredValue: 0,
        },
      ]),
      restoredParameters: expect.arrayContaining([
        { name: 'Move X', value: [0, 0] },
        { name: 'Move Y', value: [0, 0] },
      ]),
    });

    const validate = runCli(['puppet', 'validate', '--input', authored]);
    expect(validate.ok).toBe(true);

    const save = runCli([
      'puppet',
      'save',
      '--input',
      authored,
      '--output',
      saved,
    ]);
    expect(save.ok).toBe(true);
    expect(save.command).toBe('puppet save');
    expect((await stat(saved)).size).toBeGreaterThan(0);

    const reopened = runCli(['puppet', 'inspect', '--input', saved]);
    expect(reopened.result).toMatchObject({
      metadata: { name: 'CLI Lifecycle Fixture' },
      summary: { partCount: 1, parameterCount: 2, textureCount: 1 },
    });
  });
});
