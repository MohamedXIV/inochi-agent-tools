import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { createAuthoringClient, type BuildRigProjectResult } from '../../packages/sdk/src/index.js';
import { RIG_PROJECT_SCHEMA_VERSION } from '../../packages/core/src/index.js';

const enabled = process.env.IAT_V2_E2E_TESTS === '1';
const root = path.resolve('tests/fixtures/generated/v2-e2e');
const projectDir = path.join(root, 'project');
const currentProbe = path.resolve(
  '.build/current-format',
  process.platform === 'win32' ? 'iat_current_format_probe.exe' : 'iat_current_format_probe',
);

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

function rgbaPng(
  width: number,
  height: number,
  color: [number, number, number],
  inside: (x: number, y: number) => boolean,
): Buffer {
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
      const offset = 1 + x * 4;
      row[offset] = color[0];
      row[offset + 1] = color[1];
      row[offset + 2] = color[2];
      row[offset + 3] = inside(x, y) ? 255 : 0;
    }
    rows.push(row);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function manifest() {
  return {
    schemaVersion: RIG_PROJECT_SCHEMA_VERSION,
    name: 'v2 Autonomous Rigging E2E',
    layers: [
      { id: 'body', source: 'body.png', role: 'body' },
      { id: 'head', source: 'head.png', role: 'head' },
      { id: 'hair', source: 'hair.png', role: 'hair' },
    ],
    motions: [
      {
        id: 'breath',
        kind: 'deform' as const,
        axis: 'y' as const,
        min: -0.5,
        max: 0.5,
        default: 0,
        targets: ['body', 'head', 'hair'],
      },
      {
        id: 'hairSwing',
        kind: 'physics' as const,
        axis: 'x' as const,
        min: -0.2,
        max: 0.2,
        default: 0,
        targets: ['hair'],
      },
    ],
  };
}

const profiles = {
  breath: {
    parameterName: 'Breathing',
    property: 'transform.s.y' as const,
    gain: 1.6,
  },
  hairSwing: {
    parameterName: 'Hair Swing',
    property: 'transform.r.z' as const,
    physics: {
      parentPath: '/Root',
      name: 'Hair Physics',
      settings: {
        model: 'pendulum' as const,
        mapMode: 'angle-length' as const,
        gravity: 1,
        length: 90,
        frequency: 1.25,
        angleDamping: 0.45,
        lengthDamping: 0.5,
        outputScale: [1, 1] as [number, number],
        localOnly: true,
      },
    },
  },
};

const qaProfile = {
  width: 256,
  height: 256,
  minCoverageRatio: 0.6,
  maxCoverageRatio: 4,
  maxBoundsAreaRatio: 4,
  maxBoundsSpanRatio: 4,
};

async function prepareProject(): Promise<void> {
  await rm(root, { recursive: true, force: true });
  await mkdir(projectDir, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(projectDir, 'body.png'),
      rgbaPng(104, 144, [185, 112, 82], (x, y) => x >= 18 && x < 86 && y >= 10 && y < 136),
    ),
    writeFile(
      path.join(projectDir, 'head.png'),
      rgbaPng(84, 84, [224, 174, 126], (x, y) => {
        const dx = x - 42;
        const dy = y - 42;
        return dx * dx + dy * dy <= 31 * 31;
      }),
    ),
    writeFile(
      path.join(projectDir, 'hair.png'),
      rgbaPng(92, 92, [54, 39, 46], (x, y) => y >= 8 && y < 50 && x >= 10 && x < 82),
    ),
  ]);
}

function runCurrentRuntimeVerification(puppet: string): unknown {
  const result = spawnSync(currentProbe, ['--v2-e2e-verify', puppet], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'v2 current-format runtime verification failed');
  }
  return JSON.parse(result.stdout.trim());
}

async function verifySaveReloadSemanticEquivalence(puppet: string): Promise<void> {
  const directory = path.dirname(puppet);
  const saved = path.join(directory, '.e2e-save-reload.inp');
  const savedAgain = path.join(directory, '.e2e-save-reload-2.inp');
  await rm(saved, { force: true });
  await rm(savedAgain, { force: true });

  const conversion = spawnSync(currentProbe, ['--conversion-only', puppet, saved, savedAgain], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (conversion.error) throw conversion.error;
  if (conversion.status !== 0) {
    throw new Error(conversion.stderr || conversion.stdout || 'v2 save/reload conversion failed');
  }

  const originalSemantics = runCurrentRuntimeVerification(puppet);
  expect(runCurrentRuntimeVerification(saved)).toEqual(originalSemantics);
  expect(runCurrentRuntimeVerification(savedAgain)).toEqual(originalSemantics);

  await rm(saved, { force: true });
  await rm(savedAgain, { force: true });
}

async function assertFinalBuild(result: BuildRigProjectResult): Promise<void> {
  expect(result.status).toBe('green');
  expect(result.qa.pass).toBe(true);
  expect(result.qa.summary.errorCount).toBe(0);
  expect(result.qa.summary.sampleCount).toBe(7);
  expect(result.repair?.status).toBe('green');
  expect(result.repair?.iterations.length).toBeGreaterThan(0);
  expect(result.repair?.iterations.every((entry) => entry.status === 'accepted')).toBe(true);
  expect(
    result.repair?.iterations.some((entry) =>
      entry.changes.some((change) => change.motionId === 'breath' && change.diagnosticCode === 'DISAPPEARING_CONTENT')),
  ).toBe(true);

  const repairedBreath = result.repair?.plan.motions.find((motion) => motion.motionId === 'breath');
  expect(repairedBreath?.gain).toBeLessThan(profiles.breath.gain);

  const neutral = result.qa.samples.find((sample) => sample.kind === 'neutral');
  const breathMin = result.qa.samples.find((sample) => sample.motionId === 'breath' && sample.kind === 'motion-min');
  const breathMax = result.qa.samples.find((sample) => sample.motionId === 'breath' && sample.kind === 'motion-max');
  expect(neutral?.coveredPixelSamples).toBeGreaterThan(0);
  expect(breathMin?.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(breathMax?.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(breathMin?.sha256).not.toBe(breathMax?.sha256);

  const bytes = await readFile(result.artifacts.puppet);
  expect(bytes.subarray(0, 8).toString('ascii')).toBe('TRNSRTS2');
  expect(result.currentFormat?.magic).toBe('TRNSRTS2');
  expect(result.currentFormat?.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  expect(result.currentFormat?.roundtripSha256).toMatch(/^[a-f0-9]{64}$/);

  const runtime = runCurrentRuntimeVerification(result.artifacts.puppet) as {
    ok: boolean;
    mode: string;
    setReadbackRestore: boolean;
  };
  expect(runtime).toMatchObject({
    ok: true,
    mode: 'v2-e2e-verify',
    setReadbackRestore: true,
  });
  await verifySaveReloadSemanticEquivalence(result.artifacts.puppet);

  const provenance = JSON.parse(await readFile(result.artifacts.provenance, 'utf8')) as {
    buildFingerprint: string;
    manifestFingerprint: string;
    planFingerprint: string;
    currentFormat?: { sha256: string; roundtripSha256: string };
  };
  expect(provenance.buildFingerprint).toBe(result.buildFingerprint);
  expect(provenance.manifestFingerprint).toBe(result.manifestFingerprint);
  expect(provenance.planFingerprint).toBe(result.planFingerprint);
  expect(provenance.currentFormat?.sha256).toBe(result.currentFormat?.sha256);
}

describe.skipIf(!enabled)('v2 autonomous rigging end-to-end acceptance', () => {
  it('builds, diagnoses, repairs, finalizes, reloads, and reproduces a real layered character', async () => {
    const client = createAuthoringClient();

    await prepareProject();
    const project = manifest();
    const normalizedA = await client.normalizeRigProject({ manifest: project });
    const first = await client.buildRigProject({
      manifest: project,
      projectDir,
      outputDir: path.join(root, 'first'),
      outputName: 'character',
      profiles,
      qaProfile,
      repair: true,
    });
    await assertFinalBuild(first);

    const evidenceA = {
      manifestFingerprint: normalizedA.fingerprint,
      buildFingerprint: first.buildFingerprint,
      planFingerprint: first.planFingerprint,
      qaFingerprint: first.qa.fingerprint,
      currentSha256: first.currentFormat!.sha256,
      currentRoundtripSha256: first.currentFormat!.roundtripSha256,
      sampleHashes: first.qa.samples.map((sample) => [sample.id, sample.sha256] as const),
      repairedGain: first.repair!.plan.motions.find((motion) => motion.motionId === 'breath')!.gain,
    };

    await prepareProject();
    const normalizedB = await client.normalizeRigProject({ manifest: manifest() });
    const second = await client.buildRigProject({
      manifest: manifest(),
      projectDir,
      outputDir: path.join(root, 'second'),
      outputName: 'character',
      profiles,
      qaProfile,
      repair: true,
    });
    await assertFinalBuild(second);

    expect(normalizedB.fingerprint).toBe(evidenceA.manifestFingerprint);
    expect(second.manifestFingerprint).toBe(evidenceA.manifestFingerprint);
    expect(second.buildFingerprint).toBe(evidenceA.buildFingerprint);
    expect(second.planFingerprint).toBe(evidenceA.planFingerprint);
    expect(second.qa.fingerprint).toBe(evidenceA.qaFingerprint);
    expect(second.currentFormat?.sha256).toBe(evidenceA.currentSha256);
    expect(second.currentFormat?.roundtripSha256).toBe(evidenceA.currentRoundtripSha256);
    expect(second.qa.samples.map((sample) => [sample.id, sample.sha256] as const)).toEqual(evidenceA.sampleHashes);
    expect(second.repair?.plan.motions.find((motion) => motion.motionId === 'breath')?.gain).toBe(evidenceA.repairedGain);
  });
});
