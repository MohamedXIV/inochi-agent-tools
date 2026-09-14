import { describe, expect, it } from 'vitest';
import {
  InvalidAuthoringRequestError,
  InvalidBindingError,
  InvalidHierarchyError,
  InvalidPuppetError,
  InvalidTextureAssetError,
  MissingTextureError,
  NativeBridgeError,
  PuppetAlreadyExistsError,
  RoundTripMismatchError,
} from '@inochi-agent-tools/core';

import { classifyCliError } from '../src/errors.js';
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

describe('stable CLI contract', () => {
  it('returns CLI_USAGE for an unknown command in human mode without a stack trace', async () => {
    const capture = captureIo();

    const exitCode = await runCli(['unknown'], capture.io);

    expect(exitCode).toBe(2);
    expect(capture.stdout).toEqual([]);
    expect(capture.stderr).toHaveLength(1);
    expect(capture.stderr[0]).toContain('CLI_USAGE');
    expect(capture.stderr[0]).not.toContain('\n    at ');
  });

  it('returns CLI_USAGE when a required command option is missing', async () => {
    const capture = captureIo();

    const exitCode = await runCli(['puppet', 'create', '--name', 'Missing output'], capture.io);

    expect(exitCode).toBe(2);
    expect(capture.stdout).toEqual([]);
    expect(capture.stderr).toHaveLength(1);
    expect(capture.stderr[0]).toContain('CLI_USAGE');
  });

  it('emits exactly one stable JSON failure envelope on stdout in JSON mode', async () => {
    const capture = captureIo();

    const exitCode = await runCli(['--json', 'unknown'], capture.io);

    expect(exitCode).toBe(2);
    expect(capture.stderr).toEqual([]);
    expect(capture.stdout).toHaveLength(1);
    expect(JSON.parse(capture.stdout[0])).toEqual({
      ok: false,
      command: null,
      error: {
        code: 'CLI_USAGE',
        message: expect.any(String),
      },
    });
  });

  it.each([
    [new InvalidAuthoringRequestError('bad request'), 10, 'INVALID_AUTHORING_REQUEST'],
    [new InvalidPuppetError('bad puppet'), 11, 'INVALID_PUPPET'],
    [new PuppetAlreadyExistsError('exists'), 12, 'PUPPET_ALREADY_EXISTS'],
    [new InvalidHierarchyError('hierarchy'), 13, 'INVALID_HIERARCHY'],
    [new MissingTextureError('texture missing'), 14, 'MISSING_TEXTURE'],
    [new InvalidTextureAssetError('texture invalid'), 15, 'INVALID_TEXTURE_ASSET'],
    [new InvalidBindingError('binding'), 16, 'INVALID_BINDING'],
    [new RoundTripMismatchError('round trip'), 17, 'ROUND_TRIP_MISMATCH'],
    [new NativeBridgeError('native'), 20, 'NATIVE_BRIDGE_FAILURE'],
  ])('maps semantic error %s to stable exit/code contract', (error, exitCode, code) => {
    expect(classifyCliError(error)).toEqual({
      exitCode,
      code,
      message: error.message,
    });
  });

  it('maps an unknown thrown value to UNEXPECTED_FAILURE without exposing a stack', () => {
    expect(classifyCliError(new Error('boom'))).toEqual({
      exitCode: 1,
      code: 'UNEXPECTED_FAILURE',
      message: 'boom',
    });
  });
});
