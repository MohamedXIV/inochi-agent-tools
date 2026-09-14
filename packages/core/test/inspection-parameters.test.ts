import { describe, expect, it } from 'vitest';
import { parsePuppetInspection } from '../src/inspection.js';

const baseInspection = {
  schemaVersion: 1,
  metadata: {
    name: 'Parameter Fixture',
    inochiVersion: 'v0.8.7',
    rigger: '',
    artist: '',
  },
  nodes: [
    {
      path: '/Root',
      name: 'Root',
      kind: 'node',
      childCount: 1,
      textures: [],
    },
    {
      path: '/Root/Rig',
      name: 'Rig',
      kind: 'node',
      childCount: 0,
      textures: [],
    },
  ],
  parameters: [
    {
      name: 'Move X',
      dimensions: 1,
      min: [-1, 0],
      max: [1, 0],
      defaultValue: [0, 0],
      value: [0, 0],
      bindings: [
        {
          targetPath: '/Root/Rig',
          property: 'transform.t.x',
          keypoints: [
            { index: [0, 0], parameterValue: [-1, 0], value: -20 },
            { index: [1, 0], parameterValue: [1, 0], value: 20 },
          ],
        },
      ],
    },
  ],
  textures: [],
  textureCount: 0,
  summary: {
    nodeCount: 2,
    partCount: 0,
    parameterCount: 1,
    textureCount: 0,
  },
};

describe('semantic parameter binding inspection', () => {
  it('preserves target path, property, and authored keypoints without native identifiers', () => {
    const parsed = parsePuppetInspection(baseInspection);

    expect(parsed.parameters[0]?.bindings).toEqual([
      {
        targetPath: '/Root/Rig',
        property: 'transform.t.x',
        keypoints: [
          { index: [0, 0], parameterValue: [-1, 0], value: -20 },
          { index: [1, 0], parameterValue: [1, 0], value: 20 },
        ],
      },
    ]);
  });

  it('rejects binding properties outside the semantic v1 property contract', () => {
    const malformed = structuredClone(baseInspection);
    malformed.parameters[0]!.bindings[0]!.property = 'transform.magic';

    expect(() => parsePuppetInspection(malformed)).toThrow(
      /parameters\[0\]\.bindings\[0\]\.property/,
    );
  });
});
