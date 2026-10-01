import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const exe = path.join(root, '.build', 'current-format', process.platform === 'win32' ? 'iat_current_format_probe.exe' : 'iat_current_format_probe');
const nativeOut = path.join(root, '.build', 'native');
const host = path.join(nativeOut, process.platform === 'win32' ? 'iat_native_host.exe' : 'iat_native_host');
const baseInput = path.join(root, 'tests', 'fixtures', 'generated', 'v1.6-rig-helper-output.inp');
const input = path.join(root, 'tests', 'fixtures', 'generated', 'v2-current-production-input.inp');
const outA = path.join(root, 'tests', 'fixtures', 'generated', 'v1.7-current-a.inp');
const rtA = path.join(root, 'tests', 'fixtures', 'generated', 'v1.7-current-a-roundtrip.inp');
const outB = path.join(root, 'tests', 'fixtures', 'generated', 'v1.7-current-b.inp');
const rtB = path.join(root, 'tests', 'fixtures', 'generated', 'v1.7-current-b-roundtrip.inp');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(result.stdout || '');
    console.error(result.stderr || `${command} exited ${result.status}`);
    process.exit(result.status ?? 1);
  }
  return result;
}
const nativeEnv = {
  ...process.env,
  LD_LIBRARY_PATH: [nativeOut, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
  DYLD_LIBRARY_PATH: [nativeOut, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),
  PATH: [nativeOut, process.env.PATH].filter(Boolean).join(path.delimiter),
};

function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
function assertInp2(file) {
  const magic = readFileSync(file).subarray(0, 8).toString('ascii');
  if (magic !== 'TRNSRTS2') {
    console.error(`${path.basename(file)} expected TRNSRTS2, got ${JSON.stringify(magic)}`);
    process.exit(1);
  }
}

for (const file of [input, outA, rtA, outB, rtB]) rmSync(file, { force: true });

if (!existsSync(baseInput) || !existsSync(host)) {
  run(npmCommand, ['run', 'v1.6:rig-helpers:ci'], { stdio: 'inherit', encoding: undefined });
}
const productionOperations = [
  {
    type: 'parameter.create',
    name: 'Face Tint R',
    dimensions: 1,
    min: [-1, 0],
    max: [1, 0],
    defaultValue: [0, 0],
  },
  {
    type: 'parameter.bind',
    parameterName: 'Face Tint R',
    targetPath: '/Root/Face',
    property: 'tint.r',
    keypoints: [
      { at: [-1, 0], value: 0.2 },
      { at: [1, 0], value: 1 },
    ],
  },
  {
    type: 'physics.create',
    parentPath: '/Root',
    name: 'CurrentPhysics',
    parameterName: 'Head X',
    model: 'pendulum',
    mapMode: 'angle_length',
    gravity: 1,
    length: 100,
    frequency: 1,
    angleDamping: 0.5,
    lengthDamping: 0.5,
    outputScale: [1, 1],
    localOnly: true,
  },
  {
    type: 'deformer.create',
    kind: 'mesh',
    parentPath: '/Root',
    name: 'CurrentRigCage',
    mesh: {
      vertices: [[-32, -32], [32, -32], [32, 32], [-32, 32]],
      uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
      indices: [0, 1, 2, 0, 2, 3],
    },
  },
];
run(host, ['edit-visual', baseInput, input, JSON.stringify(productionOperations)], {
  env: nativeEnv,
});

run(npmCommand, ['run', 'current:materialize'], { stdio: 'inherit', encoding: undefined });
run('dub', ['build', '--root=native/current-format', '--compiler=ldc2', '--build=debug'], { stdio: 'inherit', encoding: undefined });

const first = run(exe, [input, outA, rtA]);
const second = run(exe, [input, outB, rtB]);
for (const file of [outA, rtA, outB, rtB]) assertInp2(file);

if (digest(outA) !== digest(outB)) {
  console.error('independent current-format conversions are not deterministic');
  process.exit(1);
}
if (digest(rtA) !== digest(rtB)) {
  console.error('independent current-format save/reload cycles are not deterministic');
  process.exit(1);
}

const current = JSON.parse(readFileSync(path.join(root, 'upstream', 'inochi2d-current.json'), 'utf8'));
console.log(JSON.stringify({
  ok: true,
  upstreamVersion: current.declaredVersion,
  upstreamCommit: current.commit,
  magic: 'TRNSRTS2',
  deterministicConversionSha256: digest(outA),
  deterministicRoundtripSha256: digest(rtA),
  probe: JSON.parse(first.stdout.trim()),
}));
