import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.build', 'native');
const probePath = path.join(outDir, 'bridge_probe');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

mkdirSync(outDir, { recursive: true });

run(process.execPath, ['scripts/native/verify-toolchain.mjs']);
run(process.execPath, ['scripts/upstream/materialize.mjs']);
run('dub', [
  'build',
  '--root=native/bridge',
  '--compiler=ldc2',
  '--build=debug',
  '--config=library',
]);

if (process.argv.includes('--probe')) {
  run('ldc2', [
    'native/bridge/test/bridge_probe.d',
    '-link-defaultlib-shared',
    `-L-L${outDir}`,
    '-L-liat_bridge',
    `-of=${probePath}`,
  ]);

  run(probePath, [], {
    env: {
      ...process.env,
      LD_LIBRARY_PATH: [outDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
      DYLD_LIBRARY_PATH: [outDir, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),
      PATH: [outDir, process.env.PATH].filter(Boolean).join(path.delimiter),
    },
  });
}
