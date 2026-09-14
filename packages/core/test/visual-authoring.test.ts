import { describe, expect, it } from 'vitest';

import {
  InvalidAuthoringRequestError,
  InvalidHierarchyError,
  InvalidTextureAssetError,
  MissingTextureError,
  NativeBridgeError,
  editPuppet,
} from '../src/index.js';

const validOperation = { type: 'node.create' as const, parentPath: '/Root', name: 'Body' };

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
  });

  it('keeps a valid request dependent on the native host boundary', async () => {
    await expect(editPuppet(
      { inputPath: 'input.inp', outputPath: 'output.inp', operations: [validOperation] },
      { hostPath: '/definitely/missing/iat_native_host' },
    )).rejects.toBeInstanceOf(NativeBridgeError);
  });

  it('defines typed native semantic failures for hierarchy and textures', () => {
    expect(new InvalidHierarchyError()).toBeInstanceOf(Error);
    expect(new MissingTextureError()).toBeInstanceOf(Error);
    expect(new InvalidTextureAssetError()).toBeInstanceOf(Error);
  });
});
