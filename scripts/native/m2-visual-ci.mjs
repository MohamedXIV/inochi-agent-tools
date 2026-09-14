import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.build', 'native');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const generated = path.join(root, 'tests', 'fixtures', 'generated');

const generatedArtifacts = [
  path.join(generated, 'm2-checker.png'),
  path.join(generated, 'm2-visual-input.inp'),
  path.join(generated, 'm2-visual-output.inp'),
  path.join(generated, 'm2-visual-host-output.inp'),
  path.join(generated, 'core-m2-input.inp'),
  path.join(generated, 'core-m2-output.inp'),
];

function visualEnv() {
  return {
    ...process.env,
    IAT_M1_NATIVE_TESTS: '1',
    IAT_M1_AUTHORING_TESTS: '1',
    IAT_M2_VISUAL_TESTS: '1',
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

function cleanM2Artifacts() {
  for (const artifact of generatedArtifacts) rmSync(artifact, { force: true });
}

run('m1:authoring:ci');
cleanM2Artifacts();
run('m2:png');
run('m2:visual-probe');
run('m2:visual-host');
run('typecheck');
cleanM2Artifacts();
run('m2:png');
run('test', visualEnv());
