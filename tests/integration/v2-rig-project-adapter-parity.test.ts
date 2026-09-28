import { describe, expect, it } from 'vitest';

import { inspectRigProjectManifest, RIG_PROJECT_SCHEMA_VERSION } from '../../packages/core/src/index.js';
import { runCli, type CliIo } from '../../packages/cli/src/run.js';
import { createMcpToolRegistry } from '../../packages/mcp/src/tools.js';
import { createAuthoringClient } from '../../packages/sdk/src/index.js';

function project() {
  return {
    schemaVersion: RIG_PROJECT_SCHEMA_VERSION,
    name: 'Adapter Parity',
    layers: [
      { id: 'body', source: 'layers/body.png', role: 'body', anchors: { neck: { x: 0, y: -30 } } },
      { id: 'head', source: 'layers/head.png', role: 'head', parentId: 'body', pivot: { x: 0, y: -30 } },
    ],
    motions: [
      { id: 'head.x', kind: 'rotation', axis: 'x', min: -1, max: 1, default: 0, targets: ['head'] },
    ],
  };
}

describe('v2 rig-project adapter parity', () => {
  it('uses one core contract through SDK, CLI, and MCP', async () => {
    const manifest = project();
    const core = inspectRigProjectManifest(manifest);
    const sdkClient = createAuthoringClient();
    const sdk = await sdkClient.normalizeRigProject({ manifest });
    expect(sdk).toEqual(core);

    const stdout: string[] = [];
    const stderr: string[] = [];
    const io: CliIo = {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      stdin: async () => JSON.stringify(manifest),
    };
    const exit = await runCli(['--json', 'rig-project', 'normalize', '--input', '-'], io);
    expect(exit).toBe(0);
    expect(stderr).toEqual([]);
    const cliEnvelope = JSON.parse(stdout[0] as string) as { result: unknown };
    expect(cliEnvelope.result).toEqual(core);

    const registry = createMcpToolRegistry(sdkClient);
    const tool = registry.find((candidate) => candidate.name === 'rig.project.normalize');
    expect(tool).toBeDefined();
    await expect(tool!.call({ manifest })).resolves.toEqual({ ok: true, result: core });
  });
});
