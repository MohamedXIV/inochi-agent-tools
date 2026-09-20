import { rm } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import {
  InvalidHierarchyError,
  createPuppet,
  editPuppet,
  inspectPuppet,
} from '../src/index.js';

const runNative = process.env.IAT_M2_VISUAL_TESTS === '1';
const input = 'tests/fixtures/generated/core-v1.2-deformer-input.inp';
const output = 'tests/fixtures/generated/core-v1.2-deformer-output.inp';
const invalidOutput = 'tests/fixtures/generated/core-v1.2-deformer-invalid-output.inp';
const reparentOutput = 'tests/fixtures/generated/core-v1.2-deformer-reparent-output.inp';
const removeOutput = 'tests/fixtures/generated/core-v1.2-deformer-remove-output.inp';
const imagePath = 'tests/fixtures/generated/m2-checker.png';

const initialTopology = {
  vertices: [[-24, -24], [24, -24], [24, 24], [-24, 24]],
  uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
  indices: [0, 1, 2, 0, 2, 3],
};

const updatedTopology = {
  vertices: [[-28, -20], [28, -20], [28, 20], [-28, 20]],
  uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
  indices: [0, 1, 2, 0, 2, 3],
};

describe.skipIf(!runNative)('real semantic mesh deformer authoring', () => {
  it('creates and updates a mesh deformer and preserves its Part relationship across save/reopen', async () => {
    await rm(input, { force: true });
    await rm(output, { force: true });

    await createPuppet({ outputPath: input, name: 'Core v1.2 Deformer Puppet' });
    const edited = await editPuppet({
      inputPath: input,
      outputPath: output,
      operations: [
        {
          type: 'deformer.create',
          kind: 'mesh',
          parentPath: '/Root',
          name: 'Face Warp',
          mesh: initialTopology,
        },
        { type: 'texture.import', key: 'face', imagePath },
        {
          type: 'part.create',
          parentPath: '/Root/Face Warp',
          name: 'Face',
          textureKey: 'face',
        },
        {
          type: 'deformer.setMesh',
          path: '/Root/Face Warp',
          mesh: updatedTopology,
        },
      ],
    } as never);

    const warp = edited.inspection.nodes.find((node) => node.path === '/Root/Face Warp');
    const face = edited.inspection.nodes.find((node) => node.path === '/Root/Face Warp/Face');
    expect(warp).toMatchObject({
      kind: 'mesh-deformer',
      childCount: 1,
      mesh: updatedTopology,
    });
    expect(face?.kind).toBe('part');

    const reopened = await inspectPuppet(output);
    expect(reopened.nodes.find((node) => node.path === '/Root/Face Warp')).toMatchObject({
      kind: 'mesh-deformer',
      childCount: 1,
      mesh: updatedTopology,
    });
    expect(reopened.nodes.find((node) => node.path === '/Root/Face Warp/Face')?.kind).toBe('part');
    expect(reopened).toEqual(edited.inspection);
  });

  it('reparents a mesh deformer through normal semantic hierarchy operations and preserves the new path', async () => {
    await rm(input, { force: true });
    await rm(reparentOutput, { force: true });

    await createPuppet({ outputPath: input, name: 'Core v1.2 Deformer Reparent' });
    const edited = await editPuppet({
      inputPath: input,
      outputPath: reparentOutput,
      operations: [
        { type: 'node.create', parentPath: '/Root', name: 'Rig' },
        {
          type: 'deformer.create',
          kind: 'mesh',
          parentPath: '/Root',
          name: 'Warp',
          mesh: initialTopology,
        },
        {
          type: 'node.reparent',
          path: '/Root/Warp',
          newParentPath: '/Root/Rig',
        },
      ],
    } as never);

    expect(edited.inspection.nodes.find((node) => node.path === '/Root/Rig/Warp')).toMatchObject({
      kind: 'mesh-deformer',
      mesh: initialTopology,
    });
    expect(edited.inspection.nodes.some((node) => node.path === '/Root/Warp')).toBe(false);

    const reopened = await inspectPuppet(reparentOutput);
    expect(reopened.nodes.find((node) => node.path === '/Root/Rig/Warp')).toMatchObject({
      kind: 'mesh-deformer',
      mesh: initialTopology,
    });
  });

  it('removes a mesh deformer from the authored hierarchy without serializing a detached node', async () => {
    await rm(input, { force: true });
    await rm(removeOutput, { force: true });

    await createPuppet({ outputPath: input, name: 'Core v1.2 Deformer Remove' });
    const edited = await editPuppet({
      inputPath: input,
      outputPath: removeOutput,
      operations: [
        {
          type: 'deformer.create',
          kind: 'mesh',
          parentPath: '/Root',
          name: 'Warp',
          mesh: initialTopology,
        },
        { type: 'node.remove', path: '/Root/Warp' },
      ],
    } as never);

    expect(edited.inspection.nodes.some((node) => node.name === 'Warp')).toBe(false);
    const reopened = await inspectPuppet(removeOutput);
    expect(reopened.nodes.some((node) => node.name === 'Warp')).toBe(false);
  });

  it('rejects reparenting a mesh deformer beneath its own descendant', async () => {
    await rm(input, { force: true });
    await rm(invalidOutput, { force: true });

    await createPuppet({ outputPath: input, name: 'Core v1.2 Deformer Cycle' });
    await expect(editPuppet({
      inputPath: input,
      outputPath: invalidOutput,
      operations: [
        {
          type: 'deformer.create',
          kind: 'mesh',
          parentPath: '/Root',
          name: 'Warp',
          mesh: initialTopology,
        },
        { type: 'texture.import', key: 'face', imagePath },
        {
          type: 'part.create',
          parentPath: '/Root/Warp',
          name: 'Face',
          textureKey: 'face',
        },
        {
          type: 'node.reparent',
          path: '/Root/Warp',
          newParentPath: '/Root/Warp/Face',
        },
      ],
    } as never)).rejects.toBeInstanceOf(InvalidHierarchyError);
  });

  it('rejects a missing mesh deformer update target', async () => {
    await rm(input, { force: true });
    await rm(invalidOutput, { force: true });

    await createPuppet({ outputPath: input, name: 'Core v1.2 Missing Deformer' });
    await expect(editPuppet({
      inputPath: input,
      outputPath: invalidOutput,
      operations: [
        {
          type: 'deformer.setMesh',
          path: '/Root/Missing',
          mesh: updatedTopology,
        },
      ],
    } as never)).rejects.toBeInstanceOf(InvalidHierarchyError);
  });
});
