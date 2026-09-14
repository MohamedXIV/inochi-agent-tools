import path from 'node:path';

import { InvalidAuthoringRequestError, NativeBridgeError } from './errors.js';
import type { PuppetInspection } from './inspection.js';

export interface CreatePuppetRequest {
  outputPath: string;
  name: string;
}

export interface CreatePuppetResult {
  path: string;
  inspection: PuppetInspection;
}

export interface NativeHostOptions {
  hostPath?: string;
}

function validateCreatePuppetRequest(request: CreatePuppetRequest): void {
  if (!request.name.trim()) {
    throw new InvalidAuthoringRequestError('Puppet name must contain at least one non-whitespace character');
  }

  if (request.name.includes('\0')) {
    throw new InvalidAuthoringRequestError('Puppet name must not contain NUL');
  }

  if (path.extname(request.outputPath).toLowerCase() !== '.inp') {
    throw new InvalidAuthoringRequestError('Puppet output path must end in .inp');
  }
}

async function runNativeAuthoringHost(
  _request: CreatePuppetRequest,
  _options: NativeHostOptions,
): Promise<CreatePuppetResult> {
  throw new NativeBridgeError('create-minimal host command not implemented');
}

export async function createPuppet(
  request: CreatePuppetRequest,
  options: NativeHostOptions = {},
): Promise<CreatePuppetResult> {
  validateCreatePuppetRequest(request);
  return runNativeAuthoringHost(request, options);
}
