import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.build', 'native');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const env = {
  ...process.env,
  IAT_TINT_BINDING_TESTS: '1',
  LD_LIBRARY_PATH: [outDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
  DYLD_LIBRARY_PATH: [outDir, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),
  PATH: [outDir, process.env.PATH].filter(Boolean).join(path.delimiter),
};

function run(command, args, runEnv = process.env) {
  const result = spawnSync(command, args, { cwd: root, env: runEnv, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(npmCommand, ['run', 'm2:parameter:ci']);
run(npmCommand, ['run', 'cli:build']);
run(npmCommand, ['run', 'mcp:build']);
run(npmCommand, ['run', 'test', '--', 'tests/integration/tint-adapter-parity.test.ts'], env);
