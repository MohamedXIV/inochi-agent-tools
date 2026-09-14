import { parseArgs } from 'node:util';

import type { CliIo } from './output.js';
import { writeFailure } from './output.js';

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

function validateKnownCommand(args: string[]): string {
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
      requireStringOption(values, 'output');
      requireStringOption(values, 'name');
      return command;
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
      requireStringOption(values, 'input');
      return command;
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
      requireStringOption(values, 'input');
      requireStringOption(values, 'output');
      return command;
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
      requireStringOption(values, 'input');
      requireStringOption(values, 'output');
      requireStringOption(values, 'operations');
      return command;
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
      requireStringOption(values, 'input');
      requireStringOption(values, 'values');
      return command;
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
    command = validateKnownCommand(args);
    throw new CliUsageError(`command not implemented yet: ${command}`);
  } catch (error) {
    const descriptor = usageFailure(error instanceof Error ? error.message : String(error));
    writeFailure(io, json, command, descriptor);
    return descriptor.exitCode;
  }
}
