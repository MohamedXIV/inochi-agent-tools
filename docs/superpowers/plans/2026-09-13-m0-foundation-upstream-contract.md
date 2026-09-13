# M0 Foundation & Upstream Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a reproducible TypeScript workspace and native D bridge that is pinned to one exact Inochi2D revision and proves real linkage to that upstream build.

**Architecture:** npm workspaces host the public TypeScript packages while `native/bridge` is an isolated DUB package. A checked-in upstream manifest pins Inochi2D exactly; scripts materialize that source into a gitignored dependency directory, validate its commit, and produce a reproducibility fingerprint. The first native bridge exports only version/provenance probes, proving the D/C ABI boundary and real linkage without prematurely implementing authoring APIs.

**Tech Stack:** Node.js 22+, npm workspaces, TypeScript 5.x, Vitest, DUB, LDC >= 1.40.0, Inochi2D v0_8 pinned at `fdb241da048dbe330152f7b0015e2129dc392844` (`IN_VERSION = "v0.8.7"`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-13-inochi-agent-tools-v1-design.md`

## Global Constraints

- The project is public and general-purpose; no Away Message-specific names or gameplay semantics belong in the core.
- CLI, MCP, and SDK will consume one semantic authoring core; they must not become separate implementations.
- Raw `in_*`, allocator, pointer, memory-offset, or native-handle operations are not normal public agent-facing APIs.
- Runtime and authoring concerns remain separable.
- Upstream Inochi2D is pinned; patches are isolated, minimal, documented, tested, and removable when upstream exposes an equivalent primitive.
- Real `.inp` artifacts are required for integration/acceptance proof in later milestones; fake JSON or hand-crafted binary cannot claim Creator compatibility.
- Every acceptance build must make exact upstream SHA, compiler/toolchain versions, bridge revision, patch identities, and build flags recoverable.
- Strict RED -> GREEN TDD applies to behavior changes.

---

## File Structure Locked by M0

```text
package.json                    # npm workspace and root verification scripts
tsconfig.base.json              # shared strict TypeScript configuration
vitest.config.ts                # root TS test discovery
.gitignore                      # generated dependency/build directories
.github/workflows/verify.yml    # exact repository verification gate

packages/core/
  package.json                  # semantic core package shell
  tsconfig.json
  src/index.ts                  # public semantic-core entry point
  test/smoke.test.ts            # workspace/test harness proof

upstream/
  inochi2d.json                 # exact source pin and expected upstream metadata

native/patches/
  manifest.json                 # ordered patch registry, initially empty
  README.md                     # patch policy and invariant

native/bridge/
  dub.json                      # bridge package linked to materialized Inochi2D
  source/iat_bridge.d           # stable C ABI provenance probe
  test/bridge_probe.d           # native executable assertion of real upstream linkage

scripts/
  upstream/materialize.mjs      # clone/fetch/checkout exact upstream SHA
  upstream/verify.mjs           # fail-closed source + manifest verification
  upstream/fingerprint.mjs      # deterministic provenance JSON output
  native/verify-toolchain.mjs   # check ldc2/dub version floors
  native/build-bridge.mjs       # orchestrate verified upstream + DUB build/probe

tests/reproducibility/
  upstream-manifest.test.ts     # manifest/patch-policy tests
  fingerprint.test.ts           # deterministic provenance-shape tests
```

Generated paths `.deps/`, `.build/`, `coverage/`, and `node_modules/` are ignored and never treated as source authority.

---

### Task 1: Bootstrap the strict workspace and verification shell

**Files:**
- Modify: `README.md`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/test/smoke.test.ts`

**Interfaces:**
- Produces: root scripts `typecheck`, `test`, and `verify`; package `@inochi-agent-tools/core`.
- Produces: `coreVersion(): string` as a temporary smoke-level semantic entry point; it is not a native API.

- [ ] **Step 1: Add a failing workspace smoke test**

```ts
// packages/core/test/smoke.test.ts
import { describe, expect, it } from 'vitest';
import { coreVersion } from '../src/index.js';

describe('semantic core package', () => {
  it('exposes an explicit pre-1.0 API version', () => {
    expect(coreVersion()).toBe('0.1.0');
  });
});
```

- [ ] **Step 2: Add root/package configuration, but leave `coreVersion` absent and prove RED**

Root `package.json` must contain:

```json
{
  "name": "inochi-agent-tools",
  "private": true,
  "engines": { "node": ">=22" },
  "workspaces": ["packages/*"],
  "scripts": {
    "typecheck": "tsc -p packages/core/tsconfig.json --noEmit",
    "test": "vitest run",
    "verify": "npm run typecheck && npm test"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

Run: `npm install && npm test`

Expected: FAIL because `../src/index.js` does not export `coreVersion`.

- [ ] **Step 3: Implement the minimal GREEN semantic entry point**

```ts
// packages/core/src/index.ts
export function coreVersion(): string {
  return '0.1.0';
}
```

Use strict NodeNext TypeScript settings in `tsconfig.base.json`: `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `declaration: true`.

- [ ] **Step 4: Verify the workspace**

Run: `npm run verify`

Expected: typecheck PASS and smoke test PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md package.json package-lock.json tsconfig.base.json vitest.config.ts .gitignore packages/core
git commit -m "build: bootstrap semantic core workspace"
```

---

### Task 2: Pin and validate exact Inochi2D upstream

**Files:**
- Create: `upstream/inochi2d.json`
- Create: `native/patches/manifest.json`
- Create: `native/patches/README.md`
- Create: `scripts/upstream/materialize.mjs`
- Create: `scripts/upstream/verify.mjs`
- Create: `tests/reproducibility/upstream-manifest.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces manifest schema:
  `{"repository": string, "branch": string, "commit": string, "declaredVersion": string}`.
- Produces command `npm run upstream:materialize` that leaves exact source at `.deps/inochi2d`.
- Produces command `npm run upstream:verify` that exits non-zero on any source/commit/version mismatch.

- [ ] **Step 1: Write failing manifest tests**

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const manifestPath = new URL('../../upstream/inochi2d.json', import.meta.url);

describe('Inochi2D upstream contract', () => {
  it('pins one immutable full SHA', async () => {
    const m = JSON.parse(await readFile(manifestPath, 'utf8'));
    expect(m.repository).toBe('https://github.com/Inochi2D/inochi2d.git');
    expect(m.branch).toBe('v0_8');
    expect(m.commit).toBe('fdb241da048dbe330152f7b0015e2129dc392844');
    expect(m.declaredVersion).toBe('v0.8.7');
  });
});
```

Run: `npm test -- tests/reproducibility/upstream-manifest.test.ts`

Expected: FAIL because the manifest does not exist.

- [ ] **Step 2: Add the immutable upstream and empty patch manifests**

`upstream/inochi2d.json`:

```json
{
  "repository": "https://github.com/Inochi2D/inochi2d.git",
  "branch": "v0_8",
  "commit": "fdb241da048dbe330152f7b0015e2129dc392844",
  "declaredVersion": "v0.8.7"
}
```

`native/patches/manifest.json` starts as:

```json
{ "patches": [] }
```

Document that patch order is manifest order and every future patch entry must include `file`, `reason`, and `removalCondition`.

- [ ] **Step 3: Implement materialization with exact-SHA checkout**

`scripts/upstream/materialize.mjs` must:

```js
// pseudocode shape that must be implemented literally with child_process spawnSync
// 1. read upstream/inochi2d.json
// 2. if .deps/inochi2d/.git missing: git clone --filter=blob:none <repository> .deps/inochi2d
// 3. git -C .deps/inochi2d fetch origin <commit> --depth=1
// 4. git -C .deps/inochi2d checkout --detach <commit>
// 5. invoke scripts/upstream/verify.mjs
```

Every failed git command must propagate its non-zero exit code; never fall back to branch HEAD.

- [ ] **Step 4: Implement fail-closed verification**

`scripts/upstream/verify.mjs` checks:

```text
git -C .deps/inochi2d rev-parse HEAD
== fdb241da048dbe330152f7b0015e2129dc392844

source/inochi2d/ver.d contains:
enum IN_VERSION = "v0.8.7";
```

It also validates every patch manifest entry points to an existing file under `native/patches/`.

- [ ] **Step 5: Wire and verify scripts**

Add:

```json
"upstream:materialize": "node scripts/upstream/materialize.mjs",
"upstream:verify": "node scripts/upstream/verify.mjs"
```

Run: `npm run upstream:materialize && npm run upstream:verify && npm test -- tests/reproducibility/upstream-manifest.test.ts`

Expected: all PASS and `.deps/inochi2d` detached at the exact pin.

- [ ] **Step 6: Commit**

```bash
git add upstream native/patches scripts/upstream tests/reproducibility package.json package-lock.json .gitignore
git commit -m "build: pin Inochi2D upstream contract"
```

---

### Task 3: Produce deterministic build provenance

**Files:**
- Create: `scripts/upstream/fingerprint.mjs`
- Create: `scripts/native/verify-toolchain.mjs`
- Create: `tests/reproducibility/fingerprint.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `npm run upstream:fingerprint -- --json` JSON with keys:
  `upstreamCommit`, `upstreamVersion`, `patches`, `node`, `ldc`, `dub`.
- Produces `npm run native:toolchain:verify` which requires `ldc2 >= 1.40.0` and a callable `dub`.

- [ ] **Step 1: Write RED tests for fingerprint shape and deterministic patch ordering**

```ts
import { describe, expect, it } from 'vitest';
import { buildFingerprint } from '../../scripts/upstream/fingerprint.mjs';

describe('build fingerprint', () => {
  it('reports immutable upstream and ordered patches', async () => {
    const f = await buildFingerprint({ probeTools: false });
    expect(f.upstreamCommit).toBe('fdb241da048dbe330152f7b0015e2129dc392844');
    expect(f.upstreamVersion).toBe('v0.8.7');
    expect(f.patches).toEqual([]);
  });
});
```

Run: `npm test -- tests/reproducibility/fingerprint.test.ts`

Expected: FAIL because `fingerprint.mjs` does not exist.

- [ ] **Step 2: Implement fingerprinting**

`buildFingerprint({ probeTools })` reads checked-in manifests. With `probeTools: true`, obtain versions using `node --version`, `ldc2 --version`, and `dub --version`; normalize each to one trimmed string. JSON output must use stable key order as listed in Interfaces.

- [ ] **Step 3: Implement the LDC/DUB toolchain gate**

`verify-toolchain.mjs` parses the first `LDC - the LLVM D compiler (x.y.z)` version and rejects anything below `1.40.0`. Missing executables are hard failures with actionable stderr.

- [ ] **Step 4: Verify**

Run: `npm test -- tests/reproducibility/fingerprint.test.ts && npm run native:toolchain:verify && npm run upstream:fingerprint -- --json`

Expected: tests PASS; local toolchain gate either PASS or fails explicitly naming the missing/outdated tool. CI in Task 5 becomes the authoritative clean-environment proof.

- [ ] **Step 5: Commit**

```bash
git add scripts/upstream/fingerprint.mjs scripts/native/verify-toolchain.mjs tests/reproducibility/fingerprint.test.ts package.json
git commit -m "build: record native build provenance"
```

---

### Task 4: Build the first real D/C ABI bridge against pinned Inochi2D

**Files:**
- Create: `native/bridge/dub.json`
- Create: `native/bridge/source/iat_bridge.d`
- Create: `native/bridge/test/bridge_probe.d`
- Create: `scripts/native/build-bridge.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces C ABI:
  `extern(C) uint iat_bridge_abi_version()` -> `1`.
- Produces C ABI:
  `extern(C) const(char)* iat_bridge_upstream_version()` -> upstream `IN_VERSION` as a stable null-terminated string.
- Produces `npm run native:build` and `npm run native:probe`.

- [ ] **Step 1: Add a RED native probe that expects the bridge functions**

```d
// native/bridge/test/bridge_probe.d
import std.stdio : writeln;

extern(C) uint iat_bridge_abi_version();
extern(C) const(char)* iat_bridge_upstream_version();

int main() {
    assert(iat_bridge_abi_version() == 1);
    assert(iat_bridge_upstream_version() !is null);
    writeln(iat_bridge_upstream_version());
    return 0;
}
```

Run through the future orchestrator: `npm run native:probe`

Expected: FAIL because the bridge/orchestrator does not exist.

- [ ] **Step 2: Create the DUB bridge package with a local path dependency**

`native/bridge/dub.json`:

```json
{
  "name": "inochi-agent-tools-bridge",
  "targetType": "dynamicLibrary",
  "sourcePaths": ["source"],
  "dependencies": {
    "inochi2d": { "path": "../../.deps/inochi2d" }
  },
  "toolchainRequirements": { "ldc": ">=1.40.0" }
}
```

- [ ] **Step 3: Implement the minimal real-linkage bridge**

```d
module iat_bridge;

import inochi2d.ver : IN_VERSION;

private immutable(char)[] upstreamVersion = IN_VERSION ~ "\0";

extern(C) nothrow @nogc uint iat_bridge_abi_version() {
    return 1;
}

extern(C) nothrow @nogc const(char)* iat_bridge_upstream_version() {
    return upstreamVersion.ptr;
}
```

The import from `inochi2d.ver` is mandatory: the bridge must fail to compile if the pinned upstream package is not actually wired.

- [ ] **Step 4: Implement build orchestration**

`scripts/native/build-bridge.mjs` runs, in order:

```text
node scripts/native/verify-toolchain.mjs
node scripts/upstream/verify.mjs
cd native/bridge && dub build --compiler=ldc2 --build=release
```

For probe mode, compile/link `test/bridge_probe.d` against the produced bridge and execute it with the platform library path set to the bridge output directory. The probe must assert stdout contains `v0.8.7`.

- [ ] **Step 5: Verify GREEN**

Run: `npm run upstream:materialize && npm run native:build && npm run native:probe`

Expected: dynamic bridge builds; probe exits 0 and prints `v0.8.7`.

- [ ] **Step 6: Commit**

```bash
git add native/bridge scripts/native/build-bridge.mjs package.json
git commit -m "feat: prove native bridge linkage to pinned Inochi2D"
```

---

### Task 5: Make reproducibility the CI acceptance gate

**Files:**
- Create: `.github/workflows/verify.yml`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Produces one required workflow intent named `Verify`.
- `npm run verify` remains the local TS gate; CI additionally materializes upstream and runs the native build/probe.

- [ ] **Step 1: Add the workflow with an intentionally missing native command and observe RED on the PR**

Workflow shape:

```yaml
name: Verify
on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run verify
      - name: Install LDC
        run: |
          sudo apt-get update
          sudo apt-get install -y ldc dub
      - run: npm run native:ci
```

Before defining `native:ci`, push the RED commit and confirm the exact-head workflow fails at the missing script, not at checkout/setup.

- [ ] **Step 2: Add the minimal GREEN `native:ci` script**

```json
"native:ci": "npm run upstream:materialize && npm run upstream:verify && npm run native:toolchain:verify && npm run native:build && npm run native:probe && npm run upstream:fingerprint -- --json"
```

- [ ] **Step 3: Document M0 reproducibility commands in README**

README must show exactly:

```bash
npm ci
npm run verify
npm run native:ci
```

and identify the pinned SHA `fdb241da048dbe330152f7b0015e2129dc392844` / `v0.8.7` as the current M0 upstream authority.

- [ ] **Step 4: Verify locally and on exact CI head**

Run locally: `npm run verify && npm run native:ci`

Expected: PASS where LDC/DUB are installed.

Then inspect the exact PR head GitHub Actions run. Expected: `Verify` SUCCESS with TS tests, exact upstream materialization, toolchain gate, real bridge build, real upstream-version probe, and fingerprint output all green.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/verify.yml package.json package-lock.json README.md
git commit -m "ci: verify reproducible native foundation"
```

---

## M0 Completion Gate

M0 is complete only when all of the following are true on one exact PR head:

- `npm ci` succeeds from the checked-in lockfile.
- `npm run verify` passes strict TypeScript and tests.
- `.deps/inochi2d` materializes at exactly `fdb241da048dbe330152f7b0015e2129dc392844`; moving `v0_8` HEAD cannot change the build.
- Manifest verification confirms upstream declares `v0.8.7`.
- Patch manifest is valid and currently empty unless a concrete bridge blocker required a separately reviewed patch.
- LDC/DUB toolchain validation is explicit and LDC is at least 1.40.0.
- The dynamic D bridge imports real pinned `inochi2d.ver`, builds, and its probe returns `v0.8.7` through the C ABI.
- Reproducibility fingerprint includes exact upstream SHA/version, ordered patch set, Node, LDC, and DUB versions.
- Exact-head GitHub `Verify` workflow is green.
- No raw native API has been exposed through the semantic TypeScript package.

Only after this gate may the worker start the M1 headless puppet round-trip plan.