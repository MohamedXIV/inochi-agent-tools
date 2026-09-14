import { beforeEach, describe, expect, it, vi } from 'vitest';

const coreMocks = vi.hoisted(() => ({
  inspectPuppet: vi.fn(),
}));

vi.mock('@inochi-agent-tools/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@inochi-agent-tools/core')>()),
  inspectPuppet: coreMocks.inspectPuppet,
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
    coreMocks.inspectPuppet.mockReset();
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
});
