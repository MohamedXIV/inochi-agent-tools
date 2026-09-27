import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(resolve(root, 'upstream/inochi2d-current.json'), 'utf8'));
const depsDir = resolve(root, '.deps');
const sourceDir = resolve(depsDir, 'inochi2d-current');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

mkdirSync(depsDir, { recursive: true });
if (!existsSync(resolve(sourceDir, '.git'))) {
  run('git', ['clone', '--filter=blob:none', manifest.repository, sourceDir]);
}
run('git', ['-C', sourceDir, 'fetch', 'origin', manifest.commit, '--depth=1']);
run('git', ['-C', sourceDir, 'checkout', '--detach', manifest.commit]);
run('git', ['-C', sourceDir, 'reset', '--hard', manifest.commit]);
run('git', ['-C', sourceDir, 'clean', '-fd']);
run(process.execPath, [resolve(root, 'scripts/current/verify.mjs'), '--pristine']);
run(process.execPath, [resolve(root, 'scripts/current/apply-patches.mjs')]);
run(process.execPath, [resolve(root, 'scripts/current/verify.mjs')]);
