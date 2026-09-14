import { rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  InvalidAuthoringRequestError,
  PuppetAlreadyExistsError,
  createPuppet,
  inspectPuppet,
  savePuppet,
} from '../src/index.js';

const runNative = process.env.IAT_M1_AUTHORING_TESTS === '1';
const source = 'tests/fixtures/generated/core-save-source.inp';
const saved = 'tests/fixtures/generated/core-save-output.inp';

describe.skipIf(!runNative)('real puppet save-as authoring', () => {
  it('saves through the semantic core, reopens, and refuses unsafe outputs', async () => {
    await rm(source, { force: true });
    await rm(saved, { force: true });

    const created = await createPuppet({
      outputPath: source,
      name: 'CLI Save Fixture',
    });

    const result = await savePuppet({ inputPath: source, outputPath: saved });
    expect(result.path).toBe(path.resolve(saved));
    expect(result.inspection.metadata.name).toBe(created.inspection.metadata.name);
    expect((await stat(source)).size).toBeGreaterThan(0);
    expect((await stat(saved)).size).toBeGreaterThan(0);
    expect((await inspectPuppet(saved)).metadata.name).toBe('CLI Save Fixture');

    await expect(
      savePuppet({ inputPath: source, outputPath: source }),
    ).rejects.toBeInstanceOf(InvalidAuthoringRequestError);
    await expect(
      savePuppet({ inputPath: source, outputPath: 'tests/fixtures/generated/core-save-output.json' }),
    ).rejects.toBeInstanceOf(InvalidAuthoringRequestError);
    await expect(
      savePuppet({ inputPath: source, outputPath: saved }),
    ).rejects.toBeInstanceOf(PuppetAlreadyExistsError);
  });
});
