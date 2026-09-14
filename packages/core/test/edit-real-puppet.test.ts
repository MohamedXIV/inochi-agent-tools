import { rm } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import {
  PuppetAlreadyExistsError,
  createPuppet,
  editPuppet,
  inspectPuppet,
} from '../src/index.js';

const runNative = process.env.IAT_M2_VISUAL_TESTS === '1';
const input = 'tests/fixtures/generated/core-m2-input.inp';
const output = 'tests/fixtures/generated/core-m2-output.inp';
const imagePath = 'tests/fixtures/generated/m2-checker.png';

describe.skipIf(!runNative)('real visual puppet authoring', () => {
  it('imports a PNG, authors hierarchy, saves/reopens, and refuses overwrite', async () => {
    await rm(input, { force: true });
    await rm(output, { force: true });

    await createPuppet({ outputPath: input, name: 'Core M2 Visual Puppet' });

    const operations = [
      { type: 'texture.import' as const, key: 'face', imagePath },
      { type: 'node.create' as const, parentPath: '/Root', name: 'Body' },
      { type: 'node.create' as const, parentPath: '/Root', name: 'Accessories' },
      { type: 'part.create' as const, parentPath: '/Root/Body', name: 'Face', textureKey: 'face' },
      { type: 'node.reparent' as const, path: '/Root/Body/Face', newParentPath: '/Root/Accessories' },
      { type: 'part.setTexture' as const, path: '/Root/Accessories/Face', textureKey: 'face' },
      { type: 'node.remove' as const, path: '/Root/Body' },
    ];

    const edited = await editPuppet({ inputPath: input, outputPath: output, operations });
    expect(edited.inspection.textures).toHaveLength(1);
    expect(edited.inspection.nodes.some((node) => node.path === '/Root/Body')).toBe(false);

    const face = edited.inspection.nodes.find((node) => node.path === '/Root/Accessories/Face');
    expect(face?.kind).toBe('part');
    expect(face?.textures).toEqual([
      { usage: 'albedo', ref: edited.inspection.textures[0]?.ref },
    ]);

    const reopened = await inspectPuppet(output);
    expect(reopened).toEqual(edited.inspection);

    await expect(
      editPuppet({ inputPath: input, outputPath: output, operations }),
    ).rejects.toBeInstanceOf(PuppetAlreadyExistsError);
  });
});
