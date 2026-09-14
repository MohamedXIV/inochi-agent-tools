import { parseArgs } from 'node:util';

import {
  createPuppet,
  inspectPuppet,
  savePuppet,
  validatePuppet,
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

function requireStringOption(
  values: Record<string, string | boolean | string[] | undefined>,
  name: string,
): string {
  const value = values[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CliUsageError(`missing required option --${name}`);
  }
  return value;
}

type ParsedCommand =
  | { command: 'puppet create'; outputPath: string; name: string }
  | { command: 'puppet open'; inputPath: string }
  | { command: 'puppet inspect'; inputPath: string }
  | { command: 'puppet validate'; inputPath: string }
  | { command: 'puppet save'; inputPath: string; outputPath: string }
  | {
      command: 'puppet edit';
      inputPath: string;
      outputPath: string;
      operationsSource: string;
    }
  | { command: 'parameter evaluate'; inputPath: string; valuesSource: string };

function parseKnownCommand(args: string[]): ParsedCommand {
  const [group, action, ...rest] = args;
  if (!group || !action) throw new CliUsageError('expected a command');

  const command = `${group} ${action}`;
  try {
    if (group === 'puppet' && action === 'create') {
      const { values } = parseArgs({
        args: rest,
        options: {
          output: { type: 'string' },
          name: { type: 'string' },
        },
        strict: true,
        allowPositionals: false,
      });
      return {
        command: 'puppet create',
        outputPath: requireStringOption(values, 'output'),
        name: requireStringOption(values, 'name'),
      };
    }

    if (
      group === 'puppet' &&
      (action === 'open' || action === 'inspect' || action === 'validate')
    ) {
      const { values } = parseArgs({
        args: rest,
        options: { input: { type: 'string' } },
        strict: true,
        allowPositionals: false,
      });
      const inputPath = requireStringOption(values, 'input');
      return { command: `puppet ${action}`, inputPath } as ParsedCommand;
    }

    if (group === 'puppet' && action === 'save') {
      const { values } = parseArgs({
        args: rest,
        options: {
          input: { type: 'string' },
          output: { type: 'string' },
        },
        strict: true,
        allowPositionals: false,
      });
      return {
        command: 'puppet save',
        inputPath: requireStringOption(values, 'input'),
        outputPath: requireStringOption(values, 'output'),
      };
    }

    if (group === 'puppet' && action === 'edit') {
      const { values } = parseArgs({
        args: rest,
        options: {
          input: { type: 'string' },
          output: { type: 'string' },
          operations: { type: 'string' },
        },
        strict: true,
        allowPositionals: false,
      });
      return {
        command: 'puppet edit',
        inputPath: requireStringOption(values, 'input'),
        outputPath: requireStringOption(values, 'output'),
        operationsSource: requireStringOption(values, 'operations'),
      };
    }

    if (group === 'parameter' && action === 'evaluate') {
      const { values } = parseArgs({
        args: rest,
        options: {
          input: { type: 'string' },
          values: { type: 'string' },
        },
        strict: true,
        allowPositionals: false,
      });
      return {
        command: 'parameter evaluate',
        inputPath: requireStringOption(values, 'input'),
        valuesSource: requireStringOption(values, 'values'),
      };
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
      case 'puppet create':
        result = await createPuppet({
          outputPath: parsed.outputPath,
          name: parsed.name,
        });
        break;
      case 'puppet open':
      case 'puppet inspect':
        result = await inspectPuppet(parsed.inputPath);
        break;
      case 'puppet validate':
        result = await validatePuppet(parsed.inputPath);
        break;
      case 'puppet save':
        result = await savePuppet({
          inputPath: parsed.inputPath,
          outputPath: parsed.outputPath,
        });
        break;
      default:
        throw new CliUsageError(`command not implemented yet: ${parsed.command}`);
    }

    writeSuccess(io, json, command, result);
    return 0;
  } catch (error) {
    const descriptor =
      error instanceof CliUsageError
        ? usageFailure(error.message)
        : classifyCliError(error);
    writeFailure(io, json, command, descriptor);
    return descriptor.exitCode;
  }
}
