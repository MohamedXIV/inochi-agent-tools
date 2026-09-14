# M2 Parameter Creation, Binding & Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the semantic authoring core so a real puppet can define at least two parameters, bind them to ordinary Inochi2D node properties, save/reopen those bindings, and prove transient set → target readback → restore through the real pinned native path without exposing GUIDs or native handles.

**Architecture:** Parameter authoring extends the existing `editPuppet({ inputPath, outputPath, operations })` transaction model introduced by #6. Persistent authoring operations create parameters and semantic bindings using parameter names, canonical node paths, documented node-property names, and explicit keypoint values; a separate process-isolated evaluation operation loads a puppet, applies requested parameter values in memory, reports semantic parameter/target state, restores defaults, verifies restoration, and exits without saving. Inspection is extended to expose bindings semantically while all Inochi GUID references remain private inside the D bridge and serialized `.inp` format.

**Tech Stack:** Node.js 22+, TypeScript 5.x, Vitest, DUB, LDC 1.40.0 in CI, pinned Inochi2D `fdb241da048dbe330152f7b0015e2129dc392844` / `v0.8.7`, process-isolated D native host, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-13-inochi-agent-tools-v1-design.md`

## Global Constraints

- Public/general-purpose only; no Away Message-specific character, rig, gameplay, or metadata assumptions.
- `@inochi-agent-tools/core` remains the semantic authority. CLI/MCP/SDK later adapt these same operations.
- Public parameter references use parameter names; public binding targets use canonical semantic node paths and documented property strings, never GUIDs, node IDs, pointers, allocator addresses, or D objects.
- Authoring remains file-transaction based: input `.inp` is never mutated in place and an existing output is never overwritten.
- Transient parameter evaluation runs in a fresh native-host process and never exposes a persistent native session/handle.
- Acceptance uses real `.inp` artifacts written and reopened by pinned Inochi2D. Synthetic JSON is allowed only for parser/adapter unit tests.
- Pinned upstream remains exact commit `fdb241da048dbe330152f7b0015e2129dc392844` (`v0.8.7`); add a compatibility patch only after reproducing a concrete pinned-upstream defect.
- LDC must remain >= 1.40.0; exact-head CI uses LDC 1.40.0.
- Strict RED → GREEN TDD applies to each behavior slice.
- Official Inochi Creator compatibility remains Issue #8; this issue must not claim that gate.

---

## Semantic Contract Locked by #7

### Persistent parameter inspection

Extend each `PuppetInspectionParameter` with semantic bindings:

```ts
export type ParameterBindingProperty =
  | 'zSort'
  | 'transform.t.x'
  | 'transform.t.y'
  | 'transform.t.z'
  | 'transform.r.x'
  | 'transform.r.y'
  | 'transform.r.z'
  | 'transform.s.x'
  | 'transform.s.y';

export interface PuppetInspectionParameterBinding {
  targetPath: string;
  property: ParameterBindingProperty;
  keypoints: Array<{
    index: [number, number];
    parameterValue: [number, number];
    value: number;
  }>;
}

export interface PuppetInspectionParameter {
  name: string;
  dimensions: 1 | 2;
  min: NumericPair;
  max: NumericPair;
  defaultValue: NumericPair;
  value: NumericPair;
  bindings: PuppetInspectionParameterBinding[];
}
```

The `index` field is a semantic keypoint-grid coordinate, not a native handle. `parameterValue` is included so callers do not need to reverse-map axis points.

### Persistent authoring operations

Extend the existing `PuppetVisualEditOperation` union (rename the public union to `PuppetEditOperation` while keeping a compatibility type alias for existing callers) with:

```ts
export interface ParameterCreateOperation {
  type: 'parameter.create';
  name: string;
  dimensions: 1 | 2;
  min: [number, number];
  max: [number, number];
  defaultValue: [number, number];
}

export interface ParameterBindOperation {
  type: 'parameter.bind';
  parameterName: string;
  targetPath: string;
  property: ParameterBindingProperty;
  keypoints: Array<{
    at: [number, number];
    value: number;
  }>;
}

export interface ParameterUnbindOperation {
  type: 'parameter.unbind';
  parameterName: string;
  targetPath: string;
  property: ParameterBindingProperty;
}
```

For v1 M2 acceptance, 1D parameters use endpoint keypoints matching their min/max values. 2D parameter definitions are supported and validated, but #7 acceptance does not require a complex 2D authored binding fixture.

### Transient evaluation

Expose one stateless semantic operation:

```ts
export interface EvaluateParameterValuesOptions {
  inputPath: string;
  values: Record<string, [number, number]>;
  hostPath?: string;
}

export interface ParameterEvaluationTarget {
  parameterName: string;
  targetPath: string;
  property: ParameterBindingProperty;
  appliedValue: number;
  restoredValue: number;
}

export interface ParameterEvaluationResult {
  appliedParameters: Array<{
    name: string;
    value: [number, number];
  }>;
  targets: ParameterEvaluationTarget[];
  restoredParameters: Array<{
    name: string;
    value: [number, number];
  }>;
}

export function evaluateParameterValues(
  options: EvaluateParameterValuesOptions,
): Promise<ParameterEvaluationResult>;
```

The implementation loads the puppet in an isolated process, clears node parameter offsets, assigns requested parameter values, applies real `Parameter.update()` behavior, captures bound target values using the node’s semantic property getter, restores each parameter to its serialized default, clears/reapplies defaults, verifies the target values return to their default state, emits JSON, and exits. It never saves the transient evaluation state.

### Error contract

Add:

```ts
export class InvalidBindingError extends Error {
  readonly code = 'INVALID_BINDING';
}
```

Use it for missing/duplicate parameter names, invalid dimensions/ranges/defaults, missing/ambiguous target paths, unsupported target properties, malformed binding keypoints, missing parameter references, or binding/property incompatibility. Existing `OutputConflictError`, `InvalidPuppetError`, `NativeBridgeError`, and hierarchy errors retain their meanings.

---

## Acceptance Fixture

Build the #7 real-artifact acceptance from an ordinary generic puppet, not an application character:

```text
/Root
  /Rig
```

Create two 1D parameters:

```text
Move X
  range: [-1, 1]
  default: 0
  binding: /Root/Rig -> transform.t.x
  -1 => -20
  +1 => +20

Move Y
  range: [-1, 1]
  default: 0
  binding: /Root/Rig -> transform.t.y
  -1 => -12
  +1 => +12
```

Required runtime proof after save/reopen:

```text
set Move X = +1, Move Y = -1
→ parameter readback = [+1, -1]
→ /Root/Rig transform.t.x offset = +20
→ /Root/Rig transform.t.y offset = -12
→ restore defaults
→ both parameters = 0
→ both target offsets = 0
```

---

## File Structure Added/Modified by #7

```text
packages/core/src/
  inspection.ts                    # semantic binding inventory parser/types
  visual-authoring.ts              # extend edit operation union with parameter ops
  parameter-evaluation.ts          # transient evaluateParameterValues adapter/types
  errors.ts                        # InvalidBindingError
  index.ts                         # public exports

packages/core/test/
  inspection-parameters.test.ts    # parser RED/GREEN for semantic bindings
  parameter-authoring.test.ts      # request validation/error mapping
  parameter-evaluation.test.ts     # isolated-host adapter/error tests
  parameter-real-puppet.test.ts    # genuine .inp create/bind/save/reopen/evaluate/restore

native/bridge/
  source/iat_bridge.d              # parameter authoring + semantic inspection + evaluation ABI
  test/parameter_authoring_probe.d # separately linked real native acceptance

native/host/source/
  iat_native_host.d                # parameter edit/evaluate commands

scripts/native/
  build-host.mjs                   # build/run parameter probe options
  m2-parameter-ci.mjs              # authoritative #7 acceptance composition

.github/workflows/verify.yml       # native job invokes m2:parameter:ci
package.json                       # #7 scripts
README.md                          # parameter authoring/evaluation contract
```

Do not create a second semantic authoring engine. Existing visual operations and new parameter operations must flow through the same `editPuppet` transaction and native edit command.

---

### Task 1: Expose semantic binding inventory in inspection

**Files:**
- Modify: `packages/core/src/inspection.ts`
- Create: `packages/core/test/inspection-parameters.test.ts`
- Modify: `native/bridge/source/iat_bridge.d`

**Interfaces:**
- Consumes: current `PuppetInspectionParameter` and native `buildInspectionJson(Puppet)`.
- Produces: `PuppetInspectionParameter.bindings: PuppetInspectionParameterBinding[]` with target path/property/keypoints only.

- [ ] **Step 1: Write the parser RED**

Create a synthetic inspection object containing one parameter with one binding and assert `parsePuppetInspection()` preserves:

```ts
expect(parsed.parameters[0]?.bindings).toEqual([
  {
    targetPath: '/Root/Rig',
    property: 'transform.t.x',
    keypoints: [
      { index: [0, 0], parameterValue: [-1, 0], value: -20 },
      { index: [1, 0], parameterValue: [1, 0], value: 20 },
    ],
  },
]);
```

Also assert an unknown property such as `transform.magic` is rejected.

- [ ] **Step 2: Run the focused test and prove RED**

Run:

```bash
npm test -- packages/core/test/inspection-parameters.test.ts
```

Expected: FAIL because `PuppetInspectionParameter`/parser do not expose `bindings`.

- [ ] **Step 3: Implement semantic TypeScript parsing**

Add `ParameterBindingProperty`, `PuppetInspectionParameterBinding`, property validation, non-negative integer keypoint-index parsing, and binding-array parsing. For backward-safe parser behavior during the same branch, `bindings === undefined` may parse as `[]`; native acceptance later requires the field explicitly.

- [ ] **Step 4: Extend native inspection without leaking GUIDs**

For each `ParameterBinding`:

1. obtain `binding.getNode()` after puppet finalization;
2. derive its canonical semantic path using the same path builder used for node inventory;
3. use `binding.getName()` as the property string;
4. enumerate parameter axis-point grid coordinates;
5. include only user-set keypoints (`binding.isSet(index)`);
6. for `ValueParameterBinding`, read the float value at the keypoint;
7. include `parameter.getKeypointValue(index)` as `parameterValue`.

If a binding type is not a `ValueParameterBinding`, do not fabricate a scalar value; reject it from this v1 scalar-binding inspection path or omit it only when it is a known unsupported binding class and tests explicitly document that behavior. #7 authored bindings are `ValueParameterBinding` only.

- [ ] **Step 5: Verify existing inspection plus focused tests**

Run:

```bash
npm run typecheck
npm test -- packages/core/test/inspection.test.ts packages/core/test/inspection-parameters.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/inspection.ts packages/core/test/inspection-parameters.test.ts native/bridge/source/iat_bridge.d
git commit -m "feat: expose semantic parameter bindings"
```

---

### Task 2: Add parameter creation/binding operations to the real edit transaction

**Files:**
- Modify: `packages/core/src/visual-authoring.ts`
- Modify: `packages/core/src/errors.ts`
- Create: `packages/core/test/parameter-authoring.test.ts`
- Modify: `native/bridge/source/iat_bridge.d`
- Modify: `native/bridge/test/visual_authoring_probe.d`

**Interfaces:**
- Consumes: existing `editPuppet()` transaction and native edit request JSON.
- Produces: `parameter.create`, `parameter.bind`, and `parameter.unbind` operations.

- [ ] **Step 1: Write semantic validation RED tests**

Cover at minimum:

```text
blank parameter name -> InvalidBindingError
duplicate parameter name in one transaction -> InvalidBindingError
dimensions outside 1|2 -> InvalidBindingError
min >= max on an active dimension -> InvalidBindingError
default outside range -> InvalidBindingError
parameter.bind missing parameter -> InvalidBindingError
parameter.bind unknown property -> InvalidBindingError
parameter.bind empty keypoints -> InvalidBindingError
parameter.unbind missing binding -> InvalidBindingError
```

Use a fake host for unit tests so they prove semantic request/error mapping, not file compatibility.

- [ ] **Step 2: Prove RED**

Run:

```bash
npm test -- packages/core/test/parameter-authoring.test.ts
```

Expected: FAIL because the operation union/error mapping does not exist.

- [ ] **Step 3: Implement TypeScript request normalization**

Rename the canonical operation union to `PuppetEditOperation` and retain:

```ts
export type PuppetVisualEditOperation = PuppetEditOperation;
```

as a compatibility alias during v1. Validate finite numeric pairs and dimension-specific ranges before spawning the host. Map native binding validation exit/result to `InvalidBindingError`.

- [ ] **Step 4: Add a separately linked native RED before implementation**

Extend `visual_authoring_probe.d` or add `parameter_authoring_probe.d` so it sends a transaction containing:

```json
{"type":"node.create","parentPath":"/Root","name":"Rig"}
{"type":"parameter.create","name":"Move X","dimensions":1,"min":[-1,0],"max":[1,0],"defaultValue":[0,0]}
{"type":"parameter.bind","parameterName":"Move X","targetPath":"/Root/Rig","property":"transform.t.x","keypoints":[{"at":[-1,0],"value":-20},{"at":[1,0],"value":20}]}
```

Run the probe before implementing the native cases.

Expected: FAIL because the native edit command rejects unknown parameter operations.

- [ ] **Step 5: Implement native `parameter.create`**

Resolve names semantically and require uniqueness. Construct `new Parameter(name, dimensions == 2)`, set `min`, `max`, `defaults`, initialize `value = defaults`, and append it to `puppet.parameters`. For 1D, enforce Y min/max/default = `0` in the public request to keep the semantic contract unambiguous.

- [ ] **Step 6: Implement native `parameter.bind`**

Resolve the parameter by unique name and target by canonical path. Before creating the binding require `target.hasParam(property)`. Use `parameter.getOrAddBinding(target, property, false)` and require/cast `ValueParameterBinding`.

For each requested keypoint `at`:

1. map the semantic parameter value to an exact existing axis-point coordinate;
2. reject values that do not match an axis point within a small deterministic float tolerance (e.g. `1e-6`);
3. derive `vec2u` grid index;
4. call `setValue(index, value)`.

The v1 authoring contract does not silently insert new axis points.

- [ ] **Step 7: Implement `parameter.unbind`**

Find the binding by target + property and remove it from the parameter binding list using existing upstream parameter APIs where available. If no matching binding exists, fail closed as InvalidBinding rather than silently succeeding.

- [ ] **Step 8: Save, reopen, and assert bindings persist in native probe**

The probe must reopen the real output with pinned `inLoadPuppet`, assert two authored parameters/bindings by semantic name/target/property, and confirm inspection JSON contains the expected keypoints.

- [ ] **Step 9: Verify**

Run:

```bash
npm run m2:visual:ci
npm test -- packages/core/test/parameter-authoring.test.ts
```

Expected: prior M2 gate remains PASS and parameter authoring tests/probe PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src packages/core/test/parameter-authoring.test.ts native/bridge/source/iat_bridge.d native/bridge/test
git commit -m "feat: author semantic parameter bindings"
```

---

### Task 3: Prove transient set → readback → restore through the real native path

**Files:**
- Create: `packages/core/src/parameter-evaluation.ts`
- Create: `packages/core/test/parameter-evaluation.test.ts`
- Modify: `packages/core/src/native-host.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `native/bridge/source/iat_bridge.d`
- Modify: `native/host/source/iat_native_host.d`
- Create: `native/bridge/test/parameter_evaluation_probe.d`
- Modify: `scripts/native/build-host.mjs`

**Interfaces:**
- Produces private C ABI operation returning bounded semantic JSON for one evaluation lifecycle.
- Produces public `evaluateParameterValues(options)`; no native state escapes the call.

- [ ] **Step 1: Write adapter RED tests**

Use a fake host and assert:

```text
valid host JSON -> typed ParameterEvaluationResult
missing parameter -> InvalidBindingError
out-of-range value -> InvalidBindingError
malformed host JSON -> NativeBridgeError
non-binding native failure -> NativeBridgeError
```

- [ ] **Step 2: Prove RED**

Run:

```bash
npm test -- packages/core/test/parameter-evaluation.test.ts
```

Expected: FAIL because `evaluateParameterValues` does not exist.

- [ ] **Step 3: Add a separately linked native evaluation RED**

Generate/reuse a real puppet containing `Move X` and `Move Y`. The probe calls the future evaluation ABI with values:

```json
{"Move X":[1,0],"Move Y":[-1,0]}
```

Expected before implementation: link failure or explicit missing-operation failure.

- [ ] **Step 4: Implement one isolated evaluation lifecycle**

Native logic:

1. load `.inp` through pinned `inLoadPuppet`;
2. resolve each requested parameter uniquely by name;
3. validate dimensions and range;
4. record each parameter default and each bound target property default;
5. run the normal parameter application sequence: clear node offsets via the puppet/node pre-update path, assign requested parameter values, call real parameter update behavior, and capture `target.getValue(property)`;
6. restore every parameter to `defaults`;
7. clear offsets and reapply default parameter values;
8. capture restored parameter and target states;
9. fail if restoration differs from expected defaults beyond a small deterministic float tolerance;
10. return semantic JSON and destroy process-local state on exit.

Do not save the evaluated puppet.

- [ ] **Step 5: Implement process-host command and TypeScript parser**

Add host command such as:

```text
iat_native_host evaluate-parameters <input.inp> <request-json>
```

Keep the same bounded stdout/stderr behavior used by inspection/edit operations. Public API validates finite pairs before spawning.

- [ ] **Step 6: Verify real readback/restore**

Native probe must assert:

```text
Move X applied value = [1,0]
Move Y applied value = [-1,0]
/Root/Rig transform.t.x applied = 20
/Root/Rig transform.t.y applied = -12
restored Move X = [0,0]
restored Move Y = [0,0]
restored transform.t.x = 0
restored transform.t.y = 0
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src packages/core/test/parameter-evaluation.test.ts native/bridge native/host scripts/native/build-host.mjs
git commit -m "feat: evaluate and restore parameter values"
```

---

### Task 4: Add the genuine `.inp` end-to-end #7 acceptance

**Files:**
- Create: `packages/core/test/parameter-real-puppet.test.ts`
- Modify: `scripts/native/build-host.mjs` as needed for generated acceptance paths only

**Interfaces:**
- Consumes: `createPuppet`, `editPuppet`, `inspectPuppet`, `evaluateParameterValues`.
- Produces: one real-artifact acceptance proving #7 requirements from the public semantic core.

- [ ] **Step 1: Write the real integration test**

Test flow:

```ts
const created = await createPuppet({ outputPath: input, name: 'M2 Parameter Fixture' });

await editPuppet({
  inputPath: input,
  outputPath: authored,
  operations: [
    { type: 'node.create', parentPath: '/Root', name: 'Rig' },
    {
      type: 'parameter.create', name: 'Move X', dimensions: 1,
      min: [-1, 0], max: [1, 0], defaultValue: [0, 0],
    },
    {
      type: 'parameter.create', name: 'Move Y', dimensions: 1,
      min: [-1, 0], max: [1, 0], defaultValue: [0, 0],
    },
    {
      type: 'parameter.bind', parameterName: 'Move X',
      targetPath: '/Root/Rig', property: 'transform.t.x',
      keypoints: [{ at: [-1, 0], value: -20 }, { at: [1, 0], value: 20 }],
    },
    {
      type: 'parameter.bind', parameterName: 'Move Y',
      targetPath: '/Root/Rig', property: 'transform.t.y',
      keypoints: [{ at: [-1, 0], value: -12 }, { at: [1, 0], value: 12 }],
    },
  ],
});
```

Then:

1. reopen through `inspectPuppet(authored)`;
2. assert two parameter definitions and semantic bindings survived;
3. call `evaluateParameterValues({ inputPath: authored, values: { 'Move X': [1,0], 'Move Y': [-1,0] } })`;
4. assert applied target values +20 / -12 and restored values 0 / 0;
5. byte-compare/hash the original input before/after to prove no in-place mutation;
6. pre-create a conflicting output path and assert edit fails without replacing it.

- [ ] **Step 2: Run and prove RED if any public/native layer is not yet connected**

Run with the same environment convention used by the existing real M2 tests.

Expected before all layers are complete: focused failure naming the missing parameter capability.

- [ ] **Step 3: Complete only the missing connection and rerun**

Do not weaken assertions or replace the real `.inp` with JSON fixtures.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm run typecheck
npm test -- packages/core/test/parameter-real-puppet.test.ts
```

with the generated native host/artifact environment enabled.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/test/parameter-real-puppet.test.ts
git commit -m "test: prove real parameter binding round trip"
```

---

### Task 5: Make #7 acceptance authoritative in CI and documentation

**Files:**
- Create: `scripts/native/m2-parameter-ci.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/verify.yml`
- Modify: `README.md`

**Interfaces:**
- Produces root command `npm run m2:parameter:ci`.
- CI native job executes `m2:parameter:ci` as the exact-head #7 gate.

- [ ] **Step 1: Compose the authoritative script**

`m2-parameter-ci.mjs` must run, in order:

```text
npm run m2:visual:ci
build/run separately linked parameter authoring probe
build/run separately linked parameter evaluation probe
build native host
npm run typecheck
full npm test with real-parameter integration environment enabled
```

Propagate the first non-zero exit code. Do not duplicate business logic in the script.

- [ ] **Step 2: Wire package script and Actions**

Add:

```json
"m2:parameter:ci": "node scripts/native/m2-parameter-ci.mjs"
```

and replace the native workflow’s previous `m2:visual:ci` invocation with `npm run m2:parameter:ci`.

- [ ] **Step 3: Document the public semantic surface**

README must show:

- `parameter.create`, `parameter.bind`, `parameter.unbind` inside `editPuppet`;
- canonical node-path/property binding contract;
- `evaluateParameterValues` as transient process-isolated evaluation, not persisted runtime state;
- typed `InvalidBindingError` behavior;
- no GUID/pointer/native handle exposure;
- Creator validation remains #8.

- [ ] **Step 4: Run the exact full gate**

Run:

```bash
npm run m2:parameter:ci
```

Expected: all M0/M1/#6 gates remain PASS; parameter probes, public real-artifact test, typecheck, and full suite PASS.

- [ ] **Step 5: Final review checklist before readiness**

Verify against Issue #7:

```text
[ ] strict RED → GREEN evidence exists
[ ] real reopened puppet contains >=2 parameters
[ ] both bindings survive serialization/reopen
[ ] real native set → readback → restore proven for both
[ ] invalid target/property/dimension/range fail closed
[ ] public API has no GUID/slot/pointer/native handle requirement
[ ] exact-head Verify / m2:parameter:ci green
[ ] 0 unresolved review threads
```

- [ ] **Step 6: Commit**

```bash
git add scripts/native/m2-parameter-ci.mjs package.json .github/workflows/verify.yml README.md
git commit -m "ci: gate M2 parameter authoring acceptance"
```

---

## Completion Boundary

Issue #7 is complete only after the exact current PR head satisfies all five tasks and the real-artifact acceptance demonstrates two persistent bindings plus transient set/readback/restore. Do not expand #7 into Creator automation, rendering, physics authoring, CLI, MCP, or application-specific rigging. Issue #8 owns official Creator compatibility.