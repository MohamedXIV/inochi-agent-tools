import { createHash } from 'node:crypto';

import { InvalidAuthoringRequestError } from './errors.js';
import type { RigQaDiagnostic, RigQaReport } from './rig-qa.js';
import type { StandardCharacterRigBuildPlan, StandardRigPlannedMotion } from './standard-rig-compiler.js';

export type RigRepairStatus = 'proposed' | 'blocked';

export interface RigRepairBudget {
  maxChanges?: number;
}

export interface NormalizedRigRepairBudget {
  maxChanges: number;
}

export interface RigRepairChange {
  motionId: string;
  field: 'gain';
  before: number;
  after: number;
  reason: string;
  diagnosticCode: RigQaDiagnostic['code'];
}

export interface RigRepairProposal {
  schemaVersion: 1;
  sourcePlanFingerprint: string;
  sourceQaFingerprint: string;
  status: RigRepairStatus;
  changes: RigRepairChange[];
  blockedDiagnostics: Array<{
    code: RigQaDiagnostic['code'];
    semanticTarget: string;
    reason: string;
  }>;
  fingerprint: string;
}

export interface AppliedRigRepair {
  schemaVersion: 1;
  sourcePlanFingerprint: string;
  proposalFingerprint: string;
  plan: StandardCharacterRigBuildPlan;
  changes: RigRepairChange[];
}

const DEFAULT_BUDGET: NormalizedRigRepairBudget = { maxChanges: 8 };

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) out[key] = canonicalValue(input[key]);
  return out;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalValue(value)), 'utf8').digest('hex');
}

function normalizeBudget(budget: RigRepairBudget = {}): NormalizedRigRepairBudget {
  const maxChanges = budget.maxChanges ?? DEFAULT_BUDGET.maxChanges;
  if (!Number.isInteger(maxChanges) || maxChanges < 1 || maxChanges > 64) {
    throw new InvalidAuthoringRequestError('Rig repair maxChanges must be an integer from 1 through 64');
  }
  return { maxChanges };
}

function motionForDiagnostic(
  plan: StandardCharacterRigBuildPlan,
  diagnostic: RigQaDiagnostic,
): StandardRigPlannedMotion | undefined {
  const direct = plan.motions.find((motion) => motion.motionId === diagnostic.semanticTarget);
  if (direct) return direct;

  if (
    diagnostic.semanticTarget !== 'character' ||
    !diagnostic.sampleId?.startsWith('combined-')
  ) return undefined;

  const candidates = plan.motions.filter((motion) => motion.kind !== 'physics');
  return candidates.length === 1 ? candidates[0] : undefined;
}

function boundedGain(before: number): number | null {
  const after = Math.fround(before * 0.75);
  if (!Number.isFinite(after) || after === 0 || Math.abs(after) >= Math.abs(before)) return null;
  return after;
}

function repairForDiagnostic(
  plan: StandardCharacterRigBuildPlan,
  diagnostic: RigQaDiagnostic,
): RigRepairChange | null {
  if (
    diagnostic.code !== 'EXCESSIVE_DEFORMATION' &&
    diagnostic.code !== 'DISAPPEARING_CONTENT'
  ) return null;

  const motion = motionForDiagnostic(plan, diagnostic);
  if (!motion || motion.kind === 'physics') return null;
  const after = boundedGain(motion.gain);
  if (after === null) return null;
  return {
    motionId: motion.motionId,
    field: 'gain',
    before: motion.gain,
    after,
    reason: diagnostic.code === 'EXCESSIVE_DEFORMATION'
      ? 'Reduce authored response amplitude by one bounded tuning step.'
      : 'Reduce authored response amplitude to keep the target visible across the declared range.',
    diagnosticCode: diagnostic.code,
  };
}

export function proposeRigRepair(
  plan: StandardCharacterRigBuildPlan,
  qa: RigQaReport,
  budget: RigRepairBudget = {},
): RigRepairProposal {
  if (qa.planFingerprint !== plan.fingerprint) {
    throw new InvalidAuthoringRequestError('Rig repair QA report does not belong to the supplied rig plan');
  }
  const normalized = normalizeBudget(budget);
  const changesByMotion = new Map<string, RigRepairChange>();
  const blockedDiagnostics: RigRepairProposal['blockedDiagnostics'] = [];

  for (const diagnostic of qa.diagnostics) {
    const change = repairForDiagnostic(plan, diagnostic);
    if (!change) {
      if (diagnostic.severity === 'error') {
        blockedDiagnostics.push({
          code: diagnostic.code,
          semanticTarget: diagnostic.semanticTarget,
          reason: 'No deterministic bounded repair strategy is defined for this error.',
        });
      }
      continue;
    }
    const current = changesByMotion.get(change.motionId);
    if (!current || Math.abs(change.after) < Math.abs(current.after)) {
      changesByMotion.set(change.motionId, change);
    }
  }

  const changes = [...changesByMotion.values()]
    .sort((left, right) => left.motionId.localeCompare(right.motionId));

  if (changes.length > normalized.maxChanges) {
    throw new InvalidAuthoringRequestError(
      'Rig repair proposal requires ' + changes.length + ' changes, exceeding maxChanges=' + normalized.maxChanges,
    );
  }

  const payload = {
    schemaVersion: 1 as const,
    sourcePlanFingerprint: plan.fingerprint,
    sourceQaFingerprint: qa.fingerprint,
    status: blockedDiagnostics.length > 0 ? 'blocked' as const : 'proposed' as const,
    changes,
    blockedDiagnostics: blockedDiagnostics.sort((left, right) =>
      left.code.localeCompare(right.code) || left.semanticTarget.localeCompare(right.semanticTarget)),
  };
  return { ...payload, fingerprint: fingerprint(payload) };
}

function rebuildMotion(
  motion: StandardRigPlannedMotion,
  gain: number,
): StandardRigPlannedMotion {
  const ratio = gain / motion.gain;
  return {
    ...motion,
    gain,
    targets: motion.targets.map((target) => ({
      ...target,
      keypoints: target.keypoints.map((point) => ({
        ...point,
        value: motion.valueMode === 'scale-delta'
          ? Math.fround(1 + (point.value - 1) * ratio)
          : Math.fround(point.value * ratio),
      })),
    })),
  };
}

export function applyRigRepair(
  plan: StandardCharacterRigBuildPlan,
  proposal: RigRepairProposal,
): AppliedRigRepair {
  if (proposal.sourcePlanFingerprint !== plan.fingerprint) {
    throw new InvalidAuthoringRequestError('Rig repair proposal does not belong to the supplied rig plan');
  }
  if (proposal.status !== 'proposed' || proposal.blockedDiagnostics.length > 0) {
    throw new InvalidAuthoringRequestError('Blocked rig repair proposals cannot be applied');
  }

  const byMotion = new Map(proposal.changes.map((change) => [change.motionId, change] as const));
  const motions = plan.motions.map((motion) => {
    const change = byMotion.get(motion.motionId);
    return change ? rebuildMotion(motion, change.after) : motion;
  });
  const operations = plan.operations.map((operation) => {
    if (operation.type !== 'parameter.bind') return operation;
    const motion = motions.find((candidate) =>
      candidate.parameterName === operation.parameterName &&
      candidate.property === operation.property &&
      candidate.targets.some((target) => target.path === operation.targetPath));
    if (!motion) return operation;
    const target = motion.targets.find((candidate) => candidate.path === operation.targetPath)!;
    return { ...operation, keypoints: target.keypoints };
  });

  const payload = {
    schemaVersion: 1 as const,
    projectFingerprint: plan.projectFingerprint,
    motions,
    operations,
  };
  const repairedPlan: StandardCharacterRigBuildPlan = {
    ...payload,
    fingerprint: fingerprint(payload),
  };
  return {
    schemaVersion: 1,
    sourcePlanFingerprint: plan.fingerprint,
    proposalFingerprint: proposal.fingerprint,
    plan: repairedPlan,
    changes: proposal.changes,
  };
}


export type RigRepairIterationStatus = 'accepted' | 'rolled-back' | 'blocked' | 'budget-exhausted';

export interface RigRepairIteration {
  iteration: number;
  status: RigRepairIterationStatus;
  beforePlanFingerprint: string;
  beforeQaFingerprint: string;
  proposalFingerprint?: string;
  candidatePlanFingerprint?: string;
  afterQaFingerprint?: string;
  changes: RigRepairChange[];
  reason: string;
}

export interface RigRepairLoopResult {
  schemaVersion: 1;
  status: 'green' | 'blocked' | 'budget-exhausted' | 'rolled-back';
  plan: StandardCharacterRigBuildPlan;
  qa: RigQaReport;
  iterations: RigRepairIteration[];
}

export interface RigRepairLoopOptions extends RigRepairBudget {
  maxIterations?: number;
}

function errorCount(report: RigQaReport): number {
  return report.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
}

function warningCount(report: RigQaReport): number {
  return report.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;
}

function isStrictlyBetter(before: RigQaReport, after: RigQaReport): boolean {
  const beforeErrors = errorCount(before);
  const afterErrors = errorCount(after);
  if (afterErrors !== beforeErrors) return afterErrors < beforeErrors;
  return warningCount(after) < warningCount(before);
}

/**
 * Executes a bounded repair loop. The caller owns rebuilding/rendering/QA for a
 * candidate plan, so this semantic layer never hides native automation.
 */
export async function runBoundedRigRepair(
  initialPlan: StandardCharacterRigBuildPlan,
  initialQa: RigQaReport,
  evaluate: (candidate: StandardCharacterRigBuildPlan) => Promise<RigQaReport>,
  options: RigRepairLoopOptions = {},
): Promise<RigRepairLoopResult> {
  if (initialQa.planFingerprint !== initialPlan.fingerprint) {
    throw new InvalidAuthoringRequestError('Initial rig QA report does not belong to the supplied rig plan');
  }
  const maxIterations = options.maxIterations ?? 3;
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 16) {
    throw new InvalidAuthoringRequestError('Rig repair maxIterations must be an integer from 1 through 16');
  }

  let plan = initialPlan;
  let qa = initialQa;
  const iterations: RigRepairIteration[] = [];
  let remainingChanges = normalizeBudget(options).maxChanges;

  if (qa.pass) return { schemaVersion: 1, status: 'green', plan, qa, iterations };

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const proposal = proposeRigRepair(plan, qa, { maxChanges: remainingChanges });
    if (proposal.status === 'blocked' || proposal.changes.length === 0) {
      iterations.push({
        iteration,
        status: 'blocked',
        beforePlanFingerprint: plan.fingerprint,
        beforeQaFingerprint: qa.fingerprint,
        proposalFingerprint: proposal.fingerprint,
        changes: proposal.changes,
        reason: proposal.blockedDiagnostics.length
          ? 'At least one failing diagnostic has no safe deterministic repair.'
          : 'No bounded repair is available for the remaining diagnostics.',
      });
      return { schemaVersion: 1, status: 'blocked', plan, qa, iterations };
    }

    const applied = applyRigRepair(plan, proposal);
    const candidateQa = await evaluate(applied.plan);
    if (candidateQa.planFingerprint !== applied.plan.fingerprint) {
      throw new InvalidAuthoringRequestError('Candidate QA report does not belong to the repaired rig plan');
    }

    if (!isStrictlyBetter(qa, candidateQa)) {
      iterations.push({
        iteration,
        status: 'rolled-back',
        beforePlanFingerprint: plan.fingerprint,
        beforeQaFingerprint: qa.fingerprint,
        proposalFingerprint: proposal.fingerprint,
        candidatePlanFingerprint: applied.plan.fingerprint,
        afterQaFingerprint: candidateQa.fingerprint,
        changes: proposal.changes,
        reason: 'Candidate QA did not strictly improve error/warning counts; original semantic plan retained.',
      });
      return { schemaVersion: 1, status: 'rolled-back', plan, qa, iterations };
    }

    remainingChanges -= proposal.changes.length;
    iterations.push({
      iteration,
      status: 'accepted',
      beforePlanFingerprint: plan.fingerprint,
      beforeQaFingerprint: qa.fingerprint,
      proposalFingerprint: proposal.fingerprint,
      candidatePlanFingerprint: applied.plan.fingerprint,
      afterQaFingerprint: candidateQa.fingerprint,
      changes: proposal.changes,
      reason: 'Candidate QA strictly improved and the semantic repair was accepted.',
    });
    plan = applied.plan;
    qa = candidateQa;

    if (qa.pass) return { schemaVersion: 1, status: 'green', plan, qa, iterations };
    if (remainingChanges <= 0) {
      iterations.push({
        iteration,
        status: 'budget-exhausted',
        beforePlanFingerprint: plan.fingerprint,
        beforeQaFingerprint: qa.fingerprint,
        changes: [],
        reason: 'The total semantic change budget was exhausted before QA became green.',
      });
      return { schemaVersion: 1, status: 'budget-exhausted', plan, qa, iterations };
    }
  }

  return { schemaVersion: 1, status: 'budget-exhausted', plan, qa, iterations };
}
