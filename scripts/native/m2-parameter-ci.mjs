import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.build', 'native');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const generated = path.join(root, 'tests', 'fixtures', 'generated');

const parameterArtifacts = [
  path.join(generated, 'm2-parameter-authoring.inp'),
  path.join(generated, 'm2-parameter-evaluation.inp'),
  path.join(generated, 'core-m2-parameter-input.inp'),
  path.join(generated, 'core-m2-parameter-output.inp'),
  path.join(generated, 'core-v1.3-opacity-input.inp'),
  path.join(generated, 'core-v1.3-opacity-output.inp'),
];

function parameterEnv() {
  return {
    ...process.env,
    IAT_M1_NATIVE_TESTS: '1',
    IAT_M1_AUTHORING_TESTS: '1',
    IAT_M2_VISUAL_TESTS: '1',
    IAT_M2_PARAMETER_TESTS: '1',
    LD_LIBRARY_PATH: [outDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
    DYLD_LIBRARY_PATH: [outDir, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),
    PATH: [outDir, process.env.PATH].filter(Boolean).join(path.delimiter),
  };
}

function run(script, args = [], env = process.env) {
  const result = spawnSync(npmCommand, ['run', script, ...args], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function cleanParameterArtifacts() {
  for (const artifact of parameterArtifacts) rmSync(artifact, { force: true });
}

run('m2:visual:ci');
run('m2:binding-serde-probe');
cleanParameterArtifacts();
run('m2:parameter-probe');
cleanParameterArtifacts();
run('m2:parameter-evaluation-probe');
run('typecheck');
cleanParameterArtifacts();
run('test', [
  '--',
  'packages/core/test/parameter-real-puppet.test.ts',
  'packages/core/test/parameter-opacity-real-puppet.test.ts',
], parameterEnv());
