import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RIG_PROJECT_SCHEMA_VERSION, compileStandardCharacterRig, editPuppet, runBoundedRigRepair, runRigQa, type StandardCharacterRigBuildPlan } from '../../packages/core/src/index.js';

const enabled = process.env.IAT_V2_RIG_REPAIR_TESTS === '1';
const root = path.resolve('tests/fixtures/generated/v2-repair');
const sourceInput = path.resolve('tests/fixtures/generated/v2-mesh/character-output.inp');
const guideTexture = path.resolve('tests/fixtures/generated/v2-mesh/hair.png');
const baselineInput = path.join(root, 'reference-input.inp');
const manifest = {
  schemaVersion: RIG_PROJECT_SCHEMA_VERSION,
  name: 'v2 Bounded Repair Acceptance',
  layers: [{ id: 'body', source: 'body.png', role: 'body' }],
  motions: [{ id: 'breath', kind: 'deform' as const, axis: 'y' as const, min: -0.4, max: 0.4, default: 0, targets: ['body'] }],
};
const profile = { width: 256, height: 256, minCoverageRatio: 0.68, maxCoverageRatio: 4, maxBoundsAreaRatio: 4, maxBoundsSpanRatio: 2 };

async function prepareBaseline() {
  await rm(baselineInput, { force: true });
  await editPuppet({
    inputPath: sourceInput,
    outputPath: baselineInput,
    operations: [
      { type: 'texture.import', key: 'qa-reference', imagePath: guideTexture },
      { type: 'part.create', parentPath: '/Root', name: 'QaReference', textureKey: 'qa-reference' },
      {
        type: 'part.setMesh',
        path: '/Root/QaReference',
        mesh: {
          vertices: [[-60, -60], [60, -60], [-60, 60], [60, 60]],
          uvs: [[0, 0], [1, 0], [0, 1], [1, 1]],
          indices: [0, 1, 3, 0, 3, 2],
        },
      },
    ],
  });
}

async function evaluate(plan: StandardCharacterRigBuildPlan, label: string) {
  const puppet = path.join(root, label + '.inp');
  const evidence = path.join(root, label + '-evidence');
  await rm(puppet, { force: true });
  await rm(evidence, { recursive: true, force: true });
  await editPuppet({ inputPath: baselineInput, outputPath: puppet, operations: plan.operations });
  return runRigQa({ inputPath: puppet, outputDir: evidence, plan, profile });
}

describe.skipIf(!enabled)('v2 real bounded rig repair acceptance', () => {
  it('repairs a real authored puppet to green and rebuilds deterministically', async () => {
    await mkdir(root, { recursive: true });
    await prepareBaseline();
    const initial = compileStandardCharacterRig({
      manifest,
      layerPaths: { body: '/Root/Body' },
      profiles: { breath: { parameterName: 'Breathing', property: 'transform.s.y', gain: 2.4 } },
    });
    const before = await evaluate(initial, 'before');
    expect(before.pass, JSON.stringify(before.samples, null, 2)).toBe(false);
    expect(before.diagnostics.some((d) => d.code === 'DISAPPEARING_CONTENT' && d.semanticTarget === 'breath')).toBe(true);
    expect(before.diagnostics.every((d) => d.code === 'DISAPPEARING_CONTENT' || d.severity === 'warning')).toBe(true);

    let index = 0;
    const repaired = await runBoundedRigRepair(initial, before, (candidate) => evaluate(candidate, 'candidate-' + (++index)), { maxIterations: 4, maxChanges: 4 });
    expect(repaired.status).toBe('green');
    expect(repaired.qa.pass).toBe(true);
    expect(repaired.qa.summary.errorCount).toBe(0);
    expect(repaired.plan.fingerprint).not.toBe(initial.fingerprint);
    expect(repaired.plan.motions[0]!.gain).toBeLessThan(initial.motions[0]!.gain);
    expect(repaired.iterations.length).toBeGreaterThan(0);
    expect(repaired.iterations.every((entry) => entry.status === 'accepted')).toBe(true);

    const rebuilt = await evaluate(repaired.plan, 'rebuilt');
    expect(rebuilt.pass).toBe(true);
    expect(rebuilt.planFingerprint).toBe(repaired.plan.fingerprint);
    expect(rebuilt.fingerprint).toBe(repaired.qa.fingerprint);
  });
});
