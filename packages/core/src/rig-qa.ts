import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { InvalidAuthoringRequestError } from './errors.js';
import { decodePngAlphaBuffer, type RasterAlpha } from './mesh-generation.js';
import { inspectPuppet, type InspectPuppetOptions } from './native-host.js';
import {
  type PuppetInspection,
  type PuppetInspectionMesh,
} from './inspection.js';
import {
  renderPreview,
  type PreviewFrameMetadata,
  type PreviewParameterValues,
} from './preview.js';
import type { StandardCharacterRigBuildPlan, StandardRigPlannedMotion } from './standard-rig-compiler.js';

export type RigQaSeverity = 'warning' | 'error';

export type RigQaDiagnosticCode =
  | 'MISSING_PARAMETER'
  | 'PARAMETER_RANGE_MISMATCH'
  | 'MISSING_TARGET'
  | 'MISSING_BINDING'
  | 'DEGENERATE_GEOMETRY'
  | 'BROKEN_SYMMETRY'
  | 'EMPTY_RENDER'
  | 'NO_EXPECTED_MOTION'
  | 'DISAPPEARING_CONTENT'
  | 'EXCESSIVE_DEFORMATION'
  | 'OUT_OF_BOUNDS';

export type RigQaRemediationClass =
  | 'binding'
  | 'mesh'
  | 'range'
  | 'symmetry'
  | 'layout';

export interface RigQaDiagnostic {
  code: RigQaDiagnosticCode;
  severity: RigQaSeverity;
  semanticTarget: string;
  sampleId?: string;
  evidence: Record<string, string | number | boolean | null>;
  suggestedRemediation: RigQaRemediationClass;
  message: string;
}

export interface RigQaProfile {
  width?: number;
  height?: number;
  alphaDeltaThreshold?: number;
  minCoverageRatio?: number;
  maxCoverageRatio?: number;
  maxBoundsAreaRatio?: number;
  maxBoundsSpanRatio?: number;
  maxSamples?: number;
}

export interface NormalizedRigQaProfile {
  width: number;
  height: number;
  alphaDeltaThreshold: number;
  minCoverageRatio: number;
  maxCoverageRatio: number;
  maxBoundsAreaRatio: number;
  maxBoundsSpanRatio: number;
  maxSamples: number;
}

export type RigQaSampleKind =
  | 'neutral'
  | 'motion-min'
  | 'motion-max'
  | 'combined-min'
  | 'combined-max';

export interface RigQaSample {
  id: string;
  kind: RigQaSampleKind;
  motionId?: string;
  parameters: PreviewParameterValues;
}

export interface RigQaSampleComparison {
  sameHash: boolean;
  alphaChangedPixels: number;
  alphaChangedRatio: number;
  coverageRatio: number | null;
  boundsAreaRatio: number | null;
}

export interface RigQaSampleReport {
  id: string;
  kind: RigQaSampleKind;
  motionId?: string;
  artifact: string;
  sha256: string;
  hasRenderableContent: boolean;
  coveredPixelSamples: number;
  bounds: PreviewFrameMetadata['bounds'];
  triangleCount: number;
  comparisonToNeutral: RigQaSampleComparison | null;
}

export interface RigQaReport {
  schemaVersion: 1;
  planFingerprint: string;
  fingerprint: string;
  profile: NormalizedRigQaProfile;
  pass: boolean;
  summary: {
    sampleCount: number;
    errorCount: number;
    warningCount: number;
  };
  samples: RigQaSampleReport[];
  diagnostics: RigQaDiagnostic[];
  reportArtifact: string;
}

export interface RunRigQaRequest {
  inputPath: string;
  outputDir: string;
  plan: StandardCharacterRigBuildPlan;
  profile?: RigQaProfile;
  hostPath?: string;
  reportName?: string;
}

export interface RigQaRenderedEvidence {
  sample: RigQaSample;
  artifact: string;
  sha256: string;
  metadata: PreviewFrameMetadata;
  alpha: RasterAlpha;
}

interface ParameterContract {
  min: [number, number];
  max: [number, number];
  defaultValue: [number, number];
}

const DEFAULT_PROFILE: NormalizedRigQaProfile = {
  width: 256,
  height: 256,
  alphaDeltaThreshold: 8,
  minCoverageRatio: 0.2,
  maxCoverageRatio: 4,
  maxBoundsAreaRatio: 4,
  maxBoundsSpanRatio: 1.5,
  maxSamples: 64,
};

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidAuthoringRequestError(label + ' must be finite and greater than zero');
  }
  return value;
}

function normalizeProfile(profile: RigQaProfile = {}): NormalizedRigQaProfile {
  const width = profile.width ?? DEFAULT_PROFILE.width;
  const height = profile.height ?? DEFAULT_PROFILE.height;
  const alphaDeltaThreshold = profile.alphaDeltaThreshold ?? DEFAULT_PROFILE.alphaDeltaThreshold;
  const maxSamples = profile.maxSamples ?? DEFAULT_PROFILE.maxSamples;
  if (!Number.isInteger(width) || width < 16 || width > 4096) {
    throw new InvalidAuthoringRequestError('Rig QA width must be an integer from 16 through 4096');
  }
  if (!Number.isInteger(height) || height < 16 || height > 4096) {
    throw new InvalidAuthoringRequestError('Rig QA height must be an integer from 16 through 4096');
  }
  if (!Number.isInteger(alphaDeltaThreshold) || alphaDeltaThreshold < 0 || alphaDeltaThreshold > 255) {
    throw new InvalidAuthoringRequestError('Rig QA alphaDeltaThreshold must be an integer from 0 through 255');
  }
  if (!Number.isInteger(maxSamples) || maxSamples < 3 || maxSamples > 512) {
    throw new InvalidAuthoringRequestError('Rig QA maxSamples must be an integer from 3 through 512');
  }
  const minCoverageRatio = finitePositive(profile.minCoverageRatio ?? DEFAULT_PROFILE.minCoverageRatio, 'Rig QA minCoverageRatio');
  const maxCoverageRatio = finitePositive(profile.maxCoverageRatio ?? DEFAULT_PROFILE.maxCoverageRatio, 'Rig QA maxCoverageRatio');
  const maxBoundsAreaRatio = finitePositive(profile.maxBoundsAreaRatio ?? DEFAULT_PROFILE.maxBoundsAreaRatio, 'Rig QA maxBoundsAreaRatio');
  const maxBoundsSpanRatio = finitePositive(profile.maxBoundsSpanRatio ?? DEFAULT_PROFILE.maxBoundsSpanRatio, 'Rig QA maxBoundsSpanRatio');
  if (minCoverageRatio >= 1) {
    throw new InvalidAuthoringRequestError('Rig QA minCoverageRatio must be less than one');
  }
  if (maxCoverageRatio <= 1 || maxBoundsAreaRatio <= 1 || maxBoundsSpanRatio <= 1) {
    throw new InvalidAuthoringRequestError('Rig QA maximum ratios must be greater than one');
  }
  return {
    width,
    height,
    alphaDeltaThreshold,
    minCoverageRatio,
    maxCoverageRatio,
    maxBoundsAreaRatio,
    maxBoundsSpanRatio,
    maxSamples,
  };
}

function parameterContracts(plan: StandardCharacterRigBuildPlan): Map<string, ParameterContract> {
  const contracts = new Map<string, ParameterContract>();
  for (const operation of plan.operations) {
    if (operation.type !== 'parameter.create') continue;
    contracts.set(operation.name, {
      min: operation.min,
      max: operation.max,
      defaultValue: operation.defaultValue,
    });
  }
  return contracts;
}

function sortedValues(values: Readonly<Record<string, readonly [number, number]>>): PreviewParameterValues {
  return Object.fromEntries(
    Object.entries(values)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => [name, [value[0], value[1]] as [number, number]]),
  );
}

export function buildRigQaMatrix(
  plan: StandardCharacterRigBuildPlan,
  profile: RigQaProfile = {},
): RigQaSample[] {
  const normalized = normalizeProfile(profile);
  const contracts = parameterContracts(plan);
  const neutral: Record<string, [number, number]> = {};
  for (const motion of plan.motions) {
    const contract = contracts.get(motion.parameterName);
    if (!contract) {
      throw new InvalidAuthoringRequestError(
        'Rig QA cannot build a matrix without parameter.create for ' + motion.parameterName,
      );
    }
    neutral[motion.parameterName] = [...contract.defaultValue];
  }

  const samples: RigQaSample[] = [{
    id: 'neutral',
    kind: 'neutral',
    parameters: sortedValues(neutral),
  }];

  for (const motion of plan.motions) {
    const contract = contracts.get(motion.parameterName)!;
    samples.push({
      id: motion.motionId + '-min',
      kind: 'motion-min',
      motionId: motion.motionId,
      parameters: sortedValues({ ...neutral, [motion.parameterName]: contract.min }),
    });
    samples.push({
      id: motion.motionId + '-max',
      kind: 'motion-max',
      motionId: motion.motionId,
      parameters: sortedValues({ ...neutral, [motion.parameterName]: contract.max }),
    });
  }

  const combinedMin = { ...neutral };
  const combinedMax = { ...neutral };
  for (const motion of plan.motions) {
    const contract = contracts.get(motion.parameterName)!;
    combinedMin[motion.parameterName] = [...contract.min];
    combinedMax[motion.parameterName] = [...contract.max];
  }
  samples.push({ id: 'combined-min', kind: 'combined-min', parameters: sortedValues(combinedMin) });
  samples.push({ id: 'combined-max', kind: 'combined-max', parameters: sortedValues(combinedMax) });

  if (samples.length > normalized.maxSamples) {
    throw new InvalidAuthoringRequestError(
      'Rig QA matrix requires ' + samples.length + ' samples, exceeding maxSamples=' + normalized.maxSamples,
    );
  }
  return samples;
}

function diagnostic(
  code: RigQaDiagnosticCode,
  severity: RigQaSeverity,
  semanticTarget: string,
  message: string,
  evidence: RigQaDiagnostic['evidence'],
  suggestedRemediation: RigQaRemediationClass,
  sampleId?: string,
): RigQaDiagnostic {
  return {
    code,
    severity,
    semanticTarget,
    ...(sampleId === undefined ? {} : { sampleId }),
    evidence,
    suggestedRemediation,
    message,
  };
}

function triangleArea(mesh: PuppetInspectionMesh, offset: number): number {
  const a = mesh.vertices[mesh.indices[offset]!]!;
  const b = mesh.vertices[mesh.indices[offset + 1]!]!;
  const c = mesh.vertices[mesh.indices[offset + 2]!]!;
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
}

function validateOpposedMotion(motion: StandardRigPlannedMotion): boolean {
  if (motion.mirror !== 'opposed') return true;
  const positive = motion.targets.filter((target) => target.sign === 1);
  const negative = motion.targets.filter((target) => target.sign === -1);
  if (positive.length === 0 || positive.length !== negative.length) return false;
  const signature = (target: StandardRigPlannedMotion['targets'][number]) =>
    target.keypoints.map((point) => [point.at[0], Math.abs(point.value)] as const);
  const positiveSignatures = positive.map(signature).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const negativeSignatures = negative.map(signature).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify(positiveSignatures) === JSON.stringify(negativeSignatures);
}

export function analyzeRigQaInspection(
  plan: StandardCharacterRigBuildPlan,
  inspection: PuppetInspection,
): RigQaDiagnostic[] {
  const diagnostics: RigQaDiagnostic[] = [];
  const contracts = parameterContracts(plan);
  const parameters = new Map(inspection.parameters.map((parameter) => [parameter.name, parameter] as const));
  const nodes = new Map(inspection.nodes.map((node) => [node.path, node] as const));
  const checkedMeshes = new Set<string>();

  for (const motion of plan.motions) {
    const parameter = parameters.get(motion.parameterName);
    const contract = contracts.get(motion.parameterName);
    if (!parameter) {
      diagnostics.push(diagnostic(
        'MISSING_PARAMETER', 'error', motion.motionId,
        'Compiled rig parameter is missing from the authored puppet.',
        { parameterName: motion.parameterName },
        'binding',
      ));
    } else if (contract && (
      JSON.stringify(parameter.min) !== JSON.stringify(contract.min) ||
      JSON.stringify(parameter.max) !== JSON.stringify(contract.max) ||
      JSON.stringify(parameter.defaultValue) !== JSON.stringify(contract.defaultValue)
    )) {
      diagnostics.push(diagnostic(
        'PARAMETER_RANGE_MISMATCH', 'error', motion.motionId,
        'Authored parameter range/default does not match the compiled semantic contract.',
        { parameterName: motion.parameterName },
        'range',
      ));
    }

    for (const target of motion.targets) {
      const node = nodes.get(target.path);
      if (!node) {
        diagnostics.push(diagnostic(
          'MISSING_TARGET', 'error', target.layerId,
          'Compiled semantic target path is missing from the authored puppet.',
          { path: target.path, motionId: motion.motionId },
          'binding',
        ));
        continue;
      }
      if (parameter && !parameter.bindings.some((binding) =>
        binding.targetPath === target.path && binding.property === motion.property)) {
        diagnostics.push(diagnostic(
          'MISSING_BINDING', 'error', target.layerId,
          'Expected compiled parameter binding is missing from the authored puppet.',
          { path: target.path, parameterName: motion.parameterName, property: motion.property },
          'binding',
        ));
      }

      if (node.mesh && !checkedMeshes.has(node.path)) {
        checkedMeshes.add(node.path);
        let nonDegenerate = false;
        for (let index = 0; index < node.mesh.indices.length; index += 3) {
          if (triangleArea(node.mesh, index) > 1e-6) {
            nonDegenerate = true;
            break;
          }
        }
        if (!nonDegenerate) {
          diagnostics.push(diagnostic(
            'DEGENERATE_GEOMETRY', 'error', target.layerId,
            'Target mesh contains no non-degenerate triangle.',
            { path: target.path, triangleCount: node.mesh.indices.length / 3 },
            'mesh',
          ));
        }
      }
    }

    if (!validateOpposedMotion(motion)) {
      diagnostics.push(diagnostic(
        'BROKEN_SYMMETRY', 'error', motion.motionId,
        'Opposed mirrored motion does not contain balanced opposite target responses.',
        { targetCount: motion.targets.length, parameterName: motion.parameterName },
        'symmetry',
      ));
    }
  }

  return diagnostics;
}

function boundsArea(bounds: PreviewFrameMetadata['bounds']): number | null {
  if (!bounds) return null;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) return null;
  return width * height;
}

function compareAlpha(left: RasterAlpha, right: RasterAlpha, threshold: number): { changed: number; ratio: number } {
  if (left.width !== right.width || left.height !== right.height || left.alpha.length !== right.alpha.length) {
    return { changed: Math.max(left.alpha.length, right.alpha.length), ratio: 1 };
  }
  let changed = 0;
  for (let index = 0; index < left.alpha.length; index += 1) {
    if (Math.abs((left.alpha[index] ?? 0) - (right.alpha[index] ?? 0)) > threshold) changed += 1;
  }
  return { changed, ratio: left.alpha.length === 0 ? 0 : changed / left.alpha.length };
}

function sampleComparison(
  neutral: RigQaRenderedEvidence,
  sample: RigQaRenderedEvidence,
  profile: NormalizedRigQaProfile,
): RigQaSampleComparison {
  const alpha = compareAlpha(neutral.alpha, sample.alpha, profile.alphaDeltaThreshold);
  const neutralCoverage = neutral.metadata.coveredPixelSamples ?? 0;
  const sampleCoverage = sample.metadata.coveredPixelSamples ?? 0;
  const neutralArea = boundsArea(neutral.metadata.bounds);
  const sampleArea = boundsArea(sample.metadata.bounds);
  return {
    sameHash: neutral.sha256 === sample.sha256,
    alphaChangedPixels: alpha.changed,
    alphaChangedRatio: alpha.ratio,
    coverageRatio: neutralCoverage > 0 ? sampleCoverage / neutralCoverage : null,
    boundsAreaRatio: neutralArea !== null && neutralArea > 0 && sampleArea !== null ? sampleArea / neutralArea : null,
  };
}

export function analyzeRigQaRenderedEvidence(
  plan: StandardCharacterRigBuildPlan,
  evidence: readonly RigQaRenderedEvidence[],
  profile: RigQaProfile = {},
): { samples: RigQaSampleReport[]; diagnostics: RigQaDiagnostic[] } {
  const normalized = normalizeProfile(profile);
  const neutral = evidence.find((entry) => entry.sample.kind === 'neutral');
  if (!neutral) throw new InvalidAuthoringRequestError('Rig QA evidence requires a neutral sample');

  const diagnostics: RigQaDiagnostic[] = [];
  const reports: RigQaSampleReport[] = evidence.map((entry) => {
    const covered = entry.metadata.coveredPixelSamples ?? 0;
    const comparison = entry === neutral ? null : sampleComparison(neutral, entry, normalized);
    if (!entry.metadata.hasRenderableContent || covered <= 0) {
      diagnostics.push(diagnostic(
        'EMPTY_RENDER', 'error', entry.sample.motionId ?? 'character',
        'Preview sample rendered no visible content.',
        { coveredPixelSamples: covered, hasRenderableContent: entry.metadata.hasRenderableContent },
        'layout',
        entry.sample.id,
      ));
    }
    if (comparison?.coverageRatio !== null && comparison.coverageRatio < normalized.minCoverageRatio) {
      diagnostics.push(diagnostic(
        'DISAPPEARING_CONTENT', 'error', entry.sample.motionId ?? 'character',
        'Preview coverage collapsed relative to the neutral state.',
        { coverageRatio: comparison.coverageRatio, minimum: normalized.minCoverageRatio },
        'range',
        entry.sample.id,
      ));
    }
    if (
      comparison?.coverageRatio !== null &&
      comparison.coverageRatio > normalized.maxCoverageRatio
    ) {
      diagnostics.push(diagnostic(
        'EXCESSIVE_DEFORMATION', 'warning', entry.sample.motionId ?? 'character',
        'Preview coverage expanded excessively relative to the neutral state.',
        { coverageRatio: comparison.coverageRatio, maximum: normalized.maxCoverageRatio },
        'range',
        entry.sample.id,
      ));
    }
    if (
      comparison?.boundsAreaRatio !== null &&
      comparison.boundsAreaRatio > normalized.maxBoundsAreaRatio
    ) {
      diagnostics.push(diagnostic(
        'EXCESSIVE_DEFORMATION', 'warning', entry.sample.motionId ?? 'character',
        'Preview bounds expanded excessively relative to the neutral state.',
        { boundsAreaRatio: comparison.boundsAreaRatio, maximum: normalized.maxBoundsAreaRatio },
        'range',
        entry.sample.id,
      ));
    }

    const bounds = entry.metadata.bounds;
    if (bounds) {
      const spanX = bounds.maxX - bounds.minX;
      const spanY = bounds.maxY - bounds.minY;
      if (
        spanX > normalized.width * normalized.maxBoundsSpanRatio ||
        spanY > normalized.height * normalized.maxBoundsSpanRatio
      ) {
        diagnostics.push(diagnostic(
          'OUT_OF_BOUNDS', 'warning', entry.sample.motionId ?? 'character',
          'Preview bounds exceed the configured QA frame span budget.',
          { spanX, spanY, width: normalized.width, height: normalized.height, maximumRatio: normalized.maxBoundsSpanRatio },
          'layout',
          entry.sample.id,
        ));
      }
    }

    return {
      id: entry.sample.id,
      kind: entry.sample.kind,
      ...(entry.sample.motionId === undefined ? {} : { motionId: entry.sample.motionId }),
      artifact: entry.artifact,
      sha256: entry.sha256,
      hasRenderableContent: entry.metadata.hasRenderableContent,
      coveredPixelSamples: covered,
      bounds: entry.metadata.bounds,
      triangleCount: entry.metadata.triangleCount ?? 0,
      comparisonToNeutral: comparison,
    };
  });

  for (const motion of plan.motions) {
    const min = evidence.find((entry) => entry.sample.motionId === motion.motionId && entry.sample.kind === 'motion-min');
    const max = evidence.find((entry) => entry.sample.motionId === motion.motionId && entry.sample.kind === 'motion-max');
    if (!min || !max) {
      throw new InvalidAuthoringRequestError('Rig QA evidence is missing min/max samples for motion ' + motion.motionId);
    }
    if (min.sha256 === max.sha256) {
      diagnostics.push(diagnostic(
        'NO_EXPECTED_MOTION', 'error', motion.motionId,
        'Parameter extremes produced identical rendered output.',
        { parameterName: motion.parameterName, sha256: min.sha256 },
        'binding',
      ));
    }
  }

  return { samples: reports, diagnostics };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) out[key] = canonicalValue(input[key]);
  return out;
}

function reportFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalValue(value)), 'utf8').digest('hex');
}

function safeArtifactName(index: number, sampleId: string): string {
  const safe = sampleId.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'sample';
  return String(index).padStart(3, '0') + '-' + safe + '.png';
}

function sortDiagnostics(diagnostics: RigQaDiagnostic[]): RigQaDiagnostic[] {
  return diagnostics.sort((left, right) =>
    left.code.localeCompare(right.code) ||
    left.semanticTarget.localeCompare(right.semanticTarget) ||
    (left.sampleId ?? '').localeCompare(right.sampleId ?? '') ||
    left.message.localeCompare(right.message));
}

export async function runRigQa(request: RunRigQaRequest): Promise<RigQaReport> {
  const profile = normalizeProfile(request.profile);
  const matrix = buildRigQaMatrix(request.plan, profile);
  const outputDir = path.resolve(process.cwd(), request.outputDir);
  await mkdir(outputDir, { recursive: true });

  const inspectOptions: InspectPuppetOptions = request.hostPath ? { hostPath: request.hostPath } : {};
  const inspection = await inspectPuppet(request.inputPath, inspectOptions);
  const evidence: RigQaRenderedEvidence[] = [];

  for (const [index, sample] of matrix.entries()) {
    const artifact = safeArtifactName(index, sample.id);
    const outputPath = path.join(outputDir, artifact);
    const metadata = await renderPreview({
      inputPath: request.inputPath,
      outputPath,
      width: profile.width,
      height: profile.height,
      parameters: sample.parameters,
      ...(request.hostPath === undefined ? {} : { hostPath: request.hostPath }),
    });
    const bytes = await readFile(outputPath);
    evidence.push({
      sample,
      artifact,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      metadata,
      alpha: decodePngAlphaBuffer(bytes, sample.id),
    });
  }

  const staticDiagnostics = analyzeRigQaInspection(request.plan, inspection);
  const rendered = analyzeRigQaRenderedEvidence(request.plan, evidence, profile);
  const diagnostics = sortDiagnostics([...staticDiagnostics, ...rendered.diagnostics]);
  const reportName = request.reportName ?? 'rig-qa-report.json';
  if (!reportName.endsWith('.json') || path.basename(reportName) !== reportName) {
    throw new InvalidAuthoringRequestError('Rig QA reportName must be a simple .json filename');
  }

  const payload = {
    schemaVersion: 1 as const,
    planFingerprint: request.plan.fingerprint,
    profile,
    pass: !diagnostics.some((entry) => entry.severity === 'error'),
    summary: {
      sampleCount: rendered.samples.length,
      errorCount: diagnostics.filter((entry) => entry.severity === 'error').length,
      warningCount: diagnostics.filter((entry) => entry.severity === 'warning').length,
    },
    samples: rendered.samples,
    diagnostics,
    reportArtifact: reportName,
  };
  const report: RigQaReport = { ...payload, fingerprint: reportFingerprint(payload) };
  await writeFile(path.join(outputDir, reportName), JSON.stringify(report, null, 2) + '\n', 'utf8');
  return report;
}
