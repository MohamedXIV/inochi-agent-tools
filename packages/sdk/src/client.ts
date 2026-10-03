import {
  buildRigProject,
  createPuppet,
  editPuppet,
  evaluateParameterValues,
  inspectPuppet,
  inspectRigProjectManifest,
  renderPreview,
  savePuppet,
  validatePuppet,
  type BuildRigProjectRequest,
  type BuildRigProjectResult,
  type CreatePuppetRequest,
  type CreatePuppetResult,
  type EditPuppetRequest,
  type EditPuppetResult,
  type EvaluateParameterValuesOptions,
  type ParameterEvaluationResult,
  type PuppetInspection,
  type RenderPreviewRequest,
  type PreviewFrameMetadata,
  type RigProjectInspection,
  type SavePuppetRequest,
  type SavePuppetResult,
} from '@inochi-agent-tools/core';

export interface InspectPuppetRequest {
  inputPath: string;
}

export interface NormalizeRigProjectRequest {
  manifest: unknown;
}

export interface AuthoringClient {
  buildRigProject(request: BuildRigProjectRequest): Promise<BuildRigProjectResult>;
  createPuppet(request: CreatePuppetRequest): Promise<CreatePuppetResult>;
  inspectPuppet(request: InspectPuppetRequest): Promise<PuppetInspection>;
  normalizeRigProject(request: NormalizeRigProjectRequest): Promise<RigProjectInspection>;
  validatePuppet(request: InspectPuppetRequest): Promise<PuppetInspection>;
  savePuppet(request: SavePuppetRequest): Promise<SavePuppetResult>;
  editPuppet(request: EditPuppetRequest): Promise<EditPuppetResult>;
  evaluateParameters(request: EvaluateParameterValuesOptions): Promise<ParameterEvaluationResult>;
  renderPreview(request: RenderPreviewRequest): Promise<PreviewFrameMetadata>;
}

export function createAuthoringClient(): AuthoringClient {
  return {
    buildRigProject,
    createPuppet,
    inspectPuppet: ({ inputPath }) => inspectPuppet(inputPath),
    normalizeRigProject: async ({ manifest }) => inspectRigProjectManifest(manifest),
    validatePuppet: ({ inputPath }) => validatePuppet(inputPath),
    savePuppet,
    editPuppet,
    evaluateParameters: evaluateParameterValues,
    renderPreview,
  };
}
