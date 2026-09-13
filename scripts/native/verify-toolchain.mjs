import { spawnSync } from 'node:child_process';

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) {
    console.error(`native toolchain verification failed: ${command} is unavailable: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`native toolchain verification failed: ${command} exited ${result.status}`);
    process.exit(result.status ?? 1);
  }
  return `${result.stdout}${result.stderr}`;
}

const ldcOutput = capture('ldc2', ['--version']);
const match = ldcOutput.match(/LDC - the LLVM D compiler \((\d+)\.(\d+)\.(\d+)\)/);
if (!match) {
  console.error('native toolchain verification failed: could not parse `ldc2 --version`');
  process.exit(1);
}

const [, majorText, minorText, patchText] = match;
const version = [Number(majorText), Number(minorText), Number(patchText)];
const minimum = [1, 40, 0];
for (let i = 0; i < minimum.length; i += 1) {
  if (version[i] > minimum[i]) break;
  if (version[i] < minimum[i]) {
    console.error(`native toolchain verification failed: LDC ${version.join('.')} is below required 1.40.0`);
    process.exit(1);
  }
}

capture('dub', ['--version']);
console.log(`verified native toolchain: LDC ${version.join('.')} and DUB available`);
