import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  RIG_PROJECT_SCHEMA_VERSION,
  createPuppet,
  editPuppet,
  fitRigProjectMeshes,
  inspectPuppet,
  partSetMeshOperation,
  renderPreview,
} from '../../packages/core/src/index.js';

const runNative = process.env.IAT_V2_MESH_TESTS === '1';
const root = path.resolve('tests/fixtures/generated/v2-mesh');
const input = path.join(root, 'character-input.inp');
const output = path.join(root, 'character-output.inp');
const preview = path.join(root, 'character-preview.png');

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

function rgbaPng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const offset = 1 + x * 4;
      row[offset] = r; row[offset + 1] = g; row[offset + 2] = b; row[offset + 3] = a;
    }
    rows.push(row);
  }
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

async function writeFixture(name: string, width: number, height: number, color: [number, number, number], inside: (x: number, y: number) => boolean): Promise<void> {
  await writeFile(path.join(root, name), rgbaPng(width, height, (x, y) => [...color, inside(x, y) ? 255 : 0]));
}

describe.skipIf(!runNative)('v2 real automatic mesh generation acceptance', () => {
  it('builds deterministic usable meshes for real layered PNGs and renders a real puppet', async () => {
    await mkdir(root, { recursive: true });
    await Promise.all([
      writeFixture('body.png', 96, 128, [190, 120, 80], (x, y) => x >= 18 && x < 78 && y >= 12 && y < 120),
      writeFixture('head.png', 80, 80, [220, 170, 120], (x, y) => {
        const dx = x - 40; const dy = y - 40; return dx * dx + dy * dy <= 30 * 30;
      }),
      writeFixture('hair.png', 88, 88, [55, 40, 45], (x, y) => y >= 8 && y < 48 && x >= 10 && x < 78),
    ]);

    const manifest = {
      schemaVersion: RIG_PROJECT_SCHEMA_VERSION,
      name: 'v2 Mesh Acceptance',
      layers: [
        { id: 'body', source: 'body.png', role: 'body', pivot: { x: 0, y: 0 }, anchors: { neck: { x: 0, y: -42 } } },
        { id: 'head', source: 'head.png', role: 'head', parentId: 'body', pivot: { x: 0, y: 0 }, anchors: { neck: { x: 0, y: 28 } } },
        { id: 'hair', source: 'hair.png', role: 'hair', parentId: 'head', pivot: { x: 0, y: 0 } },
      ],
    };

    const first = await fitRigProjectMeshes(manifest, { projectRoot: root, options: { paddingPx: 2, cellSizePx: 24, maxAxisCuts: 12 } });
    const second = await fitRigProjectMeshes(manifest, { projectRoot: root, options: { paddingPx: 2, cellSizePx: 24, maxAxisCuts: 12 } });
    expect(second).toEqual(first);
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.layers).toHaveLength(3);
    expect(first.layers.every((layer) => layer.mesh.vertices.length > 4 && layer.mesh.indices.length >= 6)).toBe(true);
    expect(first.layers.find((layer) => layer.layerId === 'body')?.contentBounds).toEqual({ minX: 18, minY: 12, maxX: 78, maxY: 120 });

    await rm(input, { force: true });
    await rm(output, { force: true });
    await rm(preview, { force: true });
    await createPuppet({ outputPath: input, name: 'v2 Mesh Acceptance' });

    const operations = first.layers.flatMap((fit) => {
      const name = fit.layerId[0]!.toUpperCase() + fit.layerId.slice(1);
      return [
        { type: 'texture.import' as const, key: fit.layerId, imagePath: path.join(root, fit.source) },
        { type: 'part.create' as const, parentPath: '/Root', name, textureKey: fit.layerId },
        partSetMeshOperation(fit, '/Root/' + name),
      ];
    });
    const edited = await editPuppet({ inputPath: input, outputPath: output, operations });
    for (const fit of first.layers) {
      const name = fit.layerId[0]!.toUpperCase() + fit.layerId.slice(1);
      expect(edited.inspection.nodes.find((node) => node.path === '/Root/' + name)?.mesh).toEqual(fit.mesh);
    }

    const reopened = await inspectPuppet(output);
    expect(reopened).toEqual(edited.inspection);
    const rendered = await renderPreview({ inputPath: output, outputPath: preview, width: 256, height: 256 });
    expect(rendered.triangleCount).toBeGreaterThan(0);
    expect(rendered.coveredPixelSamples).toBeGreaterThan(0);
    const previewBytes = await readFile(preview);
    expect(previewBytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });
});
