# Inochi2D runtime compatibility — Outsider Driver postmortem and future-project recovery

> **Status (2026-10-09): OPEN integration gap, not an Inochi2D quality verdict.** Outsider Driver has elected to stop using Inochi2D for this game; this report is owned by **inochi-agent-tools** so a future project can consume a verified, general-purpose authoring/runtime solution. This document records observations, not new passes.

## Decision and scope

- Do **not** resume Inochi2D integration or character production in `MohamedXIV/outsider-driver` under this work item. Do not modify that game's WASM pin or gameplay.
- Keep `inochi-agent-tools` as the reusable authoring project. Its v2 native/CLI/MCP successes are real, but its downstream WASM/browser interoperability is **unproven and currently failing** for the tested authored files.
- The historic current-format bridge in issue [#35](https://github.com/MohamedXIV/inochi-agent-tools/issues/35), hardening in [#47](https://github.com/MohamedXIV/inochi-agent-tools/issues/47), and v2 authoring acceptance in [#49](https://github.com/MohamedXIV/inochi-agent-tools/issues/49) remain correctly described within **their narrower test boundaries**. Do not relabel those completed scopes as failed.

## Versions and provenance of the 2026-10-09 investigation

| Component | Tested provenance |
| --- | --- |
| Authoring repo | `MohamedXIV/inochi-agent-tools` main `b556105529a68ece5b3bc066c793f84ba47d8ff0`; GitHub Verify succeeded on that head |
| Legacy production authoring | Inochi2D v0.8.7 / `fdb241da048dbe330152f7b0015e2129dc392844`; separately pinned in `upstream/inochi2d.json` |
| Current-format candidate source | Inochi2D `ba2b1413c68d9f7bf575fef790ba0c35715558db` (declares 0.9.0), with patch inventory at `native/current-patches/manifest.json` |
| Downstream game diagnostic baseline | Outsider Driver `6eb0cc7a9c3d1898970ec8b5d3fabc8ea583ec4c` **plus local WASI correction** (not a claim about game main); later commits may differ |
| Existing browser runtime | Official pinned 0.9.0 debug WASM release asset **604648506**, dated 2026-10-02; module SHA-256 `d0681fb37c38f149bebfe79f478c7f26485af9bc9dfb7a9e586c6c4350638794` |
| Aka source | `Inochi2D/example-models` `cd95dd00ddff63b1f7d2b84a19914c3c70d05945`; source SHA-256 `dbf82ffb86d1c761bca883ad37ec1c47487a447f8104290b459ce60aaee81e0f` |
| Native toolchain | WSL/Ubuntu LDC 1.40 built legacy host; LDC 1.43 built current-format probe; Windows native compilation unresolved (see below) |

The test artwork was **only the extracted original Aka Face texture (slot 12), losslessly converted from TGA to PNG**. No new character art was created. The v2 authored output used automatically fitted mesh and one bounded Z-rotation parameter (1200×1200 QA frame). INP2 was produced through real v2 CLI **and real stdio MCP**. A matching INP1 was produced with CLI create/edit, using the same fitting/rig compiler. Neither binary was hand-authored.

## Observed compatibility matrix

Counts are **parameters / vertices / indices / textures / draw commands**. Chromium used the real downstream binding/adapter and distinguished load, update and draw.

| File | Existing pinned official WASM in Chromium | Pristine native Inochi2D loader |
| --- | --- | --- |
| Existing tiny visual INP1 fixture | `9 / 4 / 6 / 1 / 1`; load/update/draw passed | Not tested in this matrix |
| Existing reduced Aka INP1 fixture | `1 / 4 / 6 / 1 / 1`; load/update/draw passed, visible Babylon frame | Not tested in this matrix |
| **CLI-authored** Aka Face INP1 | **`RuntimeError: unreachable` during load**, before update/draw | **1 parameter, 1 root child, 1 visual** |
| **CLI/MCP-authored** Aka Face INP2 | **`0 / 0 / 0 / 0 / 0`** | **0 parameters, 0 root children, 0 visuals** |

Two already-prepared tiny fixtures producing visible pixels **do not** establish that CLI-authored puppets render. The reduced Aka fixture replaces a large original texture with a tiny texture and simplifies geometry. No independently obtained official *INP2* puppet was included in this comparison.

Other observed results:

- CLI and stdio MCP inspection/validation of official Aka succeeded: **100 nodes, 76 Parts, 34 parameters, 76 textures**.
- CLI legacy Aka save-as failed `NATIVE_BRIDGE_FAILURE / JSONValue is not an array`; full legacy Aka -> current-format migration failed with `ArrayIndexError` in `vector2d`.
- v2 translation-only preview QA returned `NO_EXPECTED_MOTION` (not bypassed); bounded Z-rotation preview QA passed 5 samples through CLI and stdio MCP; resulting file had `TRNSRTS2` magic.
- Creator eventually launched with the INP1 in its installation working directory and left a running window titled `Inochi Creator - aka-face-inp1.inp`; **rendering/deformation acceptance was not observed**.
- Local game verification after a WASI correction passed lint/content/save checks, **270 tests across 68 files**, TypeScript/build/budgets; focused Chromium real-WASM reduced-Aka browser test passed (one test). These checks do not clear the authored-file interoperability gate.

## Diagnoses: established facts versus hypotheses

### A. INP2 content loss (confirmed, upstream reader discrepancy)

Pristine native loading of our CLI/MCP-produced INP2 also yields an **empty puppet**, so the observed INP2 content loss is not inherently a Babylon defect. In the pinned upstream `modules/inp/source/inp/format/inp2/reader.d`, the reader lacks handling for `INP2_TAG_BOOL` and does not consume/validate `INP2_TAG_ARRAY_END` or `INP2_TAG_OBJECT_END` after processing their containers. The tool already maintains isolated fixes in `scripts/current/apply-patches.mjs` and `native/current-patches/manifest.json`, plus other justified serialization/parameter/binding/physics patches. **These differences are evidence, not proof that either one independently explains every lost field.**

Next isolate a minimal INP2 object/array/boolean fixture at the DataNode level, compare pristine and each patch separately, then load actual authored INP2 through both pristine and patched **semantic** loaders and check parameters, hierarchy, textures, binding behavior and serialization. A patched runtime that reads our format must be explicitly labelled **patched**, not represented as unmodified official runtime support. Also obtain an independently sourced official INP2 control if available.

### B. INP1 WASM load trap (confirmed symptom, root cause open)

The same CLI INP1 has valid nonzero native content yet browser/Node WASM traps **during load**. Diagnostics reached JSON number reading, numem string termination and an array-bounds fatal path. Direct `nu_malloc` probes returned null on several allocations **at or above 32 KiB** while smaller tested allocations succeeded; **this is not an established universal allocation threshold**. Shortening JSON number spellings and allocation warmups did not fix it. Evaluate allocator initialization, memory growth, heap configuration, input staging, pointer lifetime, imported memory versus exported memory, and build/link flags. Use tracked experiments before changing the game or format.

### C. WASI diagnostic defect (confirmed locally, downstream-specific)

The game's initial `fd_write` shim returned success without writing `nwritten`, which could make native diagnostics loop and turn a trap into an apparent timeout. A local correction validated iovec spans against the current memory buffer and wrote the acknowledged byte count; tests covered multiple vectors and memory growth. Diagnostic payload was still intentionally discarded. **This local correction was not part of the authored repository baseline or verified as merged in the game.** A future independent browser harness must implement/verify WASI imports faithfully and expose bounded diagnostic output if safe; distinguish diagnostics correctness from loader correctness.

### D. Distinct, non-blocking lanes

- Windows native LDC 1.43 failed within `nulib`; LDC 1.40 reached an unresolved `NativeSemaphore` linker symbol. WSL builds succeeded and are sufficient for the initial recovery effort. Track Windows native portability separately rather than treating it as the browser compatibility gate.
- Legacy Aka full-model save/conversion and Creator GUI rendering are **separate** unresolved gates; do not conflate them with minimal INP1/INP2 browser compatibility.

## Recovery plan for autonomous Cloud Codex / GitHub agents

Start from **actual live main**, read this document, existing compatibility/rigging documents and manifests, and inspect open PRs before writing. Avoid competing branches. Prefer a single owner issue with narrow, reviewable PRs. This is a **general-purpose** fix in the authoring repository; no Outsider Driver gameplay/renderer modifications or wholesale format replacement.

### P0 — portable reproduction, contract and diagnostics

1. Create a small, licensed, repository-reproducible test case that drives real **CLI and stdio MCP** to author one textured visual Part and a real movable parameter. Retain source PNG/manifest, toolchain/source pins, hashes and commands. The old local temporary evidence directory is not accessible to cloud workers; do not claim it is checked into Git.
2. Generate INP1 and INP2 via official library/API-backed tool operations, never manually constructed binaries. Keep no oversized copyrighted example assets or build artifacts in Git. Use reference Aka content only when provenance/license permits; otherwise use a small owned synthetic texture for the *interop* gate.
3. Build an independent native/Node/Chromium test harness capturing stages separately: **load -> semantic counts -> parameter set/readback -> update -> draw -> visible pixels**. Record genuine runtime identity, SHA, allocator status, error paths, and bounded logs. Include negative/failure assertions.
4. Fix/reproduce the WASI `fd_write` byte-count contract in the standalone harness and test multiple iovecs and memory growth. Never silence native fatal errors by returning fabricated success.

### P1 — identify independent format failure modes

5. Obtain/derive an **independently authored official INP2 control** (if obtainable) and add a compatibility matrix covering INP1 and INP2, tool-authored vs official, patched vs pristine native and WASM. Record unknown/not run honestly.
6. Use minimal DataNode fixtures to isolate INP2 BOOL/end-token discrepancies and all relevant patch dependencies; establish semantic round-trips of real authored parameters, texture cache, Parts, references and bindings. Preserve existing v0.8.7 and current-patch lane test coverage.
7. Trace INP1 `unreachable` through allocator diagnostics, memory layout, load input lifetime, D/WASM debug symbols and exact failure location. A null allocation **must fail explicitly**, not proceed to an invalid pointer. Do not assume a fixed 32 KiB cut-off.

### P2 — a *separately identified* runtime candidate

8. Build a reproducible candidate from a pinned upstream revision and documented patches (if required). Record compiler/LDC/Dub versions, linker flags, imported/exported memory behavior, build commands, SHA and source identities. **Do not overwrite an existing game vendor WASM or silently advance a nightly pin.**
9. Run the same controls against the original pinned official runtime, pristine new candidate and patched candidate. Explicitly report whether compatibility is achieved with **unmodified official** or **patched open-source** runtime; disclose remaining upstream gaps and consider narrow upstream bug reports.
10. Demonstrate real browser/Chromium load, nonzero parameters/vertices/indices/textures/draw commands, and a real changed rendered frame on parameter movement. Prefer the existing official C API and a small renderer/harness, not a fake software-only preview.

### P3 — durable integration acceptance and handoff

11. Check original/full Aka migration and current Creator GUI separately; retain any failures as follow-ups if not required for the minimal interoperability milestone. No 'production-quality' claim without visual review on a genuinely layered character.
12. Publish an explicit compatibility table and one-command documented smoke workflow. Preserve upstream pins/patch provenance, clean rebuild instructions, limitations and regression tests. Keep optional browser/large/native checks targeted; **avoid GitHub Actions unless necessary** to conserve free minutes, and never assert passes without logs.

## Closure contract

Do **not** close the recovery issue solely because native validation, INP2 magic, headless preview QA, or synthetic Babylon fixtures pass. Closure requires:

- [ ] Fresh, independent builds from committed, provenance-clean inputs exercising actual CLI **and** real stdio MCP authoring.
- [ ] A documented runtime identity and format-support matrix; precise status for pristine official versus patched runtime.
- [ ] Both tested authored formats either work end-to-end or are explicitly declared unsupported with a defensible supported delivery format for future consumers; no silent empty puppet success.
- [ ] `load -> parameters -> update -> draw` yields **nonzero valid geometry, indices, textures, commands** with a visible browser frame for the supported output path.
- [ ] An authored parameter changes the visible result in a deterministic, measurable browser test; no fake proxy rendering.
- [ ] Allocator failure is understood/guarded and never masks traps or hangs; error reporting and WASI diagnostics are accurate.
- [ ] Existing v0.8.7 authoring + current-format CI capabilities continue to pass; any runtime patches have tests, provenance and removal conditions.
- [ ] Another developer/agent can reproduce the result without access to the original Windows temp directory; release/artifact licensing is recorded.

**Future-project rule:** Inochi2D remains a potential option, but only re-evaluate production use *after* this interop gate succeeds and a separate visually expressive real character is reviewed. It is not a dependency of Outsider Driver going forward.

## Original local evidence inventory (NOT committed)

`C:/Users/moham/AppData/Local/Temp/outsider-inochi-agent-tools/.build/smoke/` contained `browser-format-matrix.json`, `diagnostic-matrix.json`, `runtime-identity.json`, CLI/MCP QA and provenance, and Creator logs. Other provided artifacts: `face-rotation/aka-face.inp`, `face-rotation/aka-face.qa.json`, `face-rotation/aka-face.provenance.json`, `face-rotation/aka-face.previews/*.png`, `face-rotation/aka-face.inp.wasm-result.json`, `inp1-bounded-result.json`, `mcp-rig-smoke.json`, `face-build.json`, `game-wasm-smoke.mjs`, `bounded-control.mjs`. These are local-only leads: cloud agents must reproduce evidence with committed sources or explicitly request access, not fabricate it.

Related references: [`docs/current-format-compatibility.md`](current-format-compatibility.md), [`docs/v2-autonomous-rigging.md`](v2-autonomous-rigging.md), [`docs/v2-rig-qa.md`](v2-rig-qa.md), [`native/current-patches/manifest.json`](../native/current-patches/manifest.json), and the [pinned official INP2 reader](https://github.com/Inochi2D/inochi2d/blob/ba2b1413c68d9f7bf575fef790ba0c35715558db/modules/inp/source/inp/format/inp2/reader.d).
