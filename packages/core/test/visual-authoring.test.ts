import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  InvalidAuthoringRequestError,
  InvalidHierarchyError,
  InvalidTextureAssetError,
  MissingTextureError,
  NativeBridgeError,
  editPuppet,
} from '../src/index.js';

const validOperation = { type: 'node.create' as const, parentPath: '/Root', name: 'Body' };
const validRequest = { inputPath: 'input.inp', outputPath: 'output.inp', operations: [validOperation] };
const runExecutableFixtureTests = process.platform !== 'win32';

describe('editPuppet semantic request validation', () => {
  it('rejects non-INP and identical paths before native work', async () => {
    await expect(editPuppet(
      { inputPath: 'input.txt', outputPath: 'output.inp', operations: [validOperation] },
      { hostPath: '/definitely/missing/iat_native_host' },
    )).rejects.toBeInstanceOf(InvalidAuthoringRequestError);

    await expect(editPuppet(
      { inputPath: 'same.inp', outputPath: 'same.inp', operations: [validOperation] },
      { hostPath: '/definitely/missing/iat_native_host' },
    )).rejects.toBeInstanceOf(InvalidAuthoringRequestError);
  });

  it('rejects empty operations and blank/NUL semantic fields before native work', async () => {
    await expect(editPuppet(
      { inputPath: 'input.inp', outputPath: 'output.inp', operations: [] },
      { hostPath: '/definitely/missing/iat_native_host' },
    )).rejects.toBeInstanceOf(InvalidAuthoringRequestError);

    await expect(editPuppet(
      {
        inputPath: 'input.inp', outputPath: 'output.inp',
        operations: [{ type: 'node.create', parentPath: '/Root', name: '  ' }],
      },
      { hostPath: '/definitely/missing/iat_native_host' },
    )).rejects.toBeInstanceOf(InvalidAuthoringRequestError);

    await expect(editPuppet(
      {
        inputPath: 'input.inp', outputPath: 'output.inp',
        operations: [{ type: 'node.remove', path: '/Root/Bad\0Path' }],
      },
      { hostPath: '/definitely/missing/iat_native_host' },
    )).rejects.toBeInstanceOf(InvalidAuthoringRequestError);
  });

  it('keeps a valid request dependent on the native host boundary', async () => {
    await expect(editPuppet(
      validRequest,
      { hostPath: '/definitely/missing/iat_native_host' },
    )).rejects.toBeInstanceOf(NativeBridgeError);
  });
});

describe.skipIf(!runExecutableFixtureTests)('editPuppet native semantic error mapping', () => {
  let fixtureDir: string;
  const hosts = new Map<number, string>();

  beforeAll(async () => {
    fixtureDir = await mkdtemp(path.join(tmpdir(), 'iat-visual-authoring-test-'));
    for (const code of [7, 8, 9, 42]) {
      const host = path.join(fixtureDir, `exit-${code}`);
      await writeFile(
        host,
        `#!/usr/bin/env node\nprocess.stderr.write("simulated-${code}\\n");\nprocess.exit(${code});\n`,
        'utf8',
      );
      await chmod(host, 0o755);
      hosts.set(code, host);
    }
  });

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it('maps hierarchy, missing-texture, and invalid-asset exits to typed errors', async () => {
    await expect(editPuppet(validRequest, { hostPath: hosts.get(7) })).rejects.toBeInstanceOf(InvalidHierarchyError);
    await expect(editPuppet(validRequest, { hostPath: hosts.get(8) })).rejects.toBeInstanceOf(MissingTextureError);
    await expect(editPuppet(validRequest, { hostPath: hosts.get(9) })).rejects.toBeInstanceOf(InvalidTextureAssetError);
  });

  it('keeps unknown native exits behind NativeBridgeError', async () => {
    await expect(editPuppet(validRequest, { hostPath: hosts.get(42) })).rejects.toMatchObject({
      name: 'NativeBridgeError',
      code: 'NATIVE_BRIDGE_FAILURE',
      message: 'simulated-42',
    });
  });
});
