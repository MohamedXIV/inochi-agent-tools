import { InvalidAuthoringRequestError, InvalidBindingError } from './errors.js';
import type { NumericPair } from './inspection.js';

export type SimplePhysicsModel = 'pendulum' | 'spring-pendulum';
export type SimplePhysicsMapMode = 'angle-length' | 'xy' | 'length-angle' | 'yx';

export interface SimplePhysicsSettings {
  model: SimplePhysicsModel;
  mapMode: SimplePhysicsMapMode;
  gravity: number;
  length: number;
  frequency: number;
  angleDamping: number;
  lengthDamping: number;
  outputScale: NumericPair;
  localOnly: boolean;
}

export interface PhysicsCreateOperation extends SimplePhysicsSettings {
  type: 'physics.create';
  parentPath: string;
  name: string;
  parameterName: string;
}

export interface PhysicsUpdateOperation {
  type: 'physics.update';
  path: string;
  parameterName?: string;
  settings: Partial<SimplePhysicsSettings>;
}

export interface PhysicsRemoveOperation {
  type: 'physics.remove';
  path: string;
}

export type PhysicsEditOperation = PhysicsCreateOperation | PhysicsUpdateOperation | PhysicsRemoveOperation;

const MODELS = new Set<SimplePhysicsModel>(['pendulum', 'spring-pendulum']);
const MAP_MODES = new Set<SimplePhysicsMapMode>(['angle-length', 'xy', 'length-angle', 'yx']);

function requireText(value: string, label: string): void {
  if (!value.trim()) throw new InvalidAuthoringRequestError(`${label} must not be blank`);
  if (value.includes('\0')) throw new InvalidAuthoringRequestError(`${label} must not contain NUL`);
}

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new InvalidBindingError(`${label} must be finite`);
}

function validateSettings(settings: Partial<SimplePhysicsSettings>, requireAll: boolean): void {
  if (requireAll && settings.model === undefined) throw new InvalidBindingError('Physics model is required');
  if (settings.model !== undefined && !MODELS.has(settings.model)) throw new InvalidBindingError(`Unsupported physics model: ${String(settings.model)}`);
  if (requireAll && settings.mapMode === undefined) throw new InvalidBindingError('Physics map mode is required');
  if (settings.mapMode !== undefined && !MAP_MODES.has(settings.mapMode)) throw new InvalidBindingError(`Unsupported physics map mode: ${String(settings.mapMode)}`);

  for (const [key, label] of [
    ['gravity', 'Physics gravity'], ['length', 'Physics length'], ['frequency', 'Physics frequency'],
    ['angleDamping', 'Physics angle damping'], ['lengthDamping', 'Physics length damping'],
  ] as const) {
    const value = settings[key];
    if (requireAll && value === undefined) throw new InvalidBindingError(`${label} is required`);
    if (value !== undefined) requireFinite(value, label);
  }
  if (settings.length !== undefined && settings.length <= 0) throw new InvalidBindingError('Physics length must be greater than zero');
  if (settings.frequency !== undefined && settings.frequency <= 0) throw new InvalidBindingError('Physics frequency must be greater than zero');
  if (settings.angleDamping !== undefined && settings.angleDamping < 0) throw new InvalidBindingError('Physics angle damping must not be negative');
  if (settings.lengthDamping !== undefined && settings.lengthDamping < 0) throw new InvalidBindingError('Physics length damping must not be negative');
  if (requireAll && settings.outputScale === undefined) throw new InvalidBindingError('Physics output scale is required');
  if (settings.outputScale !== undefined && (!Array.isArray(settings.outputScale) || settings.outputScale.length !== 2 || !settings.outputScale.every(Number.isFinite))) {
    throw new InvalidBindingError('Physics output scale must be a finite numeric pair');
  }
  if (requireAll && settings.localOnly === undefined) throw new InvalidBindingError('Physics local-only flag is required');
}

export function validatePhysicsEditOperation(operation: PhysicsEditOperation): void {
  switch (operation.type) {
    case 'physics.create':
      requireText(operation.parentPath, 'Physics parent path');
      requireText(operation.name, 'Physics name');
      requireText(operation.parameterName, 'Physics target parameter');
      validateSettings(operation, true);
      return;
    case 'physics.update':
      requireText(operation.path, 'Physics path');
      if (operation.parameterName !== undefined) requireText(operation.parameterName, 'Physics target parameter');
      if (Object.keys(operation.settings).length === 0 && operation.parameterName === undefined) throw new InvalidAuthoringRequestError('Physics update must change a setting or target parameter');
      validateSettings(operation.settings, false);
      return;
    case 'physics.remove':
      requireText(operation.path, 'Physics path');
      return;
  }
}

/** Convert public semantic names to the exact pinned SimplePhysics enum spellings. */
export function toNativePhysicsEditOperation(operation: PhysicsEditOperation): Record<string, unknown> {
  validatePhysicsEditOperation(operation);
  if (operation.type === 'physics.remove') return { type: operation.type, path: operation.path };
  const settings = operation.type === 'physics.create' ? operation : operation.settings;
  const nativeSettings: Record<string, unknown> = {};
  if (settings.model !== undefined) nativeSettings.model = settings.model === 'spring-pendulum' ? 'spring_pendulum' : settings.model;
  if (settings.mapMode !== undefined) nativeSettings.mapMode = settings.mapMode.replaceAll('-', '_');
  for (const key of ['gravity', 'length', 'frequency', 'angleDamping', 'lengthDamping', 'outputScale', 'localOnly'] as const) {
    const value = settings[key];
    if (value !== undefined) nativeSettings[key] = value;
  }
  if (operation.type === 'physics.create') {
    return { type: operation.type, parentPath: operation.parentPath, name: operation.name, parameterName: operation.parameterName, ...nativeSettings };
  }
  return { type: operation.type, path: operation.path, ...(operation.parameterName === undefined ? {} : { parameterName: operation.parameterName }), settings: nativeSettings };
}
