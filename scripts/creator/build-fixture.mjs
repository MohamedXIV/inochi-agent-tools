import { existsSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.build', 'native');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const generated = path.join(root, 'tests', 'fixtures', 'generated');
const base = path.join(generated, 'creator-roundtrip-base.inp');
const output = path.join(generated, 'creator-roundtrip-input.inp');

function creatorEnv() {
  return {
    ...process.env,
    IAT_M1_NATIVE_TESTS: '1',
    IAT_M1_AUTHORING_TESTS: '1',
    IAT_M2_VISUAL_TESTS: '1',
    IAT_M2_PARAMETER_TESTS: '1',
    IAT_M2_CREATOR_TESTS: '1',
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

rmSync(base, { force: true });
rmSync(output, { force: true });

run('m2:parameter:ci');
run('m2:png');
run('test', ['--', 'packages/core/test/creator-fixture.test.ts'], creatorEnv());

if (!existsSync(output)) {
  throw new Error(`Creator fixture was not produced: ${output}`);
}
if (statSync(output).size === 0) {
  throw new Error(`Creator fixture is empty: ${output}`);
}

process.stdout.write(`${output}\n`);
