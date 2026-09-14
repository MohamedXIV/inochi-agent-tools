import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import {
  PuppetAlreadyExistsError,
  createPuppet,
  editPuppet,
  evaluateParameterValues,
  inspectPuppet,
} from '../src/index.js';

const runNative = process.env.IAT_M2_PARAMETER_TESTS === '1';
const input = 'tests/fixtures/generated/core-m2-parameter-input.inp';
const output = 'tests/fixtures/generated/core-m2-parameter-output.inp';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe.skipIf(!runNative)('real parameter authoring and evaluation', () => {
  it('persists two bindings, evaluates real target offsets, restores defaults, and preserves input', async () => {
    await rm(input, { force: true });
    await rm(output, { force: true });

    await createPuppet({ outputPath: input, name: 'Core M2 Parameter Puppet' });
    const inputHashBefore = sha256(await readFile(input));

    const operations = [
      { type: 'node.create' as const, parentPath: '/Root', name: 'Rig' },
      { type: 'parameter.create' as const, name: 'Move X', dimensions: 1 as const, min: [-1, 0] as const, max: [1, 0] as const, defaultValue: [0, 0] as const },
      { type: 'parameter.create' as const, name: 'Move Y', dimensions: 1 as const, min: [-1, 0] as const, max: [1, 0] as const, defaultValue: [0, 0] as const },
      {
        type: 'parameter.bind' as const,
        parameterName: 'Move X',
        targetPath: '/Root/Rig',
        property: 'transform.t.x' as const,
        keypoints: [{ at: [-1, 0] as const, value: -20 }, { at: [1, 0] as const, value: 20 }],
      },
      {
        type: 'parameter.bind' as const,
        parameterName: 'Move Y',
        targetPath: '/Root/Rig',
        property: 'transform.t.y' as const,
        keypoints: [{ at: [-1, 0] as const, value: -12 }, { at: [1, 0] as const, value: 12 }],
      },
    ];

    const edited = await editPuppet({ inputPath: input, outputPath: output, operations });
    expect(edited.inspection.parameters).toHaveLength(2);

    const moveX = edited.inspection.parameters.find((parameter) => parameter.name === 'Move X');
    const moveY = edited.inspection.parameters.find((parameter) => parameter.name === 'Move Y');
    expect(moveX?.bindings).toEqual([
      expect.objectContaining({ targetPath: '/Root/Rig', property: 'transform.t.x' }),
    ]);
    expect(moveY?.bindings).toEqual([
      expect.objectContaining({ targetPath: '/Root/Rig', property: 'transform.t.y' }),
    ]);

    const reopened = await inspectPuppet(output);
    expect(reopened).toEqual(edited.inspection);

    const evaluated = await evaluateParameterValues({
      inputPath: output,
      values: { 'Move X': [1, 0], 'Move Y': [-1, 0] },
    });
    expect(evaluated.appliedParameters).toEqual(expect.arrayContaining([
      { name: 'Move X', value: [1, 0] },
      { name: 'Move Y', value: [-1, 0] },
    ]));
    expect(evaluated.targets).toEqual(expect.arrayContaining([
      {
        parameterName: 'Move X', targetPath: '/Root/Rig', property: 'transform.t.x', appliedValue: 20, restoredValue: 0,
      },
      {
        parameterName: 'Move Y', targetPath: '/Root/Rig', property: 'transform.t.y', appliedValue: -12, restoredValue: 0,
      },
    ]));
    expect(evaluated.restoredParameters).toEqual(expect.arrayContaining([
      { name: 'Move X', value: [0, 0] },
      { name: 'Move Y', value: [0, 0] },
    ]));

    expect(sha256(await readFile(input))).toBe(inputHashBefore);
    await expect(editPuppet({ inputPath: input, outputPath: output, operations }))
      .rejects.toBeInstanceOf(PuppetAlreadyExistsError);
  });
});
