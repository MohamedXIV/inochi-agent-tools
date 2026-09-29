import { createHash } from 'node:crypto';

import { InvalidAuthoringRequestError, InvalidBindingError } from './errors.js';
import { type ParameterBindingProperty } from './inspection.js';
import { validatePhysicsEditOperation, type SimplePhysicsSettings } from './physics-authoring.js';
import { inspectRigProjectManifest, type RigProjectMotionIntent } from './rig-project.js';
import type { PuppetEditOperation } from './visual-authoring.js';

export type StandardRigValueMode = 'direct' | 'scale-delta';
export type StandardRigMirrorMode = 'same' | 'opposed';

export interface StandardRigPhysicsProfile {
  parentPath: string;
  name: string;
  settings: SimplePhysicsSettings;
}

export interface StandardRigMotionProfile {
  parameterName?: string;
  property?: ParameterBindingProperty;
  valueMode?: StandardRigValueMode;
  gain?: number;
  mirror?: StandardRigMirrorMode;
  physics?: StandardRigPhysicsProfile;
}

export interface StandardRigCompileRequest {
  manifest: unknown;
  layerPaths: Readonly<Record<string, string>>;
  profiles?: Readonly<Record<string, StandardRigMotionProfile>>;
}

export interface StandardRigPlannedTarget {
  layerId: string;
  path: string;
  sign: 1 | -1;
  keypoints: Array<{ at: [number, number]; value: number }>;
}

export interface StandardRigPlannedMotion {
  motionId: string;
  kind: RigProjectMotionIntent['kind'];
  axis: RigProjectMotionIntent['axis'];
  parameterName: string;
  property: ParameterBindingProperty;
  valueMode: StandardRigValueMode;
  gain: number;
  mirror: StandardRigMirrorMode;
  targets: StandardRigPlannedTarget[];
  physics?: StandardRigPhysicsProfile;
}

export interface StandardCharacterRigBuildPlan {
  schemaVersion: 1;
  projectFingerprint: string;
  fingerprint: string;
  motions: StandardRigPlannedMotion[];
  operations: PuppetEditOperation[];
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new InvalidAuthoringRequestError(label + ' must not be blank');
  if (trimmed.includes('\0')) throw new InvalidAuthoringRequestError(label + ' must not contain NUL');
  return trimmed;
}

function requireFiniteGain(value: number, motionId: string): number {
  if (!Number.isFinite(value) || value === 0) {
    throw new InvalidBindingError('Motion ' + motionId + ' gain must be finite and non-zero');
  }
  return value;
}

function defaultProperty(motion: RigProjectMotionIntent): ParameterBindingProperty | null {
  switch (motion.kind) {
    case 'transform':
      return motion.axis === 'x' ? 'transform.t.x' : 'transform.t.y';
    case 'rotation':
      return motion.axis === 'x' ? 'transform.r.x' : 'transform.r.y';
    case 'deform':
      return motion.axis === 'x' ? 'transform.s.x' : 'transform.s.y';
    case 'opacity':
      return 'opacity';
    case 'tint':
    case 'physics':
      return null;
  }
}

function defaultValueMode(motion: RigProjectMotionIntent): StandardRigValueMode {
  return motion.kind === 'deform' ? 'scale-delta' : 'direct';
}

function validatePropertyForKind(
  motion: RigProjectMotionIntent,
  property: ParameterBindingProperty,
): void {
  if (motion.kind === 'transform' && property !== 'transform.t.x' && property !== 'transform.t.y') {
    throw new InvalidBindingError('Transform motion ' + motion.id + ' must bind a translation property');
  }
  if (motion.kind === 'rotation' && !property.startsWith('transform.r.')) {
    throw new InvalidBindingError('Rotation motion ' + motion.id + ' must bind a rotation property');
  }
  if (motion.kind === 'deform' && property !== 'transform.s.x' && property !== 'transform.s.y') {
    throw new InvalidBindingError('Deform motion ' + motion.id + ' must bind a scale property');
  }
  if (motion.kind === 'opacity' && property !== 'opacity') {
    throw new InvalidBindingError('Opacity motion ' + motion.id + ' must bind opacity');
  }
  if (motion.kind === 'tint' && !property.startsWith('tint.')) {
    throw new InvalidBindingError('Tint motion ' + motion.id + ' requires an explicit tint channel property');
  }
}

function mappedValue(
  semantic: number,
  sign: 1 | -1,
  gain: number,
  mode: StandardRigValueMode,
): number {
  const scaled = Math.fround(semantic * sign * gain);
  return mode === 'scale-delta' ? Math.fround(1 + scaled) : scaled;
}

function keypointValues(
  motion: RigProjectMotionIntent,
  sign: 1 | -1,
  gain: number,
  mode: StandardRigValueMode,
): Array<{ at: [number, number]; value: number }> {
  const semanticValues = [motion.min, motion.default, motion.max]
    .filter((value, index, all) => all.indexOf(value) === index)
    .sort((a, b) => a - b);
  const points = semanticValues.map((semantic) => ({
    at: [semantic, 0] as [number, number],
    value: mappedValue(semantic, sign, gain, mode),
  }));

  for (const point of points) {
    if (!Number.isFinite(point.value)) {
      throw new InvalidBindingError('Motion ' + motion.id + ' produced a non-finite binding value');
    }
    if (mode === 'scale-delta' && point.value <= 0) {
      throw new InvalidBindingError('Motion ' + motion.id + ' scale-delta output must stay greater than zero');
    }
    if (
      (motion.kind === 'opacity' || motion.kind === 'tint') &&
      (point.value < 0 || point.value > 1)
    ) {
      throw new InvalidBindingError('Motion ' + motion.id + ' unit-interval output must stay between 0 and 1');
    }
  }
  return points;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) out[key] = canonicalValue(input[key]);
  return out;
}

function fingerprintPlan(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalValue(payload)), 'utf8').digest('hex');
}

function mirrorSign(
  motion: RigProjectMotionIntent,
  layerId: string,
  mirror: StandardRigMirrorMode,
  layerById: Map<string, { symmetry?: { counterpart: string; axis: 'x' | 'y' } }>,
): 1 | -1 {
  if (mirror === 'same') return 1;
  const layer = layerById.get(layerId);
  const symmetry = layer?.symmetry;
  if (!symmetry || symmetry.axis !== motion.axis || !motion.targets.includes(symmetry.counterpart)) {
    throw new InvalidBindingError(
      'Motion ' + motion.id + ' opposed mirroring requires reciprocal targeted symmetry on axis ' + motion.axis,
    );
  }
  return layerId.localeCompare(symmetry.counterpart) <= 0 ? 1 : -1;
}

export function compileStandardCharacterRig(
  request: StandardRigCompileRequest,
): StandardCharacterRigBuildPlan {
  const inspected = inspectRigProjectManifest(request.manifest);
  const manifest = inspected.manifest;
  const profiles = request.profiles ?? {};
  const motionIds = new Set(manifest.motions.map((motion) => motion.id));

  for (const profileId of Object.keys(profiles)) {
    if (!motionIds.has(profileId)) {
      throw new InvalidAuthoringRequestError('Unknown motion profile: ' + profileId);
    }
  }

  const layerById = new Map(manifest.layers.map((layer) => [layer.id, layer] as const));
  const targetPathOwners = new Map<string, string>();
  const parameterNames = new Set<string>();
  const motions: StandardRigPlannedMotion[] = [];
  const operations: PuppetEditOperation[] = [];

  for (const motion of manifest.motions) {
    const profile = profiles[motion.id] ?? {};
    const parameterName = requireText(profile.parameterName ?? motion.id, 'Motion ' + motion.id + ' parameter name');
    if (parameterNames.has(parameterName)) {
      throw new InvalidBindingError('Duplicate compiled parameter name: ' + parameterName);
    }
    parameterNames.add(parameterName);

    const property = profile.property ?? defaultProperty(motion);
    if (!property) {
      throw new InvalidBindingError(
        'Motion ' + motion.id + ' kind ' + motion.kind + ' requires an explicit binding property profile',
      );
    }
    validatePropertyForKind(motion, property);

    const valueMode = profile.valueMode ?? defaultValueMode(motion);
    if (motion.kind === 'deform' && valueMode !== 'scale-delta') {
      throw new InvalidBindingError('Deform motion ' + motion.id + ' must use scale-delta value mode');
    }
    const gain = requireFiniteGain(profile.gain ?? 1, motion.id);
    const mirror = profile.mirror ?? 'same';

    const targets: StandardRigPlannedTarget[] = motion.targets.map((layerId) => {
      const rawPath = request.layerPaths[layerId];
      if (rawPath === undefined) {
        throw new InvalidAuthoringRequestError('Missing authored path for motion target layer ' + layerId);
      }
      const targetPath = requireText(rawPath, 'Layer ' + layerId + ' authored path');
      const owner = targetPathOwners.get(targetPath);
      if (owner && owner !== layerId) {
        throw new InvalidAuthoringRequestError(
          'Authored path ' + targetPath + ' is ambiguously assigned to layers ' + owner + ' and ' + layerId,
        );
      }
      targetPathOwners.set(targetPath, layerId);
      const sign = mirrorSign(motion, layerId, mirror, layerById);
      return {
        layerId,
        path: targetPath,
        sign,
        keypoints: keypointValues(motion, sign, gain, valueMode),
      };
    });

    const planned: StandardRigPlannedMotion = {
      motionId: motion.id,
      kind: motion.kind,
      axis: motion.axis,
      parameterName,
      property,
      valueMode,
      gain,
      mirror,
      targets,
      ...(profile.physics === undefined ? {} : { physics: profile.physics }),
    };

    operations.push({
      type: 'parameter.create',
      name: parameterName,
      dimensions: 1,
      min: [motion.min, 0],
      max: [motion.max, 0],
      defaultValue: [motion.default, 0],
    });
    for (const target of targets) {
      operations.push({
        type: 'parameter.bind',
        parameterName,
        targetPath: target.path,
        property,
        keypoints: target.keypoints,
      });
    }

    if (motion.kind === 'physics') {
      const physics = profile.physics;
      if (!physics) {
        throw new InvalidBindingError('Physics motion ' + motion.id + ' requires an explicit physics profile');
      }
      const operation = {
        type: 'physics.create' as const,
        parentPath: requireText(physics.parentPath, 'Physics parent path'),
        name: requireText(physics.name, 'Physics name'),
        parameterName,
        ...physics.settings,
      };
      validatePhysicsEditOperation(operation);
      operations.push(operation);
    } else if (profile.physics !== undefined) {
      throw new InvalidBindingError('Non-physics motion ' + motion.id + ' cannot declare a physics profile');
    }

    motions.push(planned);
  }

  const payload = {
    schemaVersion: 1 as const,
    projectFingerprint: inspected.fingerprint,
    motions,
    operations,
  };
  return { ...payload, fingerprint: fingerprintPlan(payload) };
}
