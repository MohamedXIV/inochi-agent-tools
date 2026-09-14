import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.build', 'native');
const fixturePath = path.join(root, 'tests', 'fixtures', 'generated', 'm1-inspection.inp');
const invalidFixturePath = path.join(root, 'tests', 'fixtures', 'invalid', 'not-a-puppet.inp');
const fixtureExecutableName = process.platform === 'win32' ? 'm1_fixture_generator.exe' : 'm1_fixture_generator';
const fixtureGenerator = path.join(outDir, fixtureExecutableName);
const inspectionProbeName = process.platform === 'win32' ? 'm1_inspection_probe.exe' : 'm1_inspection_probe';
const inspectionProbe = path.join(outDir, inspectionProbeName);

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
  run(inspectionProbe, [fixturePath, invalidFixturePath], {
    env: {
      ...process.env,
      LD_LIBRARY_PATH: [outDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
      DYLD_LIBRARY_PATH: [outDir, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),
      PATH: [outDir, process.env.PATH].filter(Boolean).join(path.delimiter),
    },
  });
}
