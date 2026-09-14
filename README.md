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
```

`m1:ci` includes the M0 provenance/native bridge gate, generates a genuine `.inp` fixture with pinned Inochi2D serialization, proves semantic inspection through a separately linked bridge probe and process-isolated native host, then runs the TypeScript semantic and repeated-lifecycle acceptance suite.

## Read-only puppet inspection

M1 exposes `inspectPuppet(filePath)` and `validatePuppet(filePath)` from `@inochi-agent-tools/core`. Both are read-only semantic operations: they return stable metadata, node/Part inventory, parameters, texture counts, and summary data without exposing Inochi2D pointers, allocators, raw `in_*` handles, GUID pointers, or memory offsets.

The Node/agent process does not load the D shared library directly. Inspection runs in `.build/native/iat_native_host`, which calls the private D/C ABI bridge and returns a bounded semantic JSON snapshot. Malformed puppets fail as `InvalidPuppetError`; host/process/protocol failures become `NativeBridgeError`.

The real-artifact acceptance path uses official serialization from the exact pinned Inochi2D revision. Synthetic data is used only for narrow parser/adapter tests and does not substitute for `.inp` compatibility proof.

Create/save authoring is intentionally not part of the M1 public API. That work belongs to Issue #5.

See `docs/superpowers/specs/2026-09-13-inochi-agent-tools-v1-design.md` for the approved v1 design, `docs/superpowers/plans/2026-09-13-m0-foundation-upstream-contract.md` for M0, and `docs/superpowers/plans/2026-09-14-m1-open-inspect-validate.md` for the current M1 plan.
