import { spawnSync } from 'node:child_process';
import { rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const runNative = process.env.IAT_CLI_REAL_WORKFLOW_TESTS === '1';
const cliMain = path.resolve('packages/cli/dist/main.js');
const created = 'tests/fixtures/generated/cli-lifecycle-created.inp';
const saved = 'tests/fixtures/generated/cli-lifecycle-saved.inp';

interface JsonEnvelope {
  ok: boolean;
  command: string;
  result?: unknown;
  error?: { code: string; message: string };
}

function runCli(args: string[]): JsonEnvelope {
  const result = spawnSync(process.execPath, [cliMain, '--json', ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  });

  expect(result.status, result.stderr || result.stdout).toBe(0);
  expect(result.stderr).toBe('');
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]) as JsonEnvelope;
}

describe.skipIf(!runNative)('real CLI puppet lifecycle', () => {
  it('creates, opens, inspects, validates, saves, and reopens real .inp artifacts', async () => {
    await rm(created, { force: true });
    await rm(saved, { force: true });

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

    const save = runCli([
      'puppet',
      'save',
      '--input',
      created,
      '--output',
      saved,
    ]);
    expect(save.ok).toBe(true);
    expect(save.command).toBe('puppet save');
    expect((await stat(saved)).size).toBeGreaterThan(0);

    const reopened = runCli(['puppet', 'inspect', '--input', saved]);
    expect(reopened.result).toMatchObject({
      metadata: { name: 'CLI Lifecycle Fixture' },
    });
  });
});
