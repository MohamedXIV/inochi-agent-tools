import { rm } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import {
  InvalidAuthoringRequestError,
  createPuppet,
  editPuppet,
  inspectPuppet,
} from '../src/index.js';

const runNative = process.env.IAT_M2_VISUAL_TESTS === '1';
const input = 'tests/fixtures/generated/core-v1.2-mesh-input.inp';
const output = 'tests/fixtures/generated/core-v1.2-mesh-output.inp';
const imagePath = 'tests/fixtures/generated/m2-checker.png';

const topology = {
  vertices: [[-16, -16], [16, -16], [16, 16], [-16, 16]],
  uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
  indices: [0, 1, 2, 0, 2, 3],
};

describe.skipIf(!runNative)('real semantic mesh authoring', () => {
  it('replaces Part topology and preserves it across save/reopen', async () => {
    await rm(input, { force: true });
    await rm(output, { force: true });

    await createPuppet({ outputPath: input, name: 'Core v1.2 Mesh Puppet' });
    const edited = await editPuppet({
      inputPath: input,
      outputPath: output,
      operations: [
        { type: 'texture.import', key: 'face', imagePath },
        { type: 'part.create', parentPath: '/Root', name: 'Face', textureKey: 'face' },
        { type: 'part.setMesh', path: '/Root/Face', mesh: topology },
      ],
    });

    const face = edited.inspection.nodes.find((node) => node.path === '/Root/Face');
    expect(face?.kind).toBe('part');
    expect(face?.mesh).toEqual(topology);

    const reopened = await inspectPuppet(output);
    expect(reopened.nodes.find((node) => node.path === '/Root/Face')?.mesh).toEqual(topology);
    expect(reopened).toEqual(edited.inspection);
  });
});

describe('semantic mesh validation', () => {
  const request = (mesh: unknown) => ({
    inputPath: 'input.inp',
    outputPath: 'output.inp',
    operations: [{ type: 'part.setMesh', path: '/Root/Face', mesh }],
  });

  it('rejects vertex/UV cardinality mismatch before native work', async () => {
    await expect(editPuppet(request({
      ...topology,
      uvs: [[0, 0], [1, 0], [1, 1]],
    }) as never, { hostPath: '/definitely/missing/iat_native_host' }))
      .rejects.toBeInstanceOf(InvalidAuthoringRequestError);
  });

  it('rejects indices outside the vertex range before native work', async () => {
    await expect(editPuppet(request({
      ...topology,
      indices: [0, 1, 4],
    }) as never, { hostPath: '/definitely/missing/iat_native_host' }))
      .rejects.toBeInstanceOf(InvalidAuthoringRequestError);
  });

  it('rejects non-triangle index lists before native work', async () => {
    await expect(editPuppet(request({
      ...topology,
      indices: [0, 1, 2, 3],
    }) as never, { hostPath: '/definitely/missing/iat_native_host' }))
      .rejects.toBeInstanceOf(InvalidAuthoringRequestError);
  });
});
