import { createHash } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  RIG_PROJECT_SCHEMA_VERSION,
  compileStandardCharacterRig,
  editPuppet,
  inspectPuppet,
  renderPreview,
} from '../../packages/core/src/index.js';

const runNative = process.env.IAT_V2_RIG_RECIPE_TESTS === '1';
const root = path.resolve('tests/fixtures/generated/v2-rig');
const input = path.resolve('tests/fixtures/generated/v2-mesh/character-output.inp');
const output = path.join(root, 'character-rigged.inp');
const lowPng = path.join(root, 'character-low.png');
const highPng = path.join(root, 'character-high.png');

const manifest = {
  schemaVersion: RIG_PROJECT_SCHEMA_VERSION,
  name: 'v2 Standard Rig Acceptance',
  layers: [
    { id: 'body', source: 'body.png', role: 'body' },
    { id: 'hair', source: 'hair.png', role: 'hair', parentId: 'head' },
    { id: 'head', source: 'head.png', role: 'head', parentId: 'body' },
  ],
  motions: [
    { id: 'bodyLean', kind: 'rotation' as const, axis: 'x' as const, min: -0.12, max: 0.12, default: 0, targets: ['body'] },
    { id: 'breath', kind: 'deform' as const, axis: 'y' as const, min: -0.04, max: 0.04, default: 0, targets: ['body'] },
    { id: 'hairSwing', kind: 'physics' as const, axis: 'x' as const, min: -0.18, max: 0.18, default: 0, targets: ['hair'] },
    { id: 'headX', kind: 'transform' as const, axis: 'x' as const, min: -12, max: 12, default: 0, targets: ['hair', 'head'] },
    { id: 'headY', kind: 'transform' as const, axis: 'y' as const, min: -8, max: 8, default: 0, targets: ['hair', 'head'] },
  ],
};

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe.skipIf(!runNative)('v2 standard character rig recipe acceptance', () => {
  it('compiles semantic intent, authors a real puppet, reopens it, and renders distinct parameter states', async () => {
    await mkdir(root, { recursive: true });
    await rm(output, { force: true });
    await rm(lowPng, { force: true });
    await rm(highPng, { force: true });

    const plan = compileStandardCharacterRig({
      manifest,
      layerPaths: {
        body: '/Root/Body',
        hair: '/Root/Hair',
        head: '/Root/Head',
      },
      profiles: {
        bodyLean: { parameterName: 'Body Lean' },
        breath: { parameterName: 'Breathing' },
        headX: { parameterName: 'Head X' },
        headY: { parameterName: 'Head Y' },
        hairSwing: {
          parameterName: 'Hair Swing',
          property: 'transform.r.z',
          physics: {
            parentPath: '/Root',
            name: 'Hair Physics',
            settings: {
              model: 'pendulum',
              mapMode: 'angle-length',
              gravity: 1,
              length: 90,
              frequency: 1.25,
              angleDamping: 0.45,
              lengthDamping: 0.5,
              outputScale: [1, 1],
              localOnly: true,
            },
          },
        },
      },
    });

    expect(plan.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.operations.length).toBeLessThan(20);
    expect(plan).toEqual(compileStandardCharacterRig({
      manifest,
      layerPaths: { body: '/Root/Body', hair: '/Root/Hair', head: '/Root/Head' },
      profiles: {
        bodyLean: { parameterName: 'Body Lean' },
        breath: { parameterName: 'Breathing' },
        headX: { parameterName: 'Head X' },
        headY: { parameterName: 'Head Y' },
        hairSwing: {
          parameterName: 'Hair Swing',
          property: 'transform.r.z',
          physics: {
            parentPath: '/Root',
            name: 'Hair Physics',
            settings: {
              model: 'pendulum',
              mapMode: 'angle-length',
              gravity: 1,
              length: 90,
              frequency: 1.25,
              angleDamping: 0.45,
              lengthDamping: 0.5,
              outputScale: [1, 1],
              localOnly: true,
            },
          },
        },
      },
    }));

    const authored = await editPuppet({ inputPath: input, outputPath: output, operations: plan.operations });
    for (const parameterName of ['Body Lean', 'Breathing', 'Hair Swing', 'Head X', 'Head Y']) {
      expect(authored.inspection.parameters.some((parameter) => parameter.name === parameterName)).toBe(true);
    }
    const physics = authored.inspection.nodes.find((node) => node.path === '/Root/Hair Physics');
    expect(physics?.kind).toBe('simple-physics');
    expect(physics?.physics?.parameterName).toBe('Hair Swing');

    const reopened = await inspectPuppet(output);
    expect(reopened).toEqual(authored.inspection);

    const low = await renderPreview({
      inputPath: output,
      outputPath: lowPng,
      width: 256,
      height: 256,
      parameters: {
        'Head X': [-12, 0],
        'Head Y': [-8, 0],
        'Body Lean': [-0.12, 0],
        Breathing: [-0.04, 0],
      },
    });
    const high = await renderPreview({
      inputPath: output,
      outputPath: highPng,
      width: 256,
      height: 256,
      parameters: {
        'Head X': [12, 0],
        'Head Y': [8, 0],
        'Body Lean': [0.12, 0],
        Breathing: [0.04, 0],
      },
    });

    expect(low.coveredPixelSamples).toBeGreaterThan(0);
    expect(high.coveredPixelSamples).toBeGreaterThan(0);
    expect(digest(await readFile(lowPng))).not.toBe(digest(await readFile(highPng)));
  });
});
