import { describe, expect, it } from 'vitest';

import { createAuthoringClient } from '../src/client.js';
import * as sdk from '../src/index.js';

const FORBIDDEN_PUBLIC_NAME = /(in_|pointer|allocator|offset|nativeHandle)/i;

describe('public semantic SDK contract', () => {
  it('exposes an authoring client without native implementation concepts', () => {
    const client = createAuthoringClient();

    expect(Object.keys(client).sort()).toEqual([
      'createPuppet',
      'editPuppet',
      'evaluateParameters',
      'inspectPuppet',
      'renderPreview',
      'savePuppet',
      'validatePuppet',
    ]);

    const forbiddenPublicNames = Object.keys(sdk).filter((name) => FORBIDDEN_PUBLIC_NAME.test(name));
    expect(forbiddenPublicNames).toEqual([]);
  });

  it('preserves semantic validation failures from the core', async () => {
    const client = createAuthoringClient();

    await expect(
      client.createPuppet({ outputPath: 'not-an-inp.txt', name: 'SDK Contract' }),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORING_REQUEST' });
  });
});
