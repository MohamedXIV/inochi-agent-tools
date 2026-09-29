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
  return plan.motions.find((motion) => motion.motionId === diagnostic.semanticTarget);
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
  const motionMap = new Map(motions.map((motion) => [motion.motionId, motion] as const));
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
