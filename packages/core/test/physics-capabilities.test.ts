import { describe, expect, it } from 'vitest';

import { physicsCapabilities } from '../src/index.js';

describe('physics capability discovery', () => {
  it('advertises pinned SimplePhysics honestly as compatibility support', () => {
    expect(physicsCapabilities()).toEqual([
      {
        backend: 'simple-physics-compat',
        status: 'compatibility',
        models: ['pendulum', 'spring-pendulum'],
        mapModes: ['angle-length', 'xy', 'length-angle', 'yx'],
        supportsRuntimeEvaluation: true,
        supportsSaveReopen: true,
        note: expect.stringContaining('deprecated upstream'),
      },
    ]);
  });
});
