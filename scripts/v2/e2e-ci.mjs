import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const nativeOut = path.join(root, '.build', 'native');
const currentOut = path.join(root, '.build', 'current-format');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const env = {
  ...process.env,
  IAT_V2_E2E_TESTS: '1',
  IAT_CURRENT_FORMAT_DIR: currentOut,
  LD_LIBRARY_PATH: [nativeOut, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
  DYLD_LIBRARY_PATH: [nativeOut, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),
  PATH: [nativeOut, currentOut, process.env.PATH].filter(Boolean).join(path.delimiter),
};

const result = spawnSync(npmCommand, ['run', 'test', '--', 'tests/integration/v2-autonomous-rigging-e2e.test.ts'], {
  cwd: root,
  env,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
