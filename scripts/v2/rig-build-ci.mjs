import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.build', 'native');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const env = {
  ...process.env,
  IAT_V2_RIG_BUILD_TESTS: '1',
  LD_LIBRARY_PATH: [outDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
  DYLD_LIBRARY_PATH: [outDir, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),
  PATH: [outDir, process.env.PATH].filter(Boolean).join(path.delimiter),
};

const result = spawnSync(npmCommand, ['run', 'test', '--', 'tests/integration/v2-rig-build-real.test.ts'], {
  cwd: root,
  env,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
