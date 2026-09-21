import {
  createPuppet,
  editPuppet,
  evaluateParameterValues,
  inspectPuppet,
  renderPreview,
  savePuppet,
  validatePuppet,
  type CreatePuppetRequest,
  type CreatePuppetResult,
  type EditPuppetRequest,
  type EditPuppetResult,
  type EvaluateParameterValuesOptions,
  type ParameterEvaluationResult,
  type PuppetInspection,
  type RenderPreviewRequest,
  type PreviewFrameMetadata,
  type SavePuppetRequest,
  type SavePuppetResult,
} from '@inochi-agent-tools/core';

export interface InspectPuppetRequest {
  inputPath: string;
}

export interface AuthoringClient {
  createPuppet(request: CreatePuppetRequest): Promise<CreatePuppetResult>;
  inspectPuppet(request: InspectPuppetRequest): Promise<PuppetInspection>;
  validatePuppet(request: InspectPuppetRequest): Promise<PuppetInspection>;
  savePuppet(request: SavePuppetRequest): Promise<SavePuppetResult>;
  editPuppet(request: EditPuppetRequest): Promise<EditPuppetResult>;
  evaluateParameters(request: EvaluateParameterValuesOptions): Promise<ParameterEvaluationResult>;
  renderPreview(request: RenderPreviewRequest): Promise<PreviewFrameMetadata>;
}

export function createAuthoringClient(): AuthoringClient {
  return {
    createPuppet,
    inspectPuppet: ({ inputPath }) => inspectPuppet(inputPath),
    validatePuppet: ({ inputPath }) => validatePuppet(inputPath),
    savePuppet,
    editPuppet,
    evaluateParameters: evaluateParameterValues,
    renderPreview,
  };
}
