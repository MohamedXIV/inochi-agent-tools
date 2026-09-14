import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const coreMocks = vi.hoisted(() => ({
  createPuppet: vi.fn(),
  editPuppet: vi.fn(),
  evaluateParameterValues: vi.fn(),
  inspectPuppet: vi.fn(),
  savePuppet: vi.fn(),
  validatePuppet: vi.fn(),
}));

vi.mock('@inochi-agent-tools/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@inochi-agent-tools/core')>()),
  createPuppet: coreMocks.createPuppet,
  editPuppet: coreMocks.editPuppet,
  evaluateParameterValues: coreMocks.evaluateParameterValues,
  inspectPuppet: coreMocks.inspectPuppet,
  savePuppet: coreMocks.savePuppet,
  validatePuppet: coreMocks.validatePuppet,
}));

import { runCli, type CliIo } from '../src/run.js';

function captureIo(): { io: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout(text) {
        stdout.push(text);
      },
      stderr(text) {
        stderr.push(text);
      },
    },
    stdout,
    stderr,
  };
}

const inspection = {
  schemaVersion: 1 as const,
  metadata: {
    name: 'CLI Dispatch Fixture',
    inochiVersion: 'v0.8.7',
    rigger: '',
    artist: '',
  },
  nodes: [
    {
      path: '/Root',
      name: 'Root',
      kind: 'node' as const,
      childCount: 0,
      textures: [],
    },
  ],
  parameters: [],
  textures: [],
  textureCount: 0,
  summary: {
    nodeCount: 1,
    partCount: 0,
    parameterCount: 0,
    textureCount: 0,
  },
};

const tempDirs: string[] = [];

async function writeJsonFixture(value: unknown): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'iat-cli-dispatch-'));
  tempDirs.push(directory);
  const fixturePath = path.join(directory, 'payload.json');
  await writeFile(fixturePath, JSON.stringify(value), 'utf8');
  return fixturePath;
}

describe('CLI semantic command dispatch', () => {
  beforeEach(() => {
    coreMocks.createPuppet.mockReset();
    coreMocks.editPuppet.mockReset();
    coreMocks.evaluateParameterValues.mockReset();
    coreMocks.inspectPuppet.mockReset();
    coreMocks.savePuppet.mockReset();
    coreMocks.validatePuppet.mockReset();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('dispatches puppet inspect to the semantic core and preserves its JSON result', async () => {
    coreMocks.inspectPuppet.mockResolvedValue(inspection);
    const capture = captureIo();

    const exitCode = await runCli(
      ['--json', 'puppet', 'inspect', '--input', 'fixture.inp'],
      capture.io,
    );

    expect(exitCode).toBe(0);
    expect(coreMocks.inspectPuppet).toHaveBeenCalledOnce();
    expect(coreMocks.inspectPuppet).toHaveBeenCalledWith('fixture.inp');
    expect(capture.stderr).toEqual([]);
    expect(capture.stdout).toHaveLength(1);
    expect(JSON.parse(capture.stdout[0])).toEqual({
      ok: true,
      command: 'puppet inspect',
      result: inspection,
    });
  });

  it('dispatches puppet create to the semantic core with semantic arguments', async () => {
    const created = { path: '/tmp/created.inp', inspection };
    coreMocks.createPuppet.mockResolvedValue(created);
    const capture = captureIo();

    const exitCode = await runCli(
      ['--json', 'puppet', 'create', '--output', 'created.inp', '--name', 'CLI Fixture'],
      capture.io,
    );

    expect(exitCode).toBe(0);
    expect(coreMocks.createPuppet).toHaveBeenCalledWith({
      outputPath: 'created.inp',
      name: 'CLI Fixture',
    });
    expect(JSON.parse(capture.stdout[0])).toEqual({
      ok: true,
      command: 'puppet create',
      result: created,
    });
  });

  it('dispatches puppet open to the same semantic inspection core path', async () => {
    coreMocks.inspectPuppet.mockResolvedValue(inspection);
    const capture = captureIo();

    const exitCode = await runCli(
      ['--json', 'puppet', 'open', '--input', 'fixture.inp'],
      capture.io,
    );

    expect(exitCode).toBe(0);
    expect(coreMocks.inspectPuppet).toHaveBeenCalledWith('fixture.inp');
    expect(JSON.parse(capture.stdout[0])).toEqual({
      ok: true,
      command: 'puppet open',
      result: inspection,
    });
  });

  it('dispatches puppet validate and preserves the semantic validation result', async () => {
    coreMocks.validatePuppet.mockResolvedValue(inspection);
    const capture = captureIo();

    const exitCode = await runCli(
      ['--json', 'puppet', 'validate', '--input', 'fixture.inp'],
      capture.io,
    );

    expect(exitCode).toBe(0);
    expect(coreMocks.validatePuppet).toHaveBeenCalledWith('fixture.inp');
    expect(JSON.parse(capture.stdout[0])).toEqual({
      ok: true,
      command: 'puppet validate',
      result: inspection,
    });
  });

  it('dispatches puppet save to the semantic save-as primitive', async () => {
    const saved = { path: '/tmp/saved.inp', inspection };
    coreMocks.savePuppet.mockResolvedValue(saved);
    const capture = captureIo();

    const exitCode = await runCli(
      ['--json', 'puppet', 'save', '--input', 'source.inp', '--output', 'saved.inp'],
      capture.io,
    );

    expect(exitCode).toBe(0);
    expect(coreMocks.savePuppet).toHaveBeenCalledWith({
      inputPath: 'source.inp',
      outputPath: 'saved.inp',
    });
    expect(JSON.parse(capture.stdout[0])).toEqual({
      ok: true,
      command: 'puppet save',
      result: saved,
    });
  });

  it('reads puppet edit operations from a JSON file and passes the array unchanged to the core', async () => {
    const operations = [
      { type: 'node.create', parentPath: '/Root', name: 'Rig' },
    ];
    const operationsPath = await writeJsonFixture(operations);
    const edited = { path: '/tmp/edited.inp', inspection };
    coreMocks.editPuppet.mockResolvedValue(edited);
    const capture = captureIo();

    const exitCode = await runCli(
      [
        '--json',
        'puppet',
        'edit',
        '--input',
        'source.inp',
        '--output',
        'edited.inp',
        '--operations',
        operationsPath,
      ],
      capture.io,
    );

    expect(exitCode).toBe(0);
    expect(coreMocks.editPuppet).toHaveBeenCalledWith({
      inputPath: 'source.inp',
      outputPath: 'edited.inp',
      operations,
    });
    expect(JSON.parse(capture.stdout[0])).toEqual({
      ok: true,
      command: 'puppet edit',
      result: edited,
    });
  });

  it('reads parameter values from stdin and passes the object unchanged to the core', async () => {
    const values = { 'Move X': [1, 0] };
    const evaluated = {
      appliedParameters: [{ name: 'Move X', value: [1, 0] }],
      targets: [],
      restoredParameters: [{ name: 'Move X', value: [0, 0] }],
    };
    coreMocks.evaluateParameterValues.mockResolvedValue(evaluated);
    const capture = captureIo();
    const io = {
      ...capture.io,
      stdin: async () => JSON.stringify(values),
    } as CliIo & { stdin(): Promise<string> };

    const exitCode = await runCli(
      ['--json', 'parameter', 'evaluate', '--input', 'fixture.inp', '--values', '-'],
      io,
    );

    expect(exitCode).toBe(0);
    expect(coreMocks.evaluateParameterValues).toHaveBeenCalledWith({
      inputPath: 'fixture.inp',
      values,
    });
    expect(JSON.parse(capture.stdout[0])).toEqual({
      ok: true,
      command: 'parameter evaluate',
      result: evaluated,
    });
  });

  it('returns CLI_USAGE for malformed JSON before calling the semantic core', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'iat-cli-dispatch-'));
    tempDirs.push(directory);
    const operationsPath = path.join(directory, 'malformed.json');
    await writeFile(operationsPath, '{not-json', 'utf8');
    const capture = captureIo();

    const exitCode = await runCli(
      [
        '--json',
        'puppet',
        'edit',
        '--input',
        'source.inp',
        '--output',
        'edited.inp',
        '--operations',
        operationsPath,
      ],
      capture.io,
    );

    expect(exitCode).toBe(2);
    expect(coreMocks.editPuppet).not.toHaveBeenCalled();
    expect(JSON.parse(capture.stdout[0])).toMatchObject({
      ok: false,
      command: 'puppet edit',
      error: { code: 'CLI_USAGE' },
    });
  });

  it('returns CLI_USAGE for a non-array edit payload before calling the semantic core', async () => {
    const operationsPath = await writeJsonFixture({ type: 'node.create' });
    const capture = captureIo();

    const exitCode = await runCli(
      [
        '--json',
        'puppet',
        'edit',
        '--input',
        'source.inp',
        '--output',
        'edited.inp',
        '--operations',
        operationsPath,
      ],
      capture.io,
    );

    expect(exitCode).toBe(2);
    expect(coreMocks.editPuppet).not.toHaveBeenCalled();
    expect(JSON.parse(capture.stdout[0])).toMatchObject({
      ok: false,
      command: 'puppet edit',
      error: { code: 'CLI_USAGE' },
    });
  });
});
