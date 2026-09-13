# inochi-agent-tools

Public, general-purpose headless authoring tools for Inochi2D puppets.

The project is building one semantic authoring core with CLI, MCP, and TypeScript SDK adapters. Native capabilities sit behind an isolated D/C ABI bridge over a pinned Inochi2D revision; public APIs do not expose raw pointers or allocator details.

Current foundation authority:

- Inochi2D `v0_8` commit `fdb241da048dbe330152f7b0015e2129dc392844` (`v0.8.7`)
- LDC `1.40.0` for the reproducible M0 CI build; the bridge contract requires LDC >= `1.40.0`
- native D dependencies are locked by `native/bridge/dub.selections.json`

## Foundation verification

From a clean checkout with Node 22+, LDC/DUB, and Git available:

```bash
npm ci
npm run verify
npm run native:ci
```

`native:ci` materializes the exact pinned Inochi2D source, verifies its SHA/version, validates the native toolchain, builds the shared D/C ABI bridge, links and executes a separate probe that must read `v0.8.7` through the bridge, and prints the provenance fingerprint.

See `docs/superpowers/specs/2026-09-13-inochi-agent-tools-v1-design.md` for the approved v1 design and `docs/superpowers/plans/2026-09-13-m0-foundation-upstream-contract.md` for the current implementation plan.
