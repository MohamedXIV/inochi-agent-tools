import { beforeEach, describe, expect, it, vi } from 'vitest';

const coreMocks = vi.hoisted(() => ({
  createPuppet: vi.fn(),
  inspectPuppet: vi.fn(),
  savePuppet: vi.fn(),
  validatePuppet: vi.fn(),
}));

vi.mock('@inochi-agent-tools/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@inochi-agent-tools/core')>()),
  createPuppet: coreMocks.createPuppet,
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

describe('CLI semantic command dispatch', () => {
  beforeEach(() => {
    coreMocks.createPuppet.mockReset();
    coreMocks.inspectPuppet.mockReset();
    coreMocks.savePuppet.mockReset();
    coreMocks.validatePuppet.mockReset();
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
});
