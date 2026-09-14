# M2 Texture, Part & Hierarchy Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author a real visual Inochi puppet from a real PNG by importing texture data, creating semantic node/Part hierarchy, assigning textures, safely reparenting/removing nodes, saving a new `.inp`, and proving the relationships survive reopen.

**Architecture:** Extend the semantic core with one atomic `editPuppet` transaction containing typed domain operations. Public hierarchy references are canonical node paths and texture references used during mutation are request-local aliases, never raw GUIDs, slots, pointers, or native handles. The process-isolated native host loads the input puppet, applies the complete transaction to pinned Inochi2D state, writes to a new output path, reopens it, and returns the existing semantic inspection snapshot extended with content-addressed texture/Part relationships.

**Tech Stack:** Node.js 22+, TypeScript 5.x, Vitest, DUB, LDC 1.40.0 in CI, pinned Inochi2D `fdb241da048dbe330152f7b0015e2129dc392844` / `v0.8.7`, `TextureData.load`, `TextureCache`, `Node`, `Part`, `MeshData`, process-isolated D native host, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-13-inochi-agent-tools-v1-design.md`

## Global Constraints

- The project remains public and general-purpose; no Away-specific names, metadata, character concepts, or gameplay assumptions.
- Exact upstream authority remains Inochi2D `fdb241da048dbe330152f7b0015e2129dc392844` (`v0.8.7`) with the checked patch manifest and reproducible native dependency lock.
- Public operations are semantic. No GUIDs, texture slot integers, `in_*` handles, allocators, pointers, memory offsets, or D objects cross the public API.
- Node references use canonical paths such as `/Root/Body/Face`; mutation rejects ambiguous/invalid relationships rather than exposing GUIDs.
- Texture mutation references are aliases scoped to one `editPuppet` transaction. Persistent inspection identifies textures by a content fingerprint derived from decoded texture content, not the upstream texture-slot number.
- The input `.inp` is never mutated in place in this milestone. `inputPath` and `outputPath` must differ and the output must not already exist.
- A failed transaction must not leave an accepted partial output. If writing/reopen/validation fails after output creation, delete that newly created output before returning failure.
- Real acceptance uses a genuine PNG decoded by pinned Inochi2D and a genuine `.inp` written/reopened by pinned Inochi2D. Fake JSON is unit-test-only evidence.
- Existing M0 and M1 inspection/create gates must remain green.
- Strict RED -> GREEN TDD applies to every behavior slice.
- Parameter creation/binding belongs to #7 and official Creator compatibility belongs to #8; neither is implemented here.

---

## Upstream Facts Bound Into This Plan

Pinned Inochi2D v0.8.7 already exposes the primitives needed for the intended path:

- `TextureData.load(ubyte[])` decodes image bytes to R8 or RGBA8 texture data.
- `Texture.createForData(TextureData)` creates a real Inochi texture.
- `Puppet.textureCache.add(Texture)` adds it to the serialized texture cache.
- `Part(MeshData, Texture[], Node parent)` creates a textured Part.
- `Node.parent`, `Node.addChild`, and `Node.insertInto` maintain parent/child relationships and rescan the puppet.
- `inWriteINPPuppet` serializes texture-cache entries and Parts into the real INP artifact.
- `inLoadPuppet` reloads texture blobs and reconstructs Part texture references.

Do not add an upstream patch merely because authoring is new. Add one only if a RED integration probe demonstrates a concrete pinned-upstream defect, then document its reason/removal condition in `native/patches/manifest.json`.

---

## Public Semantic Contract Locked by #6

```ts
export type VisualEditOperation =
  | { type: 'texture.import'; key: string; imagePath: string }
  | { type: 'node.create'; parentPath: string; name: string }
  | { type: 'part.create'; parentPath: string; name: string; textureKey: string }
  | { type: 'part.setTexture'; path: string; textureKey: string }
  | { type: 'node.reparent'; path: string; newParentPath: string }
  | { type: 'node.remove'; path: string };

export interface EditPuppetRequest {
  inputPath: string;
  outputPath: string;
  operations: VisualEditOperation[];
}

export interface EditPuppetResult {
  path: string;
  inspection: PuppetInspection;
}

export async function editPuppet(
  request: EditPuppetRequest,
  options?: NativeHostOptions,
): Promise<EditPuppetResult>;
```

Transaction-local texture `key` values are deliberately human/agent-readable aliases such as `"face"`. They exist only while applying that transaction and are never serialized as an implementation handle.

Persistent inspection gains additive semantic data while retaining native schema version `1`:

```ts
export interface PuppetInspectionTexture {
  ref: string;             // `sha256:<lowercase hex>` over format + dimensions + decoded pixels
  width: number;
  height: number;
  format: 'rgba8' | 'r8' | 'unknown';
}

export interface PuppetInspectionNodeTexture {
  usage: 'albedo' | 'emissive' | 'bumpmap';
  ref: string;
}

export interface PuppetInspectionNode {
  path: string;
  name: string;
  kind: 'node' | 'part' | 'other';
  childCount: number;
  textures: PuppetInspectionNodeTexture[];
}

export interface PuppetInspection {
  // existing fields remain
  textures: PuppetInspectionTexture[];
}
```

For backwards-compatible narrow parser fixtures, absent `textures` arrays normalize to `[]`; the real native host always emits them after Task 1.

Typed errors added in this issue:

```ts
InvalidHierarchyError   // bad/missing/ambiguous path, cycle, root removal/reparent, duplicate sibling name
MissingTextureError     // unknown transaction texture alias
InvalidTextureAssetError // missing/non-PNG/undecodable asset
```

Output collision continues to use `PuppetAlreadyExistsError`; malformed native protocol/process failures continue to use `NativeBridgeError`; post-save semantic mismatch uses `RoundTripMismatchError`.

---

## File Structure Added/Modified by #6

```text
packages/core/src/
  visual-authoring.ts                 # typed edit transaction + host adapter
  inspection.ts                       # texture/Part relationship inventory
  errors.ts                           # hierarchy/texture errors
  index.ts                            # semantic exports

packages/core/test/
  visual-authoring.test.ts            # request/path/alias unit RED→GREEN
  inspection-textures.test.ts         # additive inspection parser contract
  edit-real-puppet.test.ts            # real PNG + real INP round-trip acceptance

native/bridge/source/
  iat_bridge.d                        # texture fingerprints + atomic visual mutation command

native/bridge/test/
  visual_authoring_probe.d            # separately linked real PNG/Part/hierarchy proof

native/host/source/
  iat_native_host.d                   # `edit-visual` process command

scripts/fixtures/
  write-m2-png.mjs                    # deterministic genuine 2x2 RGBA PNG fixture

scripts/native/
  build-host.mjs                      # build/run M2 probe
  m2-visual-ci.mjs                    # compose prior gates + #6 real acceptance

package.json
.github/workflows/verify.yml
README.md
```

Generated PNG/INP outputs live under `tests/fixtures/generated/` and remain outside source authority.

---

### Task 1: Extend semantic inspection with stable texture/Part relationships

**Files:**
- Modify: `packages/core/src/inspection.ts`
- Modify: `native/bridge/source/iat_bridge.d`
- Create: `packages/core/test/inspection-textures.test.ts`
- Modify: existing inspection tests only where the new additive fields require normalization assertions.

**Interfaces:**
- Produces `PuppetInspectionTexture` and `PuppetInspectionNodeTexture` exactly as defined above.
- Native inspection computes `sha256:` refs from texture `format`, `width`, `height`, and decoded pixel bytes in that order.
- A Part reports only non-null bindings for `albedo`, `emissive`, and `bumpmap`; ordinary Nodes report `textures: []`.

- [ ] **Step 1: Write the parser RED**

Add a fixture containing one texture and one Part:

```ts
const parsed = parsePuppetInspection({
  schemaVersion: 1,
  metadata: { name: 'Visual', inochiVersion: 'v0.8.7', rigger: '', artist: '' },
  nodes: [
    { path: '/Root', name: 'Root', kind: 'node', childCount: 1 },
    {
      path: '/Root/Face', name: 'Face', kind: 'part', childCount: 0,
      textures: [{ usage: 'albedo', ref: `sha256:${'a'.repeat(64)}` }],
    },
  ],
  parameters: [],
  textures: [{ ref: `sha256:${'a'.repeat(64)}`, width: 2, height: 2, format: 'rgba8' }],
  textureCount: 1,
  summary: { nodeCount: 2, partCount: 1, parameterCount: 0, textureCount: 1 },
});
expect(parsed.textures).toHaveLength(1);
expect(parsed.nodes[1]?.textures[0]?.usage).toBe('albedo');
```

Run: `npm test -- packages/core/test/inspection-textures.test.ts`

Expected: FAIL because the parser/type does not expose semantic texture relationships.

- [ ] **Step 2: Implement additive TypeScript parsing**

Validate refs with `/^sha256:[0-9a-f]{64}$/`, dimensions as positive integers, formats as the three allowed strings, and usage as the three allowed usage names. Normalize absent node/top-level texture arrays to `[]` so old narrow unit fixtures remain readable.

- [ ] **Step 3: Add native fingerprint and relationship emission**

In `iat_bridge.d`, implement a private helper that feeds `format`, `width`, `height`, then `cast(ubyte[])texture.pixels` into `std.digest.sha.SHA256`; encode the digest as lowercase hex prefixed with `sha256:`. Build the top-level texture list from `puppet.textureCache.cache`. For `Part`, map each non-null `part.textures[TextureUsage.*]` to the matching content ref.

Do not expose texture-cache indices in JSON.

- [ ] **Step 4: Run existing + new inspection gates**

Run:

```bash
npm run verify
npm run m1:ci
```

Expected: all prior M1 behavior remains green and real host snapshots now include texture arrays (empty for the existing M1 fixture).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/inspection.ts packages/core/test native/bridge/source/iat_bridge.d
git commit -m "feat: inspect semantic texture relationships"
```

---

### Task 2: Import a real PNG and create a textured Part in one atomic edit transaction

**Files:**
- Create: `scripts/fixtures/write-m2-png.mjs`
- Create: `native/bridge/test/visual_authoring_probe.d`
- Modify: `native/bridge/source/iat_bridge.d`
- Modify: `scripts/native/build-host.mjs`
- Modify: `package.json`

**Interfaces:**
- Add private C ABI:

```c
int iat_edit_visual_puppet_json(
  const char* input_path,
  const char* output_path,
  const char* operations_json,
  char** out_json,
  char** out_error
);
```

- First supported operations are `texture.import`, `node.create`, and `part.create` from the public contract.
- Native success returns the reopened semantic inspection JSON.
- Native semantic exit codes: `7` invalid hierarchy, `8` missing texture alias, `9` invalid texture asset, `6` round-trip mismatch. Existing `5` remains output-exists.

- [ ] **Step 1: Generate a deterministic genuine PNG fixture**

`scripts/fixtures/write-m2-png.mjs` decodes a checked constant base64 representation of a valid 2x2 RGBA PNG and writes only `tests/fixtures/generated/m2-checker.png`. The script then verifies the file starts with the 8-byte PNG signature `89 50 4e 47 0d 0a 1a 0a`.

Add root script:

```json
"m2:png": "node scripts/fixtures/write-m2-png.mjs"
```

- [ ] **Step 2: Write the separately linked native RED probe**

The probe starts from a minimal `.inp` produced by the already-green #5 path, then calls `iat_edit_visual_puppet_json` with:

```json
[
  {"type":"texture.import","key":"face","imagePath":"tests/fixtures/generated/m2-checker.png"},
  {"type":"node.create","parentPath":"/Root","name":"Body"},
  {"type":"part.create","parentPath":"/Root/Body","name":"Face","textureKey":"face"}
]
```

It must assert output exists/non-empty and returned JSON contains `/Root/Body/Face`, one texture, and the Face Part's albedo ref matching that texture.

Run: `npm run m2:visual-probe`

Expected: linker FAIL because `iat_edit_visual_puppet_json` does not exist.

- [ ] **Step 3: Implement texture decode and transaction-local aliases**

For `texture.import`:

```d
ubyte[] encoded = cast(ubyte[])read(imagePath);
auto data = TextureData.load(encoded);
auto texture = Texture.createForData(data);
auto slot = puppet.textureCache.add(texture);
texturesByKey[key] = texture;
```

Reject duplicate/blank keys, non-`.png` paths, missing files, or decode failure as code `9`. `slot` stays private and is never returned.

- [ ] **Step 4: Implement node and Part creation**

Resolve `parentPath` by traversing names from `/Root`; reject missing/ambiguous paths and duplicate sibling names as code `7`.

For `part.create`, lookup the request-local texture alias or return code `8`. Build a rectangular mesh matching texture dimensions:

```d
MeshData mesh;
float halfW = texture.width / 2.0f;
float halfH = texture.height / 2.0f;
mesh.vertices = [vec2(-halfW,-halfH), vec2(halfW,-halfH), vec2(halfW,halfH), vec2(-halfW,halfH)];
mesh.uvs = [vec2(0,1), vec2(1,1), vec2(1,0), vec2(0,0)];
mesh.indices = [0,1,2, 2,3,0];
auto part = new Part(mesh, [texture], parent);
part.name = name;
```

Preserve the texture's ownership/refcount contract across cache + Part lifetime; the integration probe must survive save/reopen/disposal without native failure.

- [ ] **Step 5: Save to a new output and reopen before success**

Reject `inputPath == outputPath` and pre-existing output before mutation. Write via official `inWriteINPPuppet`; reopen via official `inLoadPuppet`; verify expected node paths, texture count, and Part texture fingerprint. On post-write failure, remove the newly-created output before returning an error.

- [ ] **Step 6: Turn the same probe GREEN**

Run: `npm run m2:visual-probe`

Expected: PASS with real PNG decode, real texture cache entry, real Part mesh, real `.inp`, and reopened relationship evidence.

- [ ] **Step 7: Commit**

```bash
git add scripts/fixtures native/bridge scripts/native package.json
git commit -m "feat: author textured Parts from PNG assets"
```

---

### Task 3: Add safe reparent, remove, and texture reassignment semantics

**Files:**
- Modify: `native/bridge/source/iat_bridge.d`
- Modify: `native/bridge/test/visual_authoring_probe.d`
- Create: `packages/core/test/visual-authoring.test.ts`
- Modify: `packages/core/src/errors.ts`

**Interfaces:**
- Add operations `node.reparent`, `node.remove`, and `part.setTexture` exactly as specified in the public contract.
- Produce `InvalidHierarchyError`, `MissingTextureError`, and `InvalidTextureAssetError` above the native boundary.

- [ ] **Step 1: Add hierarchy RED cases to the native probe**

The same transaction must demonstrate a valid sequence:

```json
[
  {"type":"texture.import","key":"face","imagePath":".../m2-checker.png"},
  {"type":"node.create","parentPath":"/Root","name":"Body"},
  {"type":"node.create","parentPath":"/Root","name":"Accessories"},
  {"type":"part.create","parentPath":"/Root/Body","name":"Face","textureKey":"face"},
  {"type":"node.reparent","path":"/Root/Body/Face","newParentPath":"/Root/Accessories"},
  {"type":"part.setTexture","path":"/Root/Accessories/Face","textureKey":"face"},
  {"type":"node.remove","path":"/Root/Body"}
]
```

Expected final inventory: `/Root/Accessories/Face` exists and is textured; `/Root/Body` does not.

Also add failing probes for: missing parent, root reparent/remove, reparent under self/descendant, duplicate sibling name, setting texture on non-Part, and unknown texture alias.

- [ ] **Step 2: Implement path resolution with explicit ambiguity rejection**

Resolve each path segment among direct children. Zero matches => invalid hierarchy; more than one match => ambiguous hierarchy. Never select "first match" silently.

- [ ] **Step 3: Implement safe reparent/remove**

Reject root mutation. Before reparenting, walk `newParent.parent` upward; if the target node is encountered, reject the cycle. For valid reparent use Inochi's parent relationship API so child arrays/rescans remain consistent. For remove, detach from parent; do not expose or accept a GUID.

- [ ] **Step 4: Implement `part.setTexture`**

Require target to be `Part` and alias to exist. Release any prior albedo texture reference according to upstream refcount semantics, retain/assign the new texture, then verify the reopened Part fingerprint equals the selected imported texture fingerprint.

- [ ] **Step 5: Add TypeScript typed-error unit RED/GREEN**

Use fake hosts with exits `7`, `8`, and `9` and assert `InvalidHierarchyError`, `MissingTextureError`, and `InvalidTextureAssetError`. Unknown exits remain `NativeBridgeError`.

- [ ] **Step 6: Run native probe**

Run: `npm run m2:visual-probe`

Expected: valid hierarchy mutation GREEN and every invalid relationship fails closed with the intended code.

- [ ] **Step 7: Commit**

```bash
git add native/bridge packages/core
git commit -m "feat: enforce semantic hierarchy mutations"
```

---

### Task 4: Expose `editPuppet` through the process host and prove real end-to-end authoring

**Files:**
- Create: `packages/core/src/visual-authoring.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `native/host/source/iat_native_host.d`
- Create: `packages/core/test/edit-real-puppet.test.ts`
- Create: `scripts/native/m2-visual-ci.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/verify.yml`
- Modify: `README.md`

**Interfaces:**
- Public `editPuppet` matches the locked contract above.
- Private host command:

```text
iat_native_host edit-visual <input.inp> <output.inp> <operations-json>
```

- Core maps host exits: `5 -> PuppetAlreadyExistsError`, `6 -> RoundTripMismatchError`, `7 -> InvalidHierarchyError`, `8 -> MissingTextureError`, `9 -> InvalidTextureAssetError`; all other failures -> `NativeBridgeError`.

- [ ] **Step 1: Write TypeScript adapter RED**

Unit-test request validation before spawn:
- input/output must be `.inp` and must differ;
- operations must be non-empty;
- names/keys/paths must be nonblank and NUL-free;
- texture aliases used by Part operations must be strings (native still owns existence validation).

The valid fake-host path initially fails because `editPuppet` does not exist.

- [ ] **Step 2: Add host command RED then GREEN**

Add `m2:visual-host` probe to `build-host.mjs` that invokes `edit-visual` and expects the same reopened semantic output as the native probe. Establish RED on the old host dispatch, then add the host command as a thin adapter over `iat_edit_visual_puppet_json`.

- [ ] **Step 3: Implement `editPuppet` process adapter**

Use `execFile` with no shell, the existing native library environment, UTF-8 output, and 16 MiB capture bound. Serialize only the typed `operations` array to JSON. Parse success through `parsePuppetInspection`; reject protocol corruption as `NativeBridgeError`.

- [ ] **Step 4: Add real public integration acceptance**

`edit-real-puppet.test.ts`, gated by `IAT_M2_VISUAL_TESTS=1`, must:
1. create a minimal input through the already-green `createPuppet`;
2. generate/use the real PNG;
3. call `editPuppet` with import + Body + Accessories + textured Face + reparent + remove sequence;
4. reopen output with `inspectPuppet`;
5. assert full snapshot equality with `editPuppet` result;
6. assert `/Root/Accessories/Face` is a Part with albedo fingerprint matching the one top-level imported texture;
7. assert `/Root/Body` is absent;
8. assert second write to same output fails without overwrite.

- [ ] **Step 5: Create the exact #6 acceptance gate**

`scripts/native/m2-visual-ci.mjs` must run, in order:

```text
npm run m1:authoring:ci
npm run m2:png
npm run m2:visual-probe
npm run m2:visual-host
npm run typecheck
IAT_M1_NATIVE_TESTS=1 IAT_M1_AUTHORING_TESTS=1 IAT_M2_VISUAL_TESTS=1 npm test
```

Clean only the known generated #6 artifacts before running. Do not wildcard-delete user paths.

Expose:

```json
"m2:visual:ci": "node scripts/native/m2-visual-ci.mjs"
```

Change the native GitHub Actions job from `npm run m1:authoring:ci` to `npm run m2:visual:ci`.

- [ ] **Step 6: Document the semantic boundary**

README must show the `editPuppet` transaction example and explicitly state:
- paths are semantic hierarchy references;
- texture keys are request-local aliases;
- persistent inspection uses content fingerprints;
- no GUID/slot/pointer API is public;
- #7 owns parameters/bindings.

- [ ] **Step 7: Full exact-head verification and completion gate**

Run/verify on exact PR head:

```bash
npm run verify
npm run m2:visual:ci
```

Then confirm:
- PR is mergeable and current with `main`;
- 0 unresolved review threads;
- changed files are only #6 scope;
- real PNG + real `.inp` evidence is present in CI logs;
- no upstream patch was added without a demonstrated pinned defect and documented removal condition.

Only then mark Ready, merge, close #6, and unblock #7.

- [ ] **Step 8: Commit**

```bash
git add packages/core native/host scripts/native package.json .github/workflows/verify.yml README.md
git commit -m "feat: expose visual hierarchy authoring"
```

---

## #6 Definition of Done

Issue #6 is complete only when a clean exact-head run proves:

```text
minimal real .inp
  + genuine PNG
  -> semantic editPuppet transaction
  -> decode/import texture
  -> create hierarchy + textured Part
  -> reparent/remove safely by semantic paths
  -> save new real .inp
  -> reopen through pinned Inochi2D
  -> semantic inventory contains persistent texture fingerprint + Part relationship
  -> invalid hierarchy/texture refs fail with typed errors
  -> no raw GUID/slot/pointer appears in public mutation API
```

Parameters/bindings and official Creator compatibility remain blocked behind #7 and #8 respectively.
