import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

import { createPuppet } from './authoring.js';
import { fitRigProjectMeshes, partSetMeshOperation, type RigProjectMeshPlan } from './mesh-generation.js';
import { inspectRigProjectManifest, type NormalizedRigProjectManifest } from './rig-project.js';
import { runRigQa, type RigQaProfile, type RigQaReport } from './rig-qa.js';
import { runBoundedRigRepair, type RigRepairLoopResult } from './rig-repair.js';
import {
  compileStandardCharacterRig,
  type StandardCharacterRigBuildPlan,
  type StandardRigMotionProfile,
} from './standard-rig-compiler.js';
import { editPuppet, type PuppetEditOperation } from './visual-authoring.js';

export type RigBuildStage =
  | 'validate'
  | 'mesh'
  | 'compile'
  | 'author'
  | 'qa'
  | 'repair'
  | 'current-format'
  | 'provenance';

export class RigBuildStageError extends Error {
  readonly code = 'RIG_BUILD_STAGE_FAILED' as const;
  readonly stage: RigBuildStage;
  readonly details: { stage: RigBuildStage; causeCode?: string };

  constructor(stage: RigBuildStage, cause: unknown) {
    super('Rig build failed during ' + stage + '.');
    this.name = 'RigBuildStageError';
    this.stage = stage;
    const causeCode =
      typeof cause === 'object' && cause !== null && 'code' in cause && typeof (cause as { code?: unknown }).code === 'string'
        ? (cause as { code: string }).code
        : undefined;
    this.details = causeCode ? { stage, causeCode } : { stage };
  }
}

async function runBuildStage<T>(stage: RigBuildStage, operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RigBuildStageError) throw error;
    throw new RigBuildStageError(stage, error);
  }
}

export interface BuildRigProjectRequest {
  manifest: unknown;
  projectDir: string;
  outputDir: string;
  outputName?: string;
  profiles?: Readonly<Record<string, StandardRigMotionProfile>>;
  qaProfile?: RigQaProfile;
  overwrite?: boolean;
  repair?: boolean;
  currentFormatExecutable?: string;
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
  currentFormat?: {
    magic: 'TRNSRTS2';
    sha256: string;
    roundtripSha256: string;
  };
}

function defaultCurrentFormatExecutable(): string {
  return path.resolve(
    '.build',
    'current-format',
    process.platform === 'win32' ? 'iat_current_format_probe.exe' : 'iat_current_format_probe',
  );
}

async function convertToCurrentFormat(
  stablePath: string,
  outputPath: string,
  roundtripPath: string,
  executable = defaultCurrentFormatExecutable(),
): Promise<{ magic: 'TRNSRTS2'; sha256: string; roundtripSha256: string }> {
  try {
    await execFileAsync(executable, ['--conversion-only', stablePath, outputPath, roundtripPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error('Current-format finalization failed; ensure the verified #47 current-format bridge is built and available.');
  }

  const output = await readFile(outputPath);
  const roundtrip = await readFile(roundtripPath);
  if (output.subarray(0, 8).toString('ascii') !== 'TRNSRTS2' || roundtrip.subarray(0, 8).toString('ascii') !== 'TRNSRTS2') {
    throw new Error('Current-format finalization did not emit exact TRNSRTS2 INP2 artifacts.');
  }
  return {
    magic: 'TRNSRTS2',
    sha256: createHash('sha256').update(output).digest('hex'),
    roundtripSha256: createHash('sha256').update(roundtrip).digest('hex'),
  };
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

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function prepareArtifact(target: string, overwrite: boolean, recursive = false): Promise<void> {
  if (!(await exists(target))) return;
  if (!overwrite) throw new Error('Refusing to overwrite existing build artifact: ' + target);
  await rm(target, { force: true, recursive });
}

function deriveName(name: string): string {
  const normalized = name.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'rig';
}

function buildLayerPaths(manifest: NormalizedRigProjectManifest): Record<string, string> {
  const byId = new Map(manifest.layers.map((layer) => [layer.id, layer] as const));
  const cache = new Map<string, string>();
  const visiting = new Set<string>();

  const resolve = (id: string): string => {
    const cached = cache.get(id);
    if (cached) return cached;
    if (visiting.has(id)) throw new Error('Rig project layer parent cycle at ' + id);
    const layer = byId.get(id);
    if (!layer) throw new Error('Unknown rig project layer ' + id);
    visiting.add(id);
    const parentPath = layer.parentId ? resolve(layer.parentId) : '/Root';
    const value = parentPath + '/' + layer.id;
    visiting.delete(id);
    cache.set(id, value);
    return value;
  };

  for (const layer of manifest.layers) resolve(layer.id);
  return Object.fromEntries([...cache.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function layerDepth(id: string, manifest: NormalizedRigProjectManifest): number {
  const byId = new Map(manifest.layers.map((layer) => [layer.id, layer] as const));
  let depth = 0;
  let current = byId.get(id);
  const seen = new Set<string>();
  while (current?.parentId) {
    if (seen.has(current.id)) throw new Error('Rig project layer parent cycle at ' + current.id);
    seen.add(current.id);
    depth += 1;
    current = byId.get(current.parentId);
  }
  return depth;
}

function buildOperations(
  manifest: NormalizedRigProjectManifest,
  projectDir: string,
  meshPlan: RigProjectMeshPlan,
  plan: StandardCharacterRigBuildPlan,
  layerPaths: Readonly<Record<string, string>>,
): PuppetEditOperation[] {
  const fitByLayer = new Map(meshPlan.layers.map((fit) => [fit.layerId, fit] as const));
  const layers = [...manifest.layers].sort((a, b) =>
    layerDepth(a.id, manifest) - layerDepth(b.id, manifest) || a.id.localeCompare(b.id),
  );
  const operations: PuppetEditOperation[] = [];

  for (const layer of layers) {
    const fit = fitByLayer.get(layer.id);
    if (!fit) throw new Error('Missing generated mesh for layer ' + layer.id);
    const parentPath = layer.parentId ? layerPaths[layer.parentId] : '/Root';
    if (!parentPath) throw new Error('Missing authored parent path for layer ' + layer.id);
    operations.push(
      { type: 'texture.import', key: layer.id, imagePath: path.join(projectDir, layer.source) },
      { type: 'part.create', parentPath, name: layer.id, textureKey: layer.id },
      partSetMeshOperation(fit, layerPaths[layer.id]!),
    );
  }

  operations.push(...plan.operations);
  return operations;
}

export async function buildRigProject(request: BuildRigProjectRequest): Promise<BuildRigProjectResult> {
  const inspection = await runBuildStage('validate', () => inspectRigProjectManifest(request.manifest));
  const projectDir = path.resolve(request.projectDir);
  const outputDir = path.resolve(request.outputDir);
  const outputName = deriveName(request.outputName ?? inspection.manifest.name);
  const artifacts: BuildRigArtifactPaths = {
    puppet: path.join(outputDir, outputName + '.inp'),
    qaReport: path.join(outputDir, outputName + '.qa.json'),
    provenance: path.join(outputDir, outputName + '.provenance.json'),
    previewDir: path.join(outputDir, outputName + '.previews'),
  };
  const overwrite = request.overwrite === true;

  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    prepareArtifact(artifacts.puppet, overwrite),
    prepareArtifact(artifacts.qaReport, overwrite),
    prepareArtifact(artifacts.provenance, overwrite),
    prepareArtifact(artifacts.previewDir, overwrite, true),
  ]);
  await mkdir(artifacts.previewDir, { recursive: true });

  const meshPlan = await runBuildStage('mesh', () =>
    fitRigProjectMeshes(request.manifest, { projectRoot: projectDir }),
  );
  const { layerPaths, compiledPlan } = await runBuildStage('compile', () => {
    const paths = buildLayerPaths(inspection.manifest);
    const plan = compileStandardCharacterRig({
      manifest: request.manifest,
      layerPaths: paths,
      ...(request.profiles ? { profiles: request.profiles } : {}),
    });
    return { layerPaths: paths, compiledPlan: plan };
  });
  let plan = compiledPlan;

  const seedPath = path.join(outputDir, '.' + outputName + '.seed.inp');
  const stablePath = path.join(outputDir, '.' + outputName + '.stable.inp');
  const candidatePath = path.join(outputDir, '.' + outputName + '.candidate.inp');
  const currentRoundtripPath = path.join(outputDir, '.' + outputName + '.current-roundtrip.inp');
  await rm(seedPath, { force: true });
  await rm(stablePath, { force: true });
  await rm(candidatePath, { force: true });
  await rm(currentRoundtripPath, { force: true });

  try {
    await runBuildStage('author', async () => {
      await createPuppet({ outputPath: seedPath, name: inspection.manifest.name });
      await editPuppet({
        inputPath: seedPath,
        outputPath: stablePath,
        operations: buildOperations(inspection.manifest, projectDir, meshPlan, plan, layerPaths),
      });
    });

    let qa = await runBuildStage('qa', () => runRigQa({
      inputPath: stablePath,
      plan,
      outputDir: artifacts.previewDir,
      ...(request.qaProfile ? { profile: request.qaProfile } : {}),
    }));
    let repair: RigRepairLoopResult | undefined;

    if (!qa.pass && request.repair !== false) {
      repair = await runBuildStage('repair', () => runBoundedRigRepair(plan, qa, async (candidate) => {
        await rm(candidatePath, { force: true });
        await editPuppet({
          inputPath: seedPath,
          outputPath: candidatePath,
          operations: buildOperations(inspection.manifest, projectDir, meshPlan, candidate, layerPaths),
        });
        return runRigQa({
          inputPath: candidatePath,
          plan: candidate,
          outputDir: artifacts.previewDir,
          ...(request.qaProfile ? { profile: request.qaProfile } : {}),
        });
      }));
      plan = repair.plan;
      qa = repair.qa;
      if (repair.status === 'green') {
        await rm(stablePath, { force: true });
        await editPuppet({
          inputPath: seedPath,
          outputPath: stablePath,
          operations: buildOperations(inspection.manifest, projectDir, meshPlan, plan, layerPaths),
        });
      }
    }

    let currentFormat: BuildRigProjectResult['currentFormat'];
    if (qa.pass) {
      currentFormat = await runBuildStage('current-format', () => convertToCurrentFormat(
        stablePath,
        artifacts.puppet,
        currentRoundtripPath,
        request.currentFormatExecutable,
      ));
    }

    const buildFingerprint = sha256(stableJson({
      manifestFingerprint: inspection.fingerprint,
      meshFingerprint: meshPlan.fingerprint,
      planFingerprint: plan.fingerprint,
      qaFingerprint: qa.fingerprint,
    }));
    await runBuildStage('provenance', async () => {
      await writeFile(artifacts.qaReport, JSON.stringify(qa, null, 2) + '\n', 'utf8');
      const provenance = {
        schemaVersion: 1,
        manifestFingerprint: inspection.fingerprint,
        meshFingerprint: meshPlan.fingerprint,
        planFingerprint: plan.fingerprint,
        qaFingerprint: qa.fingerprint,
        buildFingerprint,
        artifacts,
        ...(currentFormat ? { currentFormat } : {}),
      };
      await writeFile(artifacts.provenance, JSON.stringify(provenance, null, 2) + '\n', 'utf8');
    });

    return {
      schemaVersion: 1,
      status: qa.pass ? 'green' : 'blocked',
      manifestFingerprint: inspection.fingerprint,
      buildFingerprint,
      artifacts,
      planFingerprint: plan.fingerprint,
      qa,
      ...(repair ? { repair } : {}),
      ...(currentFormat ? { currentFormat } : {}),
    };
  } finally {
    await rm(seedPath, { force: true });
    await rm(stablePath, { force: true });
    await rm(candidatePath, { force: true });
    await rm(currentRoundtripPath, { force: true });
  }
}
