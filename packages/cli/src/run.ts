import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import {
  createPuppet,
  editPuppet,
  evaluateParameterValues,
  inspectPuppet,
  renderPreview,
  savePuppet,
  validatePuppet,
  type NumericPair,
  type PuppetEditOperation,
} from '@inochi-agent-tools/core';

import { classifyCliError } from './errors.js';
import type { CliIo } from './output.js';
import { writeFailure, writeSuccess } from './output.js';

export type { CliIo } from './output.js';

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

function usageFailure(message: string) {
  return { exitCode: 2, code: 'CLI_USAGE', message } as const;
}

function stripGlobalJson(argv: string[]): { json: boolean; args: string[] } {
  let json = false;
  const args: string[] = [];
  for (const arg of argv) {
    if (arg === '--json') json = true;
    else args.push(arg);
  }
  return { json, args };
}

function requireStringOption(values: Record<string, string | boolean | string[] | undefined>, name: string): string {
  const value = values[name];
  if (typeof value !== 'string' || value.trim().length === 0) throw new CliUsageError(`missing required option --${name}`);
  return value;
}

function optionalPositiveInteger(values: Record<string, string | boolean | string[] | undefined>, name: string): number | undefined {
  const value = values[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1) throw new CliUsageError(`--${name} must be a positive integer`);
  return Number(value);
}

async function readJsonSource(source: string, io: CliIo): Promise<unknown> {
  let text: string;
  try {
    if (source === '-') {
      if (!io.stdin) throw new CliUsageError('stdin JSON input is not available');
      text = await io.stdin();
    } else text = await readFile(source, 'utf8');
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(`unable to read JSON input: ${error instanceof Error ? error.message : String(error)}`);
  }
  try { return JSON.parse(text) as unknown; }
  catch (error) { throw new CliUsageError(`invalid JSON input: ${error instanceof Error ? error.message : String(error)}`); }
}

type ParsedCommand =
  | { command: 'puppet create'; outputPath: string; name: string }
  | { command: 'puppet open'; inputPath: string }
  | { command: 'puppet inspect'; inputPath: string }
  | { command: 'puppet validate'; inputPath: string }
  | { command: 'puppet save'; inputPath: string; outputPath: string }
  | { command: 'puppet edit'; inputPath: string; outputPath: string; operationsSource: string }
  | { command: 'parameter evaluate'; inputPath: string; valuesSource: string }
  | { command: 'preview render'; inputPath: string; outputPath: string; width?: number; height?: number; valuesSource?: string };

function parseKnownCommand(args: string[]): ParsedCommand {
  const [group, action, ...rest] = args;
  if (!group || !action) throw new CliUsageError('expected a command');
  const command = `${group} ${action}`;
  try {
    if (group === 'puppet' && action === 'create') {
      const { values } = parseArgs({ args: rest, options: { output: { type: 'string' }, name: { type: 'string' } }, strict: true, allowPositionals: false });
      return { command: 'puppet create', outputPath: requireStringOption(values, 'output'), name: requireStringOption(values, 'name') };
    }
    if (group === 'puppet' && (action === 'open' || action === 'inspect' || action === 'validate')) {
      const { values } = parseArgs({ args: rest, options: { input: { type: 'string' } }, strict: true, allowPositionals: false });
      return { command: `puppet ${action}`, inputPath: requireStringOption(values, 'input') } as ParsedCommand;
    }
    if (group === 'puppet' && action === 'save') {
      const { values } = parseArgs({ args: rest, options: { input: { type: 'string' }, output: { type: 'string' } }, strict: true, allowPositionals: false });
      return { command: 'puppet save', inputPath: requireStringOption(values, 'input'), outputPath: requireStringOption(values, 'output') };
    }
    if (group === 'puppet' && action === 'edit') {
      const { values } = parseArgs({ args: rest, options: { input: { type: 'string' }, output: { type: 'string' }, operations: { type: 'string' } }, strict: true, allowPositionals: false });
      return { command: 'puppet edit', inputPath: requireStringOption(values, 'input'), outputPath: requireStringOption(values, 'output'), operationsSource: requireStringOption(values, 'operations') };
    }
    if (group === 'parameter' && action === 'evaluate') {
      const { values } = parseArgs({ args: rest, options: { input: { type: 'string' }, values: { type: 'string' } }, strict: true, allowPositionals: false });
      return { command: 'parameter evaluate', inputPath: requireStringOption(values, 'input'), valuesSource: requireStringOption(values, 'values') };
    }
    if (group === 'preview' && action === 'render') {
      const { values } = parseArgs({ args: rest, options: { input: { type: 'string' }, output: { type: 'string' }, width: { type: 'string' }, height: { type: 'string' }, values: { type: 'string' } }, strict: true, allowPositionals: false });
      return { command: 'preview render', inputPath: requireStringOption(values, 'input'), outputPath: requireStringOption(values, 'output'), width: optionalPositiveInteger(values, 'width'), height: optionalPositiveInteger(values, 'height'), valuesSource: typeof values.values === 'string' ? values.values : undefined };
    }
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(error instanceof Error ? error.message : String(error));
  }
  throw new CliUsageError(`unknown command: ${command}`);
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const { json, args } = stripGlobalJson(argv);
  let command: string | null = null;
  try {
    const parsed = parseKnownCommand(args);
    command = parsed.command;
    let result: unknown;
    switch (parsed.command) {
      case 'puppet create': result = await createPuppet({ outputPath: parsed.outputPath, name: parsed.name }); break;
      case 'puppet open':
      case 'puppet inspect': result = await inspectPuppet(parsed.inputPath); break;
      case 'puppet validate': result = await validatePuppet(parsed.inputPath); break;
      case 'puppet save': result = await savePuppet({ inputPath: parsed.inputPath, outputPath: parsed.outputPath }); break;
      case 'puppet edit': {
        const decoded = await readJsonSource(parsed.operationsSource, io);
        if (!Array.isArray(decoded)) throw new CliUsageError('puppet edit operations JSON must be an array');
        result = await editPuppet({ inputPath: parsed.inputPath, outputPath: parsed.outputPath, operations: decoded as PuppetEditOperation[] });
        break;
      }
      case 'parameter evaluate': {
        const decoded = await readJsonSource(parsed.valuesSource, io);
        if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) throw new CliUsageError('parameter values JSON must be an object');
        result = await evaluateParameterValues({ inputPath: parsed.inputPath, values: decoded as Record<string, NumericPair> });
        break;
      }
      case 'preview render': {
        let parameterValues: Record<string, NumericPair> | undefined;
        if (parsed.valuesSource) {
          const decoded = await readJsonSource(parsed.valuesSource, io);
          if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) throw new CliUsageError('preview parameter values JSON must be an object');
          parameterValues = decoded as Record<string, NumericPair>;
        }
        result = await renderPreview({ inputPath: parsed.inputPath, outputPath: parsed.outputPath, width: parsed.width, height: parsed.height, parameters: parameterValues });
        break;
      }
    }
    writeSuccess(io, json, command, result);
    return 0;
  } catch (error) {
    const descriptor = error instanceof CliUsageError ? usageFailure(error.message) : classifyCliError(error);
    writeFailure(io, json, command, descriptor);
    return descriptor.exitCode;
  }
}
