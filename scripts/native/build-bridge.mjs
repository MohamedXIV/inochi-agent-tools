import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.build', 'native');
const libraryName = process.platform === 'win32'
  ? 'iat_bridge.dll'
  : process.platform === 'darwin'
    ? 'libiat_bridge.dylib'
    : 'libiat_bridge.so';
const libraryPath = path.join(outDir, libraryName);
const probeName = process.platform === 'win32' ? 'bridge_probe.exe' : 'bridge_probe';
const probePath = path.join(outDir, probeName);
const shouldProbe = process.argv.includes('--probe');

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

if (existsSync(libraryPath)) rmSync(libraryPath);
run('dub', [
  'build',
  '--root=native/bridge',
  '--compiler=ldc2',
  '--build=debug',
  '--config=library',
]);

if (!existsSync(libraryPath)) {
  console.error(`native bridge build completed without expected library: ${libraryPath}`);
  process.exit(1);
}

if (shouldProbe) {
  if (existsSync(probePath)) rmSync(probePath);
  run('dub', [
    'build',
    '--root=native/probe',
    '--compiler=ldc2',
    '--build=debug',
  ]);

  if (!existsSync(probePath)) {
    console.error(`native bridge probe build completed without expected executable: ${probePath}`);
    process.exit(1);
  }

  const probeEnv = { ...process.env };
  if (process.platform === 'win32') {
    probeEnv.PATH = [outDir, probeEnv.PATH].filter(Boolean).join(path.delimiter);
  } else if (process.platform === 'darwin') {
    probeEnv.DYLD_LIBRARY_PATH = [outDir, probeEnv.DYLD_LIBRARY_PATH].filter(Boolean).join(':');
  } else {
    probeEnv.LD_LIBRARY_PATH = [outDir, probeEnv.LD_LIBRARY_PATH].filter(Boolean).join(':');
  }

  run(probePath, [], { env: probeEnv });
}
