# inochi-agent-tools

Public, general-purpose headless authoring tools for Inochi2D puppets.

The project is building one semantic authoring core with CLI, MCP, and TypeScript SDK adapters. Native capabilities sit behind an isolated D/C ABI bridge over a pinned Inochi2D revision; public APIs do not expose raw pointers or allocator details.

Current foundation authority:

- Inochi2D `v0_8` commit `fdb241da048dbe330152f7b0015e2129dc392844` (`v0.8.7`)
- LDC `1.40.0` for the reproducible CI build; the bridge contract requires LDC >= `1.40.0`
- native D dependencies are locked by `native/bridge/dub.selections.json`

## Verification

From a clean checkout with Node 22+, LDC/DUB, Git, Xvfb, and xdotool available:

```bash
npm ci
npm run verify
npm run m1:ci
npm run m1:authoring:ci
npm run m2:visual:ci
npm run m2:parameter:ci
npm run m2:creator:ci
```

`m1:ci` preserves the read-only M1 inspection acceptance gate. `m1:authoring:ci` composes that gate with a separately linked native create/write/reopen probe, the process-isolated create host contract, and the real public `createPuppet` integration test. `m2:visual:ci` composes all prior gates with a genuine PNG decode/import, native hierarchy mutation probe, process-host proof, and public `editPuppet` real-artifact integration test. `m2:parameter:ci` adds real parameter/binding serialization, create/bind/unbind probes, runtime set/readback/restore, and the public end-to-end parameter acceptance test. `m2:creator:ci` is the authoritative M2 compatibility gate: it composes the parameter gate with the pinned official Creator materialization, real full fixture construction, staged Creator-open proofs, Creator's normal Save operation, and headless semantic/evaluation verification of the Creator-produced artifact.

## Read-only puppet inspection

M1 exposes `inspectPuppet(filePath)` and `validatePuppet(filePath)` from `@inochi-agent-tools/core`. Both are read-only semantic operations: they return stable metadata, node/Part inventory, parameters, texture inventory/relationships, and summary data without exposing Inochi2D pointers, allocators, raw `in_*` handles, GUID pointers, texture slots, or memory offsets.

The Node/agent process does not load the D shared library directly. Inspection runs in `.build/native/iat_native_host`, which calls the private D/C ABI bridge and returns a bounded semantic JSON snapshot. Malformed puppets fail as `InvalidPuppetError`; host/process/protocol failures become `NativeBridgeError`.

## Minimal puppet creation

`createPuppet({ outputPath, name })` creates a canonical minimal puppet, writes a genuine `.inp` using the exact pinned Inochi2D `inWriteINPPuppet` implementation, reopens it through the pinned loader, and returns the reopened semantic inspection snapshot.

Creation fails closed when the name is blank or contains NUL, when the target is not an `.inp` path, when the target already exists, or when the saved puppet does not semantically round-trip. Existing files are never overwritten by `createPuppet`.

## Visual hierarchy authoring

`editPuppet({ inputPath, outputPath, operations })` applies one atomic semantic visual-edit transaction to an existing puppet and writes a new genuine `.inp`. The input is never modified in place and an existing output is never overwritten.

Example:

```ts
await editPuppet({
  inputPath: 'puppet.inp',
  outputPath: 'puppet-with-face.inp',
  operations: [
    { type: 'texture.import', key: 'face', imagePath: 'face.png' },
    { type: 'node.create', parentPath: '/Root', name: 'Body' },
    { type: 'node.create', parentPath: '/Root', name: 'Accessories' },
    { type: 'part.create', parentPath: '/Root/Body', name: 'Face', textureKey: 'face' },
    { type: 'node.reparent', path: '/Root/Body/Face', newParentPath: '/Root/Accessories' },
    { type: 'part.setTexture', path: '/Root/Accessories/Face', textureKey: 'face' },
    { type: 'node.remove', path: '/Root/Body' },
  ],
});
```

Hierarchy references such as `/Root/Accessories/Face` are semantic paths, not GUIDs. Texture keys such as `face` are human-readable aliases scoped only to the current request. Persistent inspection identifies textures with content-derived `sha256:` fingerprints and reports semantic Part usages such as `albedo`; texture-cache slot numbers never become public API.

Invalid/missing/ambiguous paths and unsafe cycles fail as `InvalidHierarchyError`; unknown request-local texture keys fail as `MissingTextureError`; missing/non-PNG/undecodable texture assets fail as `InvalidTextureAssetError`. The native host remains process-isolated and its captured output is bounded to 16 MiB.

## Parameter creation, binding, and evaluation

Parameter authoring uses the same `editPuppet` transaction and semantic node paths. A parameter can be created as 1D or 2D with explicit ranges/defaults, bound to a documented semantic node property, and unbound without exposing Inochi GUIDs or binding pointers.

```ts
await editPuppet({
  inputPath: 'puppet.inp',
  outputPath: 'puppet-rigged.inp',
  operations: [
    { type: 'node.create', parentPath: '/Root', name: 'Rig' },
    { type: 'parameter.create', name: 'Move X', dimensions: 1, min: [-1, 0], max: [1, 0], defaultValue: [0, 0] },
    {
      type: 'parameter.bind',
      parameterName: 'Move X',
      targetPath: '/Root/Rig',
      property: 'transform.t.x',
      keypoints: [{ at: [-1, 0], value: -20 }, { at: [1, 0], value: 20 }],
    },
  ],
});
```

`inspectPuppet` reports persisted bindings semantically as parameter name, canonical target path, documented property name, and authored keypoints. `evaluateParameterValues({ inputPath, values })` is transient and process-isolated: it opens the puppet, applies requested parameter values through pinned Inochi2D's real `Puppet.update(0)` runtime path, reads the resulting target property offsets, restores parameter defaults through the same runtime path, then exits without writing the puppet.

```ts
const result = await evaluateParameterValues({
  inputPath: 'puppet-rigged.inp',
  values: { 'Move X': [1, 0] },
});
```

Unknown parameters, invalid ranges, unsupported properties, malformed keypoints, duplicate definitions, and invalid/unavailable bindings fail as `InvalidBindingError`. Public parameter workflows use names, semantic node paths, and documented properties only; GUIDs, raw native handles, pointers, and allocator APIs remain private to the bridge.

## Official Inochi Creator compatibility

The v1 compatibility target is the official Inochi Creator `v0.8.6` Linux release asset ID `193284190`. Tool-authored artifacts remain generated by the pinned Inochi2D `v0.8.7` commit above. `npm run m2:creator:ci` downloads and verifies that exact Creator asset, constructs a real `.inp` through the public semantic core using a real PNG, proves the staged artifacts open in Creator under isolated Xvfb, triggers Creator's normal Save command, then reopens the Creator-produced `.inx` headlessly and verifies hierarchy, Part/texture relationships, parameter bindings, and real set/readback/restore behavior.

Creator GUI automation is acceptance infrastructure only. It does not enter the public semantic API, runtime contract, CLI, MCP, or SDK surface. CLI/MCP are later adapters over the same semantic core rather than independent implementations.

The real-artifact acceptance path uses official serialization from the exact pinned Inochi2D revision. Synthetic data is used only for narrow parser/adapter tests and does not substitute for `.inp` compatibility proof.

See `docs/superpowers/specs/2026-09-13-inochi-agent-tools-v1-design.md` for the approved v1 design, `docs/superpowers/plans/2026-09-13-m0-foundation-upstream-contract.md` for M0, `docs/superpowers/plans/2026-09-14-m1-open-inspect-validate.md` for M1 inspection, `docs/superpowers/plans/2026-09-14-m1-create-save-reopen.md` for minimal creation, `docs/superpowers/plans/2026-09-14-m2-texture-part-hierarchy.md` for visual hierarchy authoring, `docs/superpowers/plans/2026-09-14-m2-parameter-binding.md` for parameter authoring/evaluation, and `docs/superpowers/plans/2026-09-14-m2-creator-roundtrip.md` for the official Creator compatibility gate.
