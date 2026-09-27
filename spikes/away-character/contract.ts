import { compileTwoAxisTranslationRig } from '../../packages/core/src/rig-recipes.js';
import type { NumericPair } from '../../packages/core/src/inspection.js';
import type { PreviewParameterValues } from '../../packages/core/src/preview.js';
import type { MeshTopology, PuppetEditOperation } from '../../packages/core/src/visual-authoring.js';

export type AwayMorphId =
  | 'body.mass'
  | 'face.roundness'
  | 'face.turn.x'
  | 'face.turn.y';

export type AwaySlotId = 'hair.front' | 'clothing.top';
export type AwayTintId = 'hair';
export type AwayExpressionId = 'neutral' | 'awkward_smile';

interface MorphMapping {
  parameterName: string;
  min: number;
  max: number;
  defaultValue: number;
}

interface SlotVariant {
  controlValue: -1 | 1;
  tags: readonly string[];
  excludesTags?: readonly string[];
}

interface SlotMapping {
  parameterName: string;
  variants: Readonly<Record<string, SlotVariant>>;
}

interface TintMapping {
  parameters: Readonly<{ r: string; g: string; b: string }>;
}

interface ExpressionMapping {
  values: Readonly<Record<string, number>>;
}

export interface AwayCharacterContract {
  contractVersion: 1;
  baseTags: readonly string[];
  morphs: Readonly<Record<AwayMorphId, MorphMapping>>;
  slots: Readonly<Record<AwaySlotId, SlotMapping>>;
  tints: Readonly<Record<AwayTintId, TintMapping>>;
  expressions: Readonly<Record<AwayExpressionId, ExpressionMapping>>;
}

export const AWAY_CHARACTER_CONTRACT: AwayCharacterContract = {
  contractVersion: 1,
  baseTags: ['body.standard', 'head.standard'],
  morphs: {
    'body.mass': { parameterName: 'Body Mass', min: -1, max: 1, defaultValue: 0 },
    'face.roundness': { parameterName: 'Face Roundness', min: -1, max: 1, defaultValue: 0 },
    'face.turn.x': { parameterName: 'Head X', min: -1, max: 1, defaultValue: 0 },
    'face.turn.y': { parameterName: 'Head Y', min: -1, max: 1, defaultValue: 0 },
  },
  slots: {
    'hair.front': {
      parameterName: 'Hair Style',
      variants: {
        short: { controlValue: -1, tags: ['hair.short'] },
        long: { controlValue: 1, tags: ['hair.long'], excludesTags: ['collar.high'] },
      },
    },
    'clothing.top': {
      parameterName: 'Top Style',
      variants: {
        tee: { controlValue: -1, tags: ['top.tee', 'collar.low'] },
        jacket: { controlValue: 1, tags: ['top.jacket', 'collar.high'] },
      },
    },
  },
  tints: {
    hair: {
      parameters: {
        r: 'Hair Tint R',
        g: 'Hair Tint G',
        b: 'Hair Tint B',
      },
    },
  },
  expressions: {
    neutral: { values: { Smile: 0 } },
    awkward_smile: { values: { Smile: 1 } },
  },
};

export interface AwayCharacterState {
  morphs?: Partial<Record<AwayMorphId, number>>;
  slots: Record<AwaySlotId, string>;
  tints: Record<AwayTintId, string>;
  expression: AwayExpressionId;
}

export interface AwayPreviewMatrixEntry {
  id: string;
  state: AwayCharacterState;
}

const KNOWN_MORPHS = new Set(Object.keys(AWAY_CHARACTER_CONTRACT.morphs));
const KNOWN_SLOTS = new Set(Object.keys(AWAY_CHARACTER_CONTRACT.slots));
const KNOWN_TINTS = new Set(Object.keys(AWAY_CHARACTER_CONTRACT.tints));
const KNOWN_EXPRESSIONS = new Set(Object.keys(AWAY_CHARACTER_CONTRACT.expressions));

function fail(message: string): never {
  throw new Error(`Away character contract: ${message}`);
}

function requireNormalized(value: number, label: string): number {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    fail(`${label} must be a finite value in [-1, 1]`);
  }
  return value;
}

function parseHexColor(value: string, label: string): [number, number, number] {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) fail(`${label} must be a #RRGGBB color`);
  return [
    Number.parseInt(value.slice(1, 3), 16) / 255,
    Number.parseInt(value.slice(3, 5), 16) / 255,
    Number.parseInt(value.slice(5, 7), 16) / 255,
  ];
}

function unitToControl(value: number): number {
  return (value * 2) - 1;
}

function pair(value: number): NumericPair {
  return [value, 0];
}

function quad(x0: number, y0: number, x1: number, y1: number): MeshTopology {
  return {
    vertices: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
    uvs: [[0, 1], [1, 1], [1, 0], [0, 0]],
    indices: [0, 1, 2, 2, 3, 0],
  };
}

function addScalarParameter(
  operations: PuppetEditOperation[],
  name: string,
  bindings: Array<{
    targetPath: string;
    property: 'opacity' | 'tint.r' | 'tint.g' | 'tint.b' |
      'transform.t.y' | 'transform.s.x';
    low: number;
    high: number;
  }>,
): void {
  operations.push({
    type: 'parameter.create',
    name,
    dimensions: 1,
    min: [-1, 0],
    max: [1, 0],
    defaultValue: [0, 0],
  });
  for (const binding of bindings) {
    operations.push({
      type: 'parameter.bind',
      parameterName: name,
      targetPath: binding.targetPath,
      property: binding.property,
      keypoints: [
        { at: [-1, 0], value: binding.low },
        { at: [1, 0], value: binding.high },
      ],
    });
  }
}

export function validateAwayCharacterContract(contract: AwayCharacterContract): void {
  if (contract.contractVersion !== 1) fail('unsupported contract version');

  const parameterNames = new Set<string>();
  for (const [semanticName, morph] of Object.entries(contract.morphs)) {
    if (!semanticName.trim() || !morph.parameterName.trim()) fail('morph names must not be blank');
    if (morph.min >= morph.max || morph.defaultValue < morph.min || morph.defaultValue > morph.max) {
      fail(`invalid morph bounds/default for ${semanticName}`);
    }
    if (parameterNames.has(morph.parameterName)) fail(`duplicate parameter mapping: ${morph.parameterName}`);
    parameterNames.add(morph.parameterName);
  }

  for (const [slotName, slot] of Object.entries(contract.slots)) {
    if (!slotName.trim() || !slot.parameterName.trim()) fail('slot names must not be blank');
    const variants = Object.entries(slot.variants);
    if (variants.length < 2) fail(`slot ${slotName} must expose at least two variants`);
    if (parameterNames.has(slot.parameterName)) fail(`duplicate parameter mapping: ${slot.parameterName}`);
    parameterNames.add(slot.parameterName);
  }

  for (const [tintName, tint] of Object.entries(contract.tints)) {
    if (!tintName.trim()) fail('tint names must not be blank');
    for (const parameterName of Object.values(tint.parameters)) {
      if (!parameterName.trim() || parameterNames.has(parameterName)) {
        fail(`invalid or duplicate tint parameter: ${parameterName}`);
      }
      parameterNames.add(parameterName);
    }
  }

  for (const [expressionName, expression] of Object.entries(contract.expressions)) {
    if (!expressionName.trim() || Object.keys(expression.values).length === 0) {
      fail('expressions must have a semantic name and at least one mapped value');
    }
  }
}

function validateStateKeys(state: AwayCharacterState): void {
  for (const key of Object.keys(state.morphs ?? {})) {
    if (!KNOWN_MORPHS.has(key)) fail(`unknown morph ${key}`);
  }
  for (const key of Object.keys(state.slots)) {
    if (!KNOWN_SLOTS.has(key)) fail(`unknown slot ${key}`);
  }
  for (const key of Object.keys(state.tints)) {
    if (!KNOWN_TINTS.has(key)) fail(`unknown tint ${key}`);
  }
  if (!KNOWN_EXPRESSIONS.has(state.expression)) fail(`unknown expression ${state.expression}`);
}

function selectedVariant(
  slotId: AwaySlotId,
  variantId: string,
): SlotVariant {
  const slot = AWAY_CHARACTER_CONTRACT.slots[slotId];
  const variant = slot.variants[variantId];
  if (!variant) fail(`unknown variant ${variantId} for slot ${slotId}`);
  return variant;
}

function validateCompatibility(state: AwayCharacterState): void {
  const selected: SlotVariant[] = [];
  for (const slotId of Object.keys(AWAY_CHARACTER_CONTRACT.slots) as AwaySlotId[]) {
    const variantId = state.slots[slotId];
    if (!variantId) fail(`missing required slot selection ${slotId}`);
    selected.push(selectedVariant(slotId, variantId));
  }

  const tags = new Set<string>(AWAY_CHARACTER_CONTRACT.baseTags);
  for (const variant of selected) for (const tag of variant.tags) tags.add(tag);

  for (const variant of selected) {
    for (const excluded of variant.excludesTags ?? []) {
      if (tags.has(excluded)) fail(`incompatible slot combination: excluded tag ${excluded}`);
    }
  }
}

export function resolveAwayCharacterState(state: AwayCharacterState): PreviewParameterValues {
  validateAwayCharacterContract(AWAY_CHARACTER_CONTRACT);
  validateStateKeys(state);
  validateCompatibility(state);

  const values: Record<string, readonly [number, number]> = {};
  for (const [semanticName, mapping] of Object.entries(AWAY_CHARACTER_CONTRACT.morphs) as
    Array<[AwayMorphId, MorphMapping]>) {
    const requested = state.morphs?.[semanticName] ?? mapping.defaultValue;
    values[mapping.parameterName] = pair(requireNormalized(requested, semanticName));
  }

  for (const slotId of Object.keys(AWAY_CHARACTER_CONTRACT.slots) as AwaySlotId[]) {
    const slot = AWAY_CHARACTER_CONTRACT.slots[slotId];
    const variant = selectedVariant(slotId, state.slots[slotId]);
    values[slot.parameterName] = pair(variant.controlValue);
  }

  const hair = parseHexColor(state.tints.hair, 'hair tint');
  const tint = AWAY_CHARACTER_CONTRACT.tints.hair.parameters;
  values[tint.r] = pair(unitToControl(hair[0]));
  values[tint.g] = pair(unitToControl(hair[1]));
  values[tint.b] = pair(unitToControl(hair[2]));

  const expression = AWAY_CHARACTER_CONTRACT.expressions[state.expression];
  for (const [parameterName, value] of Object.entries(expression.values)) {
    values[parameterName] = pair(requireNormalized(value, `expression ${state.expression}`));
  }

  return values;
}

export function compileAwayCharacterOperations(imagePath: string): PuppetEditOperation[] {
  if (!imagePath.trim()) fail('imagePath must not be blank');
  validateAwayCharacterContract(AWAY_CHARACTER_CONTRACT);

  const partSpecs = [
    { key: 'body', name: 'Body', mesh: quad(-6, -8, 6, 0) },
    { key: 'face', name: 'Face', mesh: quad(-4, -2, 4, 6) },
    { key: 'mouth', name: 'Mouth', mesh: quad(-2, -1, 2, 0.5) },
    { key: 'hair-front', name: 'HairFront', mesh: quad(-4.5, 2, 4.5, 6.5) },
    { key: 'hair-alt', name: 'HairAlt', mesh: quad(-5.5, -1, 5.5, 6.5) },
    { key: 'top', name: 'Top', mesh: quad(-5.5, -8, 5.5, -1.5) },
    { key: 'jacket', name: 'Jacket', mesh: quad(-6.5, -9, 6.5, -1) },
  ] as const;

  const operations: PuppetEditOperation[] = [];
  for (const part of partSpecs) {
    operations.push({ type: 'texture.import', key: part.key, imagePath });
    operations.push({ type: 'part.create', parentPath: '/Root', name: part.name, textureKey: part.key });
    operations.push({ type: 'part.setMesh', path: `/Root/${part.name}`, mesh: part.mesh });
  }

  operations.push(...compileTwoAxisTranslationRig({
    parameterNames: { x: 'Head X', y: 'Head Y' },
    targets: [
      { path: '/Root/Face', x: 0.8, y: 0.55 },
      { path: '/Root/HairFront', x: 1.1, y: 0.7 },
      { path: '/Root/Mouth', x: 0.65, y: 0.45 },
    ],
  }));

  addScalarParameter(operations, 'Body Mass', [
    { targetPath: '/Root/Body', property: 'transform.s.x', low: 0.82, high: 1.18 },
  ]);
  addScalarParameter(operations, 'Face Roundness', [
    { targetPath: '/Root/Face', property: 'transform.s.x', low: 0.86, high: 1.14 },
  ]);
  addScalarParameter(operations, 'Hair Style', [
    { targetPath: '/Root/HairFront', property: 'opacity', low: 1, high: 0 },
    { targetPath: '/Root/HairAlt', property: 'opacity', low: 0, high: 1 },
  ]);
  addScalarParameter(operations, 'Top Style', [
    { targetPath: '/Root/Top', property: 'opacity', low: 1, high: 0 },
    { targetPath: '/Root/Jacket', property: 'opacity', low: 0, high: 1 },
  ]);
  addScalarParameter(operations, 'Smile', [
    { targetPath: '/Root/Mouth', property: 'transform.s.x', low: 0.85, high: 1.3 },
    { targetPath: '/Root/Mouth', property: 'transform.t.y', low: -0.15, high: 0.4 },
  ]);

  for (const channel of ['r', 'g', 'b'] as const) {
    const property = `tint.${channel}` as const;
    const parameterName = AWAY_CHARACTER_CONTRACT.tints.hair.parameters[channel];
    addScalarParameter(operations, parameterName, [
      { targetPath: '/Root/HairFront', property, low: 0, high: 1 },
      { targetPath: '/Root/HairAlt', property, low: 0, high: 1 },
    ]);
  }

  return operations;
}

export const AWAY_PREVIEW_MATRIX: readonly AwayPreviewMatrixEntry[] = [
  {
    id: 'compact-short-tee-neutral',
    state: {
      morphs: {
        'body.mass': -1,
        'face.roundness': -1,
        'face.turn.x': -0.6,
        'face.turn.y': -0.35,
      },
      slots: { 'hair.front': 'short', 'clothing.top': 'tee' },
      tints: { hair: '#4b2618' },
      expression: 'neutral',
    },
  },
  {
    id: 'round-short-jacket-smile',
    state: {
      morphs: {
        'body.mass': 1,
        'face.roundness': 1,
        'face.turn.x': 0.55,
        'face.turn.y': 0.25,
      },
      slots: { 'hair.front': 'short', 'clothing.top': 'jacket' },
      tints: { hair: '#c9864d' },
      expression: 'awkward_smile',
    },
  },
  {
    id: 'round-long-tee-smile',
    state: {
      morphs: {
        'body.mass': 0.45,
        'face.roundness': 0.9,
        'face.turn.x': 0.2,
        'face.turn.y': -0.15,
      },
      slots: { 'hair.front': 'long', 'clothing.top': 'tee' },
      tints: { hair: '#70452c' },
      expression: 'awkward_smile',
    },
  },
  {
    id: 'compact-long-tee-neutral',
    state: {
      morphs: {
        'body.mass': -0.5,
        'face.roundness': -0.8,
        'face.turn.x': -0.15,
        'face.turn.y': 0.4,
      },
      slots: { 'hair.front': 'long', 'clothing.top': 'tee' },
      tints: { hair: '#d1a36d' },
      expression: 'neutral',
    },
  },
] as const;
