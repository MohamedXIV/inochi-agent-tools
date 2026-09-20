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

  it('does not advertise unsupported tint or masking properties', () => {
    const properties = parameterBindingCapabilities().map((capability) => capability.property);

    expect(properties).not.toContain('tint');
    expect(properties).not.toContain('screenTint');
    expect(properties).not.toContain('mask');
  });
});
