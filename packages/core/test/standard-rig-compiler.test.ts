import { describe, expect, it } from 'vitest';

import {
  InvalidAuthoringRequestError,
  InvalidBindingError,
  RIG_PROJECT_SCHEMA_VERSION,
  compileStandardCharacterRig,
} from '../src/index.js';

const manifest = {
  schemaVersion: RIG_PROJECT_SCHEMA_VERSION,
  name: 'Standard Rig',
  layers: [
    { id: 'body', source: 'body.png', role: 'body' },
    { id: 'head', source: 'head.png', role: 'head', parentId: 'body' },
    { id: 'face', source: 'face.png', role: 'face', parentId: 'head' },
    { id: 'hairL', source: 'hair-l.png', role: 'hair', parentId: 'head', symmetry: { counterpart: 'hairR', axis: 'x' as const } },
    { id: 'hairR', source: 'hair-r.png', role: 'hair', parentId: 'head', symmetry: { counterpart: 'hairL', axis: 'x' as const } },
  ],
  motions: [
    { id: 'bodyLean', kind: 'rotation' as const, axis: 'x' as const, min: -0.15, max: 0.15, default: 0, targets: ['body'] },
    { id: 'breath', kind: 'deform' as const, axis: 'y' as const, min: -0.04, max: 0.04, default: 0, targets: ['body'] },
    { id: 'hairSwing', kind: 'physics' as const, axis: 'x' as const, min: -0.2, max: 0.2, default: 0, targets: ['hairL', 'hairR'] },
    { id: 'headX', kind: 'transform' as const, axis: 'x' as const, min: -12, max: 12, default: 0, targets: ['face', 'head'] },
    { id: 'headY', kind: 'transform' as const, axis: 'y' as const, min: -8, max: 8, default: 0, targets: ['face', 'head'] },
  ],
};

const layerPaths = {
  body: '/Root/Body',
  head: '/Root/Head',
  face: '/Root/Face',
  hairL: '/Root/HairL',
  hairR: '/Root/HairR',
};

const hairProfile = {
  parameterName: 'Hair Swing',
  property: 'transform.r.z' as const,
  mirror: 'opposed' as const,
  physics: {
    parentPath: '/Root',
    name: 'Hair Physics',
    settings: {
      model: 'pendulum' as const,
      mapMode: 'angle-length' as const,
      gravity: 1,
      length: 90,
      frequency: 1.25,
      angleDamping: 0.45,
      lengthDamping: 0.5,
      outputScale: [1, 1] as [number, number],
      localOnly: true,
    },
  },
};

describe('compileStandardCharacterRig', () => {
  it('compiles head, body, deformation, and secondary-motion intent into ordinary semantic operations', () => {
    const plan = compileStandardCharacterRig({
      manifest,
      layerPaths,
      profiles: { hairSwing: hairProfile },
    });

    expect(plan.schemaVersion).toBe(1);
    expect(plan.projectFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.motions.map((motion) => motion.motionId)).toEqual([
      'bodyLean', 'breath', 'hairSwing', 'headX', 'headY',
    ]);
    expect(plan.operations.filter((operation) => operation.type === 'parameter.create')).toHaveLength(5);
    expect(plan.operations).toContainEqual(expect.objectContaining({
      type: 'parameter.bind',
      parameterName: 'headX',
      targetPath: '/Root/Head',
      property: 'transform.t.x',
    }));
    expect(plan.operations).toContainEqual(expect.objectContaining({
      type: 'parameter.bind',
      parameterName: 'breath',
      targetPath: '/Root/Body',
      property: 'transform.s.y',
    }));
    expect(plan.operations).toContainEqual(expect.objectContaining({
      type: 'physics.create',
      parentPath: '/Root',
      name: 'Hair Physics',
      parameterName: 'Hair Swing',
      model: 'pendulum',
    }));

    const breath = plan.motions.find((motion) => motion.motionId === 'breath')!;
    expect(breath.targets[0]!.keypoints).toEqual([
      { at: [-0.04, 0], value: expect.closeTo(0.96, 5) },
      { at: [0.04, 0], value: expect.closeTo(1.04, 5) },
    ]);
    expect(plan.operations).toContainEqual({
      type: 'parameter.create',
      name: 'breath',
      dimensions: 1,
      min: [-0.04, 0],
      max: [0.04, 0],
      defaultValue: [0, 0],
    });
  });

  it('canonicalizes manifest ordering and produces the same plan fingerprint', () => {
    const first = compileStandardCharacterRig({ manifest, layerPaths, profiles: { hairSwing: hairProfile } });
    const second = compileStandardCharacterRig({
      manifest: {
        ...manifest,
        layers: [...manifest.layers].reverse(),
        motions: [...manifest.motions].reverse().map((motion) => ({ ...motion, targets: [...motion.targets].reverse() })),
      },
      layerPaths,
      profiles: { hairSwing: hairProfile },
    });

    expect(second).toEqual(first);
  });

  it('uses declared symmetry only when opposed mirroring is explicitly requested', () => {
    const plan = compileStandardCharacterRig({ manifest, layerPaths, profiles: { hairSwing: hairProfile } });
    const hair = plan.motions.find((motion) => motion.motionId === 'hairSwing')!;
    expect(hair.targets.map((target) => [target.layerId, target.sign])).toEqual([
      ['hairL', 1],
      ['hairR', -1],
    ]);
    expect(hair.targets[0]!.keypoints[0]!.value).toBeCloseTo(-0.2);
    expect(hair.targets[1]!.keypoints[0]!.value).toBeCloseTo(0.2);
  });

  it('fails closed when intent lacks deterministic binding information', () => {
    expect(() => compileStandardCharacterRig({
      manifest: {
        ...manifest,
        motions: [{ id: 'tint', kind: 'tint', axis: 'x', min: 0, max: 1, default: 1, targets: ['face'] }],
      },
      layerPaths,
    })).toThrow(InvalidBindingError);

    expect(() => compileStandardCharacterRig({
      manifest,
      layerPaths: { ...layerPaths, head: '' },
      profiles: { hairSwing: hairProfile },
    })).toThrow(InvalidAuthoringRequestError);

    expect(() => compileStandardCharacterRig({
      manifest,
      layerPaths,
      profiles: { unknown: {} },
    })).toThrow(InvalidAuthoringRequestError);
  });

  it('fails closed when opposed mirroring is requested without a complete declared pair', () => {
    expect(() => compileStandardCharacterRig({
      manifest: {
        ...manifest,
        motions: [{ id: 'hairOnly', kind: 'rotation', axis: 'x', min: -0.2, max: 0.2, default: 0, targets: ['hairL'] }],
      },
      layerPaths,
      profiles: { hairOnly: { mirror: 'opposed' } },
    })).toThrow(InvalidBindingError);
  });
});
