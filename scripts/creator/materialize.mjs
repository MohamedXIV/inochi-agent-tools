import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = resolve(root, 'upstream/inochi-creator.json');
const manifest = JSON.parse(await import('node:fs').then(({ readFileSync }) => readFileSync(manifestPath, 'utf8')));
const creatorRoot = resolve(root, '.build/creator');
const archivePath = resolve(creatorRoot, manifest.linuxAssetName);
const releaseDir = resolve(creatorRoot, manifest.release);
const extractDir = resolve(creatorRoot, `${manifest.release}.extracting`);
const downloadPath = resolve(creatorRoot, `${manifest.linuxAssetName}.downloading`);

function fail(message) {
  throw new Error(`creator materialization failed: ${message}`);
}

function assertManifest() {
  if (manifest.release !== 'v0.8.6') fail(`unexpected release ${JSON.stringify(manifest.release)}`);
  if (manifest.linuxAssetId !== 193284190) fail(`unexpected Linux asset id ${JSON.stringify(manifest.linuxAssetId)}`);
  if (manifest.linuxAssetName !== 'inochi-creator-linux.zip') fail(`unexpected Linux asset name ${JSON.stringify(manifest.linuxAssetName)}`);
  if (manifest.linuxAssetSize !== 22341517) fail(`unexpected Linux asset size ${JSON.stringify(manifest.linuxAssetSize)}`);
  if (manifest.downloadUrl !== 'https://github.com/Inochi2D/inochi-creator/releases/download/v0.8.6/inochi-creator-linux.zip') {
    fail(`unexpected download URL ${JSON.stringify(manifest.downloadUrl)}`);
  }
}

function assertArchiveSize(path) {
  if (!existsSync(path)) return false;
  const actual = statSync(path).size;
  if (actual !== manifest.linuxAssetSize) {
    fail(`archive byte size mismatch: expected ${manifest.linuxAssetSize}, got ${actual}`);
  }
  return true;
}

async function downloadArchive() {
  mkdirSync(creatorRoot, { recursive: true });
  if (assertArchiveSize(archivePath)) return;

  rmSync(downloadPath, { force: true });
  const response = await fetch(manifest.downloadUrl, { redirect: 'follow' });
  if (!response.ok) fail(`HTTP ${response.status} while downloading ${manifest.downloadUrl}`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== manifest.linuxAssetSize) {
    fail(`downloaded byte size mismatch: expected ${manifest.linuxAssetSize}, got ${bytes.byteLength}`);
  }

  writeFileSync(downloadPath, bytes, { flag: 'wx' });
  renameSync(downloadPath, archivePath);
  assertArchiveSize(archivePath);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} exited ${result.status ?? 'without status'}\n${result.stdout ?? ''}${result.stderr ?? ''}`.trim());
  }
}

function findExecutables(dir, matches = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      findExecutables(path, matches);
    } else if (entry.isFile() && basename(path) === 'inochi-creator') {
      matches.push(path);
    }
  }
  return matches;
}

function extractArchive() {
  rmSync(extractDir, { recursive: true, force: true });
  rmSync(releaseDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });

  run('unzip', ['-q', archivePath, '-d', extractDir]);

  const matches = findExecutables(extractDir);
  if (matches.length !== 1) {
    fail(`expected exactly one executable named inochi-creator, found ${matches.length}`);
  }

  renameSync(extractDir, releaseDir);
  const executable = matches[0].replace(extractDir, releaseDir);
  chmodSync(executable, 0o755);

  if (!statSync(executable).isFile()) fail(`Creator executable is not a regular file: ${executable}`);
  return executable;
}

try {
  assertManifest();
  await downloadArchive();
  const executable = extractArchive();
  process.stdout.write(`${executable}\n`);
} catch (error) {
  rmSync(downloadPath, { force: true });
  rmSync(extractDir, { recursive: true, force: true });
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
