import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { InvalidBindingError, NativeBridgeError } from './errors.js';
import type { NumericPair, ParameterBindingProperty } from './inspection.js';

const execFileAsync = promisify(execFile);
const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;

export interface EvaluateParameterValuesOptions {
  inputPath: string;
  values: Record<string, NumericPair>;
  hostPath?: string;
}

export interface ParameterEvaluationTarget {
  parameterName: string;
  targetPath: string;
  property: ParameterBindingProperty;
  appliedValue: number;
  restoredValue: number;
}

export interface ParameterEvaluationResult {
  appliedParameters: Array<{ name: string; value: NumericPair }>;
  targets: ParameterEvaluationTarget[];
  restoredParameters: Array<{ name: string; value: NumericPair }>;
}

interface ExecFailure extends Error {
  code?: string | number;
  stderr?: string;
}

type UnknownRecord = Record<string, unknown>;

const BINDING_PROPERTIES = new Set<ParameterBindingProperty>([
  'zSort',
  'transform.t.x',
  'transform.t.y',
  'transform.t.z',
  'transform.r.x',
  'transform.r.y',
  'transform.r.z',
  'transform.s.x',
  'transform.s.y',
]);

function defaultNativeHostPath(): string {
  const executable = process.platform === 'win32' ? 'iat_native_host.exe' : 'iat_native_host';
  return path.resolve(process.cwd(), '.build', 'native', executable);
}

function nativeHostEnv(): NodeJS.ProcessEnv {
  const outDir = path.resolve(process.cwd(), '.build', 'native');
  return {
    ...process.env,
    LD_LIBRARY_PATH: [outDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
    DYLD_LIBRARY_PATH: [outDir, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),
    PATH: [outDir, process.env.PATH].filter(Boolean).join(path.delimiter),
  };
}

function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new NativeBridgeError(`Native host emitted invalid parameter evaluation ${label}`);
  }
  return value as UnknownRecord;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new NativeBridgeError(`Native host emitted invalid ${label}`);
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new NativeBridgeError(`Native host emitted invalid ${label}`);
  }
  return value;
}

function numericPair(value: unknown, label: string): NumericPair {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new NativeBridgeError(`Native host emitted invalid ${label}`);
  }
  return [finiteNumber(value[0], `${label}[0]`), finiteNumber(value[1], `${label}[1]`)];
}

function propertyValue(value: unknown): ParameterBindingProperty {
  const parsed = stringValue(value, 'parameter evaluation property');
  if (!BINDING_PROPERTIES.has(parsed as ParameterBindingProperty)) {
    throw new NativeBridgeError('Native host emitted unsupported parameter evaluation property');
  }
  return parsed as ParameterBindingProperty;
}

function parseResult(stdout: string): ParameterEvaluationResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(stdout);
  } catch (error) {
    throw new NativeBridgeError(
      `Native host emitted invalid parameter evaluation JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const input = record(decoded, 'result');
  if (!Array.isArray(input.appliedParameters) || !Array.isArray(input.targets) || !Array.isArray(input.restoredParameters)) {
    throw new NativeBridgeError('Native host emitted incomplete parameter evaluation result');
  }
  return {
    appliedParameters: input.appliedParameters.map((item, index) => {
      const parsed = record(item, `appliedParameters[${index}]`);
      return {
        name: stringValue(parsed.name, `appliedParameters[${index}].name`),
        value: numericPair(parsed.value, `appliedParameters[${index}].value`),
      };
    }),
    targets: input.targets.map((item, index) => {
      const parsed = record(item, `targets[${index}]`);
      return {
        parameterName: stringValue(parsed.parameterName, `targets[${index}].parameterName`),
        targetPath: stringValue(parsed.targetPath, `targets[${index}].targetPath`),
        property: propertyValue(parsed.property),
        appliedValue: finiteNumber(parsed.appliedValue, `targets[${index}].appliedValue`),
        restoredValue: finiteNumber(parsed.restoredValue, `targets[${index}].restoredValue`),
      };
    }),
    restoredParameters: input.restoredParameters.map((item, index) => {
      const parsed = record(item, `restoredParameters[${index}]`);
      return {
        name: stringValue(parsed.name, `restoredParameters[${index}].name`),
        value: numericPair(parsed.value, `restoredParameters[${index}].value`),
      };
    }),
  };
}

function normalizeValues(values: Record<string, NumericPair>): Record<string, NumericPair> {
  const entries = Object.entries(values);
  if (entries.length === 0) throw new InvalidBindingError('At least one parameter value is required');
  const normalized: Record<string, NumericPair> = {};
  for (const [name, value] of entries) {
    if (name.trim().length === 0 || name.includes('\0') || !Array.isArray(value) || value.length !== 2 ||
        !Number.isFinite(value[0]) || !Number.isFinite(value[1])) {
      throw new InvalidBindingError('Invalid parameter evaluation value');
    }
    normalized[name] = [value[0], value[1]];
  }
  return normalized;
}

export async function evaluateParameterValues(
  options: EvaluateParameterValuesOptions,
): Promise<ParameterEvaluationResult> {
  const hostPath = options.hostPath ?? defaultNativeHostPath();
  const values = normalizeValues(options.values);
  try {
    const { stdout } = await execFileAsync(
      hostPath,
      ['evaluate-parameters', path.resolve(process.cwd(), options.inputPath), JSON.stringify(values)],
      {
        cwd: process.cwd(),
        env: nativeHostEnv(),
        encoding: 'utf8',
        maxBuffer: MAX_CAPTURE_BYTES,
        windowsHide: true,
      },
    );
    return parseResult(stdout);
  } catch (error) {
    if (error instanceof InvalidBindingError || error instanceof NativeBridgeError) throw error;
    const failure = error as ExecFailure;
    const diagnostic = failure.stderr?.trim() || failure.message || 'native parameter evaluation failed';
    if (failure.code === 10) throw new InvalidBindingError(diagnostic);
    throw new NativeBridgeError(diagnostic);
  }
}
