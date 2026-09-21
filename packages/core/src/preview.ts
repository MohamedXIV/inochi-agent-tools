import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { NativeBridgeError } from './errors.js';

const execFileAsync = promisify(execFile);
const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export type PreviewParameterValues = Readonly<Record<string, readonly [number, number]>>;

export interface PreviewFrameMetadata {
  schemaVersion: number;
  kind: string;
  commandCount: number;
  drawableCommandCount: number;
  texturedCommandCount: number;
  vertexCount: number;
  indexCount: number;
  hasRenderableContent: boolean;
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  states: Record<string, number>;
  appliedParameters?: Record<string, [number, number]>;
  width?: number;
  height?: number;
  triangleCount?: number;
  coveredPixelSamples?: number;
  output?: string;
}

export interface RenderPreviewRequest {
  inputPath: string;
  outputPath: string;
  width?: number;
  height?: number;
  parameters?: PreviewParameterValues;
  hostPath?: string;
}

function nativeDir(): string {
  if (process.env.IAT_NATIVE_DIR) return path.resolve(process.env.IAT_NATIVE_DIR);
  return path.resolve(moduleDir, '..', '..', '..', '.build', 'native');
}

function nativeHostPath(): string {
  return path.join(nativeDir(), process.platform === 'win32' ? 'iat_native_host.exe' : 'iat_native_host');
}

function nativeEnv(): NodeJS.ProcessEnv {
  const dir = nativeDir();
  return {
    ...process.env,
    LD_LIBRARY_PATH: [dir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
    DYLD_LIBRARY_PATH: [dir, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),
    PATH: [dir, process.env.PATH].filter(Boolean).join(path.delimiter),
  };
}

async function runPreviewHost(args: string[], hostPath?: string): Promise<PreviewFrameMetadata> {
  try {
    const { stdout } = await execFileAsync(hostPath ?? nativeHostPath(), args, {
      cwd: process.cwd(), env: nativeEnv(), encoding: 'utf8', maxBuffer: MAX_CAPTURE_BYTES, windowsHide: true,
    });
    const decoded: unknown = JSON.parse(stdout);
    if (!decoded || typeof decoded !== 'object') throw new Error('preview metadata must be an object');
    return decoded as PreviewFrameMetadata;
  } catch (error) {
    if (error instanceof NativeBridgeError) throw error;
    const failure = error as Error & { stderr?: string };
    throw new NativeBridgeError(failure.stderr?.trim() || failure.message || 'native preview failed');
  }
}

export async function capturePreviewFrame(inputPath: string, hostPath?: string): Promise<PreviewFrameMetadata> {
  return runPreviewHost(['capture-preview-frame', path.resolve(process.cwd(), inputPath)], hostPath);
}

export async function renderPreview(request: RenderPreviewRequest): Promise<PreviewFrameMetadata> {
  const width = request.width ?? 512;
  const height = request.height ?? 512;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 4096 || height > 4096) {
    throw new NativeBridgeError('preview dimensions must be integer values between 16 and 4096 pixels');
  }
  const args = [
    'render-preview',
    path.resolve(process.cwd(), request.inputPath),
    path.resolve(process.cwd(), request.outputPath),
    String(width),
    String(height),
  ];
  if (request.parameters) args.push(JSON.stringify(request.parameters));
  return runPreviewHost(args, request.hostPath);
}
