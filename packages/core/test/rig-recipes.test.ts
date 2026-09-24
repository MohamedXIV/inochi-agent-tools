import { describe, expect, it } from 'vitest';

import {
  InvalidAuthoringRequestError,
  InvalidBindingError,
  compileTwoAxisTranslationRig,
} from '../src/index.js';

describe('compileTwoAxisTranslationRig', () => {
  it('compiles one semantic recipe into inspectable core operations for multiple parts', () => {
    const operations = compileTwoAxisTranslationRig({
      parameterNames: { x: 'Head X', y: 'Head Y' },
      targets: [
        { path: '/Root/Head/Face', x: 8, y: 5 },
        { path: '/Root/Head/Hair Front', x: 10, y: 6 },
        { path: '/Root/Head', x: 12, y: 8 },
      ],
    });

    expect(operations).toHaveLength(8);
    expect(operations.slice(0, 2)).toEqual([
      {
        type: 'parameter.create',
        name: 'Head X',
        dimensions: 1,
        min: [-1, 0],
        max: [1, 0],
        defaultValue: [0, 0],
      },
      {
        type: 'parameter.create',
        name: 'Head Y',
        dimensions: 1,
        min: [-1, 0],
        max: [1, 0],
        defaultValue: [0, 0],
      },
    ]);
    expect(operations).toContainEqual({
      type: 'parameter.bind',
      parameterName: 'Head X',
      targetPath: '/Root/Head',
      property: 'transform.t.x',
      keypoints: [
        { at: [-1, 0], value: -12 },
        { at: [0, 0], value: 0 },
        { at: [1, 0], value: 12 },
      ],
    });
    expect(operations).toContainEqual({
      type: 'parameter.bind',
      parameterName: 'Head Y',
      targetPath: '/Root/Head/Hair Front',
      property: 'transform.t.y',
      keypoints: [
        { at: [-1, 0], value: -6 },
        { at: [0, 0], value: 0 },
        { at: [1, 0], value: 6 },
      ],
    });
  });

  it('canonicalizes target order so equivalent recipes compile identically', () => {
    const targets = [
      { path: '/Root/Head/Hair', x: 5, y: 3 },
      { path: '/Root/Head/Face', x: 4, y: 2 },
    ];
    const parameterNames = { x: 'Look X', y: 'Look Y' };

    expect(compileTwoAxisTranslationRig({ parameterNames, targets }))
      .toEqual(compileTwoAxisTranslationRig({ parameterNames, targets: [...targets].reverse() }));
  });

  it('omits zero-amplitude axis bindings without hiding the parameter contract', () => {
    const operations = compileTwoAxisTranslationRig({
      parameterNames: { x: 'Body X', y: 'Body Y' },
      targets: [{ path: '/Root/Body', x: 15, y: 0 }],
    });

    expect(operations).toHaveLength(3);
    expect(operations.filter((operation) => operation.type === 'parameter.bind'))
      .toEqual([expect.objectContaining({
        parameterName: 'Body X',
        property: 'transform.t.x',
        targetPath: '/Root/Body',
      })]);
  });

  it('fails closed on ambiguous semantic identities', () => {
    expect(() => compileTwoAxisTranslationRig({
      parameterNames: { x: 'Head', y: 'Head' },
      targets: [{ path: '/Root/Head', x: 1, y: 1 }],
    })).toThrow(InvalidBindingError);

    expect(() => compileTwoAxisTranslationRig({
      parameterNames: { x: 'Head X', y: 'Head Y' },
      targets: [
        { path: '/Root/Head', x: 1, y: 1 },
        { path: '/Root/Head', x: 2, y: 2 },
      ],
    })).toThrow(InvalidAuthoringRequestError);
  });

  it('fails closed on invalid movement magnitudes and empty targets', () => {
    expect(() => compileTwoAxisTranslationRig({
      parameterNames: { x: 'Head X', y: 'Head Y' },
      targets: [],
    })).toThrow(InvalidAuthoringRequestError);

    expect(() => compileTwoAxisTranslationRig({
      parameterNames: { x: 'Head X', y: 'Head Y' },
      targets: [{ path: '/Root/Head', x: Number.NaN, y: 1 }],
    })).toThrow(InvalidBindingError);

    expect(() => compileTwoAxisTranslationRig({
      parameterNames: { x: 'Head X', y: 'Head Y' },
      targets: [{ path: '/Root/Head', x: 0, y: 0 }],
    })).toThrow(InvalidBindingError);
  });
});
