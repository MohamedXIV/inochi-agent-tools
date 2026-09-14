import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InvalidAuthoringRequestError,
  PuppetAlreadyExistsError,
  RoundTripMismatchError,
  createPuppet,
} from '../src/index.js';

const runExecutableFixtureTests = process.platform !== 'win32';

describe.skipIf(!runExecutableFixtureTests)('minimal authoring native host mappings', () => {
  let fixtureDir: string;
  let invalidRequestHost: string;
  let conflictHost: string;
  let mismatchHost: string;

  beforeAll(async () => {
    fixtureDir = await mkdtemp(path.join(tmpdir(), 'iat-authoring-host-test-'));
    invalidRequestHost = path.join(fixtureDir, 'invalid-request-host');
    conflictHost = path.join(fixtureDir, 'conflict-host');
    mismatchHost = path.join(fixtureDir, 'mismatch-host');

    await writeFile(invalidRequestHost, '#!/usr/bin/env node\nprocess.stderr.write("invalid request\\n"); process.exit(4);\n', 'utf8');
    await writeFile(conflictHost, '#!/usr/bin/env node\nprocess.stderr.write("already exists\\n"); process.exit(5);\n', 'utf8');
    await writeFile(mismatchHost, '#!/usr/bin/env node\nprocess.stderr.write("round trip mismatch\\n"); process.exit(6);\n', 'utf8');
    await chmod(invalidRequestHost, 0o755);
    await chmod(conflictHost, 0o755);
    await chmod(mismatchHost, 0o755);
  });

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it('maps host exit 4 to InvalidAuthoringRequestError', async () => {
    await expect(
      createPuppet({ outputPath: 'valid.inp', name: 'Valid' }, { hostPath: invalidRequestHost }),
    ).rejects.toBeInstanceOf(InvalidAuthoringRequestError);
  });

  it('maps host exit 5 to PuppetAlreadyExistsError', async () => {
    await expect(
      createPuppet({ outputPath: 'valid.inp', name: 'Valid' }, { hostPath: conflictHost }),
    ).rejects.toBeInstanceOf(PuppetAlreadyExistsError);
  });

  it('maps host exit 6 to RoundTripMismatchError', async () => {
    await expect(
      createPuppet({ outputPath: 'valid.inp', name: 'Valid' }, { hostPath: mismatchHost }),
    ).rejects.toBeInstanceOf(RoundTripMismatchError);
  });
});
