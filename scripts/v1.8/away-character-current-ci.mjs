import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const exe = path.join(root, '.build', 'current-format',
  process.platform === 'win32' ? 'iat_current_format_probe.exe' : 'iat_current_format_probe');
const input = path.join(root, 'tests', 'fixtures', 'generated', 'away-character-spike.inp');
const output = path.join(root, 'tests', 'fixtures', 'generated', 'away-character-spike-current.inp');
const roundtrip = path.join(root, 'tests', 'fixtures', 'generated', 'away-character-spike-current-roundtrip.inp');

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

function assertInp2(file) {
  const magic = readFileSync(file).subarray(0, 8).toString('ascii');
  if (magic !== 'TRNSRTS2') {
    console.error(`${path.basename(file)} expected TRNSRTS2, got ${JSON.stringify(magic)}`);
    process.exit(1);
  }
}

if (!existsSync(input)) {
  console.error('Away character canonical artifact is missing; run away-character:ci first');
  process.exit(1);
}
rmSync(output, { force: true });
rmSync(roundtrip, { force: true });

run(npmCommand, ['run', 'current:materialize'], { stdio: 'inherit', encoding: undefined });
run('dub', ['build', '--root=native/current-format', '--compiler=ldc2', '--build=debug'],
  { stdio: 'inherit', encoding: undefined });
const probe = run(exe, ['--conversion-only', input, output, roundtrip]);
assertInp2(output);
assertInp2(roundtrip);

console.log(JSON.stringify({
  ok: true,
  input: path.relative(root, input),
  format: 'TRNSRTS2',
  convertedSha256: createHash('sha256').update(readFileSync(output)).digest('hex'),
  roundtripSha256: createHash('sha256').update(readFileSync(roundtrip)).digest('hex'),
  probe: JSON.parse(probe.stdout.trim()),
}));
