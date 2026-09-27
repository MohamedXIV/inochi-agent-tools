import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourceDir = resolve(root, '.deps/inochi2d-current');
const manifest = JSON.parse(readFileSync(resolve(root, 'upstream/inochi2d-current.json'), 'utf8'));
const patchManifest = JSON.parse(readFileSync(resolve(root, 'native/current-patches/manifest.json'), 'utf8'));
const pristine = process.argv.includes('--pristine');

function fail(message) {
  console.error(`current upstream verification failed: ${message}`);
  process.exit(1);
}
function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail((result.stderr || `${command} exited ${result.status}`).trim());
  return result.stdout.trim();
}

if (!existsSync(resolve(sourceDir, '.git'))) fail('.deps/inochi2d-current is not materialized');
const head = capture('git', ['-C', sourceDir, 'rev-parse', 'HEAD']);
if (head !== manifest.commit) fail(`expected ${manifest.commit}, got ${head}`);
const versionSource = readFileSync(resolve(sourceDir, 'source/inochi2d/ver.d'), 'utf8');
if (!versionSource.split(/\r?\n/).includes(`enum IN_VERSION = "${manifest.declaredVersion}";`)) {
  fail(`source/inochi2d/ver.d does not declare ${manifest.declaredVersion}`);
}
if (!Array.isArray(patchManifest.patches) || patchManifest.patches.length === 0) fail('current patch manifest is empty');
for (const [index, patch] of patchManifest.patches.entries()) {
  for (const field of ['id', 'target', 'reason', 'removalCondition']) {
    if (typeof patch[field] !== 'string' || !patch[field].trim()) fail(`patch ${index} requires non-empty ${field}`);
  }
}
const changed = new Set(capture('git', ['-C', sourceDir, 'diff', '--name-only']).split(/\r?\n/).filter(Boolean));
const expectedTargets = new Set(patchManifest.patches.flatMap((patch) => [patch.target, ...(patch.additionalTargets ?? [])]));
if (pristine) {
  if (changed.size !== 0) fail(`pristine current upstream has unexpected changes: ${[...changed].join(', ')}`);
} else {
  for (const target of expectedTargets) if (!changed.has(target)) fail(`declared patch target is unchanged: ${target}`);
  for (const target of changed) if (!expectedTargets.has(target)) fail(`undeclared current upstream mutation: ${target}`);
  capture('git', ['-C', sourceDir, 'diff', '--check']);
}
console.log(`verified isolated Inochi2D ${manifest.declaredVersion} @ ${manifest.commit} (${pristine ? 'pristine' : 'patched'})`);
