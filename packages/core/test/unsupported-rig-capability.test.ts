import { describe, expect, it } from 'vitest';

import {
  UnsupportedAuthoringCapabilityError,
  editPuppet,
} from '../src/index.js';

describe('pinned rig capability gating', () => {
  for (const type of ['bone.create', 'bone.setWeights'] as const) {
    it(`fails closed for unsupported ${type} before native work`, async () => {
      await expect(editPuppet({
        inputPath: 'input.inp',
        outputPath: 'output.inp',
        operations: [{ type } as never],
      }, { hostPath: '/definitely/missing/iat_native_host' }))
        .rejects.toBeInstanceOf(UnsupportedAuthoringCapabilityError);

      await expect(editPuppet({
        inputPath: 'input.inp',
        outputPath: 'output.inp',
        operations: [{ type } as never],
      }, { hostPath: '/definitely/missing/iat_native_host' }))
        .rejects.toMatchObject({
          code: 'UNSUPPORTED_AUTHORING_CAPABILITY',
          message: expect.stringContaining('pinned Inochi2D v0.8.7'),
        });
    });
  }
});
