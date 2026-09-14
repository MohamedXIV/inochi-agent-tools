import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.build', 'native');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const generated = path.join(root, 'tests', 'fixtures', 'generated');
const artifacts = [
  path.join(generated, 'core-save-source.inp'),
  path.join(generated, 'core-save-output.inp'),
  path.join(generated, 'cli-lifecycle-created.inp'),
  path.join(generated, 'cli-lifecycle-saved.inp'),
];

function run(script, args = [], env = process.env) {
  const result = spawnSync(npmCommand, ['run', script, ...args], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function authoringEnv(extra = {}) {
  return {
    ...process.env,
    IAT_M1_AUTHORING_TESTS: '1',
    ...extra,
    LD_LIBRARY_PATH: [outDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
    DYLD_LIBRARY_PATH: [outDir, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),
    PATH: [outDir, process.env.PATH].filter(Boolean).join(path.delimiter),
  };
}

for (const artifact of artifacts) rmSync(artifact, { force: true });
run('m2:creator:ci');
for (const artifact of artifacts) rmSync(artifact, { force: true });
run('test', ['--', 'packages/core/test/save-real-puppet.test.ts'], authoringEnv());
run('cli:build');
run(
  'test',
  ['--', 'packages/cli/test/cli-real-workflow.test.ts'],
  authoringEnv({ IAT_CLI_REAL_WORKFLOW_TESTS: '1' }),
);
