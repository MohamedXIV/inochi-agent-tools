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
npm run m3:cli:ci
npm run m3:mcp:ci
```

`m1:ci` preserves the read-only M1 inspection acceptance gate. `m1:authoring:ci` composes that gate with a separately linked native create/write/reopen probe, the process-isolated create host contract, and the real public `createPuppet` integration test. `m2:visual:ci` composes all prior gates with a genuine PNG decode/import, native hierarchy mutation probe, process-host proof, and public `editPuppet` real-artifact integration test. `m2:parameter:ci` adds real parameter/binding serialization, create/bind/unbind probes, runtime set/readback/restore, and the public end-to-end parameter acceptance test. `m2:creator:ci` is the authoritative M2 compatibility gate: it composes the parameter gate with the pinned official Creator materialization, real full fixture construction, staged Creator-open proofs, Creator's normal Save operation, and headless semantic/evaluation verification of the Creator-produced artifact. `m3:cli:ci` is the authoritative M3 CLI gate: it first preserves the full Creator compatibility gate, then typechecks/builds the CLI and runs its public contract plus spawned real-artifact authoring/evaluation workflow. `m3:mcp:ci` extends that same acceptance chain with the public SDK contract, stdio MCP protocol parity, and a spawned real MCP authoring workflow using real `.inp` and PNG artifacts.

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

## Command-line interface

M3 exposes the same semantic authoring core through the public `inochi-agent` CLI. The CLI does not call the D bridge, Creator, or native host directly and does not define a second authoring model.

Build it from the repository with:

```bash
npm run cli:build
```

The v1 command grammar is:

```text
inochi-agent puppet create   --output <file.inp> --name <name>
inochi-agent puppet open     --input <file.inp>
inochi-agent puppet inspect  --input <file.inp>
inochi-agent puppet validate --input <file.inp>
inochi-agent puppet save     --input <file.inp> --output <file.inp>
inochi-agent puppet edit     --input <file.inp> --output <file.inp> --operations <file.json|->
inochi-agent parameter evaluate --input <file.inp> --values <file.json|->
```

`puppet edit` accepts the public `PuppetEditOperation[]` JSON union used by the semantic core. `parameter evaluate` accepts a JSON object mapping parameter names to numeric pairs. For both commands, `-` means read UTF-8 JSON from stdin; otherwise the value is a UTF-8 JSON file path. The CLI validates only transport shape and leaves hierarchy, texture, parameter, binding, and artifact semantics to the core.

Use `--json` anywhere in the argument list for the stable automation envelope. Successful commands emit exactly one JSON object on stdout:

```json
{"ok":true,"command":"puppet inspect","result":{}}
```

Failures use the same single-object form:

```json
{"ok":false,"command":"puppet edit","error":{"code":"INVALID_HIERARCHY","message":"..."}}
```

Without `--json`, successful structured results are human-readable JSON and failures are concise diagnostics on stderr. Stack traces and native implementation handles are not part of the public output contract.

Stable v1 exit codes are:

| Exit | Code |
| ---: | --- |
| 0 | success |
| 1 | `UNEXPECTED_FAILURE` |
| 2 | `CLI_USAGE` |
| 10 | `INVALID_AUTHORING_REQUEST` |
| 11 | `INVALID_PUPPET` |
| 12 | `PUPPET_ALREADY_EXISTS` |
| 13 | `INVALID_HIERARCHY` |
| 14 | `MISSING_TEXTURE` |
| 15 | `INVALID_TEXTURE_ASSET` |
| 16 | `INVALID_BINDING` |
| 17 | `ROUND_TRIP_MISMATCH` |
| 18 | `UNSUPPORTED_UPSTREAM_VERSION` |
| 20 | `NATIVE_BRIDGE_FAILURE` |

The authoritative CLI acceptance is `npm run m3:cli:ci`. It includes the completed official Creator compatibility gate and then runs CLI typecheck/build/tests with the spawned real CLI workflow against genuine `.inp` and PNG artifacts, including Part creation, parameter bindings, runtime evaluation, restore, validation, save-as, and reopen.

## TypeScript SDK

The public package is `@inochi-agent-tools/sdk`. It is a thin typed facade over `@inochi-agent-tools/core`; it does not construct native protocol messages, serialize Inochi internals, or redefine authoring behavior.

From this workspace:

```bash
npm run sdk:build
```

Use `createAuthoringClient()` for the stable semantic client surface:

```ts
import { createAuthoringClient } from '@inochi-agent-tools/sdk';

const inochi = createAuthoringClient();
const inspection = await inochi.inspectPuppet({ inputPath: 'character.inp' });
const validation = await inochi.validatePuppet({ inputPath: 'character.inp' });
```

The v1 client methods are `createPuppet`, `inspectPuppet`, `validatePuppet`, `savePuppet`, `editPuppet`, and `evaluateParameters`. Inputs reuse the semantic core request types. Semantic errors retain their typed public codes; raw D/C ABI names, pointers, allocator APIs, memory offsets, and implementation-specific native handles are not part of SDK exports.

## MCP server

The public MCP package is `@inochi-agent-tools/mcp`. Build it with:

```bash
npm run mcp:build
```

Its executable is `inochi-agent-mcp` and the v1 transport is stdio only. The seven stable v1 tools are:

| Tool | Input shape |
| --- | --- |
| `puppet.create` | `{ outputPath, name }` |
| `puppet.open` | `{ inputPath }` |
| `puppet.inspect` | `{ inputPath }` |
| `puppet.validate` | `{ inputPath }` |
| `puppet.save` | `{ inputPath, outputPath }` |
| `puppet.edit` | `{ inputPath, outputPath, operations }` |
| `parameter.evaluate` | `{ inputPath, values }` |

`operations` is the same semantic `PuppetEditOperation[]` accepted by the core and CLI. `values` maps semantic parameter names to numeric value pairs. Tool schemas expose semantic paths, names, file paths, operation data, and values only; they never require Inochi GUIDs or native handles.

Successful tool results use:

```json
{"ok":true,"result":{}}
```

Known semantic failures preserve safe code/message/details:

```json
{"ok":false,"error":{"code":"INVALID_HIERARCHY","message":"..."}}
```

Malformed transport arguments are rejected before semantic dispatch. Unexpected adapter failures use one stable adapter failure envelope; stack traces and native implementation details are not returned in normal MCP responses.

A minimal stdio client configuration points its command at the built executable, for example:

```json
{
  "mcpServers": {
    "inochi-agent-tools": {
      "command": "inochi-agent-mcp",
      "args": []
    }
  }
}
```

The architecture boundary is intentionally one-way:

```text
CLI -> Core
SDK -> Core
MCP -> SDK -> Core -> Native Bridge -> pinned Inochi2D
```

CLI, SDK, and MCP therefore share one semantic authoring authority rather than implementing three authoring stacks. Runtime use remains separable from authoring, and Creator GUI automation remains acceptance infrastructure rather than a public dependency.

The authoritative M3 MCP acceptance command is `npm run m3:mcp:ci`. It preserves `m3:cli:ci`, then verifies SDK type/contracts, MCP type/build/contracts, real stdio protocol parity, and a spawned end-to-end MCP workflow that creates a real puppet, imports a real PNG, authors a Part and two parameter bindings, performs real parameter evaluation/readback/restore, validates, saves a second real `.inp`, and reopens it semantically.

## Official Inochi Creator compatibility

The v1 compatibility target is the official Inochi Creator `v0.8.6` Linux release asset ID `193284190`. Tool-authored artifacts remain generated by the pinned Inochi2D `v0.8.7` commit above. `npm run m2:creator:ci` downloads and verifies that exact Creator asset, constructs a real `.inp` through the public semantic core using a real PNG, proves the staged artifacts open in Creator under isolated Xvfb, triggers Creator's normal Save command, then reopens the Creator-produced `.inx` headlessly and verifies hierarchy, Part/texture relationships, parameter bindings, and real set/readback/restore behavior.

Creator GUI automation is acceptance infrastructure only. It does not enter the public semantic API, runtime contract, CLI, MCP, or SDK surface. CLI/MCP are adapters over the same semantic core rather than independent implementations.

The real-artifact acceptance path uses official serialization from the exact pinned Inochi2D revision. Synthetic data is used only for narrow parser/adapter tests and does not substitute for `.inp` compatibility proof.

See `docs/superpowers/specs/2026-09-13-inochi-agent-tools-v1-design.md` for the approved v1 design, `docs/superpowers/plans/2026-09-13-m0-foundation-upstream-contract.md` for M0, `docs/superpowers/plans/2026-09-14-m1-open-inspect-validate.md` for M1 inspection, `docs/superpowers/plans/2026-09-14-m1-create-save-reopen.md` for minimal creation, `docs/superpowers/plans/2026-09-14-m2-texture-part-hierarchy.md` for visual hierarchy authoring, `docs/superpowers/plans/2026-09-14-m2-parameter-binding.md` for parameter authoring/evaluation, `docs/superpowers/plans/2026-09-14-m2-creator-roundtrip.md` for the official Creator compatibility gate, `docs/superpowers/plans/2026-09-14-m3-semantic-cli.md` for the stable CLI milestone, and `docs/superpowers/plans/2026-09-14-m3-mcp-sdk.md` for the public SDK/MCP milestone.
