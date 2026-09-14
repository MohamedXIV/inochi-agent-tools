import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.build', 'native');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const generatedArtifacts = [
  path.join(root, 'tests', 'fixtures', 'generated', 'm1-created-minimal.inp'),
  path.join(root, 'tests', 'fixtures', 'generated', 'm1-host-created-minimal.inp'),
  path.join(root, 'tests', 'fixtures', 'generated', 'core-created-minimal.inp'),
];

function authoringEnv() {
  return {
    ...process.env,
    IAT_M1_NATIVE_TESTS: '1',
    IAT_M1_AUTHORING_TESTS: '1',
    LD_LIBRARY_PATH: [outDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
    DYLD_LIBRARY_PATH: [outDir, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),
    PATH: [outDir, process.env.PATH].filter(Boolean).join(path.delimiter),
  };
}

function run(script, env = process.env) {
  const result = spawnSync(npmCommand, ['run', script], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const artifact of generatedArtifacts) rmSync(artifact, { force: true });

run('m1:ci');
for (const artifact of generatedArtifacts) rmSync(artifact, { force: true });
run('m1:create-probe');
run('m1:create-host');
run('typecheck');
run('test', authoringEnv());
