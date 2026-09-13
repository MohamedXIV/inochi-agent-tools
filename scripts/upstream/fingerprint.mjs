import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function probe(command, args = []) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}: ${(result.stderr || '').trim()}`);
  return `${result.stdout}${result.stderr}`.trim().split(/\r?\n/).filter(Boolean)[0] ?? '';
}

export async function buildFingerprint({ probeTools = true } = {}) {
  const upstream = JSON.parse(readFileSync(resolve(root, 'upstream/inochi2d.json'), 'utf8'));
  const patchManifest = JSON.parse(readFileSync(resolve(root, 'native/patches/manifest.json'), 'utf8'));
  const patches = patchManifest.patches.map((patch) => patch.file);

  return {
    upstreamCommit: upstream.commit,
    upstreamVersion: upstream.declaredVersion,
    patches,
    node: probeTools ? process.version : null,
    ldc: probeTools ? probe('ldc2', ['--version']) : null,
    dub: probeTools ? probe('dub', ['--version']) : null
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fingerprint = await buildFingerprint({ probeTools: true });
  if (process.argv.includes('--json')) console.log(JSON.stringify(fingerprint));
  else console.log(fingerprint);
}
