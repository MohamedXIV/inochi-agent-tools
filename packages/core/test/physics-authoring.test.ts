import { describe, expect, it } from 'vitest';

import { InvalidAuthoringRequestError, InvalidBindingError } from '../src/errors.js';
import { toNativePhysicsEditOperation, validatePhysicsEditOperation } from '../src/physics-authoring.js';

const settings = {
  model: 'spring-pendulum' as const,
  mapMode: 'xy' as const,
  gravity: 1,
  length: 100,
  frequency: 1,
  angleDamping: 0.5,
  lengthDamping: 0.5,
  outputScale: [1, 1] as [number, number],
  localOnly: false,
};

describe('semantic physics authoring validation', () => {
  it('accepts the pinned SimplePhysics create contract without native identities', () => {
    expect(() => validatePhysicsEditOperation({ type: 'physics.create', parentPath: '/Root/Head', name: 'Hair Physics', parameterName: 'HairSwing', ...settings })).not.toThrow();
  });

  it('accepts bounded partial updates and removal by semantic path', () => {
    expect(() => validatePhysicsEditOperation({ type: 'physics.update', path: '/Root/Head/Hair Physics', settings: { angleDamping: 0.4, outputScale: [0.8, 1.2] } })).not.toThrow();
    expect(() => validatePhysicsEditOperation({ type: 'physics.remove', path: '/Root/Head/Hair Physics' })).not.toThrow();
  });

  it('normalizes public names to the pinned upstream enum spellings', () => {
    expect(toNativePhysicsEditOperation({ type: 'physics.create', parentPath: '/Root/Head', name: 'Hair Physics', parameterName: 'HairSwing', ...settings })).toMatchObject({
      type: 'physics.create', model: 'spring_pendulum', mapMode: 'xy', parentPath: '/Root/Head', name: 'Hair Physics', parameterName: 'HairSwing',
    });
    expect(toNativePhysicsEditOperation({ type: 'physics.update', path: '/Root/Head/Hair Physics', settings: { mapMode: 'length-angle' } })).toEqual({
      type: 'physics.update', path: '/Root/Head/Hair Physics', settings: { mapMode: 'length_angle' },
    });
  });

  it('accepts every public map mode while keeping native spelling private', () => {
    for (const [publicMode, nativeMode] of [['angle-length', 'angle_length'], ['xy', 'xy'], ['length-angle', 'length_angle'], ['yx', 'yx']] as const) {
      expect(toNativePhysicsEditOperation({ type: 'physics.update', path: '/Root/P', settings: { mapMode: publicMode } })).toEqual({
        type: 'physics.update', path: '/Root/P', settings: { mapMode: nativeMode },
      });
    }
  });

  it('rejects empty semantic identities and no-op updates before native work', () => {
    expect(() => validatePhysicsEditOperation({ type: 'physics.create', parentPath: '/Root', name: ' ', parameterName: 'HairSwing', ...settings })).toThrow(InvalidAuthoringRequestError);
    expect(() => validatePhysicsEditOperation({ type: 'physics.update', path: '/Root/Hair Physics', settings: {} })).toThrow(InvalidAuthoringRequestError);
  });

  it('rejects unsupported models/map modes and non-physical numeric settings', () => {
    expect(() => validatePhysicsEditOperation({ type: 'physics.create', parentPath: '/Root', name: 'P', parameterName: 'Swing', ...settings, model: 'verlet' as never })).toThrow(InvalidBindingError);
    expect(() => validatePhysicsEditOperation({ type: 'physics.create', parentPath: '/Root', name: 'P', parameterName: 'Swing', ...settings, mapMode: 'polar' as never })).toThrow(InvalidBindingError);
    for (const bad of [{ length: 0 }, { frequency: 0 }, { angleDamping: -0.1 }, { lengthDamping: -0.1 }, { gravity: Number.NaN }, { outputScale: [1, Number.POSITIVE_INFINITY] as [number, number] }]) {
      expect(() => validatePhysicsEditOperation({ type: 'physics.update', path: '/Root/P', settings: bad })).toThrow(InvalidBindingError);
    }
  });
});
