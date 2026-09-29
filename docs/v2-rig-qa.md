# v2 automated rig QA

Issue #45 turns the existing headless preview lane into deterministic agent-readable rig evidence. It does not repair rigs; it only reports bounded observations and remediation classes for #46.

`buildRigQaMatrix()` derives a neutral frame, per-motion min/max frames, and bounded combined extrema from a `StandardCharacterRigBuildPlan`. `runRigQa()` reopens the real puppet, renders every sample through the existing preview host, preserves PNG evidence, computes SHA-256 and alpha-pixel deltas, and writes `rig-qa-report.json`.

The report references semantic motion IDs, layer IDs, paths, and parameter names rather than native object IDs. Diagnostics include missing parameters/targets/bindings, degenerate geometry, broken opposed symmetry, empty or disappearing renders, no expected motion, excessive deformation, and frame-span overflow. Every diagnostic carries severity, structured evidence, and a bounded remediation class (`binding`, `mesh`, `range`, `symmetry`, or `layout`).

The QA stage is deterministic and fail-safe: it does not mutate the puppet, does not guess a repair, and rejects oversized matrices or invalid QA profiles instead of silently reducing coverage. The native acceptance lane starts from the real layered-PNG mesh fixture, compiles a non-trivial rig, writes a real `.inp`, then produces and validates the machine-readable QA report plus its preview artifacts.
