import { describe, expect, it } from 'vitest';
import { inspectPuppet } from '../src/index.js';

const runNative = process.env.IAT_M1_NATIVE_TESTS === '1';
const validFixture = 'tests/fixtures/generated/m1-inspection.inp';
const invalidFixture = 'tests/fixtures/invalid/not-a-puppet.inp';

describe.runIf(runNative)('repeated native puppet inspection lifecycle', () => {
  it('remains deterministic across repeated valid and invalid process lifecycles', async () => {
    const baseline = await inspectPuppet(validFixture);

    for (let index = 0; index < 49; index += 1) {
      await expect(inspectPuppet(validFixture)).resolves.toEqual(baseline);
    }

    for (let index = 0; index < 10; index += 1) {
      await expect(inspectPuppet(invalidFixture)).rejects.toMatchObject({
        name: 'InvalidPuppetError',
        code: 'INVALID_PUPPET',
      });
    }

    await expect(inspectPuppet(validFixture)).resolves.toEqual(baseline);
  });
});
