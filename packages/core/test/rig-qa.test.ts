import { describe, expect, it } from 'vitest';

import {
  analyzeRigQaInspection,
  analyzeRigQaRenderedEvidence,
  buildRigQaMatrix,
  parsePuppetInspection,
  type RigQaRenderedEvidence,
  type StandardCharacterRigBuildPlan,
} from '../src/index.js';

const fingerprint = 'a'.repeat(64);

const basePlan: StandardCharacterRigBuildPlan = {
  schemaVersion: 1,
  projectFingerprint: fingerprint,
  fingerprint,
  motions: [{
    motionId: 'headX',
    kind: 'transform',
    axis: 'x',
    parameterName: 'Head X',
    property: 'transform.t.x',
    valueMode: 'direct',
    gain: 1,
    mirror: 'same',
    targets: [{
      layerId: 'head',
      path: '/Root/Head',
      sign: 1,
      keypoints: [
        { at: [-10, 0], value: -10 },
        { at: [10, 0], value: 10 },
      ],
    }],
  }],
  operations: [
    {
      type: 'parameter.create',
      name: 'Head X',
      dimensions: 1,
      min: [-10, 0],
      max: [10, 0],
      defaultValue: [0, 0],
    },
    {
      type: 'parameter.bind',
      parameterName: 'Head X',
      targetPath: '/Root/Head',
      property: 'transform.t.x',
      keypoints: [
        { at: [-10, 0], value: -10 },
        { at: [10, 0], value: 10 },
      ],
    },
  ],
};

function inspection(options: {
  parameter?: boolean;
  binding?: boolean;
  rightNode?: boolean;
  wrongRange?: boolean;
  degenerate?: boolean;
} = {}) {
  const withParameter = options.parameter ?? true;
  const withBinding = options.binding ?? true;
  const nodes: unknown[] = [
    { path: '/Root', name: 'Root', kind: 'node', childCount: options.rightNode ? 2 : 1, textures: [] },
    {
      path: '/Root/Head',
      name: 'Head',
      kind: 'part',
      childCount: 0,
      textures: [],
      mesh: options.degenerate
        ? {
            vertices: [[0, 0], [1, 0], [2, 0]],
            uvs: [[0, 0], [0.5, 0], [1, 0]],
            indices: [0, 1, 2],
          }
        : {
            vertices: [[0, 0], [2, 0], [0, 2]],
            uvs: [[0, 0], [1, 0], [0, 1]],
            indices: [0, 1, 2],
          },
    },
  ];
  if (options.rightNode) {
    nodes.push({
      path: '/Root/Right',
      name: 'Right',
      kind: 'part',
      childCount: 0,
      textures: [],
      mesh: {
        vertices: [[0, 0], [2, 0], [0, 2]],
        uvs: [[0, 0], [1, 0], [0, 1]],
        indices: [0, 1, 2],
      },
    });
  }
  return parsePuppetInspection({
    schemaVersion: 1,
    metadata: { name: 'QA fixture', inochiVersion: '0.8.7', rigger: '', artist: '' },
    nodes,
    parameters: withParameter ? [{
      name: 'Head X',
      dimensions: 1,
      min: options.wrongRange ? [-5, 0] : [-10, 0],
      max: [10, 0],
      defaultValue: [0, 0],
      value: [0, 0],
      bindings: withBinding ? [{
        targetPath: '/Root/Head',
        property: 'transform.t.x',
        keypoints: [
          { index: [0, 0], parameterValue: [-10, 0], value: -10 },
          { index: [1, 0], parameterValue: [10, 0], value: 10 },
        ],
      }] : [],
    }] : [],
    textures: [],
    textureCount: 0,
    summary: {
      nodeCount: nodes.length,
      partCount: nodes.length - 1,
      parameterCount: withParameter ? 1 : 0,
      textureCount: 0,
    },
  });
}

function frame(
  sample: RigQaRenderedEvidence['sample'],
  sha256: string,
  alpha: number[],
  coveredPixelSamples = 4,
): RigQaRenderedEvidence {
  return {
    sample,
    artifact: sample.id + '.png',
    sha256,
    alpha: { width: 2, height: 2, alpha: Uint8Array.from(alpha) },
    metadata: {
      schemaVersion: 1,
      kind: 'inochi2d-headless-preview',
      commandCount: 1,
      drawableCommandCount: 1,
      texturedCommandCount: 1,
      vertexCount: 3,
      indexCount: 3,
      hasRenderableContent: coveredPixelSamples > 0,
      bounds: coveredPixelSamples > 0 ? { minX: -1, minY: -1, maxX: 1, maxY: 1 } : null,
      states: {},
      width: 2,
      height: 2,
      triangleCount: 1,
      coveredPixelSamples,
    },
  };
}

describe('v2 rig QA planning and diagnostics', () => {
  it('builds a deterministic bounded neutral/extreme/combination matrix', () => {
    const first = buildRigQaMatrix(basePlan);
    const second = buildRigQaMatrix(basePlan);

    expect(second).toEqual(first);
    expect(first.map((sample) => sample.id)).toEqual([
      'neutral',
      'headX-min',
      'headX-max',
      'combined-min',
      'combined-max',
    ]);
    expect(first[0]!.parameters).toEqual({ 'Head X': [0, 0] });
    expect(first[1]!.parameters).toEqual({ 'Head X': [-10, 0] });
    expect(first[2]!.parameters).toEqual({ 'Head X': [10, 0] });
  });

  it('emits semantic machine-readable diagnostics for broken authored structure', () => {
    const brokenPlan: StandardCharacterRigBuildPlan = {
      ...basePlan,
      motions: [{
        ...basePlan.motions[0]!,
        mirror: 'opposed',
        targets: [
          basePlan.motions[0]!.targets[0]!,
          {
            layerId: 'right',
            path: '/Root/Right',
            sign: 1,
            keypoints: [
              { at: [-10, 0], value: -10 },
              { at: [10, 0], value: 10 },
            ],
          },
        ],
      }],
    };
    const diagnostics = analyzeRigQaInspection(
      brokenPlan,
      inspection({ binding: false, wrongRange: true, degenerate: true }),
    );

    expect(diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'PARAMETER_RANGE_MISMATCH',
      'MISSING_BINDING',
      'MISSING_TARGET',
      'DEGENERATE_GEOMETRY',
      'BROKEN_SYMMETRY',
    ]));
    expect(diagnostics.every((entry) =>
      entry.semanticTarget.length > 0 &&
      entry.suggestedRemediation.length > 0 &&
      typeof entry.evidence === 'object')).toBe(true);
  });

  it('reports missing parameters explicitly instead of inferring native IDs', () => {
    expect(analyzeRigQaInspection(basePlan, inspection({ parameter: false })))
      .toContainEqual(expect.objectContaining({
        code: 'MISSING_PARAMETER',
        semanticTarget: 'headX',
        suggestedRemediation: 'binding',
      }));
  });

  it('detects no-motion and disappearing renders with reproducible image evidence', () => {
    const samples = buildRigQaMatrix(basePlan);
    const evidence = [
      frame(samples[0]!, 'neutral', [255, 255, 255, 255]),
      frame(samples[1]!, 'same', [255, 0, 0, 0], 1),
      frame(samples[2]!, 'same', [255, 0, 0, 0], 1),
      frame(samples[3]!, 'min-all', [255, 255, 0, 0], 2),
      frame(samples[4]!, 'max-all', [255, 255, 255, 0], 3),
    ];

    const result = analyzeRigQaRenderedEvidence(basePlan, evidence, { minCoverageRatio: 0.5 });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'NO_EXPECTED_MOTION',
      semanticTarget: 'headX',
      suggestedRemediation: 'binding',
    }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'DISAPPEARING_CONTENT',
      sampleId: 'headX-min',
      suggestedRemediation: 'range',
    }));
    expect(result.samples.find((sample) => sample.id === 'headX-min')?.comparisonToNeutral)
      .toMatchObject({
        sameHash: false,
        alphaChangedPixels: 3,
        alphaChangedRatio: 0.75,
        coverageRatio: 0.25,
      });
  });
});
