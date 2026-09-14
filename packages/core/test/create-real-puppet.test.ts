import { rm } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { PuppetAlreadyExistsError, createPuppet, inspectPuppet } from '../src/index.js';

const runNative = process.env.IAT_M1_AUTHORING_TESTS === '1';
const output = 'tests/fixtures/generated/core-created-minimal.inp';

describe.skipIf(!runNative)('real minimal puppet authoring', () => {
  it('creates, reopens, and refuses to overwrite a genuine .inp', async () => {
    await rm(output, { force: true });

    const created = await createPuppet({
      outputPath: output,
      name: 'Core Created Puppet',
    });
    expect(created.inspection.metadata.name).toBe('Core Created Puppet');
    expect(created.inspection.summary.nodeCount).toBeGreaterThanOrEqual(1);

    const reopened = await inspectPuppet(output);
    expect(reopened).toEqual(created.inspection);

    await expect(
      createPuppet({ outputPath: output, name: 'Replacement Puppet' }),
    ).rejects.toBeInstanceOf(PuppetAlreadyExistsError);
  });
});
