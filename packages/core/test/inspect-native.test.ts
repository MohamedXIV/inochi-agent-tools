import { describe, expect, it } from 'vitest';
import {
  inspectPuppet,
  InvalidPuppetError,
} from '../src/index.js';

const runNative = process.env.IAT_M1_NATIVE_TESTS === '1';

describe.runIf(runNative)('real native puppet inspection', () => {
  it('inspects the genuine generated M1 puppet through the child-process host', async () => {
    const inspection = await inspectPuppet('tests/fixtures/generated/m1-inspection.inp');

    expect(inspection.metadata.name).toBe('M1 Inspection Fixture');
    expect(inspection.nodes.map((node) => node.name)).toEqual(
      expect.arrayContaining(['Root', 'Face', 'Mouth']),
    );
    expect(inspection.summary.partCount).toBe(1);
    expect(inspection.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Head X', dimensions: 1 }),
      ]),
    );
    expect(inspection.textureCount).toBe(0);
  });

  it('maps malformed real input to InvalidPuppetError', async () => {
    await expect(
      inspectPuppet('tests/fixtures/invalid/not-a-puppet.inp'),
    ).rejects.toMatchObject({
      name: 'InvalidPuppetError',
      code: 'INVALID_PUPPET',
    } satisfies Partial<InvalidPuppetError>);
  });
});
