import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createPuppet, editPuppet } from './authoring.js';
import { fitRigProjectMeshes, partSetMeshOperation } from './mesh-generation.js';
import { inspectRigProjectManifest } from './rig-project.js';
import { runRigQa, type RigQaReport } from './rig-qa.js';
import { runBoundedRigRepair, type RigRepairLoopResult } from './rig-repair.js';
import { compileStandardCharacterRig, type StandardCharacterRigBuildPlan } from './standard-rig-compiler.js';
import type { PuppetEditOperation } from './visual-authoring.js';

export interface BuildRigProjectRequest {
  manifest: unknown;
  projectDir: string;
  outputDir: string;
  outputName?: string;
  overwrite?: boolean;
  repair?: boolean;
}

export interface BuildRigArtifactPaths {
  puppet: string;
  qaReport: string;
  provenance: string;
  previewDir: string;
}

export interface BuildRigProjectResult {
  schemaVersion: 1;
  status: 'green' | 'blocked';
  manifestFingerprint: string;
  buildFingerprint: string;
  artifacts: BuildRigArtifactPaths;
  planFingerprint: string;
  qa: RigQaReport;
  repair?: RigRepairLoopResult;
}

function stableJson(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (!input || typeof input !== 'object') return input;
    const record = input as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonical(record[key])]));
  };
  return JSON.stringify(canonical(value));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function assertAbsent(filePath: string, overwrite: boolean): Promise<void> {
  if (overwrite) return;
  try {
    await readFile(filePath);
    throw new Error('Refusing to overwrite existing build artifact: ' + filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

function deriveName(name: string): string {
  const normalized = name.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'rig';
}

async function compilePlan(
  manifest: ReturnType<typeof inspectRigProjectManifest>['manifest'],
  projectDir: string,
): Promise<StandardCharacterRigBuildPlan> {
  const meshPlan = await fitRigProjectMeshes(manifest, { projectDir });
  return compileStandardCharacterRig({ manifest, meshPlan });
}

function buildOperations(plan: StandardCharacterRigBuildPlan, puppetRoot = '/Root'): PuppetEditOperation[] {
  const operations: PuppetEditOperation[] = [];
  for (const fit of plan.meshPlan.layers) {
    operations.push(partSetMeshOperation(fit, puppetRoot + '/' + fit.layerId));
  }
  operations.push(...plan.operations);
  return operations;
}

export async function buildRigProject(request: BuildRigProjectRequest): Promise<BuildRigProjectResult> {
  const inspection = inspectRigProjectManifest(request.manifest);
  const projectDir = path.resolve(request.projectDir);
  const outputDir = path.resolve(request.outputDir);
  const outputName = deriveName(request.outputName ?? inspection.manifest.name);
  const artifacts: BuildRigArtifactPaths = {
    puppet: path.join(outputDir, outputName + '.inp'),
    qaReport: path.join(outputDir, outputName + '.qa.json'),
    provenance: path.join(outputDir, outputName + '.provenance.json'),
    previewDir: path.join(outputDir, outputName + '.previews'),
  };

  await mkdir(outputDir, { recursive: true });
  await mkdir(artifacts.previewDir, { recursive: true });
  await Promise.all([
    assertAbsent(artifacts.puppet, request.overwrite === true),
    assertAbsent(artifacts.qaReport, request.overwrite === true),
    assertAbsent(artifacts.provenance, request.overwrite === true),
  ]);

  let plan = await compilePlan(inspection.manifest, projectDir);
  const seedPath = path.join(outputDir, '.' + outputName + '.seed.inp');
  await createPuppet({ outputPath: seedPath, name: inspection.manifest.name });
  await editPuppet({ inputPath: seedPath, outputPath: artifacts.puppet, operations: buildOperations(plan) });

  let qa = await runRigQa({ inputPath: artifacts.puppet, plan, outputDir: artifacts.previewDir });
  let repair: RigRepairLoopResult | undefined;
  if (!qa.pass && request.repair !== false) {
    repair = await runBoundedRigRepair(plan, qa, async (candidate) => {
      const candidatePath = path.join(outputDir, '.' + outputName + '.candidate.inp');
      await editPuppet({ inputPath: seedPath, outputPath: candidatePath, operations: buildOperations(candidate) });
      return runRigQa({ inputPath: candidatePath, plan: candidate, outputDir: artifacts.previewDir });
    });
    plan = repair.plan;
    qa = repair.qa;
    if (repair.status === 'green') {
      await editPuppet({ inputPath: seedPath, outputPath: artifacts.puppet, operations: buildOperations(plan) });
    }
  }

  await writeFile(artifacts.qaReport, JSON.stringify(qa, null, 2) + '\n', 'utf8');
  const buildFingerprint = sha256(stableJson({
    manifestFingerprint: inspection.fingerprint,
    planFingerprint: plan.fingerprint,
    qaFingerprint: qa.fingerprint,
  }));
  const provenance = {
    schemaVersion: 1,
    manifestFingerprint: inspection.fingerprint,
    planFingerprint: plan.fingerprint,
    qaFingerprint: qa.fingerprint,
    buildFingerprint,
    artifacts,
  };
  await writeFile(artifacts.provenance, JSON.stringify(provenance, null, 2) + '\n', 'utf8');

  return {
    schemaVersion: 1,
    status: qa.pass ? 'green' : 'blocked',
    manifestFingerprint: inspection.fingerprint,
    buildFingerprint,
    artifacts,
    planFingerprint: plan.fingerprint,
    qa,
    ...(repair ? { repair } : {}),
  };
}
