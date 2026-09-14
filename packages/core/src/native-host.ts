import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { InvalidPuppetError, NativeBridgeError } from './errors.js';
import { parsePuppetInspection, type PuppetInspection } from './inspection.js';

const execFileAsync = promisify(execFile);
const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;

export interface InspectPuppetOptions {
  hostPath?: string;
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

interface ExecFailure extends Error {
  code?: string | number;
  stdout?: string;
  stderr?: string;
  signal?: NodeJS.Signals;
}

function failureDiagnostic(failure: ExecFailure): string {
  return failure.stderr?.trim() || failure.message || 'native puppet inspection failed';
}

function parseHostOutput(stdout: string): PuppetInspection {
  let decoded: unknown;
  try {
    decoded = JSON.parse(stdout);
  } catch (error) {
    throw new NativeBridgeError(
      `Native host emitted invalid inspection JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    return parsePuppetInspection(decoded);
  } catch (error) {
    throw new NativeBridgeError(
      `Native host emitted an invalid inspection snapshot: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function inspectPuppet(
  puppetPath: string,
  options: InspectPuppetOptions = {},
): Promise<PuppetInspection> {
  const hostPath = options.hostPath ?? defaultNativeHostPath();

  try {
    const { stdout } = await execFileAsync(
      hostPath,
      ['inspect', path.resolve(process.cwd(), puppetPath)],
      {
        cwd: process.cwd(),
        env: nativeHostEnv(),
        encoding: 'utf8',
        maxBuffer: MAX_CAPTURE_BYTES,
        windowsHide: true,
      },
    );

    return parseHostOutput(stdout);
  } catch (error) {
    if (error instanceof InvalidPuppetError || error instanceof NativeBridgeError) {
      throw error;
    }

    const failure = error as ExecFailure;
    if (failure.code === 3) {
      throw new InvalidPuppetError(failureDiagnostic(failure));
    }

    throw new NativeBridgeError(failureDiagnostic(failure));
  }
}

export async function validatePuppet(
  puppetPath: string,
  options: InspectPuppetOptions = {},
): Promise<PuppetInspection> {
  return inspectPuppet(puppetPath, options);
}
