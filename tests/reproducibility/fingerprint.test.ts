import { describe, expect, it } from 'vitest';
import { buildFingerprint } from '../../scripts/upstream/fingerprint.mjs';

describe('build fingerprint', () => {
  it('reports immutable upstream and ordered patches', async () => {
    const f = await buildFingerprint({ probeTools: false });
    expect(f.upstreamCommit).toBe('fdb241da048dbe330152f7b0015e2129dc392844');
    expect(f.upstreamVersion).toBe('v0.8.7');
    expect(f.patches).toEqual([
      '0001-accept-numeric-part-blend-mode.patch',
      '0002-copy-nstring-json-deserialization.patch',
      '0003-lowercase-parameter-nstring-view.patch',
      '0004-serialize-puppet-meta-nstring-views.patch',
      '0005-roundtrip-nested-vector-arrays.patch',
      '0006-preserve-integral-json-scalar-precision.patch',
      '0007-append-parameter-binding-json-elements.patch',
      '0008-disambiguate-guid-string-lookup.patch',
      '0009-read-binding-node-guid-from-node-field.patch',
      '0010-serialize-node-local-transform.patch',
      '0011-emit-legacy-node-uuid.patch',
      '0012-prefer-guid-over-legacy-uuid.patch',
      '0013-emit-legacy-parameter-binding-identities.patch',
      '0014-serialize-mesh-vectors-flat.patch',
      '0015-emit-legacy-part-mask-threshold.patch',
      '0016-serialize-legacy-part-blend-mode.patch',
      '0017-serialize-legacy-parameter-merge-mode.patch',
      '0018-serialize-legacy-binding-interpolate-mode.patch',
    ]);
  });
});
