# M0 Foundation & Upstream Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a reproducible TypeScript workspace and native D bridge pinned to one exact Inochi2D revision, with exact-head CI proving real linkage to that upstream build.

**Architecture:** npm workspaces host the public TypeScript packages while `native/bridge` is an isolated DUB package. A checked-in upstream manifest pins Inochi2D exactly; scripts materialize that source into a gitignored dependency directory, validate its commit, and produce a reproducibility fingerprint. The first native bridge exports only provenance probes, proving the D/C ABI boundary without prematurely implementing authoring APIs.

**Tech Stack:** Node.js 22+, npm workspaces, TypeScript 5.x, Vitest, DUB, LDC >= 1.40.0, Inochi2D `v0_8` pinned at `fdb241da048dbe330152f7b0015e2129dc392844` (`IN_VERSION = "v0.8.7"`), GitHub Actions.

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
  package.json
  tsconfig.json
  src/index.ts                  # semantic-core entry point
  test/smoke.test.ts

upstream/
  inochi2d.json                 # exact source pin + expected version

native/patches/
  manifest.json                 # ordered patch registry, initially empty
  README.md                     # patch policy

native/bridge/
  dub.json
  source/iat_bridge.d           # stable exported C ABI provenance probe
  test/bridge_probe.d           # links against the built shared bridge

scripts/
  upstream/materialize.mjs
  upstream/verify.mjs
  upstream/fingerprint.mjs
  native/verify-toolchain.mjs
  native/build-bridge.mjs

tests/reproducibility/
  upstream-manifest.test.ts
  fingerprint.test.ts
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
- Produces root scripts `typecheck`, `test`, and `verify`.
- Produces package `@inochi-agent-tools/core`.
- Produces `coreVersion(): string` as a smoke-level semantic entry point; it is not a native API.

- [ ] **Step 1: Write the failing workspace smoke test**

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

- [ ] **Step 2: Add configuration without the implementation and prove RED**

Root `package.json`:

```json
{
  "name": "inochi-agent-tools",
  "private": true,
  "type": "module",
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

`packages/core/package.json` must set `name` to `@inochi-agent-tools/core`, `version` to `0.1.0`, `private` to `true` for M0, and `type` to `module`.

Use strict NodeNext settings in `tsconfig.base.json`: `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `declaration: true`.

Run: `npm install && npm test`

Expected: FAIL because `../src/index.js` does not export `coreVersion`.

- [ ] **Step 3: Implement the minimal GREEN**

```ts
// packages/core/src/index.ts
export function coreVersion(): string {
  return '0.1.0';
}
```

- [ ] **Step 4: Verify**

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
- Manifest schema: `{"repository": string, "branch": string, "commit": string, "declaredVersion": string}`.
- `npm run upstream:materialize` leaves exact source at `.deps/inochi2d`.
- `npm run upstream:verify` exits non-zero on source/commit/version/patch-manifest mismatch.

- [ ] **Step 1: Write RED manifest tests**

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

- [ ] **Step 2: Add immutable upstream and empty patch manifests**

`upstream/inochi2d.json`:

```json
{
  "repository": "https://github.com/Inochi2D/inochi2d.git",
  "branch": "v0_8",
  "commit": "fdb241da048dbe330152f7b0015e2129dc392844",
  "declaredVersion": "v0.8.7"
}
```

`native/patches/manifest.json`:

```json
{ "patches": [] }
```

`native/patches/README.md` states that patch order is manifest order and every future entry contains `file`, `reason`, and `removalCondition`.

- [ ] **Step 3: Implement exact-SHA materialization**

`scripts/upstream/materialize.mjs` uses `spawnSync` and performs exactly:

```text
if .deps/inochi2d/.git is absent:
  git clone --filter=blob:none https://github.com/Inochi2D/inochi2d.git .deps/inochi2d

git -C .deps/inochi2d fetch origin fdb241da048dbe330152f7b0015e2129dc392844 --depth=1
git -C .deps/inochi2d checkout --detach fdb241da048dbe330152f7b0015e2129dc392844
node scripts/upstream/verify.mjs
```

Every failed command propagates a non-zero exit. Never fall back to branch HEAD.

- [ ] **Step 4: Implement fail-closed verification**

Verify:

```text
git -C .deps/inochi2d rev-parse HEAD
== fdb241da048dbe330152f7b0015e2129dc392844
```

and `source/inochi2d/ver.d` contains exactly:

```d
enum IN_VERSION = "v0.8.7";
```

Also validate that every future patch manifest entry points to an existing file under `native/patches/` and contains non-empty `reason` and `removalCondition` fields.

- [ ] **Step 5: Wire and verify**

Add:

```json
"upstream:materialize": "node scripts/upstream/materialize.mjs",
"upstream:verify": "node scripts/upstream/verify.mjs"
```

Run: `npm run upstream:materialize && npm run upstream:verify && npm test -- tests/reproducibility/upstream-manifest.test.ts`

Expected: PASS with `.deps/inochi2d` detached at the exact pin.

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
- `buildFingerprint({ probeTools: boolean })` returns stable-key-order fields `upstreamCommit`, `upstreamVersion`, `patches`, `node`, `ldc`, `dub`.
- `npm run upstream:fingerprint -- --json` prints that object as JSON.
- `npm run native:toolchain:verify` requires `ldc2 >= 1.40.0` and a callable `dub`.

- [ ] **Step 1: Write RED fingerprint test**

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

`fingerprint.mjs` exports `buildFingerprint`. With `probeTools: true`, call `node --version`, `ldc2 --version`, and `dub --version`, normalize each to one trimmed string, and preserve stable key order in JSON output.

- [ ] **Step 3: Implement toolchain validation**

`verify-toolchain.mjs` extracts the semantic version from `ldc2 --version`, rejects anything below `1.40.0`, and treats missing `ldc2` or `dub` as hard failures with actionable stderr.

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- tests/reproducibility/fingerprint.test.ts
npm run native:toolchain:verify
npm run upstream:fingerprint -- --json
```

Expected: fingerprint test PASS. Toolchain verification PASS where LDC/DUB are installed; otherwise fail explicitly naming the missing/outdated tool. Task 5 CI is the authoritative clean-environment proof.

- [ ] **Step 5: Commit**

```bash
git add scripts/upstream/fingerprint.mjs scripts/native/verify-toolchain.mjs tests/reproducibility/fingerprint.test.ts package.json
git commit -m "build: record native build provenance"
```

---

### Task 4: Build the first real exported D/C ABI bridge

**Files:**
- Create: `native/bridge/dub.json`
- Create: `native/bridge/source/iat_bridge.d`
- Create: `native/bridge/test/bridge_probe.d`
- Create: `scripts/native/build-bridge.mjs`
- Modify: `package.json`

**Interfaces:**
- Exported C ABI `uint iat_bridge_abi_version()` returns `1`.
- Exported C ABI `const(char)* iat_bridge_upstream_version()` returns a stable null-terminated `IN_VERSION` string.
- `npm run native:build` builds `.build/native/libiat_bridge` for the host platform.
- `npm run native:probe` links a separate probe executable against the produced shared library and requires upstream version `v0.8.7`.

- [ ] **Step 1: Add the RED external probe**

```d
// native/bridge/test/bridge_probe.d
import std.string : fromStringz;

extern(C) uint iat_bridge_abi_version();
extern(C) const(char)* iat_bridge_upstream_version();

int main() {
    assert(iat_bridge_abi_version() == 1);
    auto ptr = iat_bridge_upstream_version();
    assert(ptr !is null);
    assert(fromStringz(ptr) == "v0.8.7");
    return 0;
}
```

Run: `npm run native:probe`

Expected: FAIL because the bridge/orchestrator is absent.

- [ ] **Step 2: Create the DUB bridge package**

`native/bridge/dub.json`:

```json
{
  "name": "inochi-agent-tools-bridge",
  "targetType": "dynamicLibrary",
  "targetName": "iat_bridge",
  "targetPath": "../../.build/native",
  "sourcePaths": ["source"],
  "dependencies": {
    "inochi2d": { "path": "../../.deps/inochi2d" }
  },
  "toolchainRequirements": { "ldc": ">=1.40.0" }
}
```

- [ ] **Step 3: Implement exported real-linkage probes**

```d
module iat_bridge;

import inochi2d.ver : IN_VERSION;

private immutable(char)[] upstreamVersion = IN_VERSION ~ "\0";

export extern(C) nothrow @nogc uint iat_bridge_abi_version() {
    return 1;
}

export extern(C) nothrow @nogc const(char)* iat_bridge_upstream_version() {
    return upstreamVersion.ptr;
}
```

The `inochi2d.ver` import is mandatory; compilation must fail if the pinned upstream package is not actually wired.

- [ ] **Step 4: Implement build/probe orchestration**

`build-bridge.mjs` runs:

```text
node scripts/native/verify-toolchain.mjs
node scripts/upstream/verify.mjs
cd native/bridge && dub build --compiler=ldc2 --build=release
```

For Linux probe mode, compile the separate probe with:

```bash
mkdir -p .build/native
ldc2 native/bridge/test/bridge_probe.d \
  -L-L.build/native -L-liat_bridge \
  -of=.build/native/bridge_probe
LD_LIBRARY_PATH=.build/native ./.build/native/bridge_probe
```

For macOS use `DYLD_LIBRARY_PATH=.build/native`; for Windows locate `iat_bridge.dll` and pass its directory on `PATH` before running the probe. The Node orchestrator branches only on `process.platform`; it must not silently skip the probe on a supported platform.

- [ ] **Step 5: Wire and verify GREEN**

Add:

```json
"native:build": "node scripts/native/build-bridge.mjs --build",
"native:probe": "node scripts/native/build-bridge.mjs --probe"
```

Run:

```bash
npm run upstream:materialize
npm run native:build
npm run native:probe
```

Expected: shared bridge builds and the external probe exits 0 after reading `v0.8.7` through the exported C ABI.

- [ ] **Step 6: Commit**

```bash
git add native/bridge scripts/native/build-bridge.mjs package.json
git commit -m "feat: prove native bridge linkage to pinned Inochi2D"
```

---

### Task 5: Make reproducibility the exact-head CI gate

**Files:**
- Create: `.github/workflows/verify.yml`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Workflow name `Verify`.
- `npm run native:ci` performs exact upstream materialization, verification, toolchain check, shared bridge build, external C ABI probe, and fingerprint output.

- [ ] **Step 1: Add an intentional RED workflow before `native:ci` exists**

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
      - uses: dlang-community/setup-dlang@v2
        with:
          compiler: ldc-latest
      - run: npm ci
      - run: npm run verify
      - run: npm run native:ci
```

Push the RED commit. Expected exact-head failure: `npm ERR! Missing script: "native:ci"`; checkout, Node setup, D setup, install, and TypeScript verification must have completed first.

- [ ] **Step 2: Add the minimal GREEN native CI script**

```json
"native:ci": "npm run upstream:materialize && npm run upstream:verify && npm run native:toolchain:verify && npm run native:build && npm run native:probe && npm run upstream:fingerprint -- --json"
```

- [ ] **Step 3: Document the M0 reproducibility path**

README must show:

```bash
npm ci
npm run verify
npm run native:ci
```

and identify `fdb241da048dbe330152f7b0015e2129dc392844` / `v0.8.7` as the current M0 upstream authority.

- [ ] **Step 4: Verify locally and on the exact PR head**

Run locally where LDC/DUB are available:

```bash
npm run verify
npm run native:ci
```

Then inspect GitHub Actions for the exact PR head. Expected: `Verify` SUCCESS with TypeScript tests, exact source checkout, toolchain validation, real shared bridge build, external C ABI version probe, and provenance fingerprint all green.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/verify.yml package.json package-lock.json README.md
git commit -m "ci: verify reproducible native foundation"
```

---

## M0 Completion Gate

M0 is complete only when all are true on one exact PR head:

- `npm ci` succeeds from the checked-in lockfile.
- `npm run verify` passes strict TypeScript and tests.
- `.deps/inochi2d` is exactly `fdb241da048dbe330152f7b0015e2129dc392844`; movement of `v0_8` cannot change the build.
- Upstream verification confirms `IN_VERSION = "v0.8.7"`.
- Patch manifest is valid and empty unless a concrete bridge blocker required a separately reviewed patch.
- LDC/DUB validation is explicit and LDC is at least 1.40.0.
- The shared D bridge imports real pinned `inochi2d.ver`, exports the two C ABI probes, and a separately linked executable reads `v0.8.7` through that ABI.
- Provenance fingerprint contains exact upstream SHA/version, ordered patch set, Node, LDC, and DUB versions.
- Exact-head GitHub `Verify` is green.
- No raw native API has been exposed through the semantic TypeScript package.

Only after this gate may the worker start the M1 headless puppet round-trip implementation plan.