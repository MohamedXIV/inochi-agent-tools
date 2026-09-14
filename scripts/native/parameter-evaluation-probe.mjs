import { mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.build', 'native');
const baseInputPath = path.join(root, 'tests', 'fixtures', 'generated', 'm1-host-created-minimal.inp');
const inputPath = path.join(root, 'tests', 'fixtures', 'generated', 'm2-parameter-evaluation.inp');
const hostPath = path.join(outDir, process.platform === 'win32' ? 'iat_native_host.exe' : 'iat_native_host');
const executable = path.join(
  outDir,
  process.platform === 'win32' ? 'm2_parameter_evaluation_probe.exe' : 'm2_parameter_evaluation_probe',
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
rmSync(inputPath, { force: true });
run(process.execPath, ['scripts/native/build-host.mjs', '--create-host-probe']);

const operations = [
  { type: 'node.create', parentPath: '/Root', name: 'Rig' },
  { type: 'parameter.create', name: 'Move X', dimensions: 1, min: [-1, 0], max: [1, 0], defaultValue: [0, 0] },
  { type: 'parameter.create', name: 'Move Y', dimensions: 1, min: [-1, 0], max: [1, 0], defaultValue: [0, 0] },
  {
    type: 'parameter.bind', parameterName: 'Move X', targetPath: '/Root/Rig', property: 'transform.t.x',
    keypoints: [{ at: [-1, 0], value: -20 }, { at: [1, 0], value: 20 }],
  },
  {
    type: 'parameter.bind', parameterName: 'Move Y', targetPath: '/Root/Rig', property: 'transform.t.y',
    keypoints: [{ at: [-1, 0], value: -12 }, { at: [1, 0], value: 12 }],
  },
];
run(hostPath, ['edit-visual', baseInputPath, inputPath, JSON.stringify(operations)], { env: nativeEnv() });
run(process.execPath, ['scripts/native/build-bridge.mjs']);
run('ldc2', [
  'native/bridge/test/parameter_evaluation_probe.d',
  '-link-defaultlib-shared',
  `-L-L${outDir}`,
  '-L-liat_bridge',
  `-of=${executable}`,
]);
run(executable, [inputPath], { env: nativeEnv() });
