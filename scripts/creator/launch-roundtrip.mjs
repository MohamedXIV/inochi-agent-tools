import {
  existsSync,
  mkdirSync,
  readFileSync,
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
const input = resolve(root, 'tests/fixtures/generated/creator-roundtrip-input.inp');
const output = resolve(root, 'tests/fixtures/generated/creator-roundtrip-input.inx');
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
      if (await predicate()) return;
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

function killProcess(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null) return;
  try {
    child.kill(signal);
  } catch {
    // Best-effort cleanup only.
  }
}

if (!existsSync(creator)) fail(`official Creator executable missing: ${creator}`);
if (!existsSync(input) || statSync(input).size === 0) fail(`input fixture missing or empty: ${input}`);
if (!commandExists('Xvfb')) fail('Xvfb is required');
if (!commandExists('xdotool')) fail('xdotool is required');

rmSync(configDir, { recursive: true, force: true });
rmSync(output, { force: true });
mkdirSync(configDir, { recursive: true });
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
let creatorStderr = '';
let xvfbStderr = '';
xvfb.stderr?.on('data', (chunk) => { xvfbStderr += chunk.toString(); });

try {
  await waitFor('X server readiness', () => {
    const probe = spawnSync('xdpyinfo', [], { env, stdio: 'ignore' });
    return probe.status === 0;
  }, 10_000);

  creatorProcess = spawn(creator, [input], {
    cwd: dirname(creator),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  creatorProcess.stderr?.on('data', (chunk) => { creatorStderr += chunk.toString(); });

  await waitFor('Creator to record successful project open', () => {
    if (creatorProcess.exitCode !== null) {
      fail(`Creator exited early with code ${creatorProcess.exitCode}; stderr: ${creatorStderr}`);
    }
    const settings = readSettings();
    return Array.isArray(settings?.prev_projects) && settings.prev_projects[0] === input;
  });

  const search = spawnSync('xdotool', ['search', '--onlyvisible', '--pid', String(creatorProcess.pid)], {
    env,
    encoding: 'utf8',
  });
  if (search.status !== 0) fail(`could not find Creator window: ${search.stderr || search.stdout}`);
  const windowId = search.stdout.trim().split(/\s+/)[0];
  if (!windowId) fail('xdotool returned no Creator window id');

  const save = spawnSync('xdotool', [
    'windowactivate', '--sync', windowId,
    'key', '--clearmodifiers', 'ctrl+s',
  ], { env, encoding: 'utf8' });
  if (save.status !== 0) fail(`Ctrl+S dispatch failed: ${save.stderr || save.stdout}`);

  await waitFor('Creator-produced .inx save', () => existsSync(output) && statSync(output).size > 0);

  const settings = readSettings();
  if (!Array.isArray(settings?.prev_projects) || settings.prev_projects[0] !== output) {
    fail(`Creator save evidence missing from prev_projects: ${JSON.stringify(settings?.prev_projects)}`);
  }

  process.stdout.write(`${JSON.stringify({ input, output, creatorVersion: 'v0.8.6' })}\n`);
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
