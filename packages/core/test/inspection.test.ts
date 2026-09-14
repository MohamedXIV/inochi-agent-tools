import { describe, expect, it } from 'vitest';
import { parsePuppetInspection } from '../src/inspection.js';

const validInspection = {
  schemaVersion: 1,
  metadata: {
    name: 'M1 Inspection Fixture',
    inochiVersion: '0.8.x',
    rigger: '',
    artist: '',
  },
  nodes: [
    { path: 'Root', name: 'Root', kind: 'node', childCount: 1 },
    { path: 'Root/Face', name: 'Face', kind: 'node', childCount: 1 },
    { path: 'Root/Face/Mouth', name: 'Mouth', kind: 'part', childCount: 0 },
  ],
  parameters: [
    {
      name: 'Head X',
      dimensions: 1,
      min: [-1, 0],
      max: [1, 0],
      defaultValue: [0, 0],
      value: [0, 0],
    },
  ],
  textureCount: 0,
  summary: {
    nodeCount: 3,
    partCount: 1,
    parameterCount: 1,
    textureCount: 0,
  },
};

describe('parsePuppetInspection', () => {
  it('returns a validated schema v1 snapshot', () => {
    expect(parsePuppetInspection(validInspection)).toEqual(validInspection);
  });

  it.each([
    [{ ...validInspection, schemaVersion: 2 }, 'schemaVersion'],
    [{ ...validInspection, metadata: undefined }, 'metadata'],
    [{ ...validInspection, nodes: {} }, 'nodes'],
    [
      {
        ...validInspection,
        parameters: [{ ...validInspection.parameters[0], dimensions: 3 }],
      },
      'dimensions',
    ],
    [
      {
        ...validInspection,
        summary: { ...validInspection.summary, nodeCount: -1 },
      },
      'nodeCount',
    ],
    [
      {
        ...validInspection,
        parameters: [
          { ...validInspection.parameters[0], value: [Number.NaN, 0] },
        ],
      },
      'value',
    ],
  ])('rejects malformed semantic snapshots mentioning %s', (input, _label) => {
    expect(() => parsePuppetInspection(input)).toThrow();
  });
});
