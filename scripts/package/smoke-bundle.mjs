import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const repoRoot = process.cwd();
const bundleRoot = path.resolve(repoRoot, process.env.IAT_BUNDLE_DIR ?? '.build/bundle');
const unrelatedCwd = await mkdtemp(path.join(tmpdir(), 'iat-bundle-smoke-'));
const cliArtifact = path.join(repoRoot, 'tests/fixtures/generated/v1-cli-authored.inp');
const mcpArtifact = path.join(repoRoot, 'tests/fixtures/generated/v1-mcp-authored.inp');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const cli = spawnSync(path.join(bundleRoot, 'inochi-agent'), ['--json', 'puppet', 'validate', '--input', cliArtifact], {
    cwd: unrelatedCwd,
    env: process.env,
    encoding: 'utf8',
  });
  assert(cli.status === 0, `packaged CLI failed from unrelated cwd: ${cli.stderr || cli.stdout}`);
  const envelope = JSON.parse(cli.stdout.trim());
  assert(envelope.ok === true, 'packaged CLI validation did not succeed');

  const transport = new StdioClientTransport({
    command: path.join(bundleRoot, 'inochi-agent-mcp'),
    cwd: unrelatedCwd,
    env: process.env,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'iat-packaged-smoke', version: '0.1.0' });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'puppet.validate', arguments: { inputPath: mcpArtifact } });
    const structured = 'structuredContent' in result && result.structuredContent
      ? result.structuredContent
      : JSON.parse(result.content.find((item) => item.type === 'text')?.text ?? '{}');
    assert(structured.ok === true, 'packaged MCP validation did not succeed');
  } finally {
    await client.close();
  }

  console.log(JSON.stringify({ ok: true, cwd: unrelatedCwd, cliArtifact, mcpArtifact }));
} finally {
  await rm(unrelatedCwd, { recursive: true, force: true });
}
