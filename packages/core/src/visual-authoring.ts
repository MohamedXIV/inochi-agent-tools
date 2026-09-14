import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import type { NativeHostOptions } from './authoring.js';
import {
  InvalidAuthoringRequestError,
  InvalidHierarchyError,
  InvalidTextureAssetError,
  MissingTextureError,
  NativeBridgeError,
  PuppetAlreadyExistsError,
  RoundTripMismatchError,
} from './errors.js';
import { parsePuppetInspection, type PuppetInspection } from './inspection.js';

const execFileAsync = promisify(execFile);
const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;

export type VisualEditOperation =
  | { type: 'texture.import'; key: string; imagePath: string }
  | { type: 'node.create'; parentPath: string; name: string }
  | { type: 'part.create'; parentPath: string; name: string; textureKey: string }
  | { type: 'part.setTexture'; path: string; textureKey: string }
  | { type: 'node.reparent'; path: string; newParentPath: string }
  | { type: 'node.remove'; path: string };

export interface EditPuppetRequest {
  inputPath: string;
  outputPath: string;
  operations: VisualEditOperation[];
}

export interface EditPuppetResult {
  path: string;
  inspection: PuppetInspection;
}

interface ExecFailure extends Error {
  code?: string | number;
  stderr?: string;
}

function defaultNativeHostPath(): string {
  const executable = process.platform === 'win32' ? 'iat_native_host.exe' : 'iat_native_host';
  return path.resolve(process.cwd(), '.build', 'native', executable);
}

function nativeHostEnv(): NodeJS.ProcessEnv {
  const outDir = path.resolve(process.cwd(), '.build', 'native');
  return {
    ...process.env,
    LD_LIBRARY_PATH: [outDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
    DYLD_LIBRARY_PATH: [outDir, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),
    PATH: [outDir, process.env.PATH].filter(Boolean).join(path.delimiter),
  };
}

function failureDiagnostic(failure: ExecFailure): string {
  return failure.stderr?.trim() || failure.message || 'native visual authoring failed';
}

function requireSemanticText(value: string, label: string): void {
  if (!value.trim()) throw new InvalidAuthoringRequestError(`${label} must not be blank`);
  if (value.includes('\0')) throw new InvalidAuthoringRequestError(`${label} must not contain NUL`);
}

function validateOperation(operation: VisualEditOperation): void {
  switch (operation.type) {
    case 'texture.import':
      requireSemanticText(operation.key, 'Texture key');
      requireSemanticText(operation.imagePath, 'Texture image path');
      return;
    case 'node.create':
      requireSemanticText(operation.parentPath, 'Parent path');
      requireSemanticText(operation.name, 'Node name');
      return;
    case 'part.create':
      requireSemanticText(operation.parentPath, 'Parent path');
      requireSemanticText(operation.name, 'Part name');
      requireSemanticText(operation.textureKey, 'Texture key');
      return;
    case 'part.setTexture':
      requireSemanticText(operation.path, 'Part path');
      requireSemanticText(operation.textureKey, 'Texture key');
      return;
    case 'node.reparent':
      requireSemanticText(operation.path, 'Node path');
      requireSemanticText(operation.newParentPath, 'New parent path');
      return;
    case 'node.remove':
      requireSemanticText(operation.path, 'Node path');
      return;
  }
}

function validateEditPuppetRequest(request: EditPuppetRequest): void {
  if (path.extname(request.inputPath).toLowerCase() !== '.inp' ||
      path.extname(request.outputPath).toLowerCase() !== '.inp') {
    throw new InvalidAuthoringRequestError('Visual authoring input and output paths must end in .inp');
  }
  requireSemanticText(request.inputPath, 'Input path');
  requireSemanticText(request.outputPath, 'Output path');

  const input = path.resolve(process.cwd(), request.inputPath);
  const output = path.resolve(process.cwd(), request.outputPath);
  if (input === output) {
    throw new InvalidAuthoringRequestError('Visual authoring requires distinct input and output paths');
  }
  if (request.operations.length === 0) {
    throw new InvalidAuthoringRequestError('Visual authoring requires at least one operation');
  }
  for (const operation of request.operations) validateOperation(operation);
}

export async function editPuppet(
  request: EditPuppetRequest,
  options: NativeHostOptions = {},
): Promise<EditPuppetResult> {
  validateEditPuppetRequest(request);

  const inputPath = path.resolve(process.cwd(), request.inputPath);
  const outputPath = path.resolve(process.cwd(), request.outputPath);
  const hostPath = options.hostPath ?? defaultNativeHostPath();

  try {
    const { stdout } = await execFileAsync(
      hostPath,
      ['edit-visual', inputPath, outputPath, JSON.stringify(request.operations)],
      {
        cwd: process.cwd(),
        env: nativeHostEnv(),
        encoding: 'utf8',
        maxBuffer: MAX_CAPTURE_BYTES,
        windowsHide: true,
      },
    );

    let decoded: unknown;
    try {
      decoded = JSON.parse(stdout);
    } catch (error) {
      throw new NativeBridgeError(
        `Native host emitted invalid visual authoring JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let inspection: PuppetInspection;
    try {
      inspection = parsePuppetInspection(decoded);
    } catch (error) {
      throw new NativeBridgeError(
        `Native host emitted an invalid visual authoring snapshot: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return { path: outputPath, inspection };
  } catch (error) {
    if (
      error instanceof InvalidAuthoringRequestError ||
      error instanceof InvalidHierarchyError ||
      error instanceof MissingTextureError ||
      error instanceof InvalidTextureAssetError ||
      error instanceof PuppetAlreadyExistsError ||
      error instanceof RoundTripMismatchError ||
      error instanceof NativeBridgeError
    ) {
      throw error;
    }

    const failure = error as ExecFailure;
    const diagnostic = failureDiagnostic(failure);
    if (failure.code === 5) throw new PuppetAlreadyExistsError(diagnostic);
    if (failure.code === 6) throw new RoundTripMismatchError(diagnostic);
    if (failure.code === 7) throw new InvalidHierarchyError(diagnostic);
    if (failure.code === 8) throw new MissingTextureError(diagnostic);
    if (failure.code === 9) throw new InvalidTextureAssetError(diagnostic);
    throw new NativeBridgeError(diagnostic);
  }
}
