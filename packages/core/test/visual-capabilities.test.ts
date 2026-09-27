import { describe, expect, it } from 'vitest';

import { parameterBindingCapabilities } from '../src/index.js';

describe('parameter binding capability discovery', () => {
  it('describes supported visual properties without native identifiers', () => {
    const capabilities = parameterBindingCapabilities();

    expect(capabilities).toContainEqual({
      property: 'opacity',
      targetKinds: ['part'],
      value: { min: 0, max: 1 },
    });
    expect(capabilities).toContainEqual({
      property: 'zSort',
      targetKinds: ['node', 'part', 'mesh-deformer', 'other'],
    });
    expect(capabilities.some((capability) => capability.property === 'transform.t.x')).toBe(true);
    expect(JSON.stringify(capabilities)).not.toMatch(/guid|pointer|allocator|in_/i);
  });

  it('advertises scalar Part tint channels without exposing unsupported compound/screen/mask controls', () => {
    const capabilities = parameterBindingCapabilities();
    const properties = capabilities.map((capability) => capability.property);

    for (const property of ['tint.r', 'tint.g', 'tint.b'] as const) {
      expect(capabilities).toContainEqual({
        property,
        targetKinds: ['part'],
        value: { min: 0, max: 1 },
      });
    }
    expect(properties).not.toContain('tint');
    expect(properties).not.toContain('screenTint');
    expect(properties).not.toContain('mask');
  });
});
