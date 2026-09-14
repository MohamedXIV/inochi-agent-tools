import { describe, expect, it } from 'vitest';
import { parsePuppetInspection } from '../src/index.js';

describe('semantic texture inspection', () => {
  it('exposes persistent texture fingerprints and Part relationships', () => {
    const ref = `sha256:${'a'.repeat(64)}`;
    const parsed = parsePuppetInspection({
      schemaVersion: 1,
      metadata: {
        name: 'Visual',
        inochiVersion: 'v0.8.7',
        rigger: '',
        artist: '',
      },
      nodes: [
        { path: '/Root', name: 'Root', kind: 'node', childCount: 1 },
        {
          path: '/Root/Face',
          name: 'Face',
          kind: 'part',
          childCount: 0,
          textures: [{ usage: 'albedo', ref }],
        },
      ],
      parameters: [],
      textures: [{ ref, width: 2, height: 2, format: 'rgba8' }],
      textureCount: 1,
      summary: {
        nodeCount: 2,
        partCount: 1,
        parameterCount: 0,
        textureCount: 1,
      },
    });

    expect(parsed.textures).toEqual([
      { ref, width: 2, height: 2, format: 'rgba8' },
    ]);
    expect(parsed.nodes[0]?.textures).toEqual([]);
    expect(parsed.nodes[1]?.textures).toEqual([{ usage: 'albedo', ref }]);
  });
});
