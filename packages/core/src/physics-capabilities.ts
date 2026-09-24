export type PhysicsBackend = 'simple-physics-compat';
export type PhysicsModel = 'pendulum' | 'spring-pendulum';
export type PhysicsMapMode = 'angle-length' | 'xy' | 'length-angle' | 'yx';

export interface PhysicsCapability {
  backend: PhysicsBackend;
  status: 'compatibility';
  models: readonly PhysicsModel[];
  mapModes: readonly PhysicsMapMode[];
  supportsRuntimeEvaluation: true;
  supportsSaveReopen: true;
  note: string;
}

/**
 * Physics support exposed by the pinned Inochi2D runtime.
 *
 * SimplePhysics is intentionally advertised as a compatibility backend rather
 * than a generic/future physics abstraction: upstream marks it deprecated.
 * Keeping that fact in capability discovery prevents agents from silently
 * treating a legacy node as the canonical model for newer Inochi2D physics.
 */
export function physicsCapabilities(): readonly PhysicsCapability[] {
  return [
    {
      backend: 'simple-physics-compat',
      status: 'compatibility',
      models: ['pendulum', 'spring-pendulum'],
      mapModes: ['angle-length', 'xy', 'length-angle', 'yx'],
      supportsRuntimeEvaluation: true,
      supportsSaveReopen: true,
      note: 'Pinned Inochi2D SimplePhysics support; deprecated upstream and exposed only as a compatibility capability.',
    },
  ] as const;
}
