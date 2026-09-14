import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  InvalidAuthoringRequestError,
  NativeBridgeError,
  PuppetAlreadyExistsError,
  RoundTripMismatchError,
} from './errors.js';
import { parsePuppetInspection, type PuppetInspection } from './inspection.js';

const execFileAsync = promisify(execFile);
const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;

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
  return failure.stderr?.trim() || failure.message || 'native puppet authoring failed';
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

export async function createPuppet(
  request: CreatePuppetRequest,
  options: NativeHostOptions = {},
): Promise<CreatePuppetResult> {
  validateCreatePuppetRequest(request);

  const outputPath = path.resolve(process.cwd(), request.outputPath);
  const hostPath = options.hostPath ?? defaultNativeHostPath();

  try {
    const { stdout } = await execFileAsync(
      hostPath,
      ['create-minimal', outputPath, request.name],
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
        `Native host emitted invalid authoring JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let inspection: PuppetInspection;
    try {
      inspection = parsePuppetInspection(decoded);
    } catch (error) {
      throw new NativeBridgeError(
        `Native host emitted an invalid authoring snapshot: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (inspection.metadata.name !== request.name) {
      throw new RoundTripMismatchError(
        `Saved puppet reopened as ${JSON.stringify(inspection.metadata.name)} instead of ${JSON.stringify(request.name)}`,
      );
    }

    return { path: outputPath, inspection };
  } catch (error) {
    if (
      error instanceof InvalidAuthoringRequestError ||
      error instanceof PuppetAlreadyExistsError ||
      error instanceof RoundTripMismatchError ||
      error instanceof NativeBridgeError
    ) {
      throw error;
    }

    const failure = error as ExecFailure;
    const diagnostic = failureDiagnostic(failure);
    if (failure.code === 4) throw new InvalidAuthoringRequestError(diagnostic);
    if (failure.code === 5) throw new PuppetAlreadyExistsError(diagnostic);
    if (failure.code === 6) throw new RoundTripMismatchError(diagnostic);
    throw new NativeBridgeError(diagnostic);
  }
}
