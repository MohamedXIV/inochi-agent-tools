# Away Character integration spike

Issue #29 validates that the generic authoring stack can satisfy the downstream Away Character contract without moving product policy into the exported core.

## Read-only downstream evidence

The spike consumes the established Away Message contracts from `MohamedXIV/away-message` issue #34 and issue #25 as read-only design evidence. No file in that repository is modified.

Those contracts require semantic callers to work in concepts such as:

- body/face morphs;
- modular face/hair/clothing slots;
- tint channels;
- expressions;
- compatibility rules;
- renderer-independent preview/runtime state.

Raw Inochi handles, allocator functions, native enum values, and character-specific asset IDs are not part of the caller contract.

## Boundary in this repository

All Away-specific mapping lives under `spikes/away-character/**` and is intentionally not exported from `@inochi-agent-tools/core`.

The spike maps its semantic state onto already-generic primitives:

- morphs -> ordinary parameter + transform bindings;
- modular selections -> ordinary Part opacity bindings;
- hair tint -> the generic scalar tint channels proven by #38;
- expression -> ordinary transform bindings;
- head movement -> the reusable two-axis rig helper from #28;
- current-format output -> the isolated INP2 bridge proven by #35.

The representative slot compatibility rule deliberately rejects long hair with the high-collar jacket. This policy exists only in the downstream contract layer; core does not know what hair, a jacket, or Away Message means.

## Representative semantic contract

The canonical test character exposes:

- morphs: `body.mass`, `face.roundness`, `face.turn.x`, `face.turn.y`;
- slots: `hair.front = short|long`, `clothing.top = tee|jacket`;
- tint channel: `hair = #RRGGBB`;
- expression: `neutral|awkward_smile`.

The compiler produces only ordinary inspectable `PuppetEditOperation[]`. SDK, CLI, and MCP all consume the same operation list.

## Verification

The stable lane:

1. generates one real puppet through SDK;
2. authors equivalent puppets through CLI and MCP and compares semantic projections;
3. reopens the canonical puppet and verifies expected Parts, parameters, and bindings;
4. rejects the known incompatible hair/clothing combination;
5. renders the automated compatibility/extreme matrix and requires every frame to be non-empty and pixel-distinct;
6. opens the generated artifact in the accepted Creator lane.

After the workflow switches to the isolated current-format toolchain, the same canonical artifact is passed through #35's official semantic load/serialize/INP2 writer path. The resulting artifact and its second save/reload must both begin with exact `TRNSRTS2`.

## Non-goals

This spike does not build the Away Character Studio, change `away-message`, add Phaser integration, or introduce an Away-specific API into the generic packages.
