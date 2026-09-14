# inochi-agent-tools

Public, general-purpose headless authoring tools for Inochi2D puppets.

The project is building one semantic authoring core with CLI, MCP, and TypeScript SDK adapters. Native capabilities sit behind an isolated D/C ABI bridge over a pinned Inochi2D revision; public APIs do not expose raw pointers or allocator details.

Current foundation authority:

- Inochi2D `v0_8` commit `fdb241da048dbe330152f7b0015e2129dc392844` (`v0.8.7`)
- LDC `1.40.0` for the reproducible CI build; the bridge contract requires LDC >= `1.40.0`
- native D dependencies are locked by `native/bridge/dub.selections.json`

## Verification

From a clean checkout with Node 22+, LDC/DUB, and Git available:

```bash
npm ci
npm run verify
npm run m1:ci
npm run m1:authoring:ci
```

`m1:ci` preserves the read-only M1 inspection acceptance gate. `m1:authoring:ci` composes that gate with a separately linked native create/write/reopen probe, the process-isolated create host contract, and the real public `createPuppet` integration test.

## Read-only puppet inspection

M1 exposes `inspectPuppet(filePath)` and `validatePuppet(filePath)` from `@inochi-agent-tools/core`. Both are read-only semantic operations: they return stable metadata, node/Part inventory, parameters, texture counts, and summary data without exposing Inochi2D pointers, allocators, raw `in_*` handles, GUID pointers, or memory offsets.

The Node/agent process does not load the D shared library directly. Inspection runs in `.build/native/iat_native_host`, which calls the private D/C ABI bridge and returns a bounded semantic JSON snapshot. Malformed puppets fail as `InvalidPuppetError`; host/process/protocol failures become `NativeBridgeError`.

## Minimal puppet creation

`createPuppet({ outputPath, name })` is the first intentionally small authoring primitive. It creates a canonical minimal puppet, writes a genuine `.inp` using the exact pinned Inochi2D `inWriteINPPuppet` implementation, reopens it through the pinned loader, and returns the reopened semantic inspection snapshot.

This operation is deliberately narrow: Issue #5 supports metadata plus the canonical root only. Texture/Part/arbitrary hierarchy authoring belongs to Issue #6, and parameters/bindings belong to Issue #7.

Creation fails closed when the name is blank or contains NUL, when the target is not an `.inp` path, when the target already exists, or when the saved puppet does not semantically round-trip. Existing files are never overwritten by `createPuppet`.

Both inspection and authoring stay behind the process-isolated native host. The public TypeScript surface never owns a D object or native pointer, and host output is bounded to 16 MiB.

The real-artifact acceptance path uses official serialization from the exact pinned Inochi2D revision. Synthetic data is used only for narrow parser/adapter tests and does not substitute for `.inp` compatibility proof.

See `docs/superpowers/specs/2026-09-13-inochi-agent-tools-v1-design.md` for the approved v1 design, `docs/superpowers/plans/2026-09-13-m0-foundation-upstream-contract.md` for M0, `docs/superpowers/plans/2026-09-14-m1-open-inspect-validate.md` for M1 inspection, and `docs/superpowers/plans/2026-09-14-m1-create-save-reopen.md` for the current authoring slice.
