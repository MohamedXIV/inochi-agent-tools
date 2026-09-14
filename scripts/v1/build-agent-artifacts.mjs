import { spawnSync } from 'node:child_process';
import { rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root = process.cwd();
const generated = path.join(root, 'tests', 'fixtures', 'generated');
const cliMain = path.join(root, 'packages', 'cli', 'dist', 'main.js');
const mcpMain = path.join(root, 'packages', 'mcp', 'dist', 'main.js');
const imagePath = path.join(generated, 'm2-checker.png');

const paths = {
  operations: path.join(generated, 'v1-operations.json'),
  cliSource: path.join(generated, 'v1-cli-source.inp'),
  cliIntermediate: path.join(generated, 'v1-cli-intermediate.inp'),
  cliFinal: path.join(generated, 'v1-cli-authored.inp'),
  mcpSource: path.join(generated, 'v1-mcp-source.inp'),
  mcpIntermediate: path.join(generated, 'v1-mcp-intermediate.inp'),
  mcpFinal: path.join(generated, 'v1-mcp-authored.inp'),
};

const operations = [
  { type: 'texture.import', key: 'face', imagePath },
  { type: 'node.create', parentPath: '/Root', name: 'Art' },
  { type: 'part.create', parentPath: '/Root/Art', name: 'Face', textureKey: 'face' },
  { type: 'node.create', parentPath: '/Root', name: 'Rig' },
  { type: 'parameter.create', name: 'Move X', dimensions: 1, min: [-1, 0], max: [1, 0], defaultValue: [0, 0] },
  { type: 'parameter.create', name: 'Move Y', dimensions: 1, min: [-1, 0], max: [1, 0], defaultValue: [0, 0] },
  {
    type: 'parameter.bind',
    parameterName: 'Move X',
    targetPath: '/Root/Rig',
    property: 'transform.t.x',
    keypoints: [{ at: [-1, 0], value: -20 }, { at: [1, 0], value: 20 }],
  },
  {
    type: 'parameter.bind',
    parameterName: 'Move Y',
    targetPath: '/Root/Rig',
    property: 'transform.t.y',
    keypoints: [{ at: [-1, 0], value: -12 }, { at: [1, 0], value: 12 }],
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEvaluation(evaluation, adapter) {
  const targets = evaluation?.targets ?? [];
  const restored = evaluation?.restoredParameters ?? [];

  for (const expected of [
    { parameterName: 'Move X', property: 'transform.t.x', appliedValue: 20 },
    { parameterName: 'Move Y', property: 'transform.t.y', appliedValue: -12 },
  ]) {
    const target = targets.find((item) =>
      item.parameterName === expected.parameterName &&
      item.targetPath === '/Root/Rig' &&
      item.property === expected.property,
    );
    assert(target, `${adapter}: missing ${expected.parameterName} evaluation target`);
    assert(target.appliedValue === expected.appliedValue, `${adapter}: unexpected ${expected.parameterName} applied value`);
    assert(target.restoredValue === 0, `${adapter}: ${expected.parameterName} target was not restored to zero`);
  }

  for (const name of ['Move X', 'Move Y']) {
    const parameter = restored.find((item) => item.name === name);
    assert(parameter, `${adapter}: missing restored ${name} parameter`);
    assert(Array.isArray(parameter.value) && parameter.value[0] === 0 && parameter.value[1] === 0, `${adapter}: ${name} parameter was not restored to zero`);
  }
}

function runCli(args, input) {
  const result = spawnSync(process.execPath, [cliMain, '--json', ...args], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    ...(input === undefined ? {} : { input }),
  });
  if (result.error) throw result.error;
  assert(result.status === 0, `CLI failed (${result.status}): ${result.stderr || result.stdout}`);
  assert(result.stderr === '', `CLI wrote stderr: ${result.stderr}`);
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  assert(lines.length === 1, `CLI emitted ${lines.length} stdout lines instead of one JSON envelope`);
  const envelope = JSON.parse(lines[0]);
  assert(envelope.ok === true, `CLI semantic failure: ${JSON.stringify(envelope.error)}`);
  return envelope.result;
}

function structuredResult(result) {
  if ('structuredContent' in result && result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content.find((item) => item.type === 'text');
  if (text?.type === 'text') return JSON.parse(text.text);
  throw new Error('MCP tool result did not include structured content');
}

async function callMcp(client, name, arguments_) {
  const envelope = structuredResult(await client.callTool({ name, arguments: arguments_ }));
  assert(envelope?.ok === true, `MCP ${name} failed: ${JSON.stringify(envelope?.error)}`);
  return envelope.result;
}

async function assertArtifact(filePath, label) {
  const info = await stat(filePath);
  assert(info.size > 0, `${label} artifact is empty`);
}

async function buildCliArtifact() {
  runCli(['puppet', 'create', '--output', paths.cliSource, '--name', 'v1 Agent Acceptance']);
  runCli(['puppet', 'edit', '--input', paths.cliSource, '--output', paths.cliIntermediate, '--operations', paths.operations]);
  const evaluation = runCli(
    ['parameter', 'evaluate', '--input', paths.cliIntermediate, '--values', '-'],
    JSON.stringify({ 'Move X': [1, 0], 'Move Y': [-1, 0] }),
  );
  assertEvaluation(evaluation, 'CLI');
  runCli(['puppet', 'validate', '--input', paths.cliIntermediate]);
  runCli(['puppet', 'save', '--input', paths.cliIntermediate, '--output', paths.cliFinal]);
  await assertArtifact(paths.cliFinal, 'CLI');
}

async function buildMcpArtifact() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpMain],
    env: process.env,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'inochi-agent-tools-v1-acceptance', version: '1.0.0' });

  try {
    await client.connect(transport);
    await callMcp(client, 'puppet.create', { outputPath: paths.mcpSource, name: 'v1 Agent Acceptance' });
    await callMcp(client, 'puppet.edit', {
      inputPath: paths.mcpSource,
      outputPath: paths.mcpIntermediate,
      operations,
    });
    const evaluation = await callMcp(client, 'parameter.evaluate', {
      inputPath: paths.mcpIntermediate,
      values: { 'Move X': [1, 0], 'Move Y': [-1, 0] },
    });
    assertEvaluation(evaluation, 'MCP');
    await callMcp(client, 'puppet.validate', { inputPath: paths.mcpIntermediate });
    await callMcp(client, 'puppet.save', { inputPath: paths.mcpIntermediate, outputPath: paths.mcpFinal });
    await assertArtifact(paths.mcpFinal, 'MCP');
  } finally {
    await client.close();
  }
}

for (const ownedPath of Object.values(paths)) {
  await rm(ownedPath, { force: true });
}
await assertArtifact(imagePath, 'real PNG input');
await writeFile(paths.operations, JSON.stringify(operations, null, 2), 'utf8');

await buildCliArtifact();
await buildMcpArtifact();

console.log(JSON.stringify({
  cli: path.relative(root, paths.cliFinal),
  mcp: path.relative(root, paths.mcpFinal),
}));
