# Semantic Mesh, Deformer, and Bone Foundation Plan

Issue: #24
Parent: #22

## Goal

Extend the proven semantic authoring core with the smallest general-purpose geometry and rig primitives needed to construct real Inochi2D puppets: semantic mesh topology, supported deformer relationships, and supported bone/weight authoring, while preserving v1 and v1.1 behavior.

## Contract and boundaries

- The semantic core remains the single authoring authority; CLI, SDK, and MCP only adapt it.
- Public requests and inspection return semantic paths/relationships and validated topology, never native pointers, allocators, raw GUID handles, or implementation-specific identities.
- Use the pinned Inochi2D revision and standard INP2 behavior first. Any native patch requires a demonstrated blocked capability, an isolated patch, a removal condition, and real-artifact acceptance evidence.
- Real PNG and `.inp` artifacts are required for integration acceptance. Synthetic topology is acceptable only for narrow validation unit tests.
- No auto-rigging, parameter-form work, preview renderer, physics, Creator UI authoring, or Away-specific policy belongs in this issue.

## Execution slices

### 1. Upstream capability audit and semantic model

Inspect the pinned upstream/native bridge and existing semantic node/Part representation. Record which mesh, deformer, bone, and weight operations are available without a patch. Define stable semantic request/inspection shapes and stable error categories before adding adapters.

### 2. Mesh topology RED -> GREEN

RED: focused tests require a Part backed by a real imported PNG to accept validated vertices, UVs, and triangle indices, persist to a real `.inp`, reopen, and inspect the same semantic topology. Add narrow negative tests for invalid indices, malformed vertex/UV cardinality, and unsupported topology.

GREEN: implement the smallest semantic-core operation and native bridge support necessary. Keep topology validation above raw native details and fail closed.

### 3. Deformer hierarchy RED -> GREEN

RED: require supported deformer creation/reparent/update around authored Parts, deterministic semantic inspection after reopen, cycle rejection, missing-target rejection, and safe delete/reparent behavior.

GREEN: implement only relationships supported by pinned Inochi2D. If the upstream surface blocks a required operation, document the exact blocker before considering an isolated patch.

### 4. Bone and weight RED -> GREEN

Audit pinned upstream support first. RED acceptance must require actual persisted/runtime-meaningful bone/weight behavior rather than serialization-only fields. GREEN exposes semantic bone creation and weight assignment only to the extent proven by the pinned runtime. Unsupported operations return stable semantic errors rather than leaking native handles or inventing compatibility.

### 5. Adapter parity

After core behavior is GREEN, expose the accepted operations through SDK, CLI, and MCP as thin adapters. Add parity tests demonstrating equivalent semantic results and errors.

### 6. Real artifact and Creator acceptance

Build a real PNG -> Part -> mesh -> supported deformer/bone workflow, save a real `.inp`, reopen through the semantic stack, and verify topology/relationships. Run official Creator compatibility infrastructure on the resulting artifact. Where bone/deformer runtime behavior is claimed, add the strongest deterministic native/runtime evidence available; serialization alone is insufficient.

## Acceptance gate

Create a focused issue-specific gate (planned `v1.2:rig-primitives:ci`) that composes the new real-artifact acceptance with existing verification. Before merge, the exact final PR head must have:

- focused RED -> GREEN evidence for each implemented behavior slice;
- real PNG and `.inp` acceptance artifacts;
- Creator-open compatibility evidence;
- semantic reopen/inspection matching authored topology and relationships;
- stable failures for malformed topology, cycles, invalid indices, missing targets, and unsupported operations;
- CLI/SDK/MCP parity for accepted operations;
- no public raw native identities;
- `npm run verify` GREEN;
- `npm run v1:ci` GREEN;
- `npm run v1.1:package:ci` GREEN or an equivalent stronger gate that includes it;
- no unresolved review threads and a bounded #24-only diff.

## First implementation step

Do not begin with a broad native patch. First audit the pinned upstream mesh/deformer/bone surface and existing bridge, then commit a focused mesh-topology RED that proves the first missing semantic capability against a real imported Part. Only then add the minimum GREEN implementation.