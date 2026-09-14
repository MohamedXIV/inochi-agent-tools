import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const configDir = resolve(root, '.build/creator/config');
const settingsPath = resolve(configDir, 'settings.json');
const creator = resolve(root, '.build/creator/v0.8.6/inochi-creator');
const creatorDir = dirname(creator);
const creatorCrashDir = resolve(creatorDir, '$XDG_STATE_HOME');
const openOnly = process.argv[2] === '--open-only';
const inputArg = openOnly ? process.argv[3] : undefined;
const input = resolve(root, inputArg ?? 'tests/fixtures/generated/creator-roundtrip-input.inp');
const output = input.replace(/\.inp$/i, '.inx');
const display = ':99';
const timeoutMs = 30_000;

function fail(message) {
  throw new Error(`Creator round-trip failed: ${message}`);
}

function commandExists(command) {
  const result = spawnSync('sh', ['-lc', `command -v ${command}`], { stdio: 'ignore' });
  return result.status === 0;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function waitFor(label, predicate, timeout = timeoutMs) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  if (lastError) fail(`${label} timed out; last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  fail(`${label} timed out`);
}

function readSettings() {
  if (!existsSync(settingsPath)) return null;
  return JSON.parse(readFileSync(settingsPath, 'utf8'));
}

function readCreatorCrashDump(prefix = 'inochi-creator-crashdump-') {
  if (!existsSync(creatorCrashDir)) return '';
  const dumps = readdirSync(creatorCrashDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.txt'))
    .sort();
  if (dumps.length === 0) return '';
  return readFileSync(resolve(creatorCrashDir, dumps.at(-1)), 'utf8');
}

function killProcess(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null) return;
  try {
    child.kill(signal);
  } catch {
    // Best-effort cleanup only.
  }
}

if (openOnly && !inputArg) fail('--open-only requires an input .inp path');
if (!existsSync(creator)) fail(`official Creator executable missing: ${creator}`);
if (!existsSync(input) || statSync(input).size === 0) fail(`input fixture missing or empty: ${input}`);
if (!commandExists('Xvfb')) fail('Xvfb is required');
if (!commandExists('xdotool')) fail('xdotool is required');

rmSync(configDir, { recursive: true, force: true });
rmSync(creatorCrashDir, { recursive: true, force: true });
if (!openOnly) rmSync(output, { force: true });
mkdirSync(configDir, { recursive: true });
// Creator v0.8.6's Linux crash handler passes the literal string
// "$XDG_STATE_HOME/" through expandTilde(), which does not expand env vars.
// Keep that literal relative directory available so upstream exceptions do not
// get masked by a secondary FileException and their original diagnostics remain visible.
mkdirSync(creatorCrashDir, { recursive: true });
writeFileSync(settingsPath, JSON.stringify({ hasDoneQuickSetup: true, prev_projects: [] }));

const env = {
  ...process.env,
  DISPLAY: display,
  INOCHI_CONFIG_PATH: configDir,
  LIBGL_ALWAYS_SOFTWARE: '1',
};

const xvfb = spawn('Xvfb', [display, '-screen', '0', '1280x800x24', '-nolisten', 'tcp'], {
  cwd: root,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let creatorProcess;
let creatorStdout = '';
let creatorStderr = '';
let xvfbStderr = '';
xvfb.stderr?.on('data', (chunk) => { xvfbStderr += chunk.toString(); });

try {
  await waitFor('X server readiness', () => {
    const probe = spawnSync('xdpyinfo', [], { env, stdio: 'ignore' });
    return probe.status === 0;
  }, 10_000);

  creatorProcess = spawn(creator, [input], {
    cwd: creatorDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  creatorProcess.stdout?.on('data', (chunk) => { creatorStdout += chunk.toString(); });
  creatorProcess.stderr?.on('data', (chunk) => { creatorStderr += chunk.toString(); });

  await waitFor('Creator to record successful project open', () => {
    if (creatorProcess.exitCode !== null) {
      const crashDump = readCreatorCrashDump();
      fail(
        `Creator exited early with code ${creatorProcess.exitCode}; ` +
        `stdout: ${creatorStdout}; stderr: ${creatorStderr}; crashdump: ${crashDump}`,
      );
    }
    const runtimeErrorDump = readCreatorCrashDump('inochi-creator-runtime-error-');
    if (runtimeErrorDump) {
      fail(`Creator rejected the input puppet: ${runtimeErrorDump}`);
    }
    const settings = readSettings();
    return Array.isArray(settings?.prev_projects) && settings.prev_projects[0] === input;
  });

  if (openOnly) {
    process.stdout.write(`${JSON.stringify({ input, opened: true, creatorVersion: 'v0.8.6' })}\n`);
  } else {
    // incOpenProject records prev_projects before the SDL window is necessarily mapped.
    // Wait for the real Creator window instead of racing a one-shot xdotool lookup.
    const windowId = await waitFor('Creator window visibility', () => {
      const search = spawnSync('xdotool', ['search', '--onlyvisible', '--pid', String(creatorProcess.pid)], {
        env,
        encoding: 'utf8',
      });
      if (search.status !== 0) return false;
      return search.stdout.trim().split(/\s+/)[0] || false;
    });

    // Bare Xvfb intentionally has no EWMH window manager, so windowactivate is
    // not available. Target the mapped Creator window directly instead.
    const save = spawnSync('xdotool', [
      'key', '--window', windowId, '--clearmodifiers', 'ctrl+s',
    ], { env, encoding: 'utf8' });
    if (save.status !== 0) fail(`Ctrl+S dispatch failed: ${save.stderr || save.stdout}`);

    await waitFor('Creator-produced .inx save', () => existsSync(output) && statSync(output).size > 0);

    const settings = readSettings();
    if (!Array.isArray(settings?.prev_projects) || settings.prev_projects[0] !== output) {
      fail(`Creator save evidence missing from prev_projects: ${JSON.stringify(settings?.prev_projects)}`);
    }

    process.stdout.write(`${JSON.stringify({ input, output, creatorVersion: 'v0.8.6' })}\n`);
  }
} finally {
  killProcess(creatorProcess);
  await sleep(250);
  killProcess(creatorProcess, 'SIGKILL');
  killProcess(xvfb);
  await sleep(100);
  killProcess(xvfb, 'SIGKILL');
  if (xvfb.exitCode && xvfb.exitCode !== 0 && xvfbStderr) {
    console.error(xvfbStderr.trim());
  }
}
