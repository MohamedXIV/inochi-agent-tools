import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const exe = path.join(root, '.build', 'current-format', process.platform === 'win32' ? 'iat_current_format_probe.exe' : 'iat_current_format_probe');
const input = path.join(root, 'tests', 'fixtures', 'generated', 'v1.6-rig-helper-output.inp');
const outA = path.join(root, 'tests', 'fixtures', 'generated', 'v1.7-current-a.inp');
const rtA = path.join(root, 'tests', 'fixtures', 'generated', 'v1.7-current-a-roundtrip.inp');
const outB = path.join(root, 'tests', 'fixtures', 'generated', 'v1.7-current-b.inp');
const rtB = path.join(root, 'tests', 'fixtures', 'generated', 'v1.7-current-b-roundtrip.inp');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(result.stdout || '');
    console.error(result.stderr || `${command} exited ${result.status}`);
    process.exit(result.status ?? 1);
  }
  return result;
}
function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
function assertInp2(file) {
  const magic = readFileSync(file).subarray(0, 8).toString('ascii');
  if (magic !== 'TRNSRTS2') {
    console.error(`${path.basename(file)} expected TRNSRTS2, got ${JSON.stringify(magic)}`);
    process.exit(1);
  }
}

for (const file of [outA, rtA, outB, rtB]) rmSync(file, { force: true });

if (!existsSync(input)) {
  run(npmCommand, ['run', 'v1.6:rig-helpers:ci'], { stdio: 'inherit', encoding: undefined });
}
run(npmCommand, ['run', 'current:materialize'], { stdio: 'inherit', encoding: undefined });
run('dub', ['build', '--root=native/current-format', '--compiler=ldc2', '--build=debug'], { stdio: 'inherit', encoding: undefined });

const first = run(exe, [input, outA, rtA]);
const second = run(exe, [input, outB, rtB]);
for (const file of [outA, rtA, outB, rtB]) assertInp2(file);

if (digest(outA) !== digest(outB)) {
  console.error('independent current-format conversions are not deterministic');
  process.exit(1);
}
if (digest(rtA) !== digest(rtB)) {
  console.error('independent current-format save/reload cycles are not deterministic');
  process.exit(1);
}

const current = JSON.parse(readFileSync(path.join(root, 'upstream', 'inochi2d-current.json'), 'utf8'));
console.log(JSON.stringify({
  ok: true,
  upstreamVersion: current.declaredVersion,
  upstreamCommit: current.commit,
  magic: 'TRNSRTS2',
  deterministicConversionSha256: digest(outA),
  deterministicRoundtripSha256: digest(rtA),
  probe: JSON.parse(first.stdout.trim()),
}));
