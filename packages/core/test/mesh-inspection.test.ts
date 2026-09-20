import { describe, expect, it } from 'vitest';

import { parsePuppetInspection } from '../src/inspection.js';

const topology = {
  vertices: [[-16, -16], [16, -16], [16, 16], [-16, 16]],
  uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
  indices: [0, 1, 2, 0, 2, 3],
};

function inspectionWithMesh(mesh: unknown) {
  return {
    schemaVersion: 1,
    metadata: { name: 'Mesh inspection', inochiVersion: '0.8.7', rigger: '', artist: '' },
    nodes: [
      { path: '/Root', name: 'Root', kind: 'node', childCount: 1, textures: [] },
      { path: '/Root/Face', name: 'Face', kind: 'part', childCount: 0, textures: [], mesh },
    ],
    parameters: [],
    textures: [],
    textureCount: 0,
    summary: { nodeCount: 2, partCount: 1, parameterCount: 0, textureCount: 0 },
  };
}

describe('semantic mesh inspection', () => {
  it('preserves validated Part topology from native inspection', () => {
    const parsed = parsePuppetInspection(inspectionWithMesh(topology));
    expect(parsed.nodes[1]).toHaveProperty('mesh', topology);
  });

  it('rejects malformed native mesh topology instead of silently accepting it', () => {
    expect(() => parsePuppetInspection(inspectionWithMesh({
      ...topology,
      indices: [0, 1, 4],
    }))).toThrow(/mesh|indices|vertex/i);
  });
});
