import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.build', 'native');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const host = path.join(outDir, process.platform === 'win32' ? 'iat_native_host.exe' : 'iat_native_host');
const checker = path.join(root, 'tests', 'fixtures', 'generated', 'm2-checker.png');

const env = {
  ...process.env,
  IAT_AWAY_CHARACTER_SPIKE_TESTS: '1',
  LD_LIBRARY_PATH: [outDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
  DYLD_LIBRARY_PATH: [outDir, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),
  PATH: [outDir, process.env.PATH].filter(Boolean).join(path.delimiter),
};

function run(command, args, runEnv = process.env) {
  const result = spawnSync(command, args, { cwd: root, env: runEnv, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(host) || !existsSync(checker)) {
  run(npmCommand, ['run', 'tint:ci']);
}
run('npx', ['tsc', '-p', 'spikes/away-character/tsconfig.json']);
run(npmCommand, ['run', 'cli:build']);
run(npmCommand, ['run', 'mcp:build']);
run(npmCommand, [
  'run', 'test', '--',
  'tests/integration/away-character-contract.test.ts',
], env);
run(npmCommand, ['run', 'creator:materialize']);
run(process.execPath, [
  'scripts/creator/launch-roundtrip.mjs',
  '--open-only',
  'tests/fixtures/generated/away-character-spike.inp',
]);
