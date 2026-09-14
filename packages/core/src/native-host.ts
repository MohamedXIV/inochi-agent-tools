import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { InvalidPuppetError, NativeBridgeError } from './errors.js';
import { parsePuppetInspection, type PuppetInspection } from './inspection.js';

const execFileAsync = promisify(execFile);

function nativeHostPath(): string {
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
}

export async function inspectPuppet(puppetPath: string): Promise<PuppetInspection> {
  try {
    const { stdout } = await execFileAsync(
      nativeHostPath(),
      ['inspect', path.resolve(process.cwd(), puppetPath)],
      {
        cwd: process.cwd(),
        env: nativeHostEnv(),
        encoding: 'utf8',
      },
    );

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
  } catch (error) {
    if (error instanceof InvalidPuppetError || error instanceof NativeBridgeError) {
      throw error;
    }

    const failure = error as ExecFailure;
    const diagnostic = failure.stderr?.trim() || failure.message || 'native puppet inspection failed';

    if (failure.code === 3) {
      throw new InvalidPuppetError(diagnostic);
    }

    throw new NativeBridgeError(diagnostic);
  }
}
