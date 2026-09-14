import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const launcher = path.join(root, 'scripts', 'creator', 'launch-roundtrip.mjs');
const generated = path.join(root, 'tests', 'fixtures', 'generated');

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runNpm(script) {
  run(npmCommand, ['run', script]);
}

function proveCreatorOpen(fileName) {
  run(process.execPath, [launcher, '--open-only', path.join(generated, fileName)]);
}

runNpm('m2:parameter:ci');
runNpm('creator:materialize');
runNpm('creator:fixture');

for (const fileName of [
  'creator-roundtrip-base.inp',
  'creator-roundtrip-hierarchy.inp',
  'creator-roundtrip-texture.inp',
  'creator-roundtrip-visual.inp',
  'creator-roundtrip-parameters.inp',
  'creator-roundtrip-input.inp',
]) {
  proveCreatorOpen(fileName);
}

runNpm('creator:roundtrip');
runNpm('creator:verify');
