import { rm } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import {
  createPuppet,
  editPuppet,
  evaluateParameterValues,
  inspectPuppet,
} from '../src/index.js';

const runNative = process.env.IAT_M2_PARAMETER_TESTS === '1';
const input = 'tests/fixtures/generated/core-v1.3-opacity-input.inp';
const output = 'tests/fixtures/generated/core-v1.3-opacity-output.inp';
const imagePath = 'tests/fixtures/generated/m2-checker.png';

describe.skipIf(!runNative)('real parameter-driven opacity authoring', () => {
  it('persists a Part opacity binding through save/reopen and evaluates it without transform bindings', async () => {
    await rm(input, { force: true });
    await rm(output, { force: true });

    await createPuppet({ outputPath: input, name: 'Core v1.3 Opacity Puppet' });
    const edited = await editPuppet({
      inputPath: input,
      outputPath: output,
      operations: [
        { type: 'texture.import', key: 'face', imagePath },
        {
          type: 'part.create',
          parentPath: '/Root',
          name: 'Face',
          textureKey: 'face',
        },
        {
          type: 'parameter.create',
          name: 'Visibility',
          dimensions: 1,
          min: [-1, 0],
          max: [1, 0],
          defaultValue: [0, 0],
        },
        {
          type: 'parameter.bind',
          parameterName: 'Visibility',
          targetPath: '/Root/Face',
          property: 'opacity',
          keypoints: [
            { at: [-1, 0], value: 0.25 },
            { at: [1, 0], value: 1 },
          ],
        },
      ],
    } as never);

    expect(edited.inspection.parameters).toEqual([
      expect.objectContaining({
        name: 'Visibility',
        bindings: [
          expect.objectContaining({
            targetPath: '/Root/Face',
            property: 'opacity',
            keypoints: [
              expect.objectContaining({ parameterValue: [-1, 0], value: 0.25 }),
              expect.objectContaining({ parameterValue: [1, 0], value: 1 }),
            ],
          }),
        ],
      }),
    ]);

    const reopened = await inspectPuppet(output);
    expect(reopened).toEqual(edited.inspection);

    const evaluated = await evaluateParameterValues({
      inputPath: output,
      values: { Visibility: [-1, 0] },
    });
    expect(evaluated.targets).toContainEqual({
      parameterName: 'Visibility',
      targetPath: '/Root/Face',
      property: 'opacity',
      appliedValue: 0.25,
      restoredValue: 1,
    });
  });
});
