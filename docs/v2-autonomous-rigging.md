# v2 autonomous character rigging acceptance

Issue #49 is the final v2 acceptance gate. The authoritative CI lane is `npm run v2:e2e:ci`, executed after the stable native stack, v2 mesh/rig/QA/repair gates, and the isolated current-format lane have all passed.

## Proven end-to-end path

The acceptance fixture starts from regenerated layered PNG files plus a versioned Rig Project manifest. No Creator edits or hand-authored native-format data are used in construction.

The public SDK performs the complete workflow:

```text
layered PNGs + Rig Project
  -> validate / normalize
  -> deterministic mesh fitting
  -> standard rig compilation
  -> real Part authoring
  -> machine-readable preview QA
  -> detect an intentionally over-amplified breathing deformation
  -> bounded deterministic gain repair
  -> re-run QA to green
  -> current-format INP2 finalization
  -> current-format runtime verification
  -> clean-input deterministic rebuild
```

The representative character has three real textured Parts (`body`, `head`, and `hair`), a directly previewable `Breathing` deformation, and a `Hair Swing` parameter linked to bounded `SimplePhysics` secondary motion. The deliberately excessive breathing response must produce a repairable `DISAPPEARING_CONTENT` diagnostic before bounded repair reduces only that semantic gain.

## Evidence required by CI

The gate requires all of the following on the exact PR head:

- final QA is green with a non-empty seven-sample matrix;
- the dedicated defect produced at least one accepted bounded repair iteration;
- repaired semantic plan/build/QA fingerprints are deterministic;
- the emitted puppet is real INP2 with `TRNSRTS2` magic;
- current-format save/reload is byte-stable for the generated fixture;
- the final current-format puppet reloads with `body`, `head`, and `hair` nodes;
- `Breathing -> body/head/hair transform.s.y` and `Hair Swing -> hair.transform.r.z` bindings survive migration;
- `Hair Physics` remains linked to `Hair Swing`;
- current-format parameter set/readback/restore and runtime property evaluation work on the generated artifact;
- recreating the PNG inputs from scratch reproduces the manifest, repaired plan, QA, build, preview-sample, and current-format fingerprints.

SDK/CLI/MCP adapter equivalence is not reimplemented in this final test. It remains continuously enforced by the immediately preceding `v2:rig-build:ci` #48 gate on the same exact head, so #49 consumes the proven single orchestration authority rather than introducing a second test-only workflow.

## Capability boundary

v2 now proves autonomous rigging from already-layered artwork. It does **not** segment or draw source artwork, provide a Character Studio UI, or encode product-specific Away morphology/wardrobe rules.

The standard v2 recipe currently compiles transform/deformation/property bindings plus supported secondary physics. It does not automatically synthesize arbitrary MeshDeformer cages from semantic intent. Current-format MeshDeformer preservation remains independently covered by the #47 production-hardening acceptance lane in the same full repository gate.

Headless QA evaluates authored parameter states and structural physics semantics; it does not simulate a long-running temporal physics scene. Creator remains an optional compatibility oracle and is never a required authoring step.
