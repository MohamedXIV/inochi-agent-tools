import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, '.build', 'native');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(script, args = [], env = process.env) {
  const result = spawnSync(npmCommand, ['run', script, ...args], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function protocolEnv() {
  return {
    ...process.env,
    IAT_MCP_PROTOCOL_TESTS: '1',
    IAT_MCP_REAL_WORKFLOW_TESTS: '1',
    LD_LIBRARY_PATH: [outDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
    DYLD_LIBRARY_PATH: [outDir, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':'),
    PATH: [outDir, process.env.PATH].filter(Boolean).join(path.delimiter),
  };
}

run('m3:cli:ci');
run('mcp:build');
run('mcp:protocol:test', [], protocolEnv());
run('mcp:real-workflow:test', [], protocolEnv());
