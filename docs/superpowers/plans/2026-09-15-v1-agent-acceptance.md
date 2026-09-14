# v1 Agent Authoring Acceptance Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove Inochi Agent Tools v1 end-to-end with real artifacts by authoring equivalent puppets through the public CLI and stdio MCP surfaces, opening those artifacts in the pinned official Inochi Creator, reopening them headlessly, verifying semantic/evaluation equivalence, and recording exact reproducibility provenance.

**Architecture:** #11 is an acceptance-composition milestone, not a new authoring subsystem. Reuse the existing semantic core, CLI, SDK, MCP server, native bridge, Creator launcher, and upstream fingerprint machinery; add only deterministic v1 acceptance orchestration and verification. If the new RED acceptance exposes a genuine missing semantic capability, stop and document that gap before changing production behavior; otherwise do not add new public API surface.

**Tech Stack:** Node 22 ESM, TypeScript 5.9, Vitest 3.2, `@modelcontextprotocol/client` 2.0, stdio MCP, LDC 1.40.0, pinned Inochi2D `fdb241da048dbe330152f7b0015e2129dc392844` (`v0.8.7`), official Inochi Creator v0.8.6 Linux acceptance binary, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-13-inochi-agent-tools-v1-design.md`

## Global Constraints

- Public/general-purpose only: no Away-specific names, metadata assumptions, gameplay concepts, character-specific APIs, or application-specific shortcuts.
- Inochi2D upstream authority remains exact commit `fdb241da048dbe330152f7b0015e2129dc392844` on `v0_8`, declaring `IN_VERSION = "v0.8.7"`.
- LDC must remain >= `1.40.0`; CI authority is LDC `1.40.0` unless separately changed by an approved milestone.
- CLI, MCP, and SDK remain adapters over one semantic authoring core; no duplicate serialization/native authoring implementation in adapters.
- Normal public APIs never expose raw `in_*`, allocators, pointers, memory offsets, texture slots, GUID pointers, or implementation-specific native handles.
- Runtime/evaluation remains separable from authoring and must not become a raw native API surface.
- Real `.inp` and real PNG artifacts are mandatory for v1 acceptance. Synthetic/fake fixtures remain narrow unit-test-only evidence.
- Existing isolated upstream patches remain authoritative; add no patch unless a concrete acceptance capability is blocked, with reason/removal condition/test evidence.
- Creator fork/UI, HTTP/auth MCP, advanced physics, automatic rigging, and application-specific integration remain out of scope.
- Strict RED → GREEN applies to any behavior change. A new acceptance test that already passes does not justify manufacturing a false RED or changing production code.

---

### Task 1: Deterministic Public-Adapter Acceptance Artifacts

**Files:**
- Create: `scripts/v1/build-agent-artifacts.mjs`
- Create: `scripts/v1/verify-agent-artifacts.mjs`
- Create: `tests/integration/v1-agent-artifacts.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: built `inochi-agent` CLI; built `inochi-agent-mcp` stdio server; `createAuthoringClient()` only for independent read-only semantic comparison where needed; existing real PNG `tests/fixtures/generated/m2-checker.png`; semantic edit operations already used by CLI/MCP acceptance.
- Produces: deterministic `tests/fixtures/generated/v1-cli-authored.inp` and `tests/fixtures/generated/v1-mcp-authored.inp`; `npm run v1:artifacts`; `npm run v1:verify-artifacts`.

- [ ] **Step 1: Write the RED integration test for two real public-adapter artifacts**

Create `tests/integration/v1-agent-artifacts.test.ts` with the acceptance contract below. The test is gated by `IAT_V1_ACCEPTANCE_TESTS=1` so normal narrow unit collection does not claim native/Creator compatibility:

```ts
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAuthoringClient } from '@inochi-agent-tools/sdk';

const describeV1 = process.env.IAT_V1_ACCEPTANCE_TESTS === '1' ? describe : describe.skip;
const generated = path.resolve('tests/fixtures/generated');
const cliPath = path.join(generated, 'v1-cli-authored.inp');
const mcpPath = path.join(generated, 'v1-mcp-authored.inp');

describeV1('v1 public-adapter artifacts', () => {
  it('reopens equivalent real CLI and MCP authored puppets semantically', async () => {
    expect((await stat(cliPath)).size).toBeGreaterThan(0);
    expect((await stat(mcpPath)).size).toBeGreaterThan(0);

    const client = createAuthoringClient();
    const [cli, mcp] = await Promise.all([
      client.inspectPuppet({ inputPath: cliPath }),
      client.inspectPuppet({ inputPath: mcpPath }),
    ]);

    for (const inspection of [cli, mcp]) {
      expect(inspection.summary).toMatchObject({ partCount: 1, parameterCount: 2, textureCount: 1 });
      expect(inspection.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: '/Root/Art/Face', kind: 'part' }),
        expect.objectContaining({ path: '/Root/Rig' }),
      ]));
      expect(inspection.parameters).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Move X' }),
        expect.objectContaining({ name: 'Move Y' }),
      ]));
    }

    expect(mcp.summary).toEqual(cli.summary);
    expect(mcp.parameters).toEqual(cli.parameters);
  });
});
```

- [ ] **Step 2: Run the focused test and prove the intended RED**

Run:

```bash
IAT_V1_ACCEPTANCE_TESTS=1 npx vitest run tests/integration/v1-agent-artifacts.test.ts
```

Expected: FAIL because `v1-cli-authored.inp` and `v1-mcp-authored.inp` have not been built yet. A fixture/toolchain failure before those missing artifacts is not a valid RED; debug the environment before continuing.

- [ ] **Step 3: Implement one shared semantic operation recipe inside the acceptance builder**

Create `scripts/v1/build-agent-artifacts.mjs`. The recipe must be data only and reused for both transports:

```js
const operations = [
  { type: 'texture.import', key: 'face', imagePath },
  { type: 'node.create', parentPath: '/Root', name: 'Art' },
  { type: 'part.create', parentPath: '/Root/Art', name: 'Face', textureKey: 'face' },
  { type: 'node.create', parentPath: '/Root', name: 'Rig' },
  { type: 'parameter.create', name: 'Move X', dimensions: 1, min: [-1, 0], max: [1, 0], defaultValue: [0, 0] },
  { type: 'parameter.create', name: 'Move Y', dimensions: 1, min: [-1, 0], max: [1, 0], defaultValue: [0, 0] },
  {
    type: 'parameter.bind',
    parameterName: 'Move X',
    targetPath: '/Root/Rig',
    property: 'transform.t.x',
    keypoints: [{ at: [-1, 0], value: -20 }, { at: [1, 0], value: 20 }],
  },
  {
    type: 'parameter.bind',
    parameterName: 'Move Y',
    targetPath: '/Root/Rig',
    property: 'transform.t.y',
    keypoints: [{ at: [-1, 0], value: -12 }, { at: [1, 0], value: 12 }],
  },
];
```

The builder must:

1. remove only the generated v1 acceptance outputs it owns;
2. invoke the built CLI executable to create a minimal source `.inp`, then `puppet edit` using the recipe, then `parameter evaluate`, `puppet validate`, and `puppet save` to `v1-cli-authored.inp`;
3. spawn `packages/mcp/dist/main.js` through `StdioClientTransport`, invoke `puppet.create`, `puppet.edit`, `parameter.evaluate`, `puppet.validate`, and `puppet.save` with the same recipe, producing `v1-mcp-authored.inp`;
4. assert both evaluate responses apply `Move X = +20` and `Move Y = -12` and restore both to `0`;
5. exit non-zero on any adapter/semantic failure without falling back to direct core authoring.

The acceptance builder may use temporary source/intermediate `.inp` files under `tests/fixtures/generated`, but the two named final artifacts above are the outputs consumed by later tasks.

- [ ] **Step 4: Add the independent semantic verifier**

Create `scripts/v1/verify-agent-artifacts.mjs`. It must use `@inochi-agent-tools/sdk` only for reopening/validation/evaluation after the CLI/MCP processes have exited:

```js
const client = createAuthoringClient();
for (const inputPath of [cliPath, mcpPath]) {
  const inspection = await client.inspectPuppet({ inputPath });
  await client.validatePuppet({ inputPath });
  const evaluation = await client.evaluateParameters({
    inputPath,
    values: { 'Move X': [1, 0], 'Move Y': [-1, 0] },
  });
  // Assert Part/texture/2 bindings plus +20/-12 application and 0 restoration.
}
```

The script must compare the semantic summaries and parameter binding structures of the CLI and MCP artifacts and fail on drift.

- [ ] **Step 5: Add focused package scripts**

Modify `package.json`:

```json
{
  "scripts": {
    "v1:artifacts": "node scripts/v1/build-agent-artifacts.mjs",
    "v1:verify-artifacts": "node scripts/v1/verify-agent-artifacts.mjs",
    "v1:artifacts:test": "vitest run tests/integration/v1-agent-artifacts.test.ts"
  }
}
```

Do not remove or weaken any existing `m3:*`, Creator, native, or upstream gate.

- [ ] **Step 6: Run focused GREEN under the native environment**

Run after the existing native toolchain/bridge has been materialized by `m3:mcp:ci` or equivalent setup:

```bash
npm run v1:artifacts
npm run v1:verify-artifacts
IAT_V1_ACCEPTANCE_TESTS=1 npm run v1:artifacts:test
```

Expected: all commands exit 0; both real final `.inp` artifacts are non-empty; CLI/MCP semantic structures agree; evaluation applies `+20/-12` and restores to zero.

- [ ] **Step 7: Commit the public-adapter artifact proof**

```bash
git add scripts/v1/build-agent-artifacts.mjs scripts/v1/verify-agent-artifacts.mjs tests/integration/v1-agent-artifacts.test.ts package.json
git commit -m "test: build v1 CLI and MCP acceptance artifacts"
```

---

### Task 2: Official Creator + Provenance Final Gate

**Files:**
- Create: `scripts/v1/v1-acceptance-ci.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/verify.yml`
- Test: existing `scripts/creator/launch-roundtrip.mjs`, `scripts/upstream/fingerprint.mjs`, and Task 1 artifact verification are consumed unchanged unless a concrete bug is found.

**Interfaces:**
- Consumes: `npm run m3:mcp:ci`; `npm run v1:artifacts`; `npm run creator:materialize`; `scripts/creator/launch-roundtrip.mjs --open-only <absolute .inp>`; `npm run v1:verify-artifacts`; `npm run upstream:fingerprint -- --json`.
- Produces: authoritative `npm run v1:ci` exact-head gate.

- [ ] **Step 1: Write the final gate script with fail-closed ordering**

Create `scripts/v1/v1-acceptance-ci.mjs`:

```js
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const generated = path.join(root, 'tests', 'fixtures', 'generated');
const launcher = path.join(root, 'scripts', 'creator', 'launch-roundtrip.mjs');

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function npm(script, args = []) {
  run(npmCommand, ['run', script, ...(args.length ? ['--', ...args] : [])]);
}

npm('m3:mcp:ci');
npm('v1:artifacts');
npm('creator:materialize');

for (const fileName of ['v1-cli-authored.inp', 'v1-mcp-authored.inp']) {
  run(process.execPath, [launcher, '--open-only', path.join(generated, fileName)]);
}

npm('v1:verify-artifacts');
run(npmCommand, ['run', 'upstream:fingerprint', '--', '--json']);
```

Do not duplicate Creator download/open automation or upstream fingerprint logic in this script; compose the existing authorities.

- [ ] **Step 2: Expose the authoritative root command**

Modify `package.json`:

```json
{
  "scripts": {
    "v1:ci": "node scripts/v1/v1-acceptance-ci.mjs"
  }
}
```

- [ ] **Step 3: Make CI run the v1 authority, not a weaker predecessor**

Modify `.github/workflows/verify.yml` native job so the final command is:

```yaml
- run: npm run v1:ci
```

`v1:ci` itself must preserve `m3:mcp:ci`; do not run only the new acceptance fragment.

- [ ] **Step 4: Run the complete gate locally/CI and inspect every stage**

Run:

```bash
npm ci
npm run verify
npm run v1:ci
```

Expected: `verify` exits 0; `v1:ci` exits 0 after preserving all M0–M3/Creator checks, generating both real public-adapter `.inp` files, opening each in official Creator v0.8.6, reopening/verifying them headlessly, and printing exact upstream/patch provenance JSON.

If either adapter artifact fails Creator open while the pre-existing core-built Creator fixture passes, that is a real acceptance RED. Use systematic debugging to isolate adapter/request/artifact drift; do not patch Creator or bypass the artifact.

- [ ] **Step 5: Commit the authoritative v1 gate**

```bash
git add scripts/v1/v1-acceptance-ci.mjs package.json .github/workflows/verify.yml
git commit -m "test: add authoritative v1 acceptance gate"
```

---

### Task 3: Public v1 Reproducibility/Policy Documentation and Completion Audit

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-15-v1-agent-acceptance.md` only if implementation evidence forces a factual correction to this plan; do not rewrite completed history cosmetically.
- No new public runtime/authoring code unless Task 1/2 produced a documented behavioral RED.

**Interfaces:**
- Consumes: final `v1:ci` command and existing upstream manifest/patch documentation.
- Produces: public install/CLI/MCP/architecture/patch-policy/reproducibility documentation satisfying Issue #11.

- [ ] **Step 1: Extend README verification/install guidance to v1**

Document `npm run v1:ci` as the strongest acceptance command and state explicitly that it:

```text
CLI real authoring artifact
+ MCP real authoring artifact
+ official Creator open for both
+ headless reopen/semantic/evaluation verification
+ exact pinned upstream/patch fingerprint
```

Keep the existing CLI and MCP installation/configuration sections; do not add application-specific setup.

- [ ] **Step 2: Document patch policy and reproducibility contract explicitly**

Add a concise public section containing these binding points:

```text
Upstream: fdb241da048dbe330152f7b0015e2129dc392844 (v0_8 / v0.8.7)
Compiler floor: LDC >= 1.40.0; CI authority LDC 1.40.0
Patch layer: native/patches only; each patch requires concrete capability reason, removal condition, and integration evidence
Fingerprint: npm run upstream:fingerprint -- --json
No moving-upstream acceptance builds
```

Explain that official Creator v0.8.6 is compatibility acceptance infrastructure, not the serialization authority and not a public runtime dependency.

- [ ] **Step 3: Run a forbidden-surface audit on the final PR diff**

Inspect all changed files and search additions for:

```text
Away
away-message
in_
malloc
free(
pointer
offset
GUID
```

Expected: no Away/application-specific content; raw-native terms appear only in documentation/tests describing the prohibition or inside already-private native boundaries, never as new normal public API requirements.

- [ ] **Step 4: Run fresh exact-head verification before any completion claim**

Required exact-head evidence:

```bash
npm ci
npm run verify
npm run v1:ci
```

Then verify on GitHub for the exact PR head:

```text
PR mergeable = true
all required Verify jobs = green
reviews audited
unresolved review threads = 0
changed-file scope limited to #11 acceptance/docs unless a documented RED required more
```

Do not use earlier #8/#9/#10 CI as final #11 evidence.

- [ ] **Step 5: Record exact provenance and acceptance evidence on Issue #11 / PR**

The evidence comment must name:

```text
exact PR head SHA
exact main/base SHA
Verify run number/result
v1:ci result
Inochi2D pinned SHA + v0.8.7
LDC 1.40.0
official Creator v0.8.6 acceptance result
CLI artifact path/result
MCP artifact path/result
semantic evaluate/readback/restore result
review/thread audit result
```

- [ ] **Step 6: Merge only after every Issue #11 criterion is satisfied**

Use the exact verified head SHA when merging. After merge:

1. confirm `main` points to the merge result;
2. close #11 as completed with final evidence;
3. update umbrella #1 so #2–#11 are all complete;
4. close #1 as completed;
5. stop v1 implementation work. Creator fork/UI and other post-v1 features require separate scope/issues and must not be started from this worker merely because v1 is complete.

- [ ] **Step 7: Final repository-state verification**

Fetch live GitHub state again and prove:

```text
#11 = closed/completed
#1 = closed/completed
no open v1 implementation PR remains
main = expected merged head
```

Report v1 completion only after those live-state checks succeed.
