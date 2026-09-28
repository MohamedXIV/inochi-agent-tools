import { createHash } from 'node:crypto';

export const RIG_PROJECT_SCHEMA_VERSION = 'inochi-agent-tools/rig-project/v1' as const;

export type RigProjectAxis = 'x' | 'y';
export type RigProjectMotionKind = 'transform' | 'deform' | 'rotation' | 'opacity' | 'tint' | 'physics';

export interface RigProjectPoint {
  x: number;
  y: number;
}

export interface RigProjectCoordinates {
  unit: 'px';
  origin: 'center' | 'top-left';
  yAxis: 'down' | 'up';
}

export interface RigProjectLayerSymmetry {
  counterpart: string;
  axis: RigProjectAxis;
}

export interface RigProjectLayer {
  id: string;
  source: string;
  role: string;
  parentId?: string;
  pivot?: RigProjectPoint;
  anchors?: Record<string, RigProjectPoint>;
  mask?: string;
  symmetry?: RigProjectLayerSymmetry;
}

export interface RigProjectMotionIntent {
  id: string;
  kind: RigProjectMotionKind;
  axis: RigProjectAxis;
  min: number;
  max: number;
  default: number;
  targets: string[];
}

export interface RigProjectManifest {
  schemaVersion: typeof RIG_PROJECT_SCHEMA_VERSION;
  name: string;
  coordinates?: Partial<RigProjectCoordinates>;
  layers: RigProjectLayer[];
  motions?: RigProjectMotionIntent[];
}

export interface NormalizedRigProjectManifest {
  schemaVersion: typeof RIG_PROJECT_SCHEMA_VERSION;
  name: string;
  coordinates: RigProjectCoordinates;
  layers: RigProjectLayer[];
  motions: RigProjectMotionIntent[];
}

export type RigProjectDiagnosticCode =
  | 'MISSING_FIELD'
  | 'INVALID_TYPE'
  | 'INVALID_VALUE'
  | 'UNKNOWN_FIELD'
  | 'DUPLICATE_ID'
  | 'UNRESOLVED_REFERENCE'
  | 'AMBIGUOUS_REFERENCE'
  | 'UNSAFE_PATH';

export interface RigProjectDiagnostic {
  code: RigProjectDiagnosticCode;
  path: string;
  message: string;
}

export interface RigProjectInspection {
  schemaVersion: 1;
  manifest: NormalizedRigProjectManifest;
  fingerprint: string;
}

export class InvalidRigProjectError extends Error {
  readonly code = 'INVALID_RIG_PROJECT' as const;
  readonly diagnostics: readonly RigProjectDiagnostic[];
  readonly details: { diagnostics: readonly RigProjectDiagnostic[] };

  constructor(diagnostics: readonly RigProjectDiagnostic[]) {
    super(diagnostics[0]?.message ?? 'Invalid rig project manifest');
    this.name = 'InvalidRigProjectError';
    this.diagnostics = [...diagnostics];
    this.details = { diagnostics: this.diagnostics };
  }
}

type UnknownRecord = Record<string, unknown>;

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MOTION_KINDS = ['transform', 'deform', 'rotation', 'opacity', 'tint', 'physics'] as const;
const AXES = ['x', 'y'] as const;
const ORIGINS = ['center', 'top-left'] as const;
const Y_AXES = ['down', 'up'] as const;

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function diagnostic(
  diagnostics: RigProjectDiagnostic[],
  code: RigProjectDiagnosticCode,
  path: string,
  message: string,
): void {
  diagnostics.push({ code, path, message });
}

function rejectUnknownFields(
  input: UnknownRecord,
  allowed: readonly string[],
  path: string,
  diagnostics: RigProjectDiagnostic[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(input)) {
    if (!allowedSet.has(key)) {
      diagnostic(diagnostics, 'UNKNOWN_FIELD', path + '.' + key, 'unknown rig-project field "' + key + '"');
    }
  }
}

function requiredString(
  input: UnknownRecord,
  key: string,
  path: string,
  diagnostics: RigProjectDiagnostic[],
): string | undefined {
  const value = input[key];
  const fieldPath = path + '.' + key;
  if (value === undefined) {
    diagnostic(diagnostics, 'MISSING_FIELD', fieldPath, 'missing required string field');
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    diagnostic(diagnostics, 'INVALID_TYPE', fieldPath, 'expected a non-empty string');
    return undefined;
  }
  return value.trim();
}

function optionalString(
  input: UnknownRecord,
  key: string,
  path: string,
  diagnostics: RigProjectDiagnostic[],
): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    diagnostic(diagnostics, 'INVALID_TYPE', path + '.' + key, 'expected a non-empty string');
    return undefined;
  }
  return value.trim();
}

function stableId(
  value: string | undefined,
  path: string,
  diagnostics: RigProjectDiagnostic[],
): string | undefined {
  if (value === undefined) return undefined;
  if (!STABLE_ID.test(value)) {
    diagnostic(diagnostics, 'INVALID_VALUE', path, 'semantic IDs must match ' + STABLE_ID.source);
    return undefined;
  }
  return value;
}

function requiredFiniteNumber(
  input: UnknownRecord,
  key: string,
  path: string,
  diagnostics: RigProjectDiagnostic[],
): number | undefined {
  const value = input[key];
  const fieldPath = path + '.' + key;
  if (value === undefined) {
    diagnostic(diagnostics, 'MISSING_FIELD', fieldPath, 'missing required numeric field');
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    diagnostic(diagnostics, 'INVALID_TYPE', fieldPath, 'expected a finite number');
    return undefined;
  }
  return value;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  diagnostics: RigProjectDiagnostic[],
  required = true,
): T | undefined {
  if (value === undefined) {
    if (required) diagnostic(diagnostics, 'MISSING_FIELD', path, 'missing required field');
    return undefined;
  }
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    diagnostic(diagnostics, 'INVALID_VALUE', path, 'expected one of: ' + allowed.join(', '));
    return undefined;
  }
  return value as T;
}

function relativeAssetPath(
  value: string | undefined,
  path: string,
  diagnostics: RigProjectDiagnostic[],
): string | undefined {
  if (value === undefined) return undefined;
  const replaced = value.replace(/\\/g, '/');
  const segments = replaced.split('/');
  if (
    replaced.startsWith('/') ||
    /^[A-Za-z]:\//.test(replaced) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(replaced) ||
    segments.includes('..')
  ) {
    diagnostic(diagnostics, 'UNSAFE_PATH', path, 'asset path must be project-relative and cannot traverse outside the project');
    return undefined;
  }
  const normalized = segments.filter((segment) => segment.length > 0 && segment !== '.').join('/');
  if (normalized.length === 0) {
    diagnostic(diagnostics, 'INVALID_VALUE', path, 'asset path must identify a project-relative file');
    return undefined;
  }
  return normalized;
}

function point(
  value: unknown,
  path: string,
  diagnostics: RigProjectDiagnostic[],
): RigProjectPoint | undefined {
  const input = record(value);
  if (!input) {
    diagnostic(diagnostics, 'INVALID_TYPE', path, 'expected a point object with finite x and y');
    return undefined;
  }
  rejectUnknownFields(input, ['x', 'y'], path, diagnostics);
  const x = requiredFiniteNumber(input, 'x', path, diagnostics);
  const y = requiredFiniteNumber(input, 'y', path, diagnostics);
  if (x === undefined || y === undefined) return undefined;
  return { x, y };
}

function anchors(
  value: unknown,
  path: string,
  diagnostics: RigProjectDiagnostic[],
): Record<string, RigProjectPoint> | undefined {
  if (value === undefined) return undefined;
  const input = record(value);
  if (!input) {
    diagnostic(diagnostics, 'INVALID_TYPE', path, 'anchors must be an object keyed by stable semantic anchor ID');
    return undefined;
  }
  const result: Record<string, RigProjectPoint> = {};
  const normalizedNames = new Set<string>();
  for (const rawName of Object.keys(input).sort()) {
    const name = rawName.trim();
    if (!STABLE_ID.test(name)) {
      diagnostic(diagnostics, 'INVALID_VALUE', path + '.' + rawName, 'anchor IDs must match ' + STABLE_ID.source);
      continue;
    }
    if (normalizedNames.has(name)) {
      diagnostic(diagnostics, 'DUPLICATE_ID', path + '.' + rawName, 'duplicate normalized anchor ID "' + name + '"');
      continue;
    }
    normalizedNames.add(name);
    const parsed = point(input[rawName], path + '.' + rawName, diagnostics);
    if (parsed) result[name] = parsed;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

function coordinates(
  value: unknown,
  diagnostics: RigProjectDiagnostic[],
): RigProjectCoordinates {
  const defaults: RigProjectCoordinates = { unit: 'px', origin: 'center', yAxis: 'down' };
  if (value === undefined) return defaults;
  const input = record(value);
  if (!input) {
    diagnostic(diagnostics, 'INVALID_TYPE', '$.coordinates', 'coordinates must be an object');
    return defaults;
  }
  rejectUnknownFields(input, ['unit', 'origin', 'yAxis'], '$.coordinates', diagnostics);
  let unit: 'px' = 'px';
  if (input.unit !== undefined) {
    if (input.unit !== 'px') diagnostic(diagnostics, 'INVALID_VALUE', '$.coordinates.unit', 'v1 coordinate unit must be "px"');
    else unit = 'px';
  }
  const origin = enumValue(input.origin, ORIGINS, '$.coordinates.origin', diagnostics, false) ?? defaults.origin;
  const yAxis = enumValue(input.yAxis, Y_AXES, '$.coordinates.yAxis', diagnostics, false) ?? defaults.yAxis;
  return { unit, origin, yAxis };
}

function parseLayer(
  value: unknown,
  index: number,
  diagnostics: RigProjectDiagnostic[],
): RigProjectLayer | null {
  const path = '$.layers[' + index + ']';
  const input = record(value);
  if (!input) {
    diagnostic(diagnostics, 'INVALID_TYPE', path, 'layer declaration must be an object');
    return null;
  }
  rejectUnknownFields(input, ['id', 'source', 'role', 'parentId', 'pivot', 'anchors', 'mask', 'symmetry'], path, diagnostics);

  const id = stableId(requiredString(input, 'id', path, diagnostics), path + '.id', diagnostics);
  const sourceRaw = requiredString(input, 'source', path, diagnostics);
  const source = relativeAssetPath(sourceRaw, path + '.source', diagnostics);
  const role = requiredString(input, 'role', path, diagnostics);
  const parentId = stableId(optionalString(input, 'parentId', path, diagnostics), path + '.parentId', diagnostics);
  const pivot = input.pivot === undefined ? undefined : point(input.pivot, path + '.pivot', diagnostics);
  const parsedAnchors = anchors(input.anchors, path + '.anchors', diagnostics);
  const maskRaw = optionalString(input, 'mask', path, diagnostics);
  const mask = relativeAssetPath(maskRaw, path + '.mask', diagnostics);

  let symmetry: RigProjectLayerSymmetry | undefined;
  if (input.symmetry !== undefined) {
    const symmetryInput = record(input.symmetry);
    if (!symmetryInput) {
      diagnostic(diagnostics, 'INVALID_TYPE', path + '.symmetry', 'symmetry must be an object');
    } else {
      rejectUnknownFields(symmetryInput, ['counterpart', 'axis'], path + '.symmetry', diagnostics);
      const counterpart = stableId(requiredString(symmetryInput, 'counterpart', path + '.symmetry', diagnostics), path + '.symmetry.counterpart', diagnostics);
      const axis = enumValue(symmetryInput.axis, AXES, path + '.symmetry.axis', diagnostics);
      if (counterpart !== undefined && axis !== undefined) symmetry = { counterpart, axis };
    }
  }

  if (id === undefined || source === undefined || role === undefined) return null;
  return {
    id,
    source,
    role,
    ...(parentId === undefined ? {} : { parentId }),
    ...(pivot === undefined ? {} : { pivot }),
    ...(parsedAnchors === undefined ? {} : { anchors: parsedAnchors }),
    ...(mask === undefined ? {} : { mask }),
    ...(symmetry === undefined ? {} : { symmetry }),
  };
}

function parseTargets(
  value: unknown,
  path: string,
  diagnostics: RigProjectDiagnostic[],
): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    diagnostic(diagnostics, 'INVALID_TYPE', path, 'targets must be a non-empty array of semantic layer IDs');
    return undefined;
  }
  const targets: string[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      diagnostic(diagnostics, 'INVALID_TYPE', path + '[' + index + ']', 'target must be a non-empty semantic layer ID');
      return;
    }
    const id = stableId(entry.trim(), path + '[' + index + ']', diagnostics);
    if (id === undefined) return;
    if (seen.has(id)) {
      diagnostic(diagnostics, 'DUPLICATE_ID', path + '[' + index + ']', 'duplicate target semantic ID "' + id + '"');
      return;
    }
    seen.add(id);
    targets.push(id);
  });
  return targets.sort((a, b) => a.localeCompare(b));
}

function parseMotion(
  value: unknown,
  index: number,
  diagnostics: RigProjectDiagnostic[],
): RigProjectMotionIntent | null {
  const path = '$.motions[' + index + ']';
  const input = record(value);
  if (!input) {
    diagnostic(diagnostics, 'INVALID_TYPE', path, 'motion declaration must be an object');
    return null;
  }
  rejectUnknownFields(input, ['id', 'kind', 'axis', 'min', 'max', 'default', 'targets'], path, diagnostics);

  const id = stableId(requiredString(input, 'id', path, diagnostics), path + '.id', diagnostics);
  const kind = enumValue(input.kind, MOTION_KINDS, path + '.kind', diagnostics);
  const axis = enumValue(input.axis, AXES, path + '.axis', diagnostics);
  const min = requiredFiniteNumber(input, 'min', path, diagnostics);
  const max = requiredFiniteNumber(input, 'max', path, diagnostics);
  const defaultValue = requiredFiniteNumber(input, 'default', path, diagnostics);
  const targets = parseTargets(input.targets, path + '.targets', diagnostics);

  if (min !== undefined && max !== undefined && min >= max) {
    diagnostic(diagnostics, 'INVALID_VALUE', path + '.min', 'motion range must satisfy min < max');
  }
  if (min !== undefined && max !== undefined && defaultValue !== undefined && (defaultValue < min || defaultValue > max)) {
    diagnostic(diagnostics, 'INVALID_VALUE', path + '.default', 'motion default must lie inside the declared range');
  }

  if (
    id === undefined ||
    kind === undefined ||
    axis === undefined ||
    min === undefined ||
    max === undefined ||
    defaultValue === undefined ||
    targets === undefined
  ) return null;

  return { id, kind, axis, min, max, default: defaultValue, targets };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  const object = record(value);
  if (!object) return value;
  const canonical: Record<string, unknown> = {};
  for (const key of Object.keys(object).sort()) canonical[key] = canonicalValue(object[key]);
  return canonical;
}

function canonicalJson(manifest: NormalizedRigProjectManifest): string {
  return JSON.stringify(canonicalValue(manifest));
}

export function normalizeRigProjectManifest(input: unknown): NormalizedRigProjectManifest {
  const diagnostics: RigProjectDiagnostic[] = [];
  const root = record(input);
  if (!root) {
    throw new InvalidRigProjectError([{ code: 'INVALID_TYPE', path: '$', message: 'rig project manifest must be an object' }]);
  }

  rejectUnknownFields(root, ['schemaVersion', 'name', 'coordinates', 'layers', 'motions'], '$', diagnostics);

  if (root.schemaVersion === undefined) {
    diagnostic(diagnostics, 'MISSING_FIELD', '$.schemaVersion', 'missing rig-project schemaVersion');
  } else if (root.schemaVersion !== RIG_PROJECT_SCHEMA_VERSION) {
    diagnostic(diagnostics, 'INVALID_VALUE', '$.schemaVersion', 'expected schemaVersion "' + RIG_PROJECT_SCHEMA_VERSION + '"');
  }

  const name = requiredString(root, 'name', '$', diagnostics);
  const normalizedCoordinates = coordinates(root.coordinates, diagnostics);

  const layers: RigProjectLayer[] = [];
  const layerIds = new Set<string>();
  if (!Array.isArray(root.layers) || root.layers.length === 0) {
    diagnostic(diagnostics, 'INVALID_TYPE', '$.layers', 'layers must be a non-empty array');
  } else {
    root.layers.forEach((value, index) => {
      const layer = parseLayer(value, index, diagnostics);
      if (!layer) return;
      if (layerIds.has(layer.id)) {
        diagnostic(diagnostics, 'DUPLICATE_ID', '$.layers[' + index + '].id', 'duplicate layer semantic ID "' + layer.id + '"');
      }
      layerIds.add(layer.id);
      layers.push(layer);
    });
  }

  const motions: RigProjectMotionIntent[] = [];
  const motionIds = new Set<string>();
  if (root.motions !== undefined) {
    if (!Array.isArray(root.motions)) {
      diagnostic(diagnostics, 'INVALID_TYPE', '$.motions', 'motions must be an array when provided');
    } else {
      root.motions.forEach((value, index) => {
        const motion = parseMotion(value, index, diagnostics);
        if (!motion) return;
        if (motionIds.has(motion.id)) {
          diagnostic(diagnostics, 'DUPLICATE_ID', '$.motions[' + index + '].id', 'duplicate motion semantic ID "' + motion.id + '"');
        }
        motionIds.add(motion.id);
        motions.push(motion);
      });
    }
  }

  const layerById = new Map(layers.map((layer) => [layer.id, layer] as const));
  for (const layer of layers) {
    const path = '$.layers[id=' + layer.id + ']';
    if (layer.parentId !== undefined) {
      if (layer.parentId === layer.id) {
        diagnostic(diagnostics, 'AMBIGUOUS_REFERENCE', path + '.parentId', 'a layer cannot parent itself');
      } else if (!layerById.has(layer.parentId)) {
        diagnostic(diagnostics, 'UNRESOLVED_REFERENCE', path + '.parentId', 'unknown parent layer "' + layer.parentId + '"');
      }
    }
    if (layer.symmetry !== undefined) {
      if (layer.symmetry.counterpart === layer.id) {
        diagnostic(diagnostics, 'AMBIGUOUS_REFERENCE', path + '.symmetry.counterpart', 'a layer cannot be its own symmetry counterpart');
      } else {
        const counterpart = layerById.get(layer.symmetry.counterpart);
        if (!counterpart) {
          diagnostic(diagnostics, 'UNRESOLVED_REFERENCE', path + '.symmetry.counterpart', 'unknown symmetry counterpart "' + layer.symmetry.counterpart + '"');
        } else if (
          counterpart.symmetry !== undefined &&
          (counterpart.symmetry.counterpart !== layer.id || counterpart.symmetry.axis !== layer.symmetry.axis)
        ) {
          diagnostic(diagnostics, 'AMBIGUOUS_REFERENCE', path + '.symmetry', 'reciprocal symmetry declarations disagree');
        }
      }
    }
  }

  for (const motion of motions) {
    for (const target of motion.targets) {
      if (!layerById.has(target)) {
        diagnostic(diagnostics, 'UNRESOLVED_REFERENCE', '$.motions[id=' + motion.id + '].targets', 'unknown motion target "' + target + '"');
      }
    }
  }

  if (diagnostics.length > 0) throw new InvalidRigProjectError(diagnostics);

  return {
    schemaVersion: RIG_PROJECT_SCHEMA_VERSION,
    name: name as string,
    coordinates: normalizedCoordinates,
    layers: layers.sort((a, b) => a.id.localeCompare(b.id)),
    motions: motions.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function canonicalRigProjectJson(input: unknown): string {
  return canonicalJson(normalizeRigProjectManifest(input));
}

export function fingerprintRigProject(input: unknown): string {
  return createHash('sha256').update(canonicalRigProjectJson(input), 'utf8').digest('hex');
}

export function inspectRigProjectManifest(input: unknown): RigProjectInspection {
  const manifest = normalizeRigProjectManifest(input);
  const fingerprint = createHash('sha256').update(canonicalJson(manifest), 'utf8').digest('hex');
  return { schemaVersion: 1, manifest, fingerprint };
}
