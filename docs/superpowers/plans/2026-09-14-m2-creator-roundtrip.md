# M2 Official Creator Round-Trip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that a real puppet authored by `inochi-agent-tools` opens successfully in the official Inochi Creator, can be saved by Creator, and preserves the expected semantic hierarchy, texture/Part relationships, parameters, and bindings when reopened headlessly.

**Architecture:** Keep Creator entirely outside the semantic/native implementation boundary. A dedicated compatibility harness generates one real acceptance puppet through the existing public core, launches the pinned official Creator release under Xvfb with an isolated `INOCHI_CONFIG_PATH`, proves successful open using Creator's own persisted `prev_projects` side effect, triggers Creator's normal Save command, then reopens the Creator-produced `.inx` through `inspectPuppet` for semantic comparison. No production authoring API changes are allowed unless the real Creator gate demonstrates a concrete format incompatibility.

**Tech Stack:** Node.js 22+, TypeScript/Vitest, existing D/LDC native bridge, GitHub Actions Ubuntu runner, Xvfb, xdotool, official Inochi Creator v0.8.6 Linux release asset.

**Spec:** `docs/superpowers/specs/2026-09-13-inochi-agent-tools-v1-design.md`

## Global Constraints

- Work only in `MohamedXIV/inochi-agent-tools`; never touch Away Message.
- Public APIs remain semantic and general-purpose; no Creator automation details leak into `@inochi-agent-tools/core`.
- Use the existing pinned Inochi2D commit `fdb241da048dbe330152f7b0015e2129dc392844` (`v0.8.7`) for authored artifacts.
- The compatibility target is the official stable Inochi Creator `v0.8.6` release, Linux asset ID `193284190`, file `inochi-creator-linux.zip`, expected size `22341517` bytes.
- Creator runs with a temporary isolated `INOCHI_CONFIG_PATH`; never read or write a developer's normal Creator configuration.
- Acceptance artifacts are real `.inp` / Creator-produced `.inx` files; fake JSON or hand-crafted binary cannot satisfy this milestone.
- Creator-open success must not be inferred merely because the GUI process stays alive. Creator's `incOpenProject` records `prev_projects` only after successful `inLoadPuppet`; the harness must assert that side effect.
- Strict RED -> GREEN applies to the compatibility harness and semantic comparison.
- No upstream patch is added unless the official Creator gate reproduces a concrete incompatibility that cannot be fixed in our own authoring layer.

---

## File Structure

```text
upstream/inochi-creator.json                    # pinned official Creator release/asset identity
scripts/creator/materialize.mjs                 # download/cache/verify official Creator archive
scripts/creator/build-fixture.mjs               # orchestrate full visual + parameter acceptance fixture
scripts/creator/launch-roundtrip.mjs            # isolated Xvfb launch, open proof, Ctrl+S save proof
scripts/creator/verify-roundtrip.mjs             # semantic before/after comparison
scripts/creator/m2-creator-ci.mjs                # authoritative #8 gate
packages/core/test/creator-fixture.test.ts       # public-core construction of full acceptance puppet
packages/core/test/creator-roundtrip.test.ts     # headless semantic comparison of Creator output
.github/workflows/verify.yml                     # Creator compatibility CI job/step
package.json                                     # creator:* scripts
.gitignore                                       # generated Creator cache/config/artifacts
```

Generated Creator binaries/config and acceptance artifacts live under `.build/creator/` and `tests/fixtures/generated/` and are never source authority.

---

### Task 1: Pin the official Creator release and build the full acceptance puppet

**Files:**
- Create: `upstream/inochi-creator.json`
- Create: `scripts/creator/materialize.mjs`
- Create: `scripts/creator/build-fixture.mjs`
- Create: `packages/core/test/creator-fixture.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces `npm run creator:materialize`.
- Produces `npm run creator:fixture`.
- Produces real `tests/fixtures/generated/creator-roundtrip-input.inp`.
- Fixture contract: puppet name `Creator Roundtrip Fixture`; one imported real PNG texture; `/Root/Art/Face` Part using that texture; `/Root/Rig`; parameters `Move X` and `Move Y`; bindings to `/Root/Rig` `transform.t.x` and `transform.t.y` with `[-1,+1] -> [-20,+20]` and `[-12,+12]` authored values.

- [ ] **Step 1: Add a failing Creator manifest/materialization test path**

Add root scripts first, before their target files exist:

```json
"creator:materialize": "node scripts/creator/materialize.mjs",
"creator:fixture": "node scripts/creator/build-fixture.mjs"
```

Run: `npm run creator:materialize`

Expected: FAIL because `scripts/creator/materialize.mjs` does not exist.

- [ ] **Step 2: Add the immutable release identity**

Create `upstream/inochi-creator.json`:

```json
{
  "repository": "https://github.com/Inochi2D/inochi-creator",
  "release": "v0.8.6",
  "linuxAssetId": 193284190,
  "linuxAssetName": "inochi-creator-linux.zip",
  "linuxAssetSize": 22341517,
  "downloadUrl": "https://github.com/Inochi2D/inochi-creator/releases/download/v0.8.6/inochi-creator-linux.zip"
}
```

- [ ] **Step 3: Implement `materialize.mjs` fail-closed**

The script must download only the manifest URL to `.build/creator/inochi-creator-linux.zip`, reject a byte size other than `22341517`, unzip into `.build/creator/v0.8.6/`, locate the single executable named `inochi-creator`, chmod it executable, and print its absolute path. Reuse a cached archive only after rechecking size. Any HTTP, extraction, size, or executable-discovery failure is fatal.

Run: `npm run creator:materialize`

Expected: official archive materialized and executable path printed.

- [ ] **Step 4: Write the real public-core fixture test**

`creator-fixture.test.ts` must call only public semantic operations. Its core operation sequence is:

```ts
await createPuppet({ outputPath: base, name: 'Creator Roundtrip Fixture' });
await editPuppet({
  inputPath: base,
  outputPath: output,
  operations: [
    { type: 'texture.import', key: 'face', imagePath: 'tests/fixtures/generated/m2-checker.png' },
    { type: 'node.create', parentPath: '/Root', name: 'Art' },
    { type: 'part.create', parentPath: '/Root/Art', name: 'Face', textureKey: 'face' },
    { type: 'node.create', parentPath: '/Root', name: 'Rig' },
    { type: 'parameter.create', name: 'Move X', dimensions: 1, min: [-1, 0], max: [1, 0], defaultValue: [0, 0] },
    { type: 'parameter.create', name: 'Move Y', dimensions: 1, min: [-1, 0], max: [1, 0], defaultValue: [0, 0] },
    { type: 'parameter.bind', parameterName: 'Move X', targetPath: '/Root/Rig', property: 'transform.t.x', keypoints: [{ at: [-1, 0], value: -20 }, { at: [1, 0], value: 20 }] },
    { type: 'parameter.bind', parameterName: 'Move Y', targetPath: '/Root/Rig', property: 'transform.t.y', keypoints: [{ at: [-1, 0], value: -12 }, { at: [1, 0], value: 12 }] }
  ]
});
```

Assert the reopened inspection contains exactly one texture, the Face Part texture relationship, two parameters, and both bindings.

- [ ] **Step 5: Implement `build-fixture.mjs`**

Run existing `m2:png`, build the native host/bridge through `m2:parameter:ci` prerequisites, then run only the Creator fixture test with environment variables enabling native M1/M2 tests. Leave `creator-roundtrip-input.inp` in `tests/fixtures/generated/` for Task 2.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm run creator:materialize
npm run creator:fixture
```

Expected: both PASS and a real non-empty `.inp` exists.

Commit: `test: build official Creator compatibility fixture`

---

### Task 2: Prove official Creator open and save through isolated GUI automation

**Files:**
- Create: `scripts/creator/launch-roundtrip.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces `npm run creator:roundtrip`.
- Consumes `tests/fixtures/generated/creator-roundtrip-input.inp`.
- Produces `tests/fixtures/generated/creator-roundtrip-output.inx` using Creator's normal Save command.
- Produces `.build/creator/config/settings.json` evidence.

- [ ] **Step 1: Establish RED without launcher**

Add:

```json
"creator:roundtrip": "node scripts/creator/launch-roundtrip.mjs"
```

Run after `creator:fixture`.

Expected: FAIL because launcher does not exist.

- [ ] **Step 2: Seed isolated Creator configuration**

`launch-roundtrip.mjs` removes/recreates `.build/creator/config` and writes:

```json
{"hasDoneQuickSetup":true}
```

Set `INOCHI_CONFIG_PATH` to that directory. Copy the input artifact to an isolated working path before launch so Creator lock/save files never touch source-controlled inputs.

- [ ] **Step 3: Launch the official binary under Xvfb**

Require `xvfb-run` and `xdotool`; missing tools are a hard actionable failure. Spawn:

```text
xvfb-run -a <official-creator-executable> <absolute-input.inp>
```

Poll `.build/creator/config/settings.json` for at most 20 seconds. GREEN open proof requires `prev_projects[0]` to equal the exact absolute input path. This is authoritative because Creator calls `incAddPrevProject(mainPath)` only after `inLoadPuppet` succeeds.

If Creator exits before that side effect, fail with captured stdout/stderr and exit code.

- [ ] **Step 4: Trigger Creator's normal Save operation**

After open proof, target the Creator window with `xdotool search --name 'Inochi'` and send `ctrl+s`. Poll for `<input basename>.inx` for at most 20 seconds and require a non-empty file. Do not synthesize `.inx` bytes or call our own serializer for this output.

Then terminate Creator gracefully; force-kill only after a bounded grace period.

- [ ] **Step 5: Verify RED/GREEN behavior**

First run with an intentionally malformed `.inp` copy and require that `prev_projects` is not updated and the harness exits non-zero. Then run with the real fixture and require open proof + Creator-produced `.inx`.

Commit: `test: automate official Creator open and save gate`

---

### Task 3: Reopen Creator output and enforce semantic round-trip compatibility

**Files:**
- Create: `packages/core/test/creator-roundtrip.test.ts`
- Create: `scripts/creator/verify-roundtrip.mjs`
- Create: `scripts/creator/m2-creator-ci.mjs`
- Modify: `.github/workflows/verify.yml`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Produces `npm run creator:verify`.
- Produces authoritative `npm run m2:creator:ci`.

- [ ] **Step 1: Write failing semantic comparison test before verifier orchestration**

The test calls `inspectPuppet` on both the original tool-authored `.inp` and Creator-produced `.inx` and compares semantic invariants rather than unstable GUIDs/order:

```ts
expect(after.metadata.name).toBe(before.metadata.name);
expect(after.summary.partCount).toBe(before.summary.partCount);
expect(after.summary.parameterCount).toBe(2);
expect(after.textures.map(t => t.ref)).toEqual(before.textures.map(t => t.ref));
expect(after.nodes.find(n => n.path === '/Root/Art/Face')?.kind).toBe('part');
expect(after.nodes.find(n => n.path === '/Root/Art/Face')?.textures)
  .toEqual(before.nodes.find(n => n.path === '/Root/Art/Face')?.textures);
expect(after.parameters.find(p => p.name === 'Move X')?.bindings)
  .toEqual(before.parameters.find(p => p.name === 'Move X')?.bindings);
expect(after.parameters.find(p => p.name === 'Move Y')?.bindings)
  .toEqual(before.parameters.find(p => p.name === 'Move Y')?.bindings);
```

Also run `evaluateParameterValues` on Creator output and require `Move X=+1 -> +20`, `Move Y=-1 -> -12`, followed by restore to zero.

- [ ] **Step 2: Implement `verify-roundtrip.mjs`**

Run typecheck plus the focused Creator round-trip test with the same native runtime environment used by `m2:parameter:ci`.

- [ ] **Step 3: Create authoritative #8 gate**

`m2-creator-ci.mjs` runs, in order:

```text
m2:parameter:ci
creator:materialize
creator:fixture
creator:roundtrip
creator:verify
```

No earlier green gate may substitute for Creator evidence.

- [ ] **Step 4: Add CI dependencies and exact-head gate**

In `.github/workflows/verify.yml`, install `xvfb` and `xdotool` on the native Ubuntu job, then execute `npm run m2:creator:ci`. Keep the existing LDC/upstream pins unchanged.

- [ ] **Step 5: Document the compatibility target**

README must state that v1 compatibility is verified against official Creator v0.8.6 Linux release asset ID `193284190`, while authored files are generated by pinned Inochi2D v0.8.7. Document that Creator automation is acceptance infrastructure only and is not part of the public API.

- [ ] **Step 6: Final verification and completion gate**

Require exact PR head:

```text
m2:creator:ci GREEN
0 unresolved review threads
PR mergeable
```

Only then mark ready, merge, close #8, update #1, and unblock #9.

Commit: `test: enforce official Creator semantic round-trip`
