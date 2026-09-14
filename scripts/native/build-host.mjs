import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.build', 'native');
const fixturePath = path.join(root, 'tests', 'fixtures', 'generated', 'm1-inspection.inp');
const createFixturePath = path.join(root, 'tests', 'fixtures', 'generated', 'm1-created-minimal.inp');
const invalidFixturePath = path.join(root, 'tests', 'fixtures', 'invalid', 'not-a-puppet.inp');
const fixtureExecutableName = process.platform === 'win32' ? 'm1_fixture_generator.exe' : 'm1_fixture_generator';
const fixtureGenerator = path.join(outDir, fixtureExecutableName);
const inspectionProbeName = process.platform === 'win32' ? 'm1_inspection_probe.exe' : 'm1_inspection_probe';
const inspectionProbe = path.join(outDir, inspectionProbeName);
const createProbeName = process.platform === 'win32' ? 'm1_create_roundtrip_probe.exe' : 'm1_create_roundtrip_probe';
const createProbe = path.join(outDir, createProbeName);
const hostName = process.platform === 'win32' ? 'iat_native_host.exe' : 'iat_native_host';
const hostPath = path.join(outDir, hostName);

function nativeEnv() {
  return {
    ...process.env,
    LD_LIBRARY_PATH: [outDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
    DYLD_LIBRARY_PATH: [outDir, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),
    PATH: [outDir, process.env.PATH].filter(Boolean).join(path.delimiter),
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runHostContract() {
  const success = spawnSync(hostPath, ['inspect', fixturePath], {
    cwd: root,
    env: nativeEnv(),
    encoding: 'utf8',
  });
  if (success.error) throw success.error;
  if (success.status !== 0 || success.stderr !== '') {
    console.error(success.stderr || `native host success path exited ${success.status}`);
    process.exit(success.status ?? 1);
  }

  let snapshot;
  try {
    snapshot = JSON.parse(success.stdout);
  } catch (error) {
    console.error(`native host emitted invalid JSON: ${error}`);
    process.exit(1);
  }
  if (
    snapshot?.schemaVersion !== 1 ||
    snapshot?.metadata?.name !== 'M1 Inspection Fixture' ||
    !snapshot?.nodes?.some((node) => node.name === 'Face') ||
    !snapshot?.nodes?.some((node) => node.name === 'Mouth') ||
    !snapshot?.parameters?.some((parameter) => parameter.name === 'Head X')
  ) {
    console.error('native host semantic snapshot did not match the real fixture contract');
    process.exit(1);
  }

  const failure = spawnSync(hostPath, ['inspect', invalidFixturePath], {
    cwd: root,
    env: nativeEnv(),
    encoding: 'utf8',
  });
  if (failure.error) throw failure.error;
  if (failure.status !== 3 || failure.stdout !== '' || failure.stderr.trim().length === 0) {
    console.error('native host malformed-input contract failed');
    process.exit(1);
  }
}

mkdirSync(outDir, { recursive: true });
run(process.execPath, ['scripts/native/verify-toolchain.mjs']);
run(process.execPath, ['scripts/upstream/materialize.mjs']);

if (process.argv.includes('--fixture')) {
  run('dub', [
    'build',
    '--root=native/bridge',
    '--compiler=ldc2',
    '--build=debug',
    '--config=fixture-generator',
  ]);
  run(fixtureGenerator, [fixturePath]);
}

if (process.argv.includes('--inspection-probe')) {
  run(process.execPath, ['scripts/native/build-bridge.mjs']);
  run('ldc2', [
    'native/bridge/test/inspection_probe.d',
    '-link-defaultlib-shared',
    `-L-L${outDir}`,
    '-L-liat_bridge',
    `-of=${inspectionProbe}`,
  ]);
  run(inspectionProbe, [fixturePath, invalidFixturePath], { env: nativeEnv() });
}

if (process.argv.includes('--create-probe')) {
  run(process.execPath, ['scripts/native/build-bridge.mjs']);
  run('ldc2', [
    'native/bridge/test/create_roundtrip_probe.d',
    '-link-defaultlib-shared',
    `-L-L${outDir}`,
    '-L-liat_bridge',
    `-of=${createProbe}`,
  ]);
  run(createProbe, [createFixturePath], { env: nativeEnv() });
}

if (process.argv.includes('--host')) {
  run('dub', [
    'build',
    '--root=native/host',
    '--compiler=ldc2',
    '--build=debug',
  ]);
  runHostContract();
}
