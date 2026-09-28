# Rig Project Manifest v1

Issue #42 defines the deterministic input boundary consumed by later v2 rigging stages.

Every project declares schema version `inochi-agent-tools/rig-project/v1`, a non-empty name, and at least one layer. Coordinates use pixels and default to center origin with downward-positive Y.

Each layer has a unique stable semantic ID, project-relative image source, and semantic role. Optional fields are parent ID, pivot, named anchors, project-relative mask, and a symmetry counterpart plus X/Y axis. Parent and symmetry references use semantic IDs, never native UUIDs. Asset paths cannot be absolute or traverse outside the project. Away-specific body, wardrobe, and morphology policy are explicitly outside this contract.

Optional motion intents declare a stable ID, X/Y axis, finite min/max/default, semantic layer targets, and one generic kind: transform, deform, rotation, opacity, tint, or physics. Default lies inside a non-empty range and all targets must resolve. Motion intent describes desired controls; #44 later compiles it to ordinary semantic primitives.

Normalization trims the name, fills coordinate defaults, sorts layers and motions by semantic ID, sorts target IDs and anchor names, then recursively sorts object keys. The project fingerprint is SHA-256 of canonical UTF-8 JSON. Declaration order therefore cannot alter the fingerprint.

Validation fails closed before authoring. Diagnostics identify manifest paths and explain duplicate IDs, unresolved references, unsafe paths, malformed points, unsupported axes or kinds, and invalid ranges. Later stages must not guess through invalid input.

#43 owns mesh generation/fitting, #44 recipe compilation, #45 QA, and #46 bounded repair. This manifest is only the versioned semantic intent contract shared by those stages and future SDK/CLI/MCP adapters.
