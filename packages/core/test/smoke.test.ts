import { describe, expect, it } from 'vitest';
import { coreVersion } from '../src/index.js';

describe('semantic core package', () => {
  it('exposes an explicit pre-1.0 API version', () => {
    expect(coreVersion()).toBe('0.1.0');
  });
});
