import type { AuthoringClient } from '@inochi-agent-tools/sdk';

import { invalidArguments, semanticFailure, type McpToolResult } from './errors.js';

export interface McpSemanticTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call(arguments_: unknown): Promise<McpToolResult>;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function requiredString(input: UnknownRecord, key: string): string | null {
  const value = input[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function stringFieldSchema(description: string): Record<string, unknown> {
  return { type: 'string', minLength: 1, description };
}

function objectSchema(
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  };
}

function tool(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  handler: (input: UnknownRecord) => Promise<unknown>,
  validate: (input: UnknownRecord) => string | null,
): McpSemanticTool {
  return {
    name,
    description,
    inputSchema,
    async call(arguments_: unknown): Promise<McpToolResult> {
      const input = record(arguments_);
      if (!input) return invalidArguments(`${name} arguments must be an object`);

      const validationError = validate(input);
      if (validationError) return invalidArguments(validationError);

      try {
        return { ok: true, result: await handler(input) };
      } catch (error) {
        return semanticFailure(error);
      }
    },
  };
}

export function createMcpToolRegistry(client: AuthoringClient): McpSemanticTool[] {
  const inputOnlySchema = objectSchema(
    { inputPath: stringFieldSchema('Path to a real Inochi .inp puppet') },
    ['inputPath'],
  );

  const inspectLike = (name: 'puppet.open' | 'puppet.inspect', description: string) =>
    tool(
      name,
      description,
      inputOnlySchema,
      (input) => client.inspectPuppet({ inputPath: input.inputPath as string }),
      (input) => requiredString(input, 'inputPath') ? null : `${name} requires inputPath`,
    );

  return [
    tool(
      'puppet.create',
      'Create a minimal real Inochi puppet.',
      objectSchema(
        {
          outputPath: stringFieldSchema('Destination .inp path'),
          name: stringFieldSchema('Puppet display name'),
        },
        ['outputPath', 'name'],
      ),
      (input) => client.createPuppet({
        outputPath: input.outputPath as string,
        name: input.name as string,
      }),
      (input) => {
        if (!requiredString(input, 'outputPath')) return 'puppet.create requires outputPath';
        if (!requiredString(input, 'name')) return 'puppet.create requires name';
        return null;
      },
    ),
    inspectLike('puppet.open', 'Open and semantically inspect a real Inochi puppet.'),
    inspectLike('puppet.inspect', 'Inspect a real Inochi puppet.'),
    tool(
      'puppet.validate',
      'Validate and inspect a real Inochi puppet.',
      inputOnlySchema,
      (input) => client.validatePuppet({ inputPath: input.inputPath as string }),
      (input) => requiredString(input, 'inputPath') ? null : 'puppet.validate requires inputPath',
    ),
    tool(
      'puppet.save',
      'Save a real Inochi puppet to a distinct .inp path.',
      objectSchema(
        {
          inputPath: stringFieldSchema('Source .inp path'),
          outputPath: stringFieldSchema('Destination .inp path'),
        },
        ['inputPath', 'outputPath'],
      ),
      (input) => client.savePuppet({
        inputPath: input.inputPath as string,
        outputPath: input.outputPath as string,
      }),
      (input) => {
        if (!requiredString(input, 'inputPath')) return 'puppet.save requires inputPath';
        if (!requiredString(input, 'outputPath')) return 'puppet.save requires outputPath';
        return null;
      },
    ),
    tool(
      'puppet.edit',
      'Apply semantic authoring operations and save to a distinct real .inp path.',
      objectSchema(
        {
          inputPath: stringFieldSchema('Source .inp path'),
          outputPath: stringFieldSchema('Destination .inp path'),
          operations: { type: 'array', minItems: 1, items: { type: 'object' } },
        },
        ['inputPath', 'outputPath', 'operations'],
      ),
      (input) => client.editPuppet({
        inputPath: input.inputPath as string,
        outputPath: input.outputPath as string,
        operations: input.operations as Parameters<AuthoringClient['editPuppet']>[0]['operations'],
      }),
      (input) => {
        if (!requiredString(input, 'inputPath')) return 'puppet.edit requires inputPath';
        if (!requiredString(input, 'outputPath')) return 'puppet.edit requires outputPath';
        if (!Array.isArray(input.operations) || input.operations.length === 0) {
          return 'puppet.edit requires at least one operation';
        }
        return null;
      },
    ),
    tool(
      'parameter.evaluate',
      'Apply parameter values, report bound target values, and verify restoration.',
      objectSchema(
        {
          inputPath: stringFieldSchema('Source .inp path'),
          values: { type: 'object', minProperties: 1, additionalProperties: { type: 'array' } },
        },
        ['inputPath', 'values'],
      ),
      (input) => client.evaluateParameters({
        inputPath: input.inputPath as string,
        values: input.values as Parameters<AuthoringClient['evaluateParameters']>[0]['values'],
      }),
      (input) => {
        if (!requiredString(input, 'inputPath')) return 'parameter.evaluate requires inputPath';
        const values = record(input.values);
        if (!values || Object.keys(values).length === 0) return 'parameter.evaluate requires values';
        return null;
      },
    ),
  ];
}
