import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inspectPuppet } from '../src/index.js';

const runExecutableFixtureTests = process.platform !== 'win32';

describe.skipIf(!runExecutableFixtureTests)('native host adapter failures', () => {
  let fixtureDir: string;
  let malformedJsonHost: string;
  let abnormalExitHost: string;

  beforeAll(async () => {
    fixtureDir = await mkdtemp(path.join(tmpdir(), 'iat-native-host-test-'));
    malformedJsonHost = path.join(fixtureDir, 'malformed-json-host');
    abnormalExitHost = path.join(fixtureDir, 'abnormal-exit-host');

    await writeFile(
      malformedJsonHost,
      '#!/usr/bin/env node\nprocess.stdout.write("{not-json");\n',
      'utf8',
    );
    await writeFile(
      abnormalExitHost,
      '#!/usr/bin/env node\nprocess.stderr.write("simulated host failure\\n");\nprocess.exit(7);\n',
      'utf8',
    );
    await chmod(malformedJsonHost, 0o755);
    await chmod(abnormalExitHost, 0o755);
  });

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it('maps malformed host JSON to NativeBridgeError', async () => {
    await expect(
      inspectPuppet('unused.inp', { hostPath: malformedJsonHost }),
    ).rejects.toMatchObject({
      name: 'NativeBridgeError',
      code: 'NATIVE_BRIDGE_FAILURE',
    });
  });

  it('maps unsupported host exits to NativeBridgeError', async () => {
    await expect(
      inspectPuppet('unused.inp', { hostPath: abnormalExitHost }),
    ).rejects.toMatchObject({
      name: 'NativeBridgeError',
      code: 'NATIVE_BRIDGE_FAILURE',
      message: 'simulated host failure',
    });
  });
});
