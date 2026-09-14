import { describe, expect, it, vi } from 'vitest';

import { createMcpToolRegistry } from '../src/tools.js';

const EXPECTED_TOOLS = [
  'parameter.evaluate',
  'puppet.create',
  'puppet.edit',
  'puppet.inspect',
  'puppet.open',
  'puppet.save',
  'puppet.validate',
];

function fakeClient() {
  return {
    createPuppet: vi.fn(async (request: unknown) => ({ path: '/tmp/created.inp', request })),
    inspectPuppet: vi.fn(async (request: unknown) => ({ metadata: { name: 'Contract' }, request })),
    validatePuppet: vi.fn(async (request: unknown) => ({ metadata: { name: 'Contract' }, request })),
    savePuppet: vi.fn(async (request: unknown) => ({ path: '/tmp/saved.inp', request })),
    editPuppet: vi.fn(async (request: unknown) => ({ path: '/tmp/edited.inp', request })),
    evaluateParameters: vi.fn(async (request: unknown) => ({ appliedParameters: [], targets: [], restoredParameters: [], request })),
  };
}

describe('MCP semantic tool contract', () => {
  it('publishes only the stable v1 semantic tools', () => {
    const registry = createMcpToolRegistry(fakeClient());
    expect(registry.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOLS);
    expect(registry.map((tool) => tool.name).join(' ')).not.toMatch(/in_|pointer|allocator|offset|nativeHandle/i);
  });

  it('rejects malformed arguments before semantic dispatch', async () => {
    const client = fakeClient();
    const registry = createMcpToolRegistry(client);
    const inspect = registry.find((tool) => tool.name === 'puppet.inspect');
    expect(inspect).toBeDefined();

    const result = await inspect!.call({});
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENTS' },
    });
    expect(client.inspectPuppet).not.toHaveBeenCalled();
  });

  it('wraps semantic success in a stable structured payload', async () => {
    const registry = createMcpToolRegistry(fakeClient());
    const inspect = registry.find((tool) => tool.name === 'puppet.inspect')!;
    const result = await inspect.call({ inputPath: 'fixture.inp' });

    expect(result).toMatchObject({
      ok: true,
      result: { metadata: { name: 'Contract' } },
    });
  });
});
