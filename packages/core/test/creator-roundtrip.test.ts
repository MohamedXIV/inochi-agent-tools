import { describe, expect, it } from 'vitest';

import { evaluateParameterValues, inspectPuppet } from '../src/index.js';

const runCreatorRoundtrip = process.env.IAT_M2_CREATOR_TESTS === '1';
const input = 'tests/fixtures/generated/creator-roundtrip-input.inp';
const output = 'tests/fixtures/generated/creator-roundtrip-input.inx';

function parameterByName(
  inspection: Awaited<ReturnType<typeof inspectPuppet>>,
  name: string,
) {
  return inspection.parameters.find((parameter) => parameter.name === name);
}

describe.skipIf(!runCreatorRoundtrip)('official Creator semantic round-trip', () => {
  it('preserves authored hierarchy, texture relationships, parameters, bindings, and runtime evaluation', async () => {
    const before = await inspectPuppet(input);
    const after = await inspectPuppet(output);

    expect(after.metadata.name).toBe(before.metadata.name);
    expect(after.summary.partCount).toBe(before.summary.partCount);
    expect(after.summary.parameterCount).toBe(2);
    expect(after.summary.textureCount).toBe(before.summary.textureCount);
    expect(after.textures.map((texture) => texture.ref)).toEqual(
      before.textures.map((texture) => texture.ref),
    );

    const beforeFace = before.nodes.find((node) => node.path === '/Root/Art/Face');
    const afterFace = after.nodes.find((node) => node.path === '/Root/Art/Face');
    expect(afterFace?.kind).toBe('part');
    expect(afterFace?.textures).toEqual(beforeFace?.textures);

    expect(parameterByName(after, 'Move X')?.bindings).toEqual(
      parameterByName(before, 'Move X')?.bindings,
    );
    expect(parameterByName(after, 'Move Y')?.bindings).toEqual(
      parameterByName(before, 'Move Y')?.bindings,
    );

    const evaluated = await evaluateParameterValues({
      inputPath: output,
      values: { 'Move X': [1, 0], 'Move Y': [-1, 0] },
    });

    expect(evaluated.targets).toEqual(expect.arrayContaining([
      {
        parameterName: 'Move X',
        targetPath: '/Root/Rig',
        property: 'transform.t.x',
        appliedValue: 20,
        restoredValue: 0,
      },
      {
        parameterName: 'Move Y',
        targetPath: '/Root/Rig',
        property: 'transform.t.y',
        appliedValue: -12,
        restoredValue: 0,
      },
    ]));
    expect(evaluated.restoredParameters).toEqual(expect.arrayContaining([
      { name: 'Move X', value: [0, 0] },
      { name: 'Move Y', value: [0, 0] },
    ]));
  });
});
