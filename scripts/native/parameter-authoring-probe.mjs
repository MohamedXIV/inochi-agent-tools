import { mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.build', 'native');
const inputPath = path.join(root, 'tests', 'fixtures', 'generated', 'm1-host-created-minimal.inp');
const outputPath = path.join(root, 'tests', 'fixtures', 'generated', 'm2-parameter-authoring.inp');
const executable = path.join(
  outDir,
  process.platform === 'win32' ? 'm2_parameter_authoring_probe.exe' : 'm2_parameter_authoring_probe',
);

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

function nativeEnv() {
  return {
    ...process.env,
    LD_LIBRARY_PATH: [outDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
    DYLD_LIBRARY_PATH: [outDir, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),
    PATH: [outDir, process.env.PATH].filter(Boolean).join(path.delimiter),
  };
}

mkdirSync(outDir, { recursive: true });
rmSync(outputPath, { force: true });
run(process.execPath, ['scripts/native/build-host.mjs', '--create-host-probe']);
run(process.execPath, ['scripts/native/build-bridge.mjs']);
run('ldc2', [
  'native/bridge/test/parameter_authoring_probe.d',
  '-link-defaultlib-shared',
  `-L-L${outDir}`,
  '-L-liat_bridge',
  `-of=${executable}`,
]);
run(executable, [inputPath, outputPath], { env: nativeEnv() });
