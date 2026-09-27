export type CompatibilityLevel = 'supported' | 'experimental' | 'legacy-only' | 'unproven';

export interface ModelFormatCompatibilityCapabilities {
  /** Normal production authoring remains on the accepted stable lane. */
  stableAuthoring: CompatibilityLevel;
  /** A real authored model can be migrated through the isolated current-format lane. */
  currentFormatConversion: CompatibilityLevel;
  /** Directly authoring production models against the current-format lane is not established. */
  currentFormatDirectAuthoring: CompatibilityLevel;
  semantics: {
    parameter1DBoundsDefaultsValues: CompatibilityLevel;
    nodeHierarchy: CompatibilityLevel;
    textures: CompatibilityLevel;
    parameterBindings: CompatibilityLevel;
    physicsAuthoring: CompatibilityLevel;
    legacyCreatorRoundtrip: CompatibilityLevel;
  };
}

/**
 * High-level compatibility contract for callers.
 *
 * This intentionally reports semantic capability only. Upstream commits,
 * binary magic, native identities, patch mechanics, and allocator details stay
 * inside the compatibility/acceptance lane rather than leaking into normal APIs.
 */
export const modelFormatCompatibilityCapabilities: Readonly<ModelFormatCompatibilityCapabilities> = {
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
};
