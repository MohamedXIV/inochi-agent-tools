import { rm } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import {
  createPuppet,
  editPuppet,
  inspectPuppet,
} from '../src/index.js';

const runNative = process.env.IAT_M2_CREATOR_TESTS === '1';
const base = 'tests/fixtures/generated/creator-roundtrip-base.inp';
const output = 'tests/fixtures/generated/creator-roundtrip-input.inp';
const imagePath = 'tests/fixtures/generated/m2-checker.png';

describe.skipIf(!runNative)('official Creator compatibility fixture', () => {
  it('authors the complete real visual and parameter acceptance puppet through the public semantic core', async () => {
    await rm(base, { force: true });
    await rm(output, { force: true });

    await createPuppet({ outputPath: base, name: 'Creator Roundtrip Fixture' });

    const edited = await editPuppet({
      inputPath: base,
      outputPath: output,
      operations: [
        { type: 'texture.import', key: 'face', imagePath },
        { type: 'node.create', parentPath: '/Root', name: 'Art' },
        { type: 'part.create', parentPath: '/Root/Art', name: 'Face', textureKey: 'face' },
        { type: 'node.create', parentPath: '/Root', name: 'Rig' },
        {
          type: 'parameter.create',
          name: 'Move X',
          dimensions: 1,
          min: [-1, 0],
          max: [1, 0],
          defaultValue: [0, 0],
        },
        {
          type: 'parameter.create',
          name: 'Move Y',
          dimensions: 1,
          min: [-1, 0],
          max: [1, 0],
          defaultValue: [0, 0],
        },
        {
          type: 'parameter.bind',
          parameterName: 'Move X',
          targetPath: '/Root/Rig',
          property: 'transform.t.x',
          keypoints: [
            { at: [-1, 0], value: -20 },
            { at: [1, 0], value: 20 },
          ],
        },
        {
          type: 'parameter.bind',
          parameterName: 'Move Y',
          targetPath: '/Root/Rig',
          property: 'transform.t.y',
          keypoints: [
            { at: [-1, 0], value: -12 },
            { at: [1, 0], value: 12 },
          ],
        },
      ],
    });

    expect(edited.inspection.metadata.name).toBe('Creator Roundtrip Fixture');
    expect(edited.inspection.textures).toHaveLength(1);
    expect(edited.inspection.summary.textureCount).toBe(1);
    expect(edited.inspection.summary.partCount).toBe(1);
    expect(edited.inspection.summary.parameterCount).toBe(2);

    const face = edited.inspection.nodes.find((node) => node.path === '/Root/Art/Face');
    expect(face?.kind).toBe('part');
    expect(face?.textures).toEqual([
      { usage: 'albedo', ref: edited.inspection.textures[0]?.ref },
    ]);
    expect(edited.inspection.nodes.some((node) => node.path === '/Root/Rig')).toBe(true);

    const moveX = edited.inspection.parameters.find((parameter) => parameter.name === 'Move X');
    const moveY = edited.inspection.parameters.find((parameter) => parameter.name === 'Move Y');

    expect(moveX).toEqual(expect.objectContaining({
      dimensions: 1,
      min: [-1, 0],
      max: [1, 0],
      defaultValue: [0, 0],
    }));
    expect(moveX?.bindings).toEqual([
      expect.objectContaining({
        targetPath: '/Root/Rig',
        property: 'transform.t.x',
        keypoints: [
          expect.objectContaining({ parameterValue: [-1, 0], value: -20 }),
          expect.objectContaining({ parameterValue: [1, 0], value: 20 }),
        ],
      }),
    ]);

    expect(moveY).toEqual(expect.objectContaining({
      dimensions: 1,
      min: [-1, 0],
      max: [1, 0],
      defaultValue: [0, 0],
    }));
    expect(moveY?.bindings).toEqual([
      expect.objectContaining({
        targetPath: '/Root/Rig',
        property: 'transform.t.y',
        keypoints: [
          expect.objectContaining({ parameterValue: [-1, 0], value: -12 }),
          expect.objectContaining({ parameterValue: [1, 0], value: 12 }),
        ],
      }),
    ]);

    expect(await inspectPuppet(output)).toEqual(edited.inspection);

    await rm(base, { force: true });
  });
});
