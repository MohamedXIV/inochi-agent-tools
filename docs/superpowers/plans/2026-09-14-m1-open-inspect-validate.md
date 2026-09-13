# M1 Open, Inspect & Validate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open genuine Inochi2D `.inp` puppets through the pinned native implementation, expose a stable semantic inspection snapshot without raw native handles, fail closed on invalid input, and prove repeated open/inspect/dispose behavior through a process-isolated native host.

**Architecture:** Extend the existing internal D/C ABI bridge with one read-only inspection operation that loads a puppet using pinned Inochi2D, traverses its public model, serializes a small semantic JSON snapshot, and frees all native state before returning. A separately linked native host executable consumes that C ABI and is the only process Node launches. `@inochi-agent-tools/core` parses the host JSON into typed domain snapshots and errors; it never owns D pointers, `in_*` handles, allocators, or memory offsets.

**Tech Stack:** Node.js 22+, TypeScript 5.x, Vitest, DUB, LDC 1.40.0 in CI, pinned Inochi2D `fdb241da048dbe330152f7b0015e2129dc392844` / `v0.8.7`, D process host, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-13-inochi-agent-tools-v1-design.md`

## Global Constraints

- The project is public and general-purpose; no Away Message-specific names, metadata, characters, or gameplay semantics belong in this milestone.
- `@inochi-agent-tools/core` exposes semantic domain values only. Raw `in_*`, D objects, pointers, allocators, memory offsets, and native handles remain internal.
- Native input handling is fail-closed. A malformed puppet must produce a typed semantic failure rather than partial success.
- The Node/agent process never loads the D shared library directly in M1. Native work runs behind a child-process boundary.
- The real-artifact acceptance fixture must be produced by pinned official Inochi2D serialization (`inWriteINPPuppet`), not hand-crafted INP bytes or fake JSON.
- The fixture generator is test infrastructure only. It must not become a public create/save API; Issue #5 owns authoring/serialization APIs.
- M1 is read-only from the public semantic surface.
- Existing M0 provenance/lock invariants remain binding: exact Inochi SHA, checked `package-lock.json`, checked `native/bridge/dub.selections.json`, LDC >= 1.40.0 contract and LDC 1.40.0 CI pin.
- Strict RED -> GREEN TDD applies to every behavior slice.

---

## Upstream Facts This Plan Depends On

Pinned Inochi2D v0.8.7 already provides:

- `inLoadPuppet` / `inLoadINPPuppet` for real `.inp` loading;
- `Puppet.meta`, `Puppet.root`, `Puppet.parameters`, and `Puppet.textureCache`;
- `Node.name`, `Node.children`, `Node.getNodePath()`, and runtime class/type information;
- `Part` as a concrete node subclass;
- `Parameter` name/dimensions/min/max/default/value state;
- official `inWriteINPPuppet(Puppet, string)` serialization.

Pinned upstream CFFI exposes puppet/parameter/texture access, but not a complete semantic node-tree inventory. The missing node inspection is implemented only inside our private bridge against pinned D classes; it is not added as a public raw node-handle API.

---

## File Structure Added/Modified by M1

```text
native/bridge/
  source/iat_bridge.d                    # add semantic inspection C ABI + owned string allocation
  test/fixture_generator.d              # test-only genuine INP fixture generator
  test/inspection_probe.d               # RED/GREEN direct C ABI acceptance probe

native/host/
  source/iat_native_host.d               # separately linked inspect command, stdout JSON/stderr diagnostics

scripts/native/
  build-bridge.mjs                       # keep M0 bridge build behavior
  build-host.mjs                         # build host + fixture generator + inspection probe
  m1-ci.mjs                              # orchestrate real fixture + native host acceptance

packages/core/src/
  inspection.ts                          # stable semantic snapshot types + parser validation
  errors.ts                              # typed semantic errors
  native-host.ts                         # child-process adapter only
  index.ts                               # public exports

packages/core/test/
  inspection.test.ts                     # parser and typed error unit tests
  inspect-real-puppet.test.ts            # real .inp process integration
  inspect-invalid-puppet.test.ts         # malformed input fail-closed integration
  inspect-repeat.test.ts                 # repeated process/native lifecycle proof

tests/fixtures/
  invalid/not-a-puppet.inp               # intentionally malformed negative fixture
  generated/                             # gitignored real fixture output from official writer

.github/workflows/verify.yml             # add M1 integration gate
package.json                             # M1 scripts
.gitignore                               # generated fixture/binary paths
README.md                                # document read-only inspection contract
```

The generated real `.inp` is deliberately not source-controlled. The test generator recreates it deterministically enough for semantic assertions while allowing Inochi GUID generation to remain internal and nondeterministic.

---

### Task 1: Generate a genuine M1 inspection fixture with official Inochi serialization

**Files:**
- Create: `native/bridge/test/fixture_generator.d`
- Create: `scripts/native/build-host.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces executable `.build/native/m1_fixture_generator`.
- Produces command `npm run m1:fixture`.
- Produces generated real artifact `tests/fixtures/generated/m1-inspection.inp`.
- The fixture semantic contract is:
  - puppet name `M1 Inspection Fixture`;
  - root node named `Root` by Inochi finalization/serialization contract;
  - child node named `Face`;
  - child Part named `Mouth`;
  - one 1D parameter named `Head X`, min `-1`, max `1`, default `0`;
  - zero texture slots.

- [ ] **Step 1: Write the fixture generator source but intentionally call a missing build command for RED**

Create `native/bridge/test/fixture_generator.d`:

```d
import inochi2d.core.puppet : Puppet;
import inochi2d.core.nodes : Node;
import inochi2d.core.nodes.drawable.part : Part;
import inochi2d.core.param : Parameter;
import inochi2d.core.format.inp : inWriteINPPuppet;
import inmath : vec2;
import std.file : mkdirRecurse;
import std.path : dirName;

int main(string[] args) {
    assert(args.length == 2, "expected output .inp path");

    auto puppet = new Puppet();
    puppet.meta.name = "M1 Inspection Fixture";

    auto face = new Node(puppet.root);
    face.name = "Face";

    auto mouth = new Part(face);
    mouth.name = "Mouth";

    auto headX = new Parameter("Head X", false);
    headX.min = vec2(-1, 0);
    headX.max = vec2(1, 0);
    headX.defaults = vec2(0, 0);
    puppet.parameters ~= headX;

    mkdirRecurse(dirName(args[1]));
    inWriteINPPuppet(puppet, args[1]);
    return 0;
}
```

Add root script temporarily pointing to the not-yet-created `scripts/native/build-host.mjs`:

```json
"m1:fixture": "node scripts/native/build-host.mjs --fixture"
```

Run: `npm run m1:fixture`

Expected: FAIL because `scripts/native/build-host.mjs` does not exist.

- [ ] **Step 2: Implement the minimal native build helper for the test generator**

`scripts/native/build-host.mjs` must first run the existing toolchain/upstream verification, then compile the fixture generator against the same pinned DUB dependency graph used by the bridge. Use `dub run`/a dedicated DUB test configuration or explicit LDC invocation with DUB-resolved flags; do not resolve a second independent dependency graph.

The output path is `.build/native/m1_fixture_generator` and the helper invokes it with `tests/fixtures/generated/m1-inspection.inp` when `--fixture` is present.

- [ ] **Step 3: Generate and verify the artifact is a real non-empty INP**

Run:

```bash
npm run m1:fixture
```

Expected:

```text
tests/fixtures/generated/m1-inspection.inp exists
file size > 0
```

Then invoke pinned Inochi load in a tiny native assertion inside the helper or generator after writing; expected load succeeds. This is the proof that the bytes are official serialized puppet bytes, not a fabricated fixture.

- [ ] **Step 4: Keep generated artifact out of source authority**

Add to `.gitignore`:

```text
tests/fixtures/generated/
```

Do not commit the generated `.inp`.

- [ ] **Step 5: Commit**

```bash
git add native/bridge/test/fixture_generator.d scripts/native/build-host.mjs package.json .gitignore
git commit -m "test: generate real M1 Inochi fixture"
```

---

### Task 2: Add a read-only semantic inspection operation to the private D/C ABI bridge

**Files:**
- Modify: `native/bridge/source/iat_bridge.d`
- Create: `native/bridge/test/inspection_probe.d`
- Modify: `scripts/native/build-host.mjs`

**Interfaces:**
- Existing M0 exports remain unchanged:
  - `iat_bridge_abi_version() -> uint`
  - `iat_bridge_upstream_version() -> const(char)*`
- Add internal C ABI:

```c
int iat_inspect_puppet_json(const char* path, char** out_json, char** out_error);
void iat_string_free(char* value);
```

Return contract:
- `0`: success; `*out_json` owns a UTF-8 NUL-terminated semantic JSON allocation and `*out_error == null`.
- non-zero: failure; `*out_json == null`; `*out_error` owns a UTF-8 NUL-terminated diagnostic allocation.
- every non-null allocation returned by these functions must be released exactly once with `iat_string_free`.
- no `Puppet*`, `Node*`, GUID pointer, D slice pointer, or upstream `in_*` handle crosses this boundary.

Semantic JSON schema:

```ts
interface NativePuppetInspectionV1 {
  schemaVersion: 1;
  metadata: {
    name: string;
    inochiVersion: string;
    rigger: string;
    artist: string;
  };
  nodes: Array<{
    path: string;
    name: string;
    kind: 'node' | 'part' | 'other';
    childCount: number;
  }>;
  parameters: Array<{
    name: string;
    dimensions: 1 | 2;
    min: [number, number];
    max: [number, number];
    defaultValue: [number, number];
    value: [number, number];
  }>;
  textureCount: number;
  summary: {
    nodeCount: number;
    partCount: number;
    parameterCount: number;
    textureCount: number;
  };
}
```

- [ ] **Step 1: Add a separately linked RED inspection probe**

`native/bridge/test/inspection_probe.d` declares the two new C functions with `extern(C)` and:

1. calls `iat_inspect_puppet_json(argv[1], &json, &error)`;
2. asserts result `0`;
3. converts the returned C string to D text;
4. asserts it contains `"schemaVersion":1`, `M1 Inspection Fixture`, `Face`, `Mouth`, and `Head X`;
5. calls `iat_string_free(json)` exactly once.

Run:

```bash
npm run m1:fixture
node scripts/native/build-host.mjs --probe-inspection
```

Expected: FAIL at link time because `iat_inspect_puppet_json` and `iat_string_free` do not exist.

- [ ] **Step 2: Implement owned C-string allocation helpers**

Inside `iat_bridge.d`, add a private helper that allocates `text.length + 1` bytes with `core.stdc.stdlib.malloc`, copies UTF-8 bytes, writes the NUL terminator, and returns `char*`. `iat_string_free` must call `core.stdc.stdlib.free` and accept null safely.

Do not return `.ptr` from temporary D strings for inspection/error data.

- [ ] **Step 3: Implement semantic traversal using pinned Inochi classes**

`iat_inspect_puppet_json` must:

1. reject null path/output pointers;
2. call pinned `inLoadPuppet!Puppet(path)` inside `try/catch`;
3. recursively traverse `puppet.root` in pre-order;
4. classify `Part` as `part`, exact/base `Node` as `node`, other subclasses as `other`;
5. copy only the semantic fields in the schema above;
6. inspect `puppet.parameters` directly for stable scalar values;
7. read `puppet.textureCache.size` only as a count in M1;
8. serialize through `std.json`;
9. destroy/free the loaded `Puppet` in a `scope(exit)` path before returning;
10. on exception, return non-zero plus owned error text and no partial snapshot.

The bridge must not serialize the entire upstream object graph or leak upstream implementation fields into the schema.

- [ ] **Step 4: Prove GREEN through the external C ABI probe**

Run:

```bash
npm run m1:fixture
node scripts/native/build-host.mjs --probe-inspection
```

Expected: PASS and the probe validates semantic content from the genuine `.inp`.

- [ ] **Step 5: Add native negative proof**

Create `tests/fixtures/invalid/not-a-puppet.inp` as a short text fixture such as `not an inochi puppet`.

Extend the native probe or add a second invocation that asserts:
- return code is non-zero;
- JSON output is null;
- error output is non-null and non-empty;
- error allocation is freed exactly once.

Run and expect PASS.

- [ ] **Step 6: Commit**

```bash
git add native/bridge/source/iat_bridge.d native/bridge/test/inspection_probe.d tests/fixtures/invalid scripts/native/build-host.mjs
git commit -m "feat: inspect real puppets through semantic native bridge"
```

---

### Task 3: Build a process-isolated native host over the shared bridge

**Files:**
- Create: `native/host/source/iat_native_host.d`
- Modify: `scripts/native/build-host.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces `.build/native/iat_native_host`.
- Host command:

```text
iat_native_host inspect <absolute-or-relative-puppet-path>
```

Success contract:
- exit `0`;
- stdout contains exactly one semantic JSON document;
- stderr is empty.

Failure contract:
- exit `2` for invalid arguments;
- exit `3` for puppet inspection failure;
- stdout is empty on failure;
- stderr contains a human-readable native diagnostic.

- [ ] **Step 1: Write host source and prove RED before linking bridge functions**

`iat_native_host.d` must declare only the bridge C ABI functions, not import `inochi2d.core.*`. It parses only the `inspect` command, calls `iat_inspect_puppet_json`, prints JSON, frees returned strings, and exits according to the contract.

Run the host build before adding it to `build-host.mjs`.

Expected: FAIL because the helper does not yet build/link the host.

- [ ] **Step 2: Compile and separately link the host against `iat_bridge`**

Extend `build-host.mjs` to compile with LDC shared default runtime and link `-liat_bridge` from `.build/native`, mirroring the M0 external probe boundary. The host must not compile `iat_bridge.d` into its own executable.

- [ ] **Step 3: Prove real success through the process boundary**

Run:

```bash
npm run m1:fixture
.build/native/iat_native_host inspect tests/fixtures/generated/m1-inspection.inp
```

Expected JSON contains the fixture semantic contract and `schemaVersion: 1`.

- [ ] **Step 4: Prove failure through the process boundary**

Run:

```bash
.build/native/iat_native_host inspect tests/fixtures/invalid/not-a-puppet.inp
```

Expected: exit `3`, empty stdout, non-empty stderr.

- [ ] **Step 5: Commit**

```bash
git add native/host scripts/native/build-host.mjs package.json
git commit -m "feat: isolate native puppet inspection host"
```

---

### Task 4: Define the TypeScript semantic inspection model and typed errors

**Files:**
- Create: `packages/core/src/inspection.ts`
- Create: `packages/core/src/errors.ts`
- Create: `packages/core/test/inspection.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces exported domain types:

```ts
export type NodeKind = 'node' | 'part' | 'other';

export interface PuppetInspection { /* same semantic fields as schema v1 */ }

export function parsePuppetInspection(input: unknown): PuppetInspection;

export class InvalidPuppetError extends Error {
  readonly code = 'INVALID_PUPPET';
}

export class NativeBridgeError extends Error {
  readonly code = 'NATIVE_BRIDGE_FAILURE';
}
```

`parsePuppetInspection` must reject unknown schema versions and malformed field types.

- [ ] **Step 1: Write RED parser tests**

Tests must cover:
- complete valid `schemaVersion: 1` object returns typed snapshot;
- `schemaVersion: 2` rejects;
- missing `metadata`, non-array `nodes`, invalid `dimensions: 3`, negative summary counts, and non-finite numeric parameter values reject.

Run:

```bash
npm test -- packages/core/test/inspection.test.ts
```

Expected: FAIL because parser/types do not exist.

- [ ] **Step 2: Implement the minimum explicit parser**

Use ordinary TypeScript guards in M1; do not introduce a schema dependency solely for one snapshot. Validate each field and construct a fresh object rather than returning untrusted parsed JSON by assertion/cast.

- [ ] **Step 3: Export semantic types/errors only**

Update `packages/core/src/index.ts` to export the inspection model/parser/errors. Do not export native executable paths or C ABI names.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm run typecheck
npm test -- packages/core/test/inspection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/test/inspection.test.ts
git commit -m "feat: define semantic puppet inspection model"
```

---

### Task 5: Add the child-process adapter and real-puppet integration contract

**Files:**
- Create: `packages/core/src/native-host.ts`
- Create: `packages/core/test/inspect-real-puppet.test.ts`
- Create: `packages/core/test/inspect-invalid-puppet.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `vitest.config.ts` if integration timeout configuration is required

**Interfaces:**
- Produces:

```ts
export interface InspectPuppetOptions {
  hostPath?: string;
}

export async function inspectPuppet(
  filePath: string,
  options?: InspectPuppetOptions,
): Promise<PuppetInspection>;

export async function validatePuppet(
  filePath: string,
  options?: InspectPuppetOptions,
): Promise<PuppetInspection>;
```

Behavior:
- default host path resolves repository-built `.build/native/iat_native_host` without embedding platform-specific raw library handles;
- host exit `0` -> parse stdout with `parsePuppetInspection`;
- host exit `3` -> throw `InvalidPuppetError` carrying sanitized diagnostic text;
- spawn error, signal death, invalid stdout JSON, or unsupported host exit -> `NativeBridgeError`;
- file paths are passed as argument vector elements, never shell-concatenated strings.

- [ ] **Step 1: Write RED real-artifact integration test**

Before tests, `npm run m1:fixture` and host build must have produced the real fixture/host. Test:

```ts
const inspection = await inspectPuppet(
  'tests/fixtures/generated/m1-inspection.inp',
);
expect(inspection.metadata.name).toBe('M1 Inspection Fixture');
expect(inspection.nodes.map((n) => n.name)).toEqual(
  expect.arrayContaining(['Root', 'Face', 'Mouth']),
);
expect(inspection.summary.partCount).toBe(1);
expect(inspection.parameters).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ name: 'Head X', dimensions: 1 }),
  ]),
);
expect(inspection.textureCount).toBe(0);
```

Run and expect FAIL because `inspectPuppet` does not exist.

- [ ] **Step 2: Implement child-process adapter with no shell**

Use `node:child_process` `execFile` or `spawn` with an argv array. Bound captured stdout/stderr to a reasonable M1 maximum (16 MiB); overflow becomes `NativeBridgeError` rather than unbounded memory use.

- [ ] **Step 3: Add invalid-puppet typed error test**

Call `inspectPuppet('tests/fixtures/invalid/not-a-puppet.inp')` and assert `InvalidPuppetError`, code `INVALID_PUPPET`, and a non-empty diagnostic. Do not assert exact upstream exception wording.

- [ ] **Step 4: Add host-corruption error tests**

Using a tiny test-only fake executable/script via `hostPath`, prove malformed JSON and abnormal process exit map to `NativeBridgeError`. These are adapter unit/integration tests only; they do not replace the real artifact acceptance test.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm run typecheck
npm test -- packages/core/test/inspection.test.ts packages/core/test/inspect-real-puppet.test.ts packages/core/test/inspect-invalid-puppet.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src packages/core/test vitest.config.ts
git commit -m "feat: inspect puppets through isolated native host"
```

---

### Task 6: Prove deterministic repeated open/inspect/dispose and wire exact-head CI

**Files:**
- Create: `packages/core/test/inspect-repeat.test.ts`
- Create: `scripts/native/m1-ci.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/verify.yml`
- Modify: `README.md`

**Interfaces:**
- Produces root command `npm run m1:ci`.
- `m1:ci` performs, in order:
  1. M0 `native:ci` foundation verification;
  2. M1 host/fixture build;
  3. real fixture generation;
  4. native inspection probe success + malformed-input negative proof;
  5. TypeScript typecheck;
  6. complete test suite including real artifact process tests and repeated lifecycle test.

- [ ] **Step 1: Write RED repeated lifecycle test**

`inspect-repeat.test.ts` runs `inspectPuppet` on the generated real fixture 50 sequential times and asserts every snapshot has identical semantic data after removing no fields—the schema intentionally contains no random GUIDs. Each call creates a fresh native process, which must terminate successfully.

Then inspect invalid input 10 sequential times and assert all return `InvalidPuppetError` without poisoning subsequent valid inspections.

Run and expect RED until the M1 integration harness consistently supports the loop.

- [ ] **Step 2: Add `m1-ci.mjs` and package script**

The script must use `spawnSync`/`execFileSync` argument arrays and propagate non-zero status. Add:

```json
"m1:host:build": "node scripts/native/build-host.mjs --host",
"m1:probe": "node scripts/native/build-host.mjs --probe-inspection",
"m1:ci": "node scripts/native/m1-ci.mjs"
```

- [ ] **Step 3: Wire M1 into GitHub Actions**

After `npm ci`, the native job must run `npm run m1:ci` instead of duplicating hand-written command fragments. Keep LDC `1.40.0`. Semantic-only job may remain fast, but exact-head required verification is not green unless the M1 real-artifact native job is green.

- [ ] **Step 4: Document read-only inspection boundary**

README must state:
- M1 `inspectPuppet`/`validatePuppet` are read-only semantic operations;
- native pointers are process-internal;
- the host is isolated from agent/Node process;
- fixture acceptance uses official pinned Inochi serialization;
- create/save authoring remains Issue #5 and is not part of this API yet.

- [ ] **Step 5: Run strongest local/CI-equivalent verification**

Run:

```bash
npm ci
npm run verify
npm run m1:ci
```

Expected: all PASS. The lifecycle test completes 50 valid + 10 invalid inspections and then one final valid inspection successfully.

- [ ] **Step 6: Exact-head GitHub verification and review audit**

Push the current branch. On the exact current PR head:
- required semantic job GREEN;
- required native/M1 job GREEN;
- PR mergeable;
- no unresolved review threads;
- no acceptance item in Issue #4 remains open.

Do not merge on stale CI evidence from an earlier head.

- [ ] **Step 7: Commit**

```bash
git add packages/core/test/inspect-repeat.test.ts scripts/native/m1-ci.mjs package.json .github/workflows/verify.yml README.md
git commit -m "test: gate M1 semantic inspection on real puppets"
```

---

## M1 Issue #4 Definition of Done

Issue #4 is complete only when all of these are true on one exact PR head:

1. A real `.inp` is generated by pinned official `inWriteINPPuppet`; no hand-crafted acceptance bytes.
2. The shared bridge loads that artifact through pinned Inochi2D and emits the documented semantic schema.
3. A separately linked native host calls the bridge C ABI; the Node process never loads or owns native handles.
4. Public TypeScript exposes semantic metadata, hierarchy, Part classification, parameters, texture count, and summary only.
5. Malformed `.inp` input fails closed as `InvalidPuppetError`; host/protocol failures become `NativeBridgeError`.
6. Fifty sequential valid inspections, ten sequential invalid inspections, and a final valid inspection all complete without lifecycle corruption.
7. All returned C strings and native puppet state have deterministic ownership/free paths.
8. `npm ci`, `npm run verify`, and `npm run m1:ci` pass on the exact PR head in GitHub Actions.
9. No public API exposes raw upstream `in_*`, D pointers, allocators, memory offsets, or implementation-specific handles.
10. No public create/save authoring API is introduced; Issue #5 remains the owner of that capability.
