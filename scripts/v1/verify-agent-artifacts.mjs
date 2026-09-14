import { stat } from 'node:fs/promises';
import path from 'node:path';

import { createAuthoringClient } from '@inochi-agent-tools/sdk';

const root = process.cwd();
const generated = path.join(root, 'tests', 'fixtures', 'generated');
const artifacts = [
  { label: 'CLI', inputPath: path.join(generated, 'v1-cli-authored.inp') },
  { label: 'MCP', inputPath: path.join(generated, 'v1-mcp-authored.inp') },
];
const client = createAuthoringClient();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalParameters(parameters) {
  return parameters.map((parameter) => ({
    name: parameter.name,
    min: parameter.min,
    max: parameter.max,
    defaultValue: parameter.defaultValue,
    bindings: parameter.bindings,
  }));
}

function assertInspection(inspection, label) {
  assert(inspection.summary.partCount === 1, `${label}: expected one Part`);
  assert(inspection.summary.parameterCount === 2, `${label}: expected two parameters`);
  assert(inspection.summary.textureCount === 1, `${label}: expected one texture`);

  const face = inspection.nodes.find((node) => node.path === '/Root/Art/Face');
  assert(face?.kind === 'part', `${label}: missing /Root/Art/Face Part`);
  assert(Array.isArray(face.textures) && face.textures.length === 1, `${label}: Face must use one texture`);
  assert(inspection.nodes.some((node) => node.path === '/Root/Rig'), `${label}: missing /Root/Rig`);

  for (const expected of [
    { name: 'Move X', property: 'transform.t.x', negative: -20, positive: 20 },
    { name: 'Move Y', property: 'transform.t.y', negative: -12, positive: 12 },
  ]) {
    const parameter = inspection.parameters.find((item) => item.name === expected.name);
    assert(parameter, `${label}: missing ${expected.name}`);
    const binding = parameter.bindings.find((item) => item.targetPath === '/Root/Rig' && item.property === expected.property);
    assert(binding, `${label}: missing ${expected.name} binding`);
    assert(binding.keypoints.some((point) => point.at[0] === -1 && point.value === expected.negative), `${label}: missing negative ${expected.name} keypoint`);
    assert(binding.keypoints.some((point) => point.at[0] === 1 && point.value === expected.positive), `${label}: missing positive ${expected.name} keypoint`);
  }
}

function assertEvaluation(evaluation, label) {
  for (const expected of [
    { name: 'Move X', property: 'transform.t.x', applied: 20 },
    { name: 'Move Y', property: 'transform.t.y', applied: -12 },
  ]) {
    const target = evaluation.targets.find((item) =>
      item.parameterName === expected.name &&
      item.targetPath === '/Root/Rig' &&
      item.property === expected.property,
    );
    assert(target?.appliedValue === expected.applied, `${label}: unexpected ${expected.name} applied value`);
    assert(target?.restoredValue === 0, `${label}: ${expected.name} target did not restore to zero`);
    const restored = evaluation.restoredParameters.find((item) => item.name === expected.name);
    assert(restored?.value?.[0] === 0 && restored?.value?.[1] === 0, `${label}: ${expected.name} parameter did not restore to zero`);
  }
}

const results = [];
for (const artifact of artifacts) {
  const info = await stat(artifact.inputPath);
  assert(info.size > 0, `${artifact.label}: artifact is empty`);
  const inspection = await client.inspectPuppet({ inputPath: artifact.inputPath });
  await client.validatePuppet({ inputPath: artifact.inputPath });
  const evaluation = await client.evaluateParameters({
    inputPath: artifact.inputPath,
    values: { 'Move X': [1, 0], 'Move Y': [-1, 0] },
  });
  assertInspection(inspection, artifact.label);
  assertEvaluation(evaluation, artifact.label);
  results.push({ ...artifact, inspection });
}

const [cli, mcp] = results;
assert(JSON.stringify(mcp.inspection.summary) === JSON.stringify(cli.inspection.summary), 'CLI/MCP semantic summaries differ');
assert(JSON.stringify(canonicalParameters(mcp.inspection.parameters)) === JSON.stringify(canonicalParameters(cli.inspection.parameters)), 'CLI/MCP parameter/binding semantics differ');

console.log(JSON.stringify({
  cli: path.relative(root, cli.inputPath),
  mcp: path.relative(root, mcp.inputPath),
  summary: cli.inspection.summary,
  evaluation: { 'Move X': 20, 'Move Y': -12, restored: 0 },
}));
