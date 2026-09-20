import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.build', 'native');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const visualControlEnv = {
  ...process.env,
  IAT_V13_VISUAL_CONTROL_TESTS: '1',
  LD_LIBRARY_PATH: [outDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
  DYLD_LIBRARY_PATH: [outDir, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),
  PATH: [outDir, process.env.PATH].filter(Boolean).join(path.delimiter),
};

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(npmCommand, ['run', 'm2:parameter:ci']);
run(npmCommand, ['run', 'cli:build']);
run(npmCommand, ['run', 'mcp:build']);
run(npmCommand, [
  'run',
  'test',
  '--',
  'tests/integration/v1.3-opacity-adapter-parity.test.ts',
], visualControlEnv);
run(npmCommand, ['run', 'creator:materialize']);
run(process.execPath, [
  'scripts/creator/launch-roundtrip.mjs',
  '--open-only',
  'tests/fixtures/generated/core-v1.3-opacity-output.inp',
]);
