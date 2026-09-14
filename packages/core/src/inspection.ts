export type NodeKind = 'node' | 'part' | 'other';
export type NumericPair = [number, number];
export type PuppetTextureFormat = 'rgba8' | 'r8' | 'unknown';
export type PuppetTextureUsage = 'albedo' | 'emissive' | 'bumpmap';

export interface PuppetInspectionNodeTexture {
  usage: PuppetTextureUsage;
  ref: string;
}

export interface PuppetInspectionNode {
  path: string;
  name: string;
  kind: NodeKind;
  childCount: number;
  textures: PuppetInspectionNodeTexture[];
}

export interface PuppetInspectionTexture {
  ref: string;
  width: number;
  height: number;
  format: PuppetTextureFormat;
}

export interface PuppetInspectionParameter {
  name: string;
  dimensions: 1 | 2;
  min: NumericPair;
  max: NumericPair;
  defaultValue: NumericPair;
  value: NumericPair;
}

export interface PuppetInspection {
  schemaVersion: 1;
  metadata: {
    name: string;
    inochiVersion: string;
    rigger: string;
    artist: string;
  };
  nodes: PuppetInspectionNode[];
  parameters: PuppetInspectionParameter[];
  textures: PuppetInspectionTexture[];
  textureCount: number;
  summary: {
    nodeCount: number;
    partCount: number;
    parameterCount: number;
    textureCount: number;
  };
}

type UnknownRecord = Record<string, unknown>;

const SHA256_REF = /^sha256:[0-9a-f]{64}$/;

function fail(path: string, message: string): never {
  throw new Error(`Invalid puppet inspection at ${path}: ${message}`);
}

function record(value: unknown, path: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'expected object');
  }
  return value as UnknownRecord;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'expected string');
  return value;
}

function sha256Ref(value: unknown, path: string): string {
  const parsed = stringValue(value, path);
  if (!SHA256_REF.test(parsed)) fail(path, 'expected sha256 content reference');
  return parsed;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, 'expected finite number');
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  const parsed = finiteNumber(value, path);
  if (!Number.isInteger(parsed) || parsed < 0) {
    fail(path, 'expected non-negative integer');
  }
  return parsed;
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = nonNegativeInteger(value, path);
  if (parsed === 0) fail(path, 'expected positive integer');
  return parsed;
}

function numericPair(value: unknown, path: string): NumericPair {
  if (!Array.isArray(value) || value.length !== 2) {
    fail(path, 'expected two-number array');
  }
  return [
    finiteNumber(value[0], `${path}[0]`),
    finiteNumber(value[1], `${path}[1]`),
  ];
}

function nodeKind(value: unknown, path: string): NodeKind {
  if (value !== 'node' && value !== 'part' && value !== 'other') {
    fail(path, 'expected node, part, or other');
  }
  return value;
}

function textureUsage(value: unknown, path: string): PuppetTextureUsage {
  if (value !== 'albedo' && value !== 'emissive' && value !== 'bumpmap') {
    fail(path, 'expected albedo, emissive, or bumpmap');
  }
  return value;
}

function textureFormat(value: unknown, path: string): PuppetTextureFormat {
  if (value !== 'rgba8' && value !== 'r8' && value !== 'unknown') {
    fail(path, 'expected rgba8, r8, or unknown');
  }
  return value;
}

function parseNodeTexture(value: unknown, nodeIndex: number, index: number): PuppetInspectionNodeTexture {
  const path = `nodes[${nodeIndex}].textures[${index}]`;
  const input = record(value, path);
  return {
    usage: textureUsage(input.usage, `${path}.usage`),
    ref: sha256Ref(input.ref, `${path}.ref`),
  };
}

function parseNode(value: unknown, index: number): PuppetInspectionNode {
  const path = `nodes[${index}]`;
  const input = record(value, path);
  const textures = input.textures === undefined ? [] : input.textures;
  if (!Array.isArray(textures)) fail(`${path}.textures`, 'expected array');
  return {
    path: stringValue(input.path, `${path}.path`),
    name: stringValue(input.name, `${path}.name`),
    kind: nodeKind(input.kind, `${path}.kind`),
    childCount: nonNegativeInteger(input.childCount, `${path}.childCount`),
    textures: textures.map((texture, textureIndex) => parseNodeTexture(texture, index, textureIndex)),
  };
}

function parseTexture(value: unknown, index: number): PuppetInspectionTexture {
  const path = `textures[${index}]`;
  const input = record(value, path);
  return {
    ref: sha256Ref(input.ref, `${path}.ref`),
    width: positiveInteger(input.width, `${path}.width`),
    height: positiveInteger(input.height, `${path}.height`),
    format: textureFormat(input.format, `${path}.format`),
  };
}

function parseParameter(value: unknown, index: number): PuppetInspectionParameter {
  const path = `parameters[${index}]`;
  const input = record(value, path);
  const dimensions = input.dimensions;
  if (dimensions !== 1 && dimensions !== 2) {
    fail(`${path}.dimensions`, 'expected 1 or 2');
  }

  return {
    name: stringValue(input.name, `${path}.name`),
    dimensions,
    min: numericPair(input.min, `${path}.min`),
    max: numericPair(input.max, `${path}.max`),
    defaultValue: numericPair(input.defaultValue, `${path}.defaultValue`),
    value: numericPair(input.value, `${path}.value`),
  };
}

export function parsePuppetInspection(input: unknown): PuppetInspection {
  const root = record(input, '$');
  if (root.schemaVersion !== 1) {
    fail('schemaVersion', 'expected supported schema version 1');
  }

  const metadata = record(root.metadata, 'metadata');
  if (!Array.isArray(root.nodes)) fail('nodes', 'expected array');
  if (!Array.isArray(root.parameters)) fail('parameters', 'expected array');
  const textures = root.textures === undefined ? [] : root.textures;
  if (!Array.isArray(textures)) fail('textures', 'expected array');
  const summary = record(root.summary, 'summary');

  return {
    schemaVersion: 1,
    metadata: {
      name: stringValue(metadata.name, 'metadata.name'),
      inochiVersion: stringValue(metadata.inochiVersion, 'metadata.inochiVersion'),
      rigger: stringValue(metadata.rigger, 'metadata.rigger'),
      artist: stringValue(metadata.artist, 'metadata.artist'),
    },
    nodes: root.nodes.map(parseNode),
    parameters: root.parameters.map(parseParameter),
    textures: textures.map(parseTexture),
    textureCount: nonNegativeInteger(root.textureCount, 'textureCount'),
    summary: {
      nodeCount: nonNegativeInteger(summary.nodeCount, 'summary.nodeCount'),
      partCount: nonNegativeInteger(summary.partCount, 'summary.partCount'),
      parameterCount: nonNegativeInteger(summary.parameterCount, 'summary.parameterCount'),
      textureCount: nonNegativeInteger(summary.textureCount, 'summary.textureCount'),
    },
  };
}
