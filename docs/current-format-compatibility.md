# Current-format compatibility lane

Issue #35 adds an **isolated compatibility lane**. It does not replace the accepted production authoring path.

## Lanes and provenance

- Stable production authoring remains pinned to **Inochi2D v0.8.7** at `fdb241da048dbe330152f7b0015e2129dc392844` via `upstream/inochi2d.json`.
- The experimental conversion lane is pinned independently to **Inochi2D v0.9.0** at `ba2b1413c68d9f7bf575fef790ba0c35715558db` via `upstream/inochi2d-current.json`.
- GitHub Verify uses Node 22 and LDC 1.40.0. The current lane is materialized into `.deps/inochi2d-current`, so it cannot silently replace the stable `.deps/inochi2d` authoring source.
- Exact compatibility patches, reasons, target files, and removal conditions live in `native/current-patches/manifest.json`.

The conversion path uses upstream semantic APIs: detect/read the authored INP, load it as a Puppet, serialize the Puppet model, and write with the upstream current-format writer. The acceptance gate checks the resulting format signature; it does not patch magic bytes or hand-author binary records.

## Proven current-format capability

The v1.7 acceptance starts from the real multi-Part v1.6 artifact rather than a synthetic binary fixture. It proves, after current-upstream reload:

- two mutable 1D parameters (`Head X` and `Head Y`);
- preserved non-degenerate bounds/defaults and upgraded axis points;
- set -> readback -> restore on both parameters;
- preserved `Face` and `HairFront` node data;
- at least two preserved texture slots;
- repeated independent conversion and save/reload determinism;
- exact current-format output through the official writer.

The public core surface exposes only this high-level semantic status through `modelFormatCompatibilityCapabilities`. Commit pins, file signatures, native identities, patch mechanics, pointers, and allocator details stay private to the compatibility lane.

## Still legacy-only or unproven

Production authoring remains on the v0.8.7 lane. Creator compatibility and the existing Creator/v1 acceptance gates therefore remain attached to that stable lane.

The current-format proof does **not** claim direct production authoring, parameter-binding preservation, physics-authoring preservation, or Creator roundtrip on the v0.9 lane. Those capabilities stay explicitly unproven until a real acceptance artifact demonstrates them. Downstream issue #29 may consume the proven conversion capability, but it must not treat unproven semantics as supported.
