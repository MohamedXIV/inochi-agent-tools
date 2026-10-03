import { describe, expect, it } from 'vitest';

import { createAuthoringClient } from '../src/client.js';
import * as sdk from '../src/index.js';

const FORBIDDEN_PUBLIC_NAME = /(in_|pointer|allocator|offset|nativeHandle)/i;

describe('public semantic SDK contract', () => {
  it('exposes an authoring client without native implementation concepts', () => {
    const client = createAuthoringClient();

    expect(Object.keys(client).sort()).toEqual([
      'buildRigProject',
      'createPuppet',
      'editPuppet',
      'evaluateParameters',
      'inspectPuppet',
      'normalizeRigProject',
      'renderPreview',
      'savePuppet',
      'validatePuppet',
    ]);

    const forbiddenPublicNames = Object.keys(sdk).filter((name) => FORBIDDEN_PUBLIC_NAME.test(name));
    expect(forbiddenPublicNames).toEqual([]);
  });

  it('normalizes and fingerprints rig-project manifests through the core contract', async () => {
    const client = createAuthoringClient();
    const result = await client.normalizeRigProject({ manifest: {
      schemaVersion: 'inochi-agent-tools/rig-project/v1',
      name: 'SDK Rig',
      layers: [{ id: 'body', source: 'layers/body.png', role: 'body' }],
    } });

    expect(result.schemaVersion).toBe(1);
    expect(result.manifest.coordinates).toEqual({ unit: 'px', origin: 'center', yAxis: 'down' });
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('preserves semantic validation failures from the core', async () => {
    const client = createAuthoringClient();

    await expect(
      client.createPuppet({ outputPath: 'not-an-inp.txt', name: 'SDK Contract' }),
    ).rejects.toMatchObject({ code: 'INVALID_AUTHORING_REQUEST' });
  });
});
