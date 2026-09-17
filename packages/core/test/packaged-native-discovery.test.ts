import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import { inspectPuppet } from '../src/native-host.js';

const realPuppet = process.env.IAT_REAL_PUPPET;

test.skipIf(!realPuppet)('packaged core discovers its native host independently of caller cwd', async () => {
  const unrelatedCwd = await mkdtemp(path.join(tmpdir(), 'iat-packaged-cwd-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(unrelatedCwd);
    const inspection = await inspectPuppet(path.resolve(previousCwd, realPuppet!));
    expect(inspection).toBeTruthy();
  } finally {
    process.chdir(previousCwd);
    await rm(unrelatedCwd, { recursive: true, force: true });
  }
});
