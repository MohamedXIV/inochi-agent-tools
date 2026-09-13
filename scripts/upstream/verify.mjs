import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourceDir = resolve(root, '.deps/inochi2d');
const patchesDir = resolve(root, 'native/patches');
const manifest = JSON.parse(readFileSync(resolve(root, 'upstream/inochi2d.json'), 'utf8'));
const patchManifest = JSON.parse(readFileSync(resolve(patchesDir, 'manifest.json'), 'utf8'));

function fail(message) {
  console.error(`upstream verification failed: ${message}`);
  process.exit(1);
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail((result.stderr || `${command} exited ${result.status}`).trim());
  return result.stdout.trim();
}

if (!existsSync(resolve(sourceDir, '.git'))) fail('.deps/inochi2d is not materialized');

const head = capture('git', ['-C', sourceDir, 'rev-parse', 'HEAD']);
if (head !== manifest.commit) fail(`expected ${manifest.commit}, got ${head}`);

const versionSource = readFileSync(resolve(sourceDir, 'source/inochi2d/ver.d'), 'utf8');
const expectedVersionLine = `enum IN_VERSION = "${manifest.declaredVersion}";`;
if (!versionSource.split(/\r?\n/).includes(expectedVersionLine)) {
  fail(`source/inochi2d/ver.d does not contain ${expectedVersionLine}`);
}

if (!Array.isArray(patchManifest.patches)) fail('native/patches/manifest.json must contain a patches array');
for (const [index, patch] of patchManifest.patches.entries()) {
  if (!patch || typeof patch !== 'object') fail(`patch ${index} must be an object`);
  for (const field of ['file', 'reason', 'removalCondition']) {
    if (typeof patch[field] !== 'string' || patch[field].trim() === '') fail(`patch ${index} requires non-empty ${field}`);
  }
  const patchPath = resolve(patchesDir, patch.file);
  if (!patchPath.startsWith(`${patchesDir}${sep}`)) fail(`patch ${index} escapes native/patches`);
  if (!existsSync(patchPath)) fail(`patch ${index} file does not exist: ${patch.file}`);
}

console.log(`verified Inochi2D ${manifest.declaredVersion} @ ${manifest.commit}`);
