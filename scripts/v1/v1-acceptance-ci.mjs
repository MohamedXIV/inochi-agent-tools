import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const generated = path.join(root, 'tests', 'fixtures', 'generated');
const launcher = path.join(root, 'scripts', 'creator', 'launch-roundtrip.mjs');

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function npm(script, args = []) {
  run(npmCommand, ['run', script, ...(args.length ? ['--', ...args] : [])]);
}

npm('m3:mcp:ci');
npm('v1:artifacts');
npm('creator:materialize');

for (const fileName of ['v1-cli-authored.inp', 'v1-mcp-authored.inp']) {
  run(process.execPath, [launcher, '--open-only', path.join(generated, fileName)]);
}

npm('v1:verify-artifacts');
npm('upstream:fingerprint', ['--json']);
