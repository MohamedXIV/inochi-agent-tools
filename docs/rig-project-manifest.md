# Rig Project Manifest v1

Issue #42 defines the deterministic input boundary consumed by later v2 rigging stages.

The executable schema version is `inochi-agent-tools/rig-project/v1`. A project has a non-empty name and at least one layer. Coordinates use pixels and default to center origin with downward-positive Y; v1 also permits explicit `top-left` origin and upward-positive Y.

Each layer has a unique stable semantic `id`, project-relative image `source`, and generic semantic `role`. Optional fields are `parentId`, `pivot`, named `anchors`, project-relative `mask`, and a symmetry `counterpart` plus X/Y axis. References use semantic IDs, never Inochi UUIDs, pointers, or native handles. Absolute paths, URL-like paths, drive-qualified paths, and `..` traversal fail closed. Product-specific body, wardrobe, and morphology policy remains downstream.

Optional motion intents declare a stable ID, X/Y axis, finite min/max/default, semantic layer targets, and one generic kind: `transform`, `deform`, `rotation`, `opacity`, `tint`, or `physics`. Motion intent describes desired controls; #44 later compiles it into ordinary inspectable semantic primitives.

Normalization trims semantic text, canonicalizes asset separators, fills coordinate defaults, sorts layers and motions by semantic ID, sorts target IDs and anchor names, and recursively sorts object keys. The project fingerprint is SHA-256 of canonical UTF-8 JSON. Declaration order and JSON object-key order therefore cannot alter the fingerprint.

Validation fails before authoring and throws `InvalidRigProjectError` with machine-readable diagnostics containing `code`, `path`, and `message`. Duplicate IDs, unresolved references, unsafe paths, malformed points, unknown fields, unsupported axes/kinds, and invalid ranges are explicit errors; later v2 stages must not guess through them.

There is one semantic authority in `@inochi-agent-tools/core`: `normalizeRigProjectManifest`, `inspectRigProjectManifest`, and `fingerprintRigProject`. SDK/CLI/MCP adapters must delegate to these functions rather than redefining validation.

#43 owns mesh generation/fitting, #44 recipe compilation, #45 QA, and #46 bounded repair.
