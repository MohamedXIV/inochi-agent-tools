import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

import { inspectRigProjectManifest, type NormalizedRigProjectManifest, type RigProjectLayer, type RigProjectPoint } from './rig-project.js';
import type { MeshTopology, PuppetEditOperation } from './visual-authoring.js';

export type MeshGenerationDiagnosticCode =
  | 'IO_ERROR'
  | 'UNSUPPORTED_IMAGE'
  | 'EMPTY_ALPHA'
  | 'DIMENSION_MISMATCH'
  | 'INVALID_OPTION'
  | 'OUT_OF_BOUNDS_HINT'
  | 'TOO_COMPLEX'
  | 'DEGENERATE_TOPOLOGY';

export interface MeshGenerationDiagnostic {
  code: MeshGenerationDiagnosticCode;
  layerId: string;
  path: string;
  message: string;
}

export class InvalidMeshGenerationError extends Error {
  readonly code = 'INVALID_MESH_GENERATION' as const;
  readonly diagnostics: readonly MeshGenerationDiagnostic[];
  readonly details: { diagnostics: readonly MeshGenerationDiagnostic[] };

  constructor(diagnostics: readonly MeshGenerationDiagnostic[]) {
    super(diagnostics[0]?.message ?? 'Invalid mesh generation request');
    this.name = 'InvalidMeshGenerationError';
    this.diagnostics = [...diagnostics];
    this.details = { diagnostics: this.diagnostics };
  }
}

export interface RasterAlpha {
  width: number;
  height: number;
  alpha: Uint8Array;
}

export interface PixelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MeshGenerationOptions {
  alphaThreshold?: number;
  paddingPx?: number;
  cellSizePx?: number;
  maxAxisCuts?: number;
}

export interface NormalizedMeshGenerationOptions {
  alphaThreshold: number;
  paddingPx: number;
  cellSizePx: number;
  maxAxisCuts: number;
}

export interface LayerMeshFit {
  layerId: string;
  source: string;
  sample: string;
  image: { width: number; height: number };
  contentBounds: PixelBounds;
  pivot?: RigProjectPoint;
  anchors: Record<string, RigProjectPoint>;
  mesh: MeshTopology;
}

export interface RigProjectMeshPlan {
  schemaVersion: 1;
  projectFingerprint: string;
  fingerprint: string;
  options: NormalizedMeshGenerationOptions;
  layers: LayerMeshFit[];
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fail(layerId: string, code: MeshGenerationDiagnosticCode, diagnosticPath: string, message: string): never {
  throw new InvalidMeshGenerationError([{ code, layerId, path: diagnosticPath, message }]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function reconstructScanlines(
  compressed: Buffer,
  width: number,
  height: number,
  bytesPerPixel: number,
  layerId: string,
): Uint8Array {
  let raw: Buffer;
  try {
    raw = inflateSync(compressed);
  } catch (error) {
    fail(layerId, 'UNSUPPORTED_IMAGE', '$.image', `PNG zlib stream could not be decoded: ${error instanceof Error ? error.message : String(error)}`);
  }

  const stride = width * bytesPerPixel;
  const expected = height * (stride + 1);
  if (raw.length !== expected) {
    fail(layerId, 'UNSUPPORTED_IMAGE', '$.image', `PNG scanline payload has ${raw.length} bytes, expected ${expected}`);
  }

  const out = new Uint8Array(width * height * bytesPerPixel);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] as number;
    const rowStart = y * (stride + 1) + 1;
    const outStart = y * stride;
    if (filter < 0 || filter > 4) {
      fail(layerId, 'UNSUPPORTED_IMAGE', '$.image', `unsupported PNG filter type ${filter}`);
    }

    for (let x = 0; x < stride; x += 1) {
      const encoded = raw[rowStart + x] as number;
      const left = x >= bytesPerPixel ? out[outStart + x - bytesPerPixel] as number : 0;
      const up = y > 0 ? out[outStart - stride + x] as number : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? out[outStart - stride + x - bytesPerPixel] as number : 0;
      let value = encoded;
      if (filter === 1) value = (encoded + left) & 0xff;
      else if (filter === 2) value = (encoded + up) & 0xff;
      else if (filter === 3) value = (encoded + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) value = (encoded + paeth(left, up, upLeft)) & 0xff;
      out[outStart + x] = value;
    }
  }
  return out;
}

export function decodePngAlphaBuffer(bytes: Uint8Array, layerId = 'image'): RasterAlpha {
  const buffer = Buffer.from(bytes);
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    fail(layerId, 'UNSUPPORTED_IMAGE', '$.image', 'mesh generation currently requires a PNG source or mask');
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = -1;
  let colorType = -1;
  let interlace = -1;
  const idat: Buffer[] = [];

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const next = dataEnd + 4;
    if (next > buffer.length) fail(layerId, 'UNSUPPORTED_IMAGE', '$.image', 'PNG chunk extends beyond the file boundary');
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === 'IHDR') {
      if (length !== 13) fail(layerId, 'UNSUPPORTED_IMAGE', '$.image', 'PNG IHDR must be 13 bytes');
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] as number;
      colorType = data[9] as number;
      const compression = data[10] as number;
      const filterMethod = data[11] as number;
      interlace = data[12] as number;
      if (width < 1 || height < 1 || width > 16384 || height > 16384) {
        fail(layerId, 'UNSUPPORTED_IMAGE', '$.image', `PNG dimensions ${width}x${height} are outside the supported 1..16384 range`);
      }
      if (bitDepth !== 8 || ![0, 2, 4, 6].includes(colorType) || compression !== 0 || filterMethod !== 0 || interlace !== 0) {
        fail(layerId, 'UNSUPPORTED_IMAGE', '$.image', 'mesh generation supports non-interlaced 8-bit grayscale, RGB, grayscale-alpha, and RGBA PNGs');
      }
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    offset = next;
  }

  if (width === 0 || height === 0 || idat.length === 0) {
    fail(layerId, 'UNSUPPORTED_IMAGE', '$.image', 'PNG is missing IHDR or IDAT data');
  }

  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
  const pixels = reconstructScanlines(Buffer.concat(idat), width, height, channels, layerId);
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    alpha[i] = colorType === 4 ? pixels[i * 2 + 1] as number : colorType === 6 ? pixels[i * 4 + 3] as number : 255;
  }
  return { width, height, alpha };
}

export function alphaContentBounds(raster: RasterAlpha, threshold = 1, layerId = 'image'): PixelBounds {
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
    fail(layerId, 'INVALID_OPTION', '$.options.alphaThreshold', 'alphaThreshold must be an integer from 0 through 255');
  }
  if (raster.alpha.length !== raster.width * raster.height) {
    fail(layerId, 'UNSUPPORTED_IMAGE', '$.image', 'alpha sample count does not match raster dimensions');
  }

  let minX = raster.width;
  let minY = raster.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      if ((raster.alpha[y * raster.width + x] as number) < threshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) {
    fail(layerId, 'EMPTY_ALPHA', '$.image.alpha', `no pixels meet alphaThreshold=${threshold}`);
  }
  return { minX, minY, maxX: maxX + 1, maxY: maxY + 1 };
}

function normalizeOptions(options: MeshGenerationOptions, layerId: string): NormalizedMeshGenerationOptions {
  const alphaThreshold = options.alphaThreshold ?? 1;
  const paddingPx = options.paddingPx ?? 1;
  const cellSizePx = options.cellSizePx ?? 48;
  const maxAxisCuts = options.maxAxisCuts ?? 16;
  if (!Number.isInteger(alphaThreshold) || alphaThreshold < 0 || alphaThreshold > 255) {
    fail(layerId, 'INVALID_OPTION', '$.options.alphaThreshold', 'alphaThreshold must be an integer from 0 through 255');
  }
  if (!Number.isInteger(paddingPx) || paddingPx < 0 || paddingPx > 256) {
    fail(layerId, 'INVALID_OPTION', '$.options.paddingPx', 'paddingPx must be an integer from 0 through 256');
  }
  if (!Number.isFinite(cellSizePx) || cellSizePx < 4 || cellSizePx > 2048) {
    fail(layerId, 'INVALID_OPTION', '$.options.cellSizePx', 'cellSizePx must be between 4 and 2048');
  }
  if (!Number.isInteger(maxAxisCuts) || maxAxisCuts < 2 || maxAxisCuts > 128) {
    fail(layerId, 'INVALID_OPTION', '$.options.maxAxisCuts', 'maxAxisCuts must be an integer from 2 through 128');
  }
  return { alphaThreshold, paddingPx, cellSizePx, maxAxisCuts };
}

function clampBounds(bounds: PixelBounds, width: number, height: number, paddingPx: number): PixelBounds {
  return {
    minX: Math.max(0, bounds.minX - paddingPx),
    minY: Math.max(0, bounds.minY - paddingPx),
    maxX: Math.min(width, bounds.maxX + paddingPx),
    maxY: Math.min(height, bounds.maxY + paddingPx),
  };
}

function projectPointToPixel(
  point: RigProjectPoint,
  width: number,
  height: number,
  manifest: NormalizedRigProjectManifest,
): RigProjectPoint {
  const x = manifest.coordinates.origin === 'center' ? point.x + width / 2 : point.x;
  const signedY = manifest.coordinates.yAxis === 'down' ? point.y : -point.y;
  const y = manifest.coordinates.origin === 'center' ? signedY + height / 2 : signedY;
  return { x, y };
}

function pixelPointToProject(
  point: RigProjectPoint,
  width: number,
  height: number,
  manifest: NormalizedRigProjectManifest,
): RigProjectPoint {
  const x = manifest.coordinates.origin === 'center' ? point.x - width / 2 : point.x;
  const baseY = manifest.coordinates.origin === 'center' ? point.y - height / 2 : point.y;
  const y = manifest.coordinates.yAxis === 'down' ? baseY : -baseY;
  return { x, y };
}

function axisCuts(
  min: number,
  max: number,
  hints: number[],
  options: NormalizedMeshGenerationOptions,
  layerId: string,
  axis: 'x' | 'y',
): number[] {
  const values = new Set<number>([min, max]);
  for (const hint of hints) {
    if (hint < min || hint > max) {
      fail(layerId, 'OUT_OF_BOUNDS_HINT', `$.layers[id=${layerId}].${axis}`, `authored ${axis}-axis pivot/anchor ${hint} lies outside fitted content bounds [${min}, ${max}]`);
    }
    values.add(hint);
  }

  const span = max - min;
  const uniformSegments = Math.max(1, Math.ceil(span / options.cellSizePx));
  for (let i = 1; i < uniformSegments; i += 1) values.add(min + (span * i) / uniformSegments);
  const sorted = [...values].sort((a, b) => a - b);

  if (sorted.length > options.maxAxisCuts) {
    const required = [...new Set([min, max, ...hints])].sort((a, b) => a - b);
    if (required.length > options.maxAxisCuts) {
      fail(layerId, 'TOO_COMPLEX', `$.layers[id=${layerId}]`, `authored hints require ${required.length} ${axis}-axis cuts, exceeding maxAxisCuts=${options.maxAxisCuts}`);
    }
    const remaining = options.maxAxisCuts - required.length;
    const optional = sorted.filter((value) => !required.includes(value));
    const selected: number[] = [];
    for (let i = 0; i < remaining; i += 1) {
      const index = Math.floor(((i + 1) * (optional.length + 1)) / (remaining + 1)) - 1;
      if (index >= 0 && index < optional.length) selected.push(optional[index] as number);
    }
    return [...new Set([...required, ...selected])].sort((a, b) => a - b);
  }
  return sorted;
}

export function generateGridMesh(
  raster: RasterAlpha,
  bounds: PixelBounds,
  manifest: NormalizedRigProjectManifest,
  layer: RigProjectLayer,
  options: MeshGenerationOptions = {},
): MeshTopology {
  const normalized = normalizeOptions(options, layer.id);
  const padded = clampBounds(bounds, raster.width, raster.height, normalized.paddingPx);
  if (padded.maxX <= padded.minX || padded.maxY <= padded.minY) {
    fail(layer.id, 'DEGENERATE_TOPOLOGY', `$.layers[id=${layer.id}]`, 'fitted content bounds have zero area');
  }

  const authoredPoints = [layer.pivot, ...Object.values(layer.anchors ?? {})].filter((value): value is RigProjectPoint => value !== undefined);
  const pixelHints = authoredPoints.map((point) => projectPointToPixel(point, raster.width, raster.height, manifest));
  const xCuts = axisCuts(padded.minX, padded.maxX, pixelHints.map((point) => point.x), normalized, layer.id, 'x');
  const yCuts = axisCuts(padded.minY, padded.maxY, pixelHints.map((point) => point.y), normalized, layer.id, 'y');

  const vertices: [number, number][] = [];
  const uvs: [number, number][] = [];
  for (const y of yCuts) {
    for (const x of xCuts) {
      const project = pixelPointToProject({ x, y }, raster.width, raster.height, manifest);
      vertices.push([project.x, project.y]);
      uvs.push([x / raster.width, y / raster.height]);
    }
  }

  const indices: number[] = [];
  const columns = xCuts.length;
  for (let row = 0; row < yCuts.length - 1; row += 1) {
    for (let column = 0; column < xCuts.length - 1; column += 1) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  if (vertices.length < 4 || indices.length < 6) {
    fail(layer.id, 'DEGENERATE_TOPOLOGY', `$.layers[id=${layer.id}]`, 'generated grid does not contain a drawable cell');
  }
  return { vertices, uvs, indices };
}

async function readLayerRaster(projectRoot: string, layer: RigProjectLayer): Promise<{ raster: RasterAlpha; sample: string }> {
  const sourcePath = path.resolve(projectRoot, layer.source);
  const sampleRelative = layer.mask ?? layer.source;
  const samplePath = path.resolve(projectRoot, sampleRelative);
  let sourceBytes: Buffer;
  let sampleBytes: Buffer;
  try {
    [sourceBytes, sampleBytes] = await Promise.all([readFile(sourcePath), readFile(samplePath)]);
  } catch (error) {
    fail(layer.id, 'IO_ERROR', `$.layers[id=${layer.id}]`, `layer image could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }

  const source = decodePngAlphaBuffer(sourceBytes, layer.id);
  const sample = layer.mask ? decodePngAlphaBuffer(sampleBytes, layer.id) : source;
  if (sample.width !== source.width || sample.height !== source.height) {
    fail(layer.id, 'DIMENSION_MISMATCH', `$.layers[id=${layer.id}].mask`, `mask dimensions ${sample.width}x${sample.height} must match source ${source.width}x${source.height}`);
  }
  return { raster: sample, sample: sampleRelative };
}

function canonicalPlanPayload(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalPlanPayload).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + canonicalPlanPayload(record[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export async function fitRigProjectMeshes(
  input: unknown,
  request: { projectRoot: string; options?: MeshGenerationOptions },
): Promise<RigProjectMeshPlan> {
  const inspected = inspectRigProjectManifest(input);
  const root = path.resolve(request.projectRoot);
  const options = normalizeOptions(request.options ?? {}, 'project');
  const layers: LayerMeshFit[] = [];

  for (const layer of inspected.manifest.layers) {
    const { raster, sample } = await readLayerRaster(root, layer);
    const bounds = alphaContentBounds(raster, options.alphaThreshold, layer.id);
    const mesh = generateGridMesh(raster, bounds, inspected.manifest, layer, options);
    layers.push({
      layerId: layer.id,
      source: layer.source,
      sample,
      image: { width: raster.width, height: raster.height },
      contentBounds: bounds,
      ...(layer.pivot === undefined ? {} : { pivot: layer.pivot }),
      anchors: { ...(layer.anchors ?? {}) },
      mesh,
    });
  }

  const payload = { schemaVersion: 1, projectFingerprint: inspected.fingerprint, options, layers };
  const fingerprint = createHash('sha256').update(canonicalPlanPayload(payload), 'utf8').digest('hex');
  return { ...payload, fingerprint };
}

export function partSetMeshOperation(fit: LayerMeshFit, partPath: string): PuppetEditOperation {
  if (!partPath.trim()) fail(fit.layerId, 'INVALID_OPTION', '$.partPath', 'partPath must be non-empty');
  return { type: 'part.setMesh', path: partPath, mesh: fit.mesh };
}
