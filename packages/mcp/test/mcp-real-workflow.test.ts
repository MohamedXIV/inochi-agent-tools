import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, describe, expect, it } from 'vitest';

const enabled = process.env.IAT_MCP_REAL_WORKFLOW_TESTS === '1';
const describeReal = enabled ? describe : describe.skip;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function structuredResult(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  if ('structuredContent' in result && result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content.find((item) => item.type === 'text');
  if (text?.type === 'text') return JSON.parse(text.text);
  throw new Error('MCP tool result did not include structured content');
}

async function call(client: Client, name: string, arguments_: Record<string, unknown>) {
  return structuredResult(await client.callTool({ name, arguments: arguments_ })) as {
    ok: boolean;
    result?: any;
    error?: { code: string; message: string };
  };
}

describeReal('real MCP authoring workflow', () => {
  it('creates, authors, evaluates, validates, saves, and reopens a real PNG-backed puppet', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'iat-mcp-real-'));
    temporaryDirectories.push(directory);
    const created = path.join(directory, 'created.inp');
    const authored = path.join(directory, 'authored.inp');
    const saved = path.join(directory, 'saved.inp');
    const imagePath = path.resolve('tests/fixtures/generated/m2-checker.png');
    const serverPath = path.resolve('packages/mcp/dist/main.js');

    const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], env: process.env, stderr: 'pipe' });
    const client = new Client({ name: 'inochi-agent-tools-real-workflow', version: '0.1.0' });

    try {
      await client.connect(transport);

      expect((await call(client, 'puppet.create', { outputPath: created, name: 'MCP Lifecycle Fixture' })).ok).toBe(true);
      expect((await stat(created)).size).toBeGreaterThan(0);
      expect((await call(client, 'puppet.open', { inputPath: created })).ok).toBe(true);

      const operations = [
        { type: 'texture.import', key: 'face', imagePath },
        { type: 'node.create', parentPath: '/Root', name: 'Art' },
        { type: 'part.create', parentPath: '/Root/Art', name: 'Face', textureKey: 'face' },
        { type: 'node.create', parentPath: '/Root', name: 'Rig' },
        { type: 'parameter.create', name: 'Move X', dimensions: 1, min: [-1, 0], max: [1, 0], defaultValue: [0, 0] },
        { type: 'parameter.create', name: 'Move Y', dimensions: 1, min: [-1, 0], max: [1, 0], defaultValue: [0, 0] },
        { type: 'parameter.bind', parameterName: 'Move X', targetPath: '/Root/Rig', property: 'transform.t.x', keypoints: [{ at: [-1, 0], value: -20 }, { at: [1, 0], value: 20 }] },
        { type: 'parameter.bind', parameterName: 'Move Y', targetPath: '/Root/Rig', property: 'transform.t.y', keypoints: [{ at: [-1, 0], value: -12 }, { at: [1, 0], value: 12 }] },
      ];

      const edit = await call(client, 'puppet.edit', { inputPath: created, outputPath: authored, operations });
      expect(edit.ok, JSON.stringify(edit.error)).toBe(true);
      expect((await stat(authored)).size).toBeGreaterThan(0);

      const inspect = await call(client, 'puppet.inspect', { inputPath: authored });
      expect(inspect.ok).toBe(true);
      expect(inspect.result).toMatchObject({
        metadata: { name: 'MCP Lifecycle Fixture' },
        summary: { partCount: 1, parameterCount: 2, textureCount: 1 },
      });
      expect(inspect.result.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: '/Root/Art/Face', kind: 'part', textures: expect.any(Array) }),
        expect.objectContaining({ path: '/Root/Rig' }),
      ]));
      expect(inspect.result.nodes.find((node: any) => node.path === '/Root/Art/Face')?.textures).toHaveLength(1);
      expect(inspect.result.parameters).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Move X', bindings: expect.arrayContaining([expect.objectContaining({ targetPath: '/Root/Rig', property: 'transform.t.x' })]) }),
        expect.objectContaining({ name: 'Move Y', bindings: expect.arrayContaining([expect.objectContaining({ targetPath: '/Root/Rig', property: 'transform.t.y' })]) }),
      ]));

      const evaluate = await call(client, 'parameter.evaluate', { inputPath: authored, values: { 'Move X': [1, 0], 'Move Y': [-1, 0] } });
      expect(evaluate.ok).toBe(true);
      expect(evaluate.result).toMatchObject({
        targets: expect.arrayContaining([
          { parameterName: 'Move X', targetPath: '/Root/Rig', property: 'transform.t.x', appliedValue: 20, restoredValue: 0 },
          { parameterName: 'Move Y', targetPath: '/Root/Rig', property: 'transform.t.y', appliedValue: -12, restoredValue: 0 },
        ]),
        restoredParameters: expect.arrayContaining([
          { name: 'Move X', value: [0, 0] },
          { name: 'Move Y', value: [0, 0] },
        ]),
      });

      expect((await call(client, 'puppet.validate', { inputPath: authored })).ok).toBe(true);
      expect((await call(client, 'puppet.save', { inputPath: authored, outputPath: saved })).ok).toBe(true);
      expect((await stat(saved)).size).toBeGreaterThan(0);

      const reopened = await call(client, 'puppet.open', { inputPath: saved });
      expect(reopened.ok).toBe(true);
      expect(reopened.result).toMatchObject({
        metadata: { name: 'MCP Lifecycle Fixture' },
        summary: { partCount: 1, parameterCount: 2, textureCount: 1 },
      });
    } finally {
      await client.close();
    }
  });
});
