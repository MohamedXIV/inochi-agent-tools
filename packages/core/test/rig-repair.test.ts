import { describe, expect, it } from 'vitest';

import {
  applyRigRepair,
  proposeRigRepair,
  runBoundedRigRepair,
  type RigQaReport,
  type StandardCharacterRigBuildPlan,
} from '../src/index.js';

const fingerprint = 'a'.repeat(64);

const plan: StandardCharacterRigBuildPlan = {
  schemaVersion: 1,
  projectFingerprint: fingerprint,
  fingerprint,
  motions: [{
    motionId: 'headX',
    kind: 'transform',
    axis: 'x',
    parameterName: 'Head X',
    property: 'transform.t.x',
    valueMode: 'direct',
    gain: 1,
    mirror: 'same',
    targets: [{
      layerId: 'head',
      path: '/Root/Head',
      sign: 1,
      keypoints: [
        { at: [-10, 0], value: -10 },
        { at: [10, 0], value: 10 },
      ],
    }],
  }],
  operations: [
    {
      type: 'parameter.create',
      name: 'Head X',
      dimensions: 1,
      min: [-10, 0],
      max: [10, 0],
      defaultValue: [0, 0],
    },
    {
      type: 'parameter.bind',
      parameterName: 'Head X',
      targetPath: '/Root/Head',
      property: 'transform.t.x',
      keypoints: [
        { at: [-10, 0], value: -10 },
        { at: [10, 0], value: 10 },
      ],
    },
  ],
};

function qa(code: RigQaReport['diagnostics'][number]['code'], severity: 'warning' | 'error' = 'warning'): RigQaReport {
  return {
    schemaVersion: 1,
    planFingerprint: plan.fingerprint,
    fingerprint: 'b'.repeat(64),
    profile: {
      width: 256,
      height: 256,
      alphaDeltaThreshold: 8,
      minCoverageRatio: 0.2,
      maxCoverageRatio: 4,
      maxBoundsAreaRatio: 4,
      maxBoundsSpanRatio: 1.5,
      maxSamples: 64,
    },
    pass: severity !== 'error',
    summary: { sampleCount: 1, errorCount: severity === 'error' ? 1 : 0, warningCount: severity === 'warning' ? 1 : 0 },
    samples: [],
    diagnostics: [{
      code,
      severity,
      semanticTarget: 'headX',
      sampleId: 'headX-max',
      evidence: {},
      suggestedRemediation: 'range',
      message: 'fixture',
    }],
    reportArtifact: 'rig-qa-report.json',
  };
}

describe('bounded rig repair', () => {
  it('proposes and applies a deterministic bounded amplitude repair', () => {
    const proposal = proposeRigRepair(plan, qa('EXCESSIVE_DEFORMATION'));
    expect(proposal.status).toBe('proposed');
    expect(proposal.changes).toEqual([expect.objectContaining({
      motionId: 'headX',
      before: 1,
      after: 0.75,
    })]);

    const applied = applyRigRepair(plan, proposal);
    expect(applied.plan.motions[0]!.gain).toBe(0.75);
    expect(applied.plan.motions[0]!.targets[0]!.keypoints.map((point) => point.value)).toEqual([-7.5, 7.5]);
    expect(applied.plan.operations[1]).toMatchObject({
      type: 'parameter.bind',
      keypoints: [
        { at: [-10, 0], value: -7.5 },
        { at: [10, 0], value: 7.5 },
      ],
    });
    expect(applied.plan.fingerprint).not.toBe(plan.fingerprint);
  });

  it('fails safely when an error has no deterministic repair strategy', () => {
    const proposal = proposeRigRepair(plan, qa('MISSING_TARGET', 'error'));
    expect(proposal.status).toBe('blocked');
    expect(proposal.changes).toEqual([]);
    expect(proposal.blockedDiagnostics).toEqual([
      expect.objectContaining({ code: 'MISSING_TARGET', semanticTarget: 'headX' }),
    ]);
    expect(() => applyRigRepair(plan, proposal)).toThrow(/Blocked rig repair proposals/);
  });

  it('enforces an explicit change budget', () => {
    const twoMotionPlan: StandardCharacterRigBuildPlan = {
      ...plan,
      motions: [
        plan.motions[0]!,
        {
          ...plan.motions[0]!,
          motionId: 'headY',
          parameterName: 'Head Y',
          property: 'transform.t.y',
        },
      ],
    };
    const report = qa('EXCESSIVE_DEFORMATION');
    report.planFingerprint = twoMotionPlan.fingerprint;
    report.diagnostics.push({
      ...report.diagnostics[0]!,
      semanticTarget: 'headY',
      sampleId: 'headY-max',
    });
    expect(() => proposeRigRepair(twoMotionPlan, report, { maxChanges: 1 })).toThrow(/exceeding maxChanges=1/);
  });
});


describe('iterative bounded rig repair', () => {
  it('accepts an improving candidate and reaches green', async () => {
    const failing = qa('EXCESSIVE_DEFORMATION', 'error');
    const result = await runBoundedRigRepair(plan, failing, async (candidate) => ({
      ...failing,
      planFingerprint: candidate.fingerprint,
      fingerprint: 'c'.repeat(64),
      pass: true,
      summary: { sampleCount: 1, errorCount: 0, warningCount: 0 },
      diagnostics: [],
    }));
    expect(result.status).toBe('green');
    expect(result.plan.motions[0]!.gain).toBe(0.75);
    expect(result.iterations).toEqual([
      expect.objectContaining({ status: 'accepted', changes: [expect.objectContaining({ after: 0.75 })] }),
    ]);
  });

  it('rolls back a candidate whose QA does not strictly improve', async () => {
    const failing = qa('EXCESSIVE_DEFORMATION', 'error');
    const result = await runBoundedRigRepair(plan, failing, async (candidate) => ({
      ...failing,
      planFingerprint: candidate.fingerprint,
      fingerprint: 'd'.repeat(64),
    }));
    expect(result.status).toBe('rolled-back');
    expect(result.plan.fingerprint).toBe(plan.fingerprint);
    expect(result.iterations[0]).toMatchObject({
      status: 'rolled-back',
      beforePlanFingerprint: plan.fingerprint,
    });
  });

  it('stops safely when a failing diagnostic is ambiguous', async () => {
    const failing = qa('MISSING_TARGET', 'error');
    let evaluated = false;
    const result = await runBoundedRigRepair(plan, failing, async () => {
      evaluated = true;
      throw new Error('must not evaluate blocked repair');
    });
    expect(result.status).toBe('blocked');
    expect(evaluated).toBe(false);
    expect(result.iterations[0]).toMatchObject({ status: 'blocked', changes: [] });
  });

  it('rejects QA evidence for a different candidate plan', async () => {
    const failing = qa('EXCESSIVE_DEFORMATION', 'error');
    await expect(runBoundedRigRepair(plan, failing, async () => ({
      ...failing,
      fingerprint: 'e'.repeat(64),
    }))).rejects.toThrow(/Candidate QA report does not belong/);
  });
});
