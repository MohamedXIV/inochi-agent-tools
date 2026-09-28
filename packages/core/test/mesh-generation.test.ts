import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  InvalidMeshGenerationError,
  RIG_PROJECT_SCHEMA_VERSION,
  alphaContentBounds,
  decodePngAlphaBuffer,
  generateGridMesh,
  normalizeRigProjectManifest,
} from '../src/index.js';

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function rgbaPng(width: number, height: number, alphaAt: (x: number, y: number) => number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      row[offset] = 255;
      row[offset + 1] = 255;
      row[offset + 2] = 255;
      row[offset + 3] = alphaAt(x, y);
    }
    rows.push(row);
  }
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

const manifest = normalizeRigProjectManifest({
  schemaVersion: RIG_PROJECT_SCHEMA_VERSION,
  name: 'Mesh Unit',
  coordinates: { unit: 'px', origin: 'center', yAxis: 'down' },
  layers: [{
    id: 'head',
    source: 'head.png',
    role: 'head',
    pivot: { x: 0, y: 0 },
    anchors: { neck: { x: 0, y: 12 } },
  }],
});

describe('deterministic automatic mesh generation', () => {
  it('decodes alpha and fits transparent padding instead of the full image', () => {
    const raster = decodePngAlphaBuffer(rgbaPng(12, 10, (x, y) => x >= 3 && x < 9 && y >= 2 && y < 8 ? 255 : 0), 'head');
    expect(alphaContentBounds(raster)).toEqual({ minX: 3, minY: 2, maxX: 9, maxY: 8 });
  });

  it('produces deterministic row-major topology with pivot and anchor cuts', () => {
    const raster = { width: 64, height: 64, alpha: new Uint8Array(64 * 64).fill(255) };
    const layer = manifest.layers[0]!;
    const bounds = { minX: 8, minY: 8, maxX: 56, maxY: 56 };
    const first = generateGridMesh(raster, bounds, manifest, layer, { paddingPx: 0, cellSizePx: 24, maxAxisCuts: 8 });
    const second = generateGridMesh(raster, bounds, manifest, layer, { paddingPx: 0, cellSizePx: 24, maxAxisCuts: 8 });

    expect(second).toEqual(first);
    expect(first.vertices).toContainEqual([0, 0]);
    expect(first.vertices).toContainEqual([0, 12]);
    expect(first.indices.length % 3).toBe(0);
    expect(first.uvs.every(([u, v]) => u >= 0 && u <= 1 && v >= 0 && v <= 1)).toBe(true);
  });

  it('fails closed with machine-readable diagnostics for empty alpha and impossible hints', () => {
    expect(() => alphaContentBounds({ width: 4, height: 4, alpha: new Uint8Array(16) }, 1, 'empty'))
      .toThrowError(InvalidMeshGenerationError);

    let caught: unknown;
    try {
      generateGridMesh(
        { width: 32, height: 32, alpha: new Uint8Array(32 * 32).fill(255) },
        { minX: 8, minY: 8, maxX: 24, maxY: 24 },
        manifest,
        { paddingPx: 0 },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidMeshGenerationError);
    expect((caught as InvalidMeshGenerationError).diagnostics[0]).toMatchObject({
      code: 'OUT_OF_BOUNDS_HINT',
      layerId: 'head',
    });
  });
});
