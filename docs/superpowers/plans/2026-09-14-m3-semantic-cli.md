# M3 Stable Semantic CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stable, automation-friendly and human-usable CLI that exposes the existing Inochi Agent Tools semantic authoring core without duplicating native or authoring behavior.

**Architecture:** Add `packages/cli` as a thin Node.js 22 adapter over `@inochi-agent-tools/core`. Commands parse semantic arguments/JSON, call exported core functions, and format one stable result/error envelope; no CLI command may call the D bridge or `iat_native_host` directly. A small `savePuppet` semantic core primitive is added only because Issue #9 explicitly requires a save-as operation and the current core intentionally rejects zero-operation `editPuppet` transactions.

**Tech Stack:** Node.js 22+, TypeScript 5.9, Node `util.parseArgs`, Vitest, npm workspaces, existing process-isolated semantic core/native host.

**Spec:** `docs/superpowers/specs/2026-09-13-inochi-agent-tools-v1-design.md`

## Global Constraints

- Work only in `MohamedXIV/inochi-agent-tools`; never touch Away Message.
- CLI, MCP, and SDK remain adapters over one semantic authoring core.
- Public/CLI arguments never expose raw `in_*`, pointers, allocators, memory offsets, GUID handles, texture slots, or native implementation handles.
- Existing pinned Inochi2D authority remains `fdb241da048dbe330152f7b0015e2129dc392844` (`v0.8.7`); LDC remains >= `1.40.0`.
- Real `.inp` and real image artifacts are mandatory for CLI integration acceptance; synthetic values are allowed only for parser/formatter unit tests.
- Strict RED -> GREEN applies to command behavior and error/exit-code contracts.
- Creator compatibility remains the completed `m2:creator:ci` acceptance gate; the CLI must not embed or drive Creator.
- Keep #9 focused on CLI only. MCP/SDK implementation belongs to #10.

---

## File Structure

```text
packages/core/src/authoring.ts                 # add semantic savePuppet save-as primitive
packages/core/src/index.ts                     # export existing/new semantic operations only
packages/core/test/save-real-puppet.test.ts    # real save-as proof
packages/cli/package.json                      # public CLI package/bin metadata
packages/cli/tsconfig.json                     # CLI TypeScript build config
packages/cli/src/main.ts                       # executable entrypoint only
packages/cli/src/run.ts                        # parse/dispatch semantic commands
packages/cli/src/output.ts                     # stable JSON + human formatting
packages/cli/src/errors.ts                     # semantic error -> stable exit contract
packages/cli/test/cli-contract.test.ts          # parser/output/error unit contract
packages/cli/test/cli-real-workflow.test.ts    # spawned real-artifact CLI workflow
scripts/cli/m3-cli-ci.mjs                       # authoritative #9 gate
package.json                                   # root CLI build/test/gate scripts
.github/workflows/verify.yml                    # run authoritative CLI gate
README.md                                      # CLI usage and stable contract
```

The CLI command grammar for v1 is:

```text
inochi-agent puppet create   --output <file.inp> --name <name>
inochi-agent puppet open     --input <file.inp>
inochi-agent puppet inspect  --input <file.inp>
inochi-agent puppet validate --input <file.inp>
inochi-agent puppet save     --input <file.inp> --output <file.inp>
inochi-agent puppet edit     --input <file.inp> --output <file.inp> --operations <file.json|->
inochi-agent parameter evaluate --input <file.inp> --values <file.json|->
```

Global output switch:

```text
--json   # stable one-line JSON envelope on stdout; diagnostics stay on stderr
```

`puppet open` is the one-shot CLI open operation and returns the same semantic inspection snapshot as the core's headless open/inspection path. `puppet inspect` intentionally returns the same full inspection contract; both exist because the approved public vocabulary distinguishes open from inspect while v1 has no persistent interactive session.

`puppet edit` consumes the existing `PuppetEditOperation[]` JSON union. This single transaction surface exposes texture import, node create/remove/reparent, Part create/setTexture, parameter create/bind/unbind without reimplementing each operation in the CLI parser.

---

### Task 1: Add the missing semantic save-as primitive

**Files:**
- Modify: `packages/core/src/authoring.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/save-real-puppet.test.ts`
- Modify as required by the existing host protocol: `native/bridge/source/host.d`

**Interfaces:**
- Consumes: existing process-isolated native host and `PuppetInspection` parser.
- Produces:

```ts
export interface SavePuppetRequest {
  inputPath: string;
  outputPath: string;
}

export interface SavePuppetResult {
  path: string;
  inspection: PuppetInspection;
}

export async function savePuppet(
  request: SavePuppetRequest,
  options?: NativeHostOptions,
): Promise<SavePuppetResult>;
```

- [ ] **Step 1: Write the failing real-artifact save test**

Create a minimal real puppet with `createPuppet`, then call `savePuppet` to a distinct `.inp`. Assert the source still exists, destination exists and is non-empty, destination reopens through `inspectPuppet`, and semantic metadata matches the source.

```ts
const source = await createPuppet({ outputPath: sourcePath, name: 'CLI Save Fixture' });
const saved = await savePuppet({ inputPath: sourcePath, outputPath: savedPath });
expect(saved.path).toBe(path.resolve(savedPath));
expect(saved.inspection.metadata.name).toBe(source.inspection.metadata.name);
expect((await inspectPuppet(savedPath)).metadata.name).toBe('CLI Save Fixture');
```

Also assert same-path save, non-`.inp` paths, and existing destination fail with the existing semantic error classes rather than raw native diagnostics.

- [ ] **Step 2: Run the focused test and prove RED**

Run:

```bash
npm test -- packages/core/test/save-real-puppet.test.ts
```

Expected: FAIL because `savePuppet` is not exported.

- [ ] **Step 3: Add the smallest host save-as command and semantic wrapper**

Add native-host command `save-as <input> <output>` using the same pinned loader/writer used by the existing create/edit flows. The host must load the real input, refuse overwrite, write through official Inochi2D serialization, reopen the destination, and emit the normal inspection JSON. `savePuppet` validates distinct `.inp` paths before spawning the host and maps host exit codes into existing semantic errors.

Do not implement save by filesystem byte-copy: the Issue #9 contract is a semantic save/reopen operation, and the result must remain official serializer output.

- [ ] **Step 4: Run focused and regression gates**

Run:

```bash
npm run m2:parameter:ci
npm test -- packages/core/test/save-real-puppet.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/authoring.ts packages/core/src/index.ts packages/core/test/save-real-puppet.test.ts native/bridge/source/host.d
git commit -m "feat: add semantic puppet save-as"
```

---

### Task 2: Establish the CLI package, stable envelopes, and exit-code contract

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/main.ts`
- Create: `packages/cli/src/run.ts`
- Create: `packages/cli/src/output.ts`
- Create: `packages/cli/src/errors.ts`
- Test: `packages/cli/test/cli-contract.test.ts`
- Modify: root `package.json`

**Interfaces:**
- CLI bin name: `inochi-agent`.
- Internal adapter entrypoint:

```ts
export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export async function runCli(argv: string[], io: CliIo): Promise<number>;
```

- Stable JSON success envelope:

```ts
{ ok: true, command: string, result: unknown }
```

- Stable JSON failure envelope:

```ts
{ ok: false, command: string | null, error: { code: string, message: string } }
```

- Stable exit codes:

```text
0  success
2  CLI_USAGE
10 INVALID_AUTHORING_REQUEST
11 INVALID_PUPPET
12 PUPPET_ALREADY_EXISTS
13 INVALID_HIERARCHY
14 MISSING_TEXTURE
15 INVALID_TEXTURE_ASSET
16 INVALID_BINDING
17 ROUND_TRIP_MISMATCH
18 UNSUPPORTED_UPSTREAM_VERSION
20 NATIVE_BRIDGE_FAILURE
1  UNEXPECTED_FAILURE
```

- [ ] **Step 1: Write RED tests for parser, JSON envelope, human output, and exit mapping**

Use fake `CliIo` collectors and parser-only invocations that do not require native artifacts. Assert unknown command/missing option returns exit `2`; `--json` produces exactly one JSON object on stdout; human usage errors are concise on stderr; and every exported semantic error class maps to the listed stable code/name without exposing stack traces by default.

- [ ] **Step 2: Run and prove RED**

Run:

```bash
npm test -- packages/cli/test/cli-contract.test.ts
```

Expected: FAIL because `packages/cli` and `runCli` do not exist.

- [ ] **Step 3: Implement package/build shell**

Use Node `util.parseArgs`; do not add a command-framework dependency. `main.ts` calls `runCli(process.argv.slice(2), io)`, sets `process.exitCode`, and contains no semantic authoring logic. `output.ts` owns JSON/human rendering; `errors.ts` owns stable error classification.

`packages/cli/package.json` must expose:

```json
{
  "name": "@inochi-agent-tools/cli",
  "private": false,
  "type": "module",
  "bin": { "inochi-agent": "dist/main.js" },
  "dependencies": { "@inochi-agent-tools/core": "0.1.0" }
}
```

Root scripts:

```json
"cli:typecheck": "tsc -p packages/cli/tsconfig.json --noEmit",
"cli:build": "tsc -p packages/cli/tsconfig.json",
"cli:test": "vitest run packages/cli/test"
```

- [ ] **Step 4: GREEN the contract tests**

Run:

```bash
npm run cli:typecheck
npm run cli:test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli package.json package-lock.json
git commit -m "feat: establish stable semantic CLI contract"
```

---

### Task 3: Wire read/create/save commands directly to the semantic core

**Files:**
- Modify: `packages/cli/src/run.ts`
- Modify: `packages/cli/src/output.ts`
- Test: `packages/cli/test/cli-contract.test.ts`
- Test: `packages/cli/test/cli-real-workflow.test.ts`

**Interfaces:**
- `puppet create` -> `createPuppet`
- `puppet open` -> `inspectPuppet`
- `puppet inspect` -> `inspectPuppet`
- `puppet validate` -> `validatePuppet`
- `puppet save` -> `savePuppet`

- [ ] **Step 1: Add failing command-dispatch tests**

For JSON mode, assert `puppet inspect` returns `result.metadata`, `result.nodes`, `result.parameters`, and `result.textures` exactly from core output rather than a CLI-owned shadow model. Assert `puppet validate` returns the core validation result unchanged inside the envelope.

- [ ] **Step 2: Prove RED**

Run:

```bash
npm run cli:test
```

Expected: FAIL because the semantic commands are not dispatched yet.

- [ ] **Step 3: Implement direct dispatch only**

Parse paths/names, call the matching core function, and hand the returned semantic object to the formatter. Do not invoke `.build/native/iat_native_host`, DUB, Creator, or filesystem serialization directly from `packages/cli`.

Human mode should summarize without changing semantics, for example:

```text
Puppet: Creator Roundtrip Fixture
Nodes: 4  Parts: 1  Parameters: 2  Textures: 1
```

JSON mode remains the authority for automation.

- [ ] **Step 4: Add a real-artifact create/open/inspect/validate/save integration slice**

Spawn the built CLI against a temp directory using the real native host environment from existing acceptance tests. Require a created real `.inp`, successful inspection/validation, semantic save-as to a second real `.inp`, and successful reopen of that destination.

- [ ] **Step 5: Run GREEN**

Run:

```bash
npm run cli:build
npm run cli:test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli
git commit -m "feat: expose puppet lifecycle through CLI"
```

---

### Task 4: Expose the existing edit and parameter-evaluation semantics without duplicating operation parsing

**Files:**
- Modify: `packages/cli/src/run.ts`
- Test: `packages/cli/test/cli-contract.test.ts`
- Test: `packages/cli/test/cli-real-workflow.test.ts`

**Interfaces:**
- `puppet edit --operations <path|->` parses a JSON array and passes it as `PuppetEditOperation[]` to `editPuppet`.
- `parameter evaluate --values <path|->` parses a JSON object and passes it to `evaluateParameterValues`.
- `-` means read UTF-8 JSON from stdin; a file argument means read that UTF-8 file. No inline native IDs are supported.

- [ ] **Step 1: Write failing operation-input tests**

Assert file and stdin JSON are both supported; malformed JSON returns `CLI_USAGE`; a non-array edit payload returns `CLI_USAGE` before touching native code; and semantic operation validation failures still return their semantic exit code, especially `INVALID_HIERARCHY`, `MISSING_TEXTURE`, `INVALID_TEXTURE_ASSET`, and `INVALID_BINDING`.

- [ ] **Step 2: Prove RED**

Run:

```bash
npm run cli:test
```

Expected: FAIL because `puppet edit` / `parameter evaluate` are not wired.

- [ ] **Step 3: Implement JSON transport and direct core calls**

The CLI only parses JSON transport shape. It must not independently validate hierarchy, binding properties, parameter ranges, texture decoding, or authoring semantics; those remain core responsibilities.

- [ ] **Step 4: Extend the real workflow test through full authored puppet behavior**

Drive this exact CLI sequence against real artifacts:

```text
puppet create
→ puppet edit with real PNG texture.import
→ node.create Art
→ part.create Face
→ node.create Rig
→ parameter.create Move X
→ parameter.create Move Y
→ parameter.bind Move X
→ parameter.bind Move Y
→ puppet inspect
→ parameter evaluate (Move X=1, Move Y=-1)
→ puppet validate
→ puppet save
→ puppet inspect saved output
```

Require inspection to show one Part using the imported texture, two parameters, both semantic bindings to `/Root/Rig`, evaluation `Move X -> +20`, `Move Y -> -12`, and restore values at zero. No fake puppet bytes satisfy this test.

- [ ] **Step 5: Run GREEN**

Run:

```bash
npm run m2:creator:ci
npm run cli:build
npm run cli:test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli
git commit -m "feat: expose semantic authoring workflow through CLI"
```

---

### Task 5: Create the authoritative #9 gate, CI integration, and public CLI documentation

**Files:**
- Create: `scripts/cli/m3-cli-ci.mjs`
- Modify: root `package.json`
- Modify: `.github/workflows/verify.yml`
- Modify: `README.md`
- Modify: Issue #9 evidence only after exact-head verification

**Interfaces:**
- Produces authoritative `npm run m3:cli:ci`.
- `m3:cli:ci` runs in order:

```text
m2:creator:ci
cli:typecheck
cli:build
cli:test
```

- [ ] **Step 1: Establish RED for the authoritative command**

Add the root script before the orchestrator exists:

```json
"m3:cli:ci": "node scripts/cli/m3-cli-ci.mjs"
```

Run:

```bash
npm run m3:cli:ci
```

Expected: FAIL because the orchestrator file does not exist.

- [ ] **Step 2: Implement the fail-fast orchestrator**

Follow the existing `scripts/native/m2-parameter-ci.mjs` / `scripts/creator/m2-creator-ci.mjs` spawn pattern. Inherit stdio, stop on first non-zero child status, and do not duplicate test logic inside the orchestrator.

- [ ] **Step 3: Make CI call only the authoritative #9 gate for the native/CLI lane**

Keep Node 22, `ldc-1.40.0`, Xvfb/xdotool, SDL2, and FreeType installation unchanged. Replace the previous terminal M2 command with:

```yaml
- run: npm run m3:cli:ci
```

Semantic/unit CI may remain separate.

- [ ] **Step 4: Document CLI grammar and automation contract**

README must document all v1 CLI commands above, `--json`, JSON success/failure envelopes, stable exit codes, stdin JSON via `-`, and the guarantee that CLI operations call the same semantic core used by SDK/MCP rather than native APIs directly.

- [ ] **Step 5: Exact-head completion audit**

Require on the current PR head:

```text
npm run m3:cli:ci GREEN
PR mergeable
0 unresolved review threads
```

Audit the diff for native-handle vocabulary in CLI arguments/output and for any duplicated authoring implementation. Only then mark ready, merge, close #9, update #1, and unblock #10.

- [ ] **Step 6: Commit**

```bash
git add scripts/cli/m3-cli-ci.mjs package.json package-lock.json .github/workflows/verify.yml README.md
git commit -m "test: enforce semantic CLI acceptance gate"
```

---

## Self-Review

- Spec coverage: the plan covers M3 CLI stabilization, single semantic authority, structured/human output, typed errors, real-artifact integration, and the complete v1 authoring slice through CLI. MCP/SDK remain intentionally deferred to #10.
- Native leakage: no CLI interface accepts GUIDs, pointers, allocator state, `in_*`, native host commands, texture slots, or memory offsets.
- Real evidence: Task 3 proves lifecycle on real `.inp`; Task 4 proves real PNG + hierarchy/Part + two parameters/bindings + evaluation/restore; Task 5 composes completed official Creator compatibility before CLI acceptance.
- Type consistency: `savePuppet`, `runCli`, `CliIo`, `PuppetEditOperation[]`, and `evaluateParameterValues` are defined once and consumed consistently.
- Placeholder scan: no implementation step relies on TBD/TODO or unspecified error handling.
