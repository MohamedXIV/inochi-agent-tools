import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundleRoot = path.resolve(repoRoot, process.env.IAT_BUNDLE_DIR ?? '.build/bundle');

await rm(bundleRoot, { recursive: true, force: true });
await mkdir(bundleRoot, { recursive: true });

for (const name of ['core', 'cli', 'sdk', 'mcp']) {
  const source = path.join(repoRoot, 'packages', name);
  const target = path.join(bundleRoot, 'packages', name);
  await mkdir(target, { recursive: true });
  await cp(path.join(source, 'dist'), path.join(target, 'dist'), { recursive: true });
  await cp(path.join(source, 'package.json'), path.join(target, 'package.json'));
}

// Keep the npm workspace layout intact so package-name imports and MCP runtime
// dependencies resolve exactly as they did in the verified checkout. Symlinks are
// preserved and their workspace targets exist under bundleRoot/packages.
await cp(path.join(repoRoot, 'node_modules'), path.join(bundleRoot, 'node_modules'), {
  recursive: true,
  dereference: false,
  verbatimSymlinks: true,
});
await cp(path.join(repoRoot, '.build', 'native'), path.join(bundleRoot, 'native'), { recursive: true });

const sh = `#!/usr/bin/env sh\nset -eu\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexport IAT_NATIVE_DIR="$ROOT/native"\nexec node "$ROOT/packages/cli/dist/main.js" "$@"\n`;
const mcpSh = `#!/usr/bin/env sh\nset -eu\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexport IAT_NATIVE_DIR="$ROOT/native"\nexec node "$ROOT/packages/mcp/dist/main.js" "$@"\n`;
const ps = `\$root = Split-Path -Parent \$MyInvocation.MyCommand.Path\n\$env:IAT_NATIVE_DIR = Join-Path \$root 'native'\n& node (Join-Path \$root 'packages/cli/dist/main.js') @args\nexit \$LASTEXITCODE\n`;
const mcpPs = `\$root = Split-Path -Parent \$MyInvocation.MyCommand.Path\n\$env:IAT_NATIVE_DIR = Join-Path \$root 'native'\n& node (Join-Path \$root 'packages/mcp/dist/main.js') @args\nexit \$LASTEXITCODE\n`;

await writeFile(path.join(bundleRoot, 'inochi-agent'), sh, { mode: 0o755 });
await writeFile(path.join(bundleRoot, 'inochi-agent-mcp'), mcpSh, { mode: 0o755 });
await writeFile(path.join(bundleRoot, 'inochi-agent.ps1'), ps);
await writeFile(path.join(bundleRoot, 'inochi-agent-mcp.ps1'), mcpPs);
await writeFile(path.join(bundleRoot, 'bundle.json'), `${JSON.stringify({ format: 1, nativeDir: 'native' }, null, 2)}\n`);

console.log(bundleRoot);
