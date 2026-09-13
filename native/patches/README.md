# Native patch policy

`inochi-agent-tools` consumes a pinned upstream Inochi2D revision. Patches are a last-resort compatibility mechanism, not a private fork.

`manifest.json` is the ordered authority for patches. Every future patch entry must contain:

- `file`: patch file path relative to this directory;
- `reason`: the concrete authoring capability blocked without it;
- `removalCondition`: the upstream condition that lets us delete it.

Patch order is manifest order. Every entry must resolve to a file inside `native/patches/`; path traversal is rejected. A patch must be covered by an integration test for the capability that requires it.
