import { describe, expect, it } from 'vitest';

import {
  InvalidRigProjectError,
  RIG_PROJECT_SCHEMA_VERSION,
  inspectRigProjectManifest,
  normalizeRigProjectManifest,
} from '../src/index.js';

function representativeProject() {
  return {
    schemaVersion: RIG_PROJECT_SCHEMA_VERSION,
    name: '  Example Character  ',
    coordinates: { origin: 'center', yAxis: 'down', unit: 'px' },
    layers: [
      {
        id: 'hair.r',
        source: 'art\\hair-r.png',
        role: 'hair',
        parentId: 'head',
        symmetry: { counterpart: 'hair.l', axis: 'x' },
        pivot: { x: 12, y: -20 },
      },
      {
        id: 'head',
        source: './art/head.png',
        role: 'head',
        anchors: { neck: { x: 0, y: 42 }, face_center: { x: 0, y: 0 } },
      },
      {
        id: 'hair.l',
        source: 'art/hair-l.png',
        role: 'hair',
        parentId: 'head',
        symmetry: { counterpart: 'hair.r', axis: 'x' },
      },
    ],
    motions: [
      { id: 'look.y', kind: 'transform', axis: 'y', min: -1, max: 1, default: 0, targets: ['hair.r', 'head', 'hair.l'] },
      { id: 'look.x', kind: 'deform', axis: 'x', min: -1, max: 1, default: 0, targets: ['head'] },
    ],
  };
}

describe('rig project manifest contract', () => {
  it('validates and canonicalizes a representative layered character project', () => {
    const inspected = inspectRigProjectManifest(representativeProject());

    expect(inspected.schemaVersion).toBe(1);
    expect(inspected.manifest.name).toBe('Example Character');
    expect(inspected.manifest.layers.map((layer) => layer.id)).toEqual(['hair.l', 'hair.r', 'head']);
    expect(inspected.manifest.layers.find((layer) => layer.id === 'hair.r')?.source).toBe('art/hair-r.png');
    expect(inspected.manifest.motions.map((motion) => motion.id)).toEqual(['look.x', 'look.y']);
    expect(inspected.manifest.motions.find((motion) => motion.id === 'look.y')?.targets).toEqual(['hair.l', 'hair.r', 'head']);
    expect(inspected.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('normalizes declaration order and object-key order to the same fingerprint', () => {
    const first = representativeProject();
    const second = {
      motions: [...first.motions].reverse().map((motion) => ({ ...motion, targets: [...motion.targets].reverse() })),
      layers: [...first.layers].reverse(),
      name: first.name,
      schemaVersion: first.schemaVersion,
      coordinates: { yAxis: 'down', unit: 'px', origin: 'center' },
    };

    expect(inspectRigProjectManifest(first).fingerprint).toBe(inspectRigProjectManifest(second).fingerprint);
    expect(normalizeRigProjectManifest(first)).toEqual(normalizeRigProjectManifest(second));
  });

  it('fails closed with machine-readable diagnostics for ambiguous and malformed declarations', () => {
    const malformed: unknown = {
      ...representativeProject(),
      layers: [
        ...representativeProject().layers,
        { id: 'head', source: '../outside.png', role: 'duplicate' },
      ],
      motions: [
        { id: 'bad', kind: 'physics', axis: 'x', min: 1, max: -1, default: 9, targets: ['missing.layer'] },
      ],
    };

    let caught: unknown;
    try {
      inspectRigProjectManifest(malformed);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(InvalidRigProjectError);
    const error = caught as InvalidRigProjectError;
    expect(error.code).toBe('INVALID_RIG_PROJECT');
    expect(error.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DUPLICATE_ID', path: expect.stringContaining('.id') }),
      expect.objectContaining({ code: 'UNSAFE_PATH', path: expect.stringContaining('.source') }),
      expect.objectContaining({ code: 'INVALID_VALUE', path: expect.stringContaining('.min') }),
      expect.objectContaining({ code: 'UNRESOLVED_REFERENCE', path: expect.stringContaining('.targets') }),
    ]));
  });
});
