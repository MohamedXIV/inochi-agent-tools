import { describe, expect, it } from 'vitest';

import {
  InvalidAuthoringRequestError,
  NativeBridgeError,
  createPuppet,
} from '../src/index.js';

describe('createPuppet semantic request validation', () => {
  it('rejects a blank puppet name before spawning native work', async () => {
    await expect(
      createPuppet(
        { outputPath: 'tests/fixtures/generated/blank-name.inp', name: '   ' },
        { hostPath: '/definitely/missing/iat_native_host' },
      ),
    ).rejects.toBeInstanceOf(InvalidAuthoringRequestError);
  });

  it('rejects a non-INP output path before spawning native work', async () => {
    await expect(
      createPuppet(
        { outputPath: 'tests/fixtures/generated/not-inp.txt', name: 'Valid Puppet' },
        { hostPath: '/definitely/missing/iat_native_host' },
      ),
    ).rejects.toBeInstanceOf(InvalidAuthoringRequestError);
  });

  it('rejects NUL in the puppet name before spawning native work', async () => {
    await expect(
      createPuppet(
        { outputPath: 'tests/fixtures/generated/nul-name.inp', name: 'bad\0name' },
        { hostPath: '/definitely/missing/iat_native_host' },
      ),
    ).rejects.toBeInstanceOf(InvalidAuthoringRequestError);
  });

  it('keeps a valid request RED until the native create command exists', async () => {
    await expect(
      createPuppet(
        { outputPath: 'tests/fixtures/generated/valid-request.inp', name: 'Valid Puppet' },
        { hostPath: '/definitely/missing/iat_native_host' },
      ),
    ).rejects.toBeInstanceOf(NativeBridgeError);
  });
});
