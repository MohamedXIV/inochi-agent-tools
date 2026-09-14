export type NodeKind = 'node' | 'part' | 'other';
export type NumericPair = [number, number];

export interface PuppetInspectionNode {
  path: string;
  name: string;
  kind: NodeKind;
  childCount: number;
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
  textureCount: number;
  summary: {
    nodeCount: number;
    partCount: number;
    parameterCount: number;
    textureCount: number;
  };
}

type UnknownRecord = Record<string, unknown>;

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

function parseNode(value: unknown, index: number): PuppetInspectionNode {
  const path = `nodes[${index}]`;
  const input = record(value, path);
  return {
    path: stringValue(input.path, `${path}.path`),
    name: stringValue(input.name, `${path}.name`),
    kind: nodeKind(input.kind, `${path}.kind`),
    childCount: nonNegativeInteger(input.childCount, `${path}.childCount`),
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
    textureCount: nonNegativeInteger(root.textureCount, 'textureCount'),
    summary: {
      nodeCount: nonNegativeInteger(summary.nodeCount, 'summary.nodeCount'),
      partCount: nonNegativeInteger(summary.partCount, 'summary.partCount'),
      parameterCount: nonNegativeInteger(summary.parameterCount, 'summary.parameterCount'),
      textureCount: nonNegativeInteger(summary.textureCount, 'summary.textureCount'),
    },
  };
}
