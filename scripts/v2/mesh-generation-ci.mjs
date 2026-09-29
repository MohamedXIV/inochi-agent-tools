import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.build', 'native');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const env = {
  ...process.env,
  IAT_V2_MESH_TESTS: '1',
  LD_LIBRARY_PATH: [outDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
  DYLD_LIBRARY_PATH: [outDir, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),
  PATH: [outDir, process.env.PATH].filter(Boolean).join(path.delimiter),
};
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(npmCommand, ['run', 'test', '--', 'tests/integration/v2-mesh-generation-real.test.ts']);
run(process.execPath, ['scripts/creator/launch-roundtrip.mjs', '--open-only', 'tests/fixtures/generated/v2-mesh/character-output.inp']);
