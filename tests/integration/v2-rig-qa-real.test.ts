import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  RIG_PROJECT_SCHEMA_VERSION,
  compileStandardCharacterRig,
  editPuppet,
  runRigQa,
} from '../../packages/core/src/index.js';

const runNative = process.env.IAT_V2_RIG_QA_TESTS === '1';
const root = path.resolve('tests/fixtures/generated/v2-qa');
const meshInput = path.resolve('tests/fixtures/generated/v2-mesh/character-output.inp');
const rigged = path.join(root, 'character-rigged.inp');
const evidenceDir = path.join(root, 'evidence');

const manifest = {
  schemaVersion: RIG_PROJECT_SCHEMA_VERSION,
  name: 'v2 Rig QA Acceptance',
  layers: [
    { id: 'body', source: 'body.png', role: 'body' },
    { id: 'hair', source: 'hair.png', role: 'hair', parentId: 'head' },
    { id: 'head', source: 'head.png', role: 'head', parentId: 'body' },
  ],
  motions: [
    { id: 'bodyLean', kind: 'rotation' as const, axis: 'x' as const, min: -0.12, max: 0.12, default: 0, targets: ['body'] },
    { id: 'breath', kind: 'deform' as const, axis: 'y' as const, min: -0.04, max: 0.04, default: 0, targets: ['body'] },
    { id: 'hairSwing', kind: 'physics' as const, axis: 'x' as const, min: -0.18, max: 0.18, default: 0, targets: ['hair'] },
    { id: 'headX', kind: 'transform' as const, axis: 'x' as const, min: -12, max: 12, default: 0, targets: ['hair', 'head'] },
    { id: 'headY', kind: 'transform' as const, axis: 'y' as const, min: -8, max: 8, default: 0, targets: ['hair', 'head'] },
  ],
};

describe.skipIf(!runNative)('v2 real rig QA acceptance', () => {
  it('emits deterministic machine-readable diagnostics and preserved preview evidence for a real puppet', async () => {
    await mkdir(root, { recursive: true });
    await rm(rigged, { force: true });
    await rm(evidenceDir, { recursive: true, force: true });

    const plan = compileStandardCharacterRig({
      manifest,
      layerPaths: {
        body: '/Root/Body',
        hair: '/Root/Hair',
        head: '/Root/Head',
      },
      profiles: {
        bodyLean: { parameterName: 'Body Lean', property: 'transform.r.z' },
        breath: { parameterName: 'Breathing' },
        headX: { parameterName: 'Head X' },
        headY: { parameterName: 'Head Y' },
        hairSwing: {
          parameterName: 'Hair Swing',
          property: 'transform.r.z',
          physics: {
            parentPath: '/Root',
            name: 'Hair Physics',
            settings: {
              model: 'pendulum',
              mapMode: 'angle-length',
              gravity: 1,
              length: 90,
              frequency: 1.25,
              angleDamping: 0.45,
              lengthDamping: 0.5,
              outputScale: [1, 1],
              localOnly: true,
            },
          },
        },
      },
    });

    await editPuppet({ inputPath: meshInput, outputPath: rigged, operations: plan.operations });
    const report = await runRigQa({
      inputPath: rigged,
      outputDir: evidenceDir,
      plan,
      profile: {
        width: 256,
        height: 256,
        minCoverageRatio: 0.1,
        maxCoverageRatio: 8,
        maxBoundsAreaRatio: 8,
        maxBoundsSpanRatio: 4,
      },
    });

    expect(report.pass).toBe(true);
    expect(report.summary.errorCount).toBe(0);
    expect(report.summary.sampleCount).toBe(13);
    expect(report.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(report.planFingerprint).toBe(plan.fingerprint);
    expect(report.samples.every((sample) => sample.sha256.match(/^[a-f0-9]{64}$/))).toBe(true);
    expect(report.samples.every((sample) => sample.coveredPixelSamples > 0)).toBe(true);

    for (const motion of plan.motions) {
      const min = report.samples.find((sample) => sample.motionId === motion.motionId && sample.kind === 'motion-min');
      const max = report.samples.find((sample) => sample.motionId === motion.motionId && sample.kind === 'motion-max');
      expect(min?.sha256).toBeTruthy();
      expect(max?.sha256).toBeTruthy();
      expect(min?.sha256).not.toBe(max?.sha256);
    }

    const persisted = JSON.parse(await readFile(path.join(evidenceDir, report.reportArtifact), 'utf8'));
    expect(persisted).toEqual(report);
  });
});
