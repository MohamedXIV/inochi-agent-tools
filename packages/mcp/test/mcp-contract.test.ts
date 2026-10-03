import { describe, expect, it, vi } from 'vitest';

import { createMcpToolRegistry } from '../src/tools.js';

const EXPECTED_TOOLS = [
  'parameter.evaluate',
  'preview.render',
  'puppet.create',
  'puppet.edit',
  'puppet.inspect',
  'puppet.open',
  'puppet.save',
  'puppet.validate',
  'rig.project.build',
  'rig.project.normalize',
];

function fakeClient() {
  return {
    buildRigProject: vi.fn(async (request: unknown) => ({ schemaVersion: 1, status: 'green', request })),
    createPuppet: vi.fn(async (request: unknown) => ({ path: '/tmp/created.inp', request })),
    inspectPuppet: vi.fn(async (request: unknown) => ({ metadata: { name: 'Contract' }, request })),
    validatePuppet: vi.fn(async (request: unknown) => ({ metadata: { name: 'Contract' }, request })),
    savePuppet: vi.fn(async (request: unknown) => ({ path: '/tmp/saved.inp', request })),
    editPuppet: vi.fn(async (request: unknown) => ({ path: '/tmp/edited.inp', request })),
    renderPreview: vi.fn(async (_request: unknown) => ({
      schemaVersion: 1,
      kind: 'render-preview',
      commandCount: 1,
      drawableCommandCount: 1,
      texturedCommandCount: 1,
      vertexCount: 4,
      indexCount: 6,
      hasRenderableContent: true,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      states: {},
      output: '/tmp/preview.png',
    })),
    evaluateParameters: vi.fn(async (request: unknown) => ({ appliedParameters: [], targets: [], restoredParameters: [], request })),
    normalizeRigProject: vi.fn(async (request: unknown) => ({ schemaVersion: 1, fingerprint: 'a'.repeat(64), request })),
  };
}

describe('MCP semantic tool contract', () => {
  it('publishes only the stable semantic tools', () => {
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

  it('returns structured rig-build stage failures without native details', async () => {
    const client = fakeClient();
    client.buildRigProject.mockRejectedValue(Object.assign(new Error('Rig build failed during mesh.'), {
      code: 'RIG_BUILD_STAGE_FAILED',
      details: { stage: 'mesh' },
    }));
    const registry = createMcpToolRegistry(client);
    const build = registry.find((tool) => tool.name === 'rig.project.build')!;
    const manifest = { schemaVersion: 'inochi-agent-tools/rig-project/v1', name: 'MCP Build', layers: [{ id: 'body', source: 'body.png', role: 'body' }] };

    const result = await build.call({ manifest, projectDir: 'project', outputDir: 'output' });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'RIG_BUILD_STAGE_FAILED',
        message: 'Rig build failed during mesh.',
        details: { stage: 'mesh' },
      },
    });
  });

  it('dispatches rig-project build through the semantic SDK contract', async () => {
    const client = fakeClient();
    const registry = createMcpToolRegistry(client);
    const build = registry.find((tool) => tool.name === 'rig.project.build')!;
    const manifest = { schemaVersion: 'inochi-agent-tools/rig-project/v1', name: 'MCP Build', layers: [{ id: 'body', source: 'body.png', role: 'body' }] };

    const profiles = { headX: { parameterName: 'Head X' } };
    const qaProfile = { minCoverageRatio: 0.01 };
    const result = await build.call({ manifest, projectDir: 'project', outputDir: 'output', profiles, qaProfile, overwrite: true, repair: false });

    expect(result).toMatchObject({ ok: true, result: { schemaVersion: 1, status: 'green' } });
    expect(client.buildRigProject).toHaveBeenCalledWith({ manifest, projectDir: 'project', outputDir: 'output', profiles, qaProfile, overwrite: true, repair: false });
  });

  it('dispatches rig-project normalization through the semantic SDK contract', async () => {
    const client = fakeClient();
    const registry = createMcpToolRegistry(client);
    const normalize = registry.find((tool) => tool.name === 'rig.project.normalize')!;
    const manifest = { schemaVersion: 'inochi-agent-tools/rig-project/v1', name: 'MCP Rig', layers: [{ id: 'body', source: 'body.png', role: 'body' }] };

    const result = await normalize.call({ manifest });

    expect(result).toMatchObject({ ok: true, result: { schemaVersion: 1 } });
    expect(client.normalizeRigProject).toHaveBeenCalledWith({ manifest });
  });

  it('dispatches preview rendering through the semantic SDK contract', async () => {
    const client = fakeClient();
    const registry = createMcpToolRegistry(client);
    const preview = registry.find((tool) => tool.name === 'preview.render')!;
    const result = await preview.call({
      inputPath: 'fixture.inp',
      outputPath: 'preview.png',
      width: 320,
      height: 240,
      parameters: { Visibility: [-1, 0] },
    });

    expect(result).toMatchObject({ ok: true, result: { output: '/tmp/preview.png' } });
    expect(client.renderPreview).toHaveBeenCalledWith({
      inputPath: 'fixture.inp',
      outputPath: 'preview.png',
      width: 320,
      height: 240,
      parameters: { Visibility: [-1, 0] },
    });
  });
});
