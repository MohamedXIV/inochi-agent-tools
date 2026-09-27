import { describe, expect, it } from 'vitest';

import { modelFormatCompatibilityCapabilities } from '../src/index.js';

describe('modelFormatCompatibilityCapabilities', () => {
  it('exposes semantic lane status without native format internals', () => {
    expect(modelFormatCompatibilityCapabilities).toEqual({
      stableAuthoring: 'supported',
      currentFormatConversion: 'experimental',
      currentFormatDirectAuthoring: 'unproven',
      semantics: {
        parameter1DBoundsDefaultsValues: 'supported',
        nodeHierarchy: 'supported',
        textures: 'supported',
        parameterBindings: 'unproven',
        physicsAuthoring: 'unproven',
        legacyCreatorRoundtrip: 'legacy-only',
      },
    });

    const publicShape = JSON.stringify(modelFormatCompatibilityCapabilities);
    expect(publicShape).not.toContain('TRNSRTS');
    expect(publicShape).not.toContain('fdb241');
    expect(publicShape).not.toContain('ba2b14');
    expect(publicShape).not.toContain('guid');
    expect(publicShape).not.toContain('pointer');
  });
});
