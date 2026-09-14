import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  InvalidBindingError,
  NativeBridgeError,
  editPuppet,
} from '../src/index.js';

const missingHost = '/definitely/missing/iat_native_host';

const createMoveX = {
  type: 'parameter.create' as const,
  name: 'Move X',
  dimensions: 1 as const,
  min: [-1, 0] as [number, number],
  max: [1, 0] as [number, number],
  defaultValue: [0, 0] as [number, number],
};

const bindMoveX = {
  type: 'parameter.bind' as const,
  parameterName: 'Move X',
  targetPath: '/Root/Rig',
  property: 'transform.t.x' as const,
  keypoints: [
    { at: [-1, 0] as [number, number], value: -20 },
    { at: [1, 0] as [number, number], value: 20 },
  ],
};

describe('parameter authoring semantic validation', () => {
  it('rejects invalid definitions before native work', async () => {
    await expect(editPuppet({
      inputPath: 'input.inp', outputPath: 'output.inp',
      operations: [{ ...createMoveX, name: '  ' }],
    }, { hostPath: missingHost })).rejects.toBeInstanceOf(InvalidBindingError);

    await expect(editPuppet({
      inputPath: 'input.inp', outputPath: 'output.inp',
      operations: [{ ...createMoveX, min: [1, 0], max: [-1, 0] }],
    }, { hostPath: missingHost })).rejects.toBeInstanceOf(InvalidBindingError);

    await expect(editPuppet({
      inputPath: 'input.inp', outputPath: 'output.inp',
      operations: [{ ...createMoveX, defaultValue: [2, 0] }],
    }, { hostPath: missingHost })).rejects.toBeInstanceOf(InvalidBindingError);
  });

  it('rejects malformed bindings before native work', async () => {
    await expect(editPuppet({
      inputPath: 'input.inp', outputPath: 'output.inp',
      operations: [{ ...bindMoveX, targetPath: '  ' }],
    }, { hostPath: missingHost })).rejects.toBeInstanceOf(InvalidBindingError);

    await expect(editPuppet({
      inputPath: 'input.inp', outputPath: 'output.inp',
      operations: [{ ...bindMoveX, keypoints: [] }],
    }, { hostPath: missingHost })).rejects.toBeInstanceOf(InvalidBindingError);
  });

  it('keeps valid parameter operations dependent on the native boundary', async () => {
    await expect(editPuppet({
      inputPath: 'input.inp', outputPath: 'output.inp',
      operations: [
        { type: 'node.create', parentPath: '/Root', name: 'Rig' },
        createMoveX,
        bindMoveX,
      ],
    }, { hostPath: missingHost })).rejects.toBeInstanceOf(NativeBridgeError);
  });
});

const runExecutableFixtureTests = process.platform !== 'win32';

describe.skipIf(!runExecutableFixtureTests)('parameter authoring native error mapping', () => {
  let fixtureDir: string;
  let bindingHost: string;

  beforeAll(async () => {
    fixtureDir = await mkdtemp(path.join(tmpdir(), 'iat-parameter-authoring-test-'));
    bindingHost = path.join(fixtureDir, 'exit-10');
    await writeFile(
      bindingHost,
      '#!/usr/bin/env node\nprocess.stderr.write("simulated-invalid-binding\\n");\nprocess.exit(10);\n',
      'utf8',
    );
    await chmod(bindingHost, 0o755);
  });

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it('maps native binding validation to InvalidBindingError', async () => {
    await expect(editPuppet({
      inputPath: 'input.inp', outputPath: 'output.inp',
      operations: [createMoveX],
    }, { hostPath: bindingHost })).rejects.toBeInstanceOf(InvalidBindingError);
  });
});
