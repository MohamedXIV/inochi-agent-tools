import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.build', 'native');
const fixturePath = path.join(root, 'tests', 'fixtures', 'generated', 'm1-inspection.inp');
const executableName = process.platform === 'win32' ? 'm1_fixture_generator.exe' : 'm1_fixture_generator';
const fixtureGenerator = path.join(outDir, executableName);

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
