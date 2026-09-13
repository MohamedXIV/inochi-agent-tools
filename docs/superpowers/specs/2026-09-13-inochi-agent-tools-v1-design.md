# Inochi Agent Tools v1 — Design

Date: 2026-09-13
Repository: `MohamedXIV/inochi-agent-tools`
Status: Approved design

## 1. Purpose

`inochi-agent-tools` is a public, general-purpose, headless authoring toolchain for Inochi2D puppets. Its primary goal is to let software agents and automation systems create, inspect, edit, validate, save, and round-trip real Inochi puppet files without driving the graphical Inochi Creator UI.

The project is intentionally independent from Away Message. Away may consume the toolchain later through a separate adapter, but the core, CLI, MCP surface, SDK, native bridge, metadata model, tests, and documentation must not contain Away-specific character names, assumptions, or gameplay semantics.

Version 1 focuses on three deliverables:

1. a headless semantic authoring core;
2. a CLI built on that core;
3. an MCP server built on the same core for agent use.

A modified/forked Inochi Creator UI is explicitly outside v1 and may be considered later as another frontend over the same authoring capabilities.

## 2. Architectural principles

### 2.1 One semantic authority

The semantic authoring core is the single public source of authoring behavior. CLI, MCP, and SDK surfaces are adapters over that core rather than separate implementations.

```text
CLI ─┐
MCP ─┼──> Semantic Authoring Core
SDK ─┘             │
                   ↓
              Native Bridge
                   │
                   ↓
          pinned Inochi2D upstream
                   +
          minimal isolated patches
```

This keeps behavior consistent across interfaces and makes the native layer replaceable without changing agent-facing contracts.

### 2.2 Upstream strategy

The project uses a pinned upstream Inochi2D revision plus an isolated patch layer.

The project does not maintain a broad fork of Inochi2D and does not vendor arbitrary direct modifications into the public semantic layer. The exact upstream revision is selected and recorded during the Foundation milestone before native bridge work proceeds. Build metadata must record the chosen commit and the patch set applied to it.

Any upstream extension must satisfy all of the following:

- required by a concrete authoring capability;
- as small as practical;
- isolated under the native bridge/patch boundary;
- documented with the reason it exists;
- covered by an integration test proving the capability that requires it;
- removable when upstream exposes an equivalent stable primitive.

### 2.3 Public APIs stay semantic

Public surfaces must expose domain operations such as:

- `puppet.create`
- `puppet.open`
- `puppet.inspect`
- `puppet.validate`
- `puppet.save`
- `texture.import`
- `texture.list`
- `node.create`
- `node.remove`
- `node.reparent`
- `node.list`
- `part.create`
- `part.setTexture`
- `part.inspect`
- `parameter.create`
- `parameter.inspect`
- `parameter.set`
- `parameter.bind`
- `parameter.unbind`
- `project.validate`
- `project.roundtrip`

The public API must not expose raw `in_*` functions, native pointers, allocator APIs, memory offsets, or implementation-specific handles as normal agent-facing operations.

### 2.4 Runtime and authoring remain separable

The project is an authoring toolchain, not an application runtime. Where runtime-style inspection is useful for validating authoring output, it must remain behind a clear boundary and must not cause the public API to become a thin wrapper around raw Inochi2D internals.

### 2.5 Public and general-purpose by default

The core must not require Away-specific metadata or concepts. Application-specific metadata may be carried as vendor/application data when the underlying format supports it, but the general authoring model must remain useful to unrelated projects.

## 3. Repository structure

The intended top-level structure is:

```text
inochi-agent-tools/
├─ packages/
│  ├─ core/              # semantic authoring model/API
│  ├─ cli/               # headless CLI
│  ├─ mcp/               # MCP server for agents
│  └─ sdk/               # public TypeScript types/client where useful
│
├─ native/
│  ├─ bridge/            # D/C ABI boundary over Inochi2D
│  └─ patches/           # minimal upstream-compatible extensions
│
├─ upstream/
│  └─ manifest.*         # pinned revision and reproducibility metadata
│
├─ tools/
│  └─ build/             # reproducible native/WASM build helpers
│
├─ tests/
│  ├─ fixtures/
│  ├─ integration/
│  └─ roundtrip/
│
└─ docs/
```

Exact package boundaries may be refined by the implementation plan, but the separation between semantic core, external interfaces, and native bridge is binding.

## 4. Data flow

A normal authoring operation follows this path:

```text
agent / human
     ↓
CLI or MCP
     ↓
semantic request
     ↓
Authoring Core validation
     ↓
Native Bridge command
     ↓
pinned Inochi2D + minimal patches
     ↓
real puppet state / real .inp output
     ↓
semantic result
```

The same core operation must produce equivalent behavior whether invoked through CLI, MCP, or SDK.

For save and round-trip flows:

```text
authoring operations
      ↓
real puppet state
      ↓
save real .inp
      ↓
reopen headlessly
      ↓
semantic validation
      ↓
official Inochi Creator compatibility gate
```

## 5. Error model and native failure boundary

Errors exposed above the native boundary are typed and semantic. Representative categories include:

- `InvalidPuppet`
- `UnsupportedUpstreamVersion`
- `InvalidHierarchy`
- `MissingTexture`
- `InvalidBinding`
- `NativeBridgeFailure`
- `RoundTripMismatch`

CLI and MCP adapters translate these into interface-appropriate responses while preserving detailed diagnostics for logs and test evidence.

Potentially unsafe native behavior must be isolated behind strict validation and, where practical, a process boundary so malformed input or a native fault does not unnecessarily take down the agent host. The implementation plan must prefer fail-closed behavior for invalid native handles, dimensions, hierarchy references, and serialized output.

## 6. Testing strategy

Testing is layered so narrow unit confidence never substitutes for real artifact proof.

### 6.1 Semantic core tests

Unit tests cover the semantic authoring model, validation rules, command behavior, typed errors, and adapter-independent logic.

Synthetic fixtures are acceptable here when the test is explicitly narrow and does not claim file-format or Creator compatibility.

### 6.2 Native bridge tests

Native integration tests run against the exact pinned upstream revision and applied patch set. They prove that bridge operations map to real Inochi2D behavior rather than a mock implementation.

### 6.3 Real `.inp` integration tests

Integration tests use real puppet artifacts for open, inspect, edit, save, reopen, hierarchy, texture, parameter, and binding behaviors. Fake JSON or hand-crafted binary fixtures must not be used as acceptance proof for real authoring compatibility.

### 6.4 Round-trip acceptance

The strongest acceptance gate is an actual round trip:

1. create or modify a puppet through the headless authoring API;
2. save a real `.inp`;
3. reopen it headlessly;
4. validate its semantic structure;
5. open the result successfully in the official Inochi Creator;
6. when the milestone requires it, save/modify through Creator and reopen the resulting artifact in this toolchain;
7. compare the expected semantic structure and bindings.

This gate is required before v1 can be declared complete.

## 7. Reproducibility

Every native build used for acceptance evidence must make the following recoverable:

- exact Inochi2D commit SHA;
- D compiler and version;
- WASI/WASM toolchain version when applicable;
- native bridge revision;
- patch identities/hashes;
- relevant build flags.

The repository must not silently build against a moving upstream target.

## 8. Milestones

### M0 — Foundation & Upstream Contract

Goals:

- establish repository/toolchain conventions;
- select and pin the upstream Inochi2D revision;
- define patch policy and reproducible build metadata;
- establish CI;
- prove the native D/C ABI bridge can be built reproducibly.

M0 ends only when a clean environment can reproduce the same native bridge inputs from repository metadata.

### M1 — Headless Puppet Round-Trip

Goals:

- open real puppet bytes;
- inspect metadata, hierarchy, parameters, textures, and parts where available;
- validate puppet structure;
- create a minimal puppet headlessly;
- save it as a real `.inp`;
- reopen and validate it;
- prove compatibility with official Inochi Creator.

### M2 — Real Authoring

Goals:

- import texture assets;
- create nodes and Parts;
- create and maintain hierarchy;
- create parameters;
- bind at least two parameters to authored puppet behavior;
- save and reopen the result;
- prove the authored puppet operates correctly in official Inochi Creator.

The milestone target is a genuinely authored puppet, not a metadata-only file.

### M3 — Agent Interfaces

Goals:

- stabilize the CLI over the semantic core;
- expose the same capabilities through MCP;
- provide public TypeScript SDK/types where useful;
- prove an agent can execute the complete v1 authoring workflow without direct D/C ABI or pointer knowledge.

### M4 — Post-v1

Explicitly outside v1:

- modified Inochi Creator UI/fork;
- richer preview/rendering workflows;
- advanced physics authoring;
- higher-level automatic rigging;
- application-specific integrations such as Away Message.

## 9. Initial GitHub issue model

The v1 execution graph should begin with one umbrella project issue and dependency-driven implementation issues:

```text
[PROJECT] Inochi Agent Tools v1 — Headless Authoring

#1 Architecture + pinned upstream contract
  ↓
#2 Reproducible native/D bridge build
  ↓
#3 Headless open + inspect + validation
  ↓
#4 Create/save/reopen minimal puppet
  ↓
#5 Texture + Part + hierarchy authoring
  ↓
#6 Parameter creation + binding
  ↓
#7 Official Creator round-trip gate
  ↓
#8 CLI semantic surface
  ↓
#9 MCP semantic surface
  ↓
#10 v1 integration/acceptance gate
```

Issue numbers are illustrative until the implementation plan is converted into real GitHub issues. The dependency order, not the literal numbers, is binding.

## 10. Worker execution model

A dedicated `Inochi Agent Tools Worker` operates independently from Away Message workers and must never mutate the Away repository as part of this project.

Each hourly run should:

1. inspect live repository state, open issues, active PRs, reviews, CI, and recent commits;
2. choose the highest-priority unblocked v1 issue;
3. continue an existing relevant PR instead of creating competing work;
4. use strict RED → GREEN TDD for behavior changes;
5. prefer real artifacts over mocks for integration and acceptance work;
6. verify the exact PR head before claiming completion;
7. record concise evidence on the issue/PR;
8. merge only when the issue acceptance criteria are complete, exact-head CI is green, and review/thread state is clean;
9. move to the next unblocked issue rather than expanding scope speculatively.

The worker may merge completed implementation PRs automatically after the above gates are satisfied. It must not merge work with unresolved acceptance criteria, failing exact-head verification, or unresolved review threads.

## 11. v1 definition of done

Version 1 is complete only when the toolchain can perform the following workflow headlessly through the semantic API and expose it through both CLI and MCP:

```text
create puppet
→ import PNG
→ create hierarchy / Part
→ create at least two parameters
→ bind those parameters
→ save real .inp
→ open successfully in official Inochi Creator
→ reopen with inochi-agent-tools
→ pass semantic round-trip validation
```

The final acceptance must use real artifacts and a reproducible pinned upstream build. No character-specific assumptions, raw pointer APIs, or application-specific authoring shortcuts may be required by the public workflow.
