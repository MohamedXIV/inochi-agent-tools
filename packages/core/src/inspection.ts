export type NodeKind = 'node' | 'part' | 'mesh-deformer' | 'other';
export type NumericPair = [number, number];
export type PuppetTextureFormat = 'rgba8' | 'r8' | 'unknown';
export type PuppetTextureUsage = 'albedo' | 'emissive' | 'bumpmap';
export type ParameterBindingProperty =
  | 'zSort'
  | 'transform.t.x'
  | 'transform.t.y'
  | 'transform.t.z'
  | 'transform.r.x'
  | 'transform.r.y'
  | 'transform.r.z'
  | 'transform.s.x'
  | 'transform.s.y';

export interface PuppetInspectionNodeTexture {
  usage: PuppetTextureUsage;
  ref: string;
}

export interface PuppetInspectionMesh {
  vertices: NumericPair[];
  uvs: NumericPair[];
  indices: number[];
}

export interface PuppetInspectionNode {
  path: string;
  name: string;
  kind: NodeKind;
  childCount: number;
  textures: PuppetInspectionNodeTexture[];
  mesh?: PuppetInspectionMesh;
}

export interface PuppetInspectionTexture {
  ref: string;
  width: number;
  height: number;
  format: PuppetTextureFormat;
}

export interface PuppetInspectionParameterBindingKeypoint {
  index: [number, number];
  parameterValue: NumericPair;
  value: number;
}

export interface PuppetInspectionParameterBinding {
  targetPath: string;
  property: ParameterBindingProperty;
  keypoints: PuppetInspectionParameterBindingKeypoint[];
}

export interface PuppetInspectionParameter {
  name: string;
  dimensions: 1 | 2;
  min: NumericPair;
  max: NumericPair;
  defaultValue: NumericPair;
  value: NumericPair;
  bindings: PuppetInspectionParameterBinding[];
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

function indexPair(value: unknown, path: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    fail(path, 'expected two-integer array');
  }
  return [
    nonNegativeInteger(value[0], `${path}[0]`),
    nonNegativeInteger(value[1], `${path}[1]`),
  ];
}

function nodeKind(value: unknown, path: string): NodeKind {
  if (value !== 'node' &&
      value !== 'part' &&
      value !== 'mesh-deformer' &&
      value !== 'other') {
    fail(path, 'expected node, part, mesh-deformer, or other');
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

function parameterBindingProperty(value: unknown, path: string): ParameterBindingProperty {
  switch (value) {
    case 'zSort':
    case 'transform.t.x':
    case 'transform.t.y':
    case 'transform.t.z':
    case 'transform.r.x':
    case 'transform.r.y':
    case 'transform.r.z':
    case 'transform.s.x':
    case 'transform.s.y':
      return value;
    default:
      fail(path, 'expected supported parameter binding property');
  }
}

function parseMesh(value: unknown, path: string): PuppetInspectionMesh {
  const input = record(value, path);
  if (!Array.isArray(input.vertices)) fail(`${path}.vertices`, 'expected array');
  if (!Array.isArray(input.uvs)) fail(`${path}.uvs`, 'expected array');
  if (!Array.isArray(input.indices)) fail(`${path}.indices`, 'expected array');

  if (input.vertices.length < 3 || input.vertices.length !== input.uvs.length) {
    fail(path, 'vertices and uvs must have equal cardinality with at least three vertices');
  }

  const vertices = input.vertices.map((vertex, index) =>
    numericPair(vertex, `${path}.vertices[${index}]`));
  const uvs = input.uvs.map((uv, index) =>
    numericPair(uv, `${path}.uvs[${index}]`));

  if (input.indices.length < 3 || input.indices.length % 3 !== 0) {
    fail(`${path}.indices`, 'expected triangle index list');
  }
  const indices = input.indices.map((value, index) =>
    nonNegativeInteger(value, `${path}.indices[${index}]`));
  if (indices.some((index) => index >= vertices.length)) {
    fail(`${path}.indices`, 'index exceeds vertex range');
  }

  return { vertices, uvs, indices };
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

  const kind = nodeKind(input.kind, `${path}.kind`);
  const node: PuppetInspectionNode = {
    path: stringValue(input.path, `${path}.path`),
    name: stringValue(input.name, `${path}.name`),
    kind,
    childCount: nonNegativeInteger(input.childCount, `${path}.childCount`),
    textures: textures.map((texture, textureIndex) => parseNodeTexture(texture, index, textureIndex)),
  };

  if (input.mesh !== undefined) {
    if (kind !== 'part' && kind !== 'mesh-deformer') {
      fail(`${path}.mesh`, 'mesh is only valid for Part or mesh-deformer nodes');
    }
    node.mesh = parseMesh(input.mesh, `${path}.mesh`);
  }

  return node;
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

function parseParameterBindingKeypoint(
  value: unknown,
  parameterIndex: number,
  bindingIndex: number,
  keypointIndex: number,
): PuppetInspectionParameterBindingKeypoint {
  const path = `parameters[${parameterIndex}].bindings[${bindingIndex}].keypoints[${keypointIndex}]`;
  const input = record(value, path);
  return {
    index: indexPair(input.index, `${path}.index`),
    parameterValue: numericPair(input.parameterValue, `${path}.parameterValue`),
    value: finiteNumber(input.value, `${path}.value`),
  };
}

function parseParameterBinding(
  value: unknown,
  parameterIndex: number,
  bindingIndex: number,
): PuppetInspectionParameterBinding {
  const path = `parameters[${parameterIndex}].bindings[${bindingIndex}]`;
  const input = record(value, path);
  if (!Array.isArray(input.keypoints)) fail(`${path}.keypoints`, 'expected array');
  return {
    targetPath: stringValue(input.targetPath, `${path}.targetPath`),
    property: parameterBindingProperty(input.property, `${path}.property`),
    keypoints: input.keypoints.map((keypoint, keypointIndex) =>
      parseParameterBindingKeypoint(keypoint, parameterIndex, bindingIndex, keypointIndex),
    ),
  };
}

function parseParameter(value: unknown, index: number): PuppetInspectionParameter {
  const path = `parameters[${index}]`;
  const input = record(value, path);
  const dimensions = input.dimensions;
  if (dimensions !== 1 && dimensions !== 2) {
    fail(`${path}.dimensions`, 'expected 1 or 2');
  }
  const bindings = input.bindings === undefined ? [] : input.bindings;
  if (!Array.isArray(bindings)) fail(`${path}.bindings`, 'expected array');

  return {
    name: stringValue(input.name, `${path}.name`),
    dimensions,
    min: numericPair(input.min, `${path}.min`),
    max: numericPair(input.max, `${path}.max`),
    defaultValue: numericPair(input.defaultValue, `${path}.defaultValue`),
    value: numericPair(input.value, `${path}.value`),
    bindings: bindings.map((binding, bindingIndex) => parseParameterBinding(binding, index, bindingIndex)),
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
