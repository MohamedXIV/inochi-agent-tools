import { describe, expect, it } from 'vitest';
import { buildFingerprint } from '../../scripts/upstream/fingerprint.mjs';

describe('build fingerprint', () => {
  it('reports immutable upstream and ordered patches', async () => {
    const f = await buildFingerprint({ probeTools: false });
    expect(f.upstreamCommit).toBe('fdb241da048dbe330152f7b0015e2129dc392844');
    expect(f.upstreamVersion).toBe('v0.8.7');
    expect(f.patches).toEqual([]);
  });
});
