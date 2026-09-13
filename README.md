# inochi-agent-tools

Public, general-purpose headless authoring tools for Inochi2D puppets.

The project is building one semantic authoring core with CLI, MCP, and TypeScript SDK adapters. Native capabilities sit behind an isolated D/C ABI bridge over a pinned Inochi2D revision; public APIs do not expose raw pointers or allocator details.

Current foundation pin: Inochi2D `v0_8` commit `fdb241da048dbe330152f7b0015e2129dc392844` (`v0.8.7`).

See `docs/superpowers/specs/2026-09-13-inochi-agent-tools-v1-design.md` for the approved v1 design and `docs/superpowers/plans/2026-09-13-m0-foundation-upstream-contract.md` for the current implementation plan.
