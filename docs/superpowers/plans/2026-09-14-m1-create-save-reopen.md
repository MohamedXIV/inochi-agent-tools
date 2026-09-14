# M1 Create, Save & Reopen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first public semantic authoring operation that creates a minimal valid Inochi2D puppet headlessly, saves a genuine `.inp`, reopens it through the existing M1 inspection path, and fails closed when the saved semantic structure does not round-trip.

**Architecture:** Keep the process-isolated architecture established by Issue #4. `@inochi-agent-tools/core` sends one semantic create request to `iat_native_host`; the host calls a private D/C ABI operation that constructs a pinned-Inochi `Puppet`, serializes it with official `inWriteINPPuppet`, then reloads/inspects the result before success is returned. No D object, pointer, allocator, GUID, or native handle crosses into TypeScript. This milestone deliberately supports only a minimal puppet (metadata + canonical root); texture/Part/hierarchy authoring remains Issue #6 and parameters/bindings remain Issue #7.

**Tech Stack:** Node.js 22+, TypeScript 5.x, Vitest, DUB, LDC 1.40.0 in CI, pinned Inochi2D `fdb241da048dbe330152f7b0015e2129dc392844` / `v0.8.7`, D process host, existing ordered upstream patch layer, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-13-inochi-agent-tools-v1-design.md`

## Global Constraints

- Public/general-purpose only; no Away-specific metadata, names, characters, or workflow assumptions.
- Preserve the pinned upstream SHA and ordered patch/provenance contract from M0/M1 inspection.
- The Node/agent process must not load the D shared library directly; authoring remains behind `iat_native_host`.
- Public APIs are semantic only; no raw `in_*`, pointers, allocators, memory offsets, GUIDs, or native handles.
- Real `.inp` bytes written by official pinned `inWriteINPPuppet` are mandatory acceptance evidence.
- Do not hand-craft INP bytes or use fake JSON as save/reopen acceptance proof.
- Any new upstream patch must be required by a concrete failing acceptance test, minimal, ordered, documented with reason/removal condition, and included in provenance.
- Strict RED -> GREEN TDD applies to each behavior slice.
- Issue #5 does not add texture, Part, arbitrary hierarchy, parameter, binding, Creator-UI, CLI, or MCP authoring.

---

## Public Semantic Contract Locked by #5

```ts
export interface CreatePuppetRequest {
  outputPath: string;
  name: string;
}

export interface CreatePuppetResult {
  path: string;
  inspection: PuppetInspection;
}

export async function createPuppet(
  request: CreatePuppetRequest,
  options?: NativeHostOptions,
): Promise<CreatePuppetResult>;
```

Rules:

- `name` must contain at least one non-whitespace character and must not contain NUL.
- `outputPath` must end in `.inp`; parent directories may be created by the native side.
- Existing files are not overwritten in #5. If the target exists, fail closed with `PuppetAlreadyExistsError`.
- Success means: official writer produced a non-empty `.inp`, pinned loader reopened it, semantic inspection succeeded, and reopened `metadata.name` equals the requested name.
- The result contains the reopened semantic snapshot, never a native handle.

New semantic errors:

```ts
export class InvalidAuthoringRequestError extends InochiAgentToolsError {}
export class PuppetAlreadyExistsError extends InochiAgentToolsError {}
export class RoundTripMismatchError extends InochiAgentToolsError {}
```

Native host exit mapping added by this milestone:

```text
0 = success
3 = InvalidPuppet (existing inspect contract)
4 = InvalidAuthoringRequest
5 = PuppetAlreadyExists
6 = RoundTripMismatch
other/non-process/protocol failure = NativeBridgeError
```

---

## File Structure Added/Modified by #5

```text
native/bridge/source/iat_bridge.d          # add create/write/reopen semantic C ABI
native/bridge/test/create_roundtrip_probe.d# separately linked real artifact proof
native/host/source/iat_native_host.d       # add `create-minimal` command
native/bridge/dub.json                     # probe configuration if required

packages/core/src/authoring.ts             # semantic request validation + host adapter
packages/core/src/errors.ts                # authoring/round-trip typed errors
packages/core/src/native-host.ts           # share host path/env/exec plumbing if needed
packages/core/src/index.ts                 # export authoring contract
packages/core/test/authoring.test.ts        # narrow semantic request/error tests
packages/core/test/create-real-puppet.test.ts # real `.inp` create/reopen integration
packages/core/test/create-conflict.test.ts  # no-overwrite acceptance

scripts/native/build-host.mjs              # build/run create probe target
scripts/native/m1-authoring-ci.mjs         # #5 exact acceptance orchestration
package.json                               # authoring scripts
.github/workflows/verify.yml               # native job runs #5 gate
README.md                                  # document minimal create/save contract
```

Generated output lives under `tests/fixtures/generated/` and remains gitignored.

---

### Task 1: Establish semantic create-request validation and RED host contract

**Files:**
- Create: `packages/core/src/authoring.ts`
- Create: `packages/core/test/authoring.test.ts`
- Modify: `packages/core/src/errors.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: existing `PuppetInspection`, process-isolated host conventions.
- Produces: `CreatePuppetRequest`, `CreatePuppetResult`, `createPuppet()` signature and typed request errors.

- [ ] **Step 1: Write RED validation tests**

Add tests that call `createPuppet` with a fake host path but invalid requests so validation happens before process spawn:

```ts
await expect(createPuppet({ outputPath: 'x.inp', name: '   ' }, { hostPath: '/missing' }))
  .rejects.toBeInstanceOf(InvalidAuthoringRequestError);

await expect(createPuppet({ outputPath: 'x.txt', name: 'Valid' }, { hostPath: '/missing' }))
  .rejects.toBeInstanceOf(InvalidAuthoringRequestError);

await expect(createPuppet({ outputPath: 'x.inp', name: 'bad\0name' }, { hostPath: '/missing' }))
  .rejects.toBeInstanceOf(InvalidAuthoringRequestError);
```

Run: `npm test -- packages/core/test/authoring.test.ts`

Expected: FAIL because `authoring.ts` and the new errors do not exist.

- [ ] **Step 2: Add typed errors and minimal request validator**

`authoring.ts` validates:

```ts
if (!request.name.trim() || request.name.includes('\0')) throw new InvalidAuthoringRequestError(...);
if (path.extname(request.outputPath).toLowerCase() !== '.inp') throw new InvalidAuthoringRequestError(...);
```

Do not spawn the native host for invalid semantic input.

- [ ] **Step 3: Leave the valid request path deliberately RED**

For valid input, call an internal `runNativeAuthoringHost(...)` placeholder that throws `NativeBridgeError('create-minimal host command not implemented')`.

Add a test asserting a valid request reaches that RED rather than request validation.

- [ ] **Step 4: Verify narrow GREEN/RED split**

Run: `npm test -- packages/core/test/authoring.test.ts`

Expected: invalid-request tests PASS; valid create test remains intentionally RED for the missing native command.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/authoring.ts packages/core/src/errors.ts packages/core/src/index.ts packages/core/test/authoring.test.ts
git commit -m "test: establish semantic puppet creation contract"
```

---

### Task 2: Add private native create/write/reopen C ABI with a real RED/GREEN probe

**Files:**
- Modify: `native/bridge/source/iat_bridge.d`
- Create: `native/bridge/test/create_roundtrip_probe.d`
- Modify: `native/bridge/dub.json`
- Modify: `scripts/native/build-host.mjs`

**Interfaces:**
- Add private C ABI:

```c
int iat_create_minimal_puppet_json(
  const char* output_path,
  const char* name,
  char** out_json,
  char** out_error
);
```

Return codes:
- `0` success with owned reopened inspection JSON;
- `2` invalid native arguments/allocation boundary;
- `4` invalid authoring request;
- `5` target already exists;
- `6` semantic round-trip mismatch;
- `1` unexpected native/load/write failure.

All returned strings use the existing `iat_string_free` ownership contract.

- [ ] **Step 1: Add separately linked RED probe**

`create_roundtrip_probe.d` declares only the C ABI and attempts:

```text
create tests/fixtures/generated/m1-created-minimal.inp
name = "M1 Created Puppet"
```

Assert:
- return code `0`;
- JSON contains schemaVersion 1 and `M1 Created Puppet`;
- output file exists and size > 0.

Run through `npm run m1:create-probe` before implementing the export.

Expected: link/build FAIL because `iat_create_minimal_puppet_json` is absent.

- [ ] **Step 2: Implement the minimal native authoring operation**

Inside bridge implementation:

```d
if (exists(outputPath)) return 5;
if (nameText.strip.length == 0 || nameText.indexOf('\0') >= 0) return 4;
if (extension(outputPath) != ".inp") return 4;
mkdirRecurse(dirName(outputPath));
auto puppet = new Puppet();
puppet.meta.name = nameText;
inWriteINPPuppet(puppet, outputPath);
auto reopened = inLoadPuppet!Puppet(outputPath);
if (reopened is null || reopened.meta.name.value != nameText) return 6;
```

Then reuse one internal inspection builder shared with `iat_inspect_puppet_json` so create and inspect cannot diverge semantically. Do not duplicate the JSON schema.

- [ ] **Step 3: Verify real writer/loader GREEN**

Run: `npm run m1:create-probe`

Expected: PASS and a real non-empty generated `.inp` exists.

- [ ] **Step 4: Add conflict RED/GREEN to the probe**

Call the same create operation again without deleting the artifact.

Expected: return code `5`, original artifact remains readable, no overwrite occurs.

- [ ] **Step 5: Commit**

```bash
git add native/bridge/source/iat_bridge.d native/bridge/test/create_roundtrip_probe.d native/bridge/dub.json scripts/native/build-host.mjs package.json
git commit -m "feat: create and round-trip minimal native puppet"
```

---

### Task 3: Expose `create-minimal` through the process-isolated native host

**Files:**
- Modify: `native/host/source/iat_native_host.d`
- Modify: `scripts/native/build-host.mjs`

**Interfaces:**
- Host command:

```text
iat_native_host create-minimal <output.inp> <name>
```

On success stdout is only the reopened inspection JSON. Diagnostics go to stderr. Exit codes preserve the native semantic mapping above.

- [ ] **Step 1: Add RED host invocation to the build helper**

Add `--create-host-probe` mode that invokes the separately built host against a fresh generated output.

Run: `npm run m1:create-host`

Expected: FAIL because host does not recognize `create-minimal`.

- [ ] **Step 2: Implement command dispatch without shell parsing**

Host must require exactly four argv values (`program`, command, output, name), call the C ABI, print returned JSON verbatim on success, print owned error text to stderr on failure, free every returned C string exactly once, and exit with the bridge semantic code.

- [ ] **Step 3: Verify success + no-overwrite through the external process**

Run: `npm run m1:create-host`

Expected: first invocation exit `0` with valid inspection JSON; second invocation on same path exit `5`.

- [ ] **Step 4: Commit**

```bash
git add native/host/source/iat_native_host.d scripts/native/build-host.mjs package.json
git commit -m "feat: expose minimal puppet creation through native host"
```

---

### Task 4: Complete TypeScript process adapter and typed semantic failures

**Files:**
- Modify: `packages/core/src/authoring.ts`
- Modify: `packages/core/src/native-host.ts`
- Modify: `packages/core/test/authoring.test.ts`
- Create: `packages/core/test/create-conflict.test.ts`

**Interfaces:**
- `createPuppet(request, options)` spawns host with `execFile`, never shell.
- Reuse the existing max-output, environment, host-path override, and JSON parsing discipline from `inspectPuppet`.

- [ ] **Step 1: Add fake-host RED tests for exit mappings**

Test executable fixtures/scripts should produce:
- exit `4` -> `InvalidAuthoringRequestError`;
- exit `5` -> `PuppetAlreadyExistsError`;
- exit `6` -> `RoundTripMismatchError`;
- malformed success JSON -> `NativeBridgeError`;
- unknown exit -> `NativeBridgeError`.

Run: `npm test -- packages/core/test/authoring.test.ts packages/core/test/create-conflict.test.ts`

Expected: FAIL until mappings are implemented.

- [ ] **Step 2: Factor shared host execution without weakening inspect behavior**

If `native-host.ts` currently duplicates execution plumbing, extract a private helper that preserves:
- `execFile` (not shell);
- `maxBuffer = 16 MiB`;
- process environment/library paths;
- `hostPath` override;
- stdout semantic JSON parsing;
- stderr diagnostic preference.

Do not change public inspect results or existing exit `3 -> InvalidPuppetError` mapping.

- [ ] **Step 3: Implement create mappings and return path**

On success return:

```ts
{
  path: path.resolve(process.cwd(), request.outputPath),
  inspection: parsePuppetInspection(stdoutJson),
}
```

Also assert `inspection.metadata.name === request.name`; otherwise throw `RoundTripMismatchError` even if the host incorrectly returned success.

- [ ] **Step 4: Verify semantic tests**

Run: `npm run verify`

Expected: existing inspection suite remains GREEN and new authoring unit tests GREEN.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/test
git commit -m "feat: add semantic minimal puppet authoring API"
```

---

### Task 5: Prove the public API creates and reopens a genuine `.inp`

**Files:**
- Create: `packages/core/test/create-real-puppet.test.ts`
- Create: `scripts/native/m1-authoring-ci.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/verify.yml`
- Modify: `README.md`

**Interfaces:**
- Produces root command `npm run m1:authoring:ci`.
- The command composes existing M1 inspection acceptance with #5 create/save/reopen acceptance.

- [ ] **Step 1: Write the real integration RED**

Test flow:

```ts
const output = 'tests/fixtures/generated/core-created-minimal.inp';
await rm(output, { force: true });
const created = await createPuppet({ outputPath: output, name: 'Core Created Puppet' });
expect(created.inspection.metadata.name).toBe('Core Created Puppet');
const reopened = await inspectPuppet(output);
expect(reopened).toEqual(created.inspection);
expect(reopened.summary.nodeCount).toBeGreaterThanOrEqual(1);
```

Then attempt the same create again and require `PuppetAlreadyExistsError`.

Run before wiring/building native artifacts: targeted test should FAIL because required host artifact is absent.

- [ ] **Step 2: Implement deterministic CI orchestration**

`m1-authoring-ci.mjs` must run, in order:

```text
npm run m1:ci
npm run m1:create-probe
npm run m1:create-host
npm run typecheck
npm test
```

It must delete only known generated #5 artifact paths before the create probes so RED/GREEN runs are reproducible; never recursively delete user-controlled paths.

- [ ] **Step 3: Wire exact-head GitHub Actions gate**

Native job runs `npm run m1:authoring:ci`. Do not leave the new acceptance as a local-only script.

- [ ] **Step 4: Document the intentionally minimal v1 authoring slice**

README documents:
- `createPuppet({ outputPath, name })`;
- no overwrite by default;
- process isolation;
- result is reopened semantic inspection;
- textures/Parts/hierarchy/parameters are intentionally later issues, not silently unsupported promises.

- [ ] **Step 5: Run full acceptance**

Run: `npm run m1:authoring:ci`

Expected: exit `0`, real `.inp` created by pinned official writer, reopened through pinned loader and public inspect API, duplicate-create fail-closed, full regression suite GREEN.

- [ ] **Step 6: Commit**

```bash
git add packages/core/test/create-real-puppet.test.ts scripts/native/m1-authoring-ci.mjs package.json .github/workflows/verify.yml README.md
git commit -m "test: gate minimal puppet save and reopen round trip"
```

---

## Final #5 Acceptance Audit

Before marking the PR Ready or closing Issue #5, verify on the exact PR head:

```text
[ ] current main is the PR base or branch is not stale/conflicted
[ ] `npm run m1:authoring:ci` GREEN in GitHub Actions
[ ] real generated `.inp` is non-empty and produced by pinned `inWriteINPPuppet`
[ ] pinned loader reopens it successfully
[ ] public `createPuppet` result equals subsequent public `inspectPuppet` semantic snapshot
[ ] requested puppet name round-trips exactly
[ ] duplicate target fails without overwriting original
[ ] malformed/invalid authoring requests fail with typed semantic errors
[ ] existing #4 inspect/invalid/repeat acceptance remains GREEN
[ ] upstream SHA/version and patch provenance unchanged except any concretely required documented patch
[ ] no raw pointer/allocator/native handle is exposed publicly
[ ] changed files contain no Issue #6/#7 scope creep
[ ] 0 unresolved review threads
```

Only after all boxes are evidenced may #5 be completed and #6 become unblocked.
