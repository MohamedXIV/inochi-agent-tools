import { stat } from 'node:fs/promises';
import path from 'node:path';

import { createAuthoringClient } from '@inochi-agent-tools/sdk';
import { describe, expect, it } from 'vitest';

const describeV1 = process.env.IAT_V1_ACCEPTANCE_TESTS === '1' ? describe : describe.skip;
const generated = path.resolve('tests/fixtures/generated');
const cliPath = path.join(generated, 'v1-cli-authored.inp');
const mcpPath = path.join(generated, 'v1-mcp-authored.inp');

describeV1('v1 public-adapter artifacts', () => {
  it('reopens equivalent real CLI and MCP authored puppets semantically', async () => {
    expect((await stat(cliPath)).size).toBeGreaterThan(0);
    expect((await stat(mcpPath)).size).toBeGreaterThan(0);

    const client = createAuthoringClient();
    const [cli, mcp] = await Promise.all([
      client.inspectPuppet({ inputPath: cliPath }),
      client.inspectPuppet({ inputPath: mcpPath }),
    ]);

    for (const inspection of [cli, mcp]) {
      expect(inspection.summary).toMatchObject({ partCount: 1, parameterCount: 2, textureCount: 1 });
      expect(inspection.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: '/Root/Art/Face', kind: 'part' }),
        expect.objectContaining({ path: '/Root/Rig' }),
      ]));
      expect(inspection.parameters).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Move X' }),
        expect.objectContaining({ name: 'Move Y' }),
      ]));
    }

    expect(mcp.summary).toEqual(cli.summary);
    expect(mcp.parameters).toEqual(cli.parameters);
  });
});
