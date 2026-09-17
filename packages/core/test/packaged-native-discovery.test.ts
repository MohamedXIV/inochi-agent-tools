import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectPuppet } from '../src/native-host.js';

const realPuppet = process.env.IAT_REAL_PUPPET;

test('packaged core discovers its native host independently of caller cwd', { skip: !realPuppet }, async () => {
  const unrelatedCwd = await mkdtemp(path.join(tmpdir(), 'iat-packaged-cwd-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(unrelatedCwd);
    const inspection = await inspectPuppet(path.resolve(previousCwd, realPuppet!));
    assert.ok(inspection, 'real puppet should be inspected from an unrelated caller cwd');
  } finally {
    process.chdir(previousCwd);
    await rm(unrelatedCwd, { recursive: true, force: true });
  }
});
