import { spawnSync } from 'node:child_process';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
run(npm, ['run', 'v1:ci']);
run(npm, ['run', 'v1.1:bundle']);
run(process.execPath, ['scripts/package/smoke-bundle.mjs']);
