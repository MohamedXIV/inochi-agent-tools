import { InvalidAuthoringRequestError, InvalidBindingError } from './errors.js';
import type { PuppetEditOperation } from './visual-authoring.js';

export interface TwoAxisTranslationTarget {
  path: string;
  /** Maximum absolute X translation at normalized parameter value +/-1. */
  x: number;
  /** Maximum absolute Y translation at normalized parameter value +/-1. */
  y: number;
}

export interface TwoAxisTranslationRigRecipe {
  parameterNames: {
    x: string;
    y: string;
  };
  targets: TwoAxisTranslationTarget[];
}

function requireSemanticText(value: string, label: string): void {
  if (!value.trim()) throw new InvalidAuthoringRequestError(`${label} must not be blank`);
  if (value.includes('\0')) throw new InvalidAuthoringRequestError(`${label} must not contain NUL`);
}

function requireFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new InvalidBindingError(`${label} must be finite`);
  if (value < 0) throw new InvalidBindingError(`${label} must not be negative`);
}

/**
 * Compile a normalized two-axis movement recipe into ordinary semantic authoring
 * operations. The helper owns no hidden state: callers can inspect, edit, or
 * submit the returned operations through the same editPuppet authority.
 */
export function compileTwoAxisTranslationRig(
  recipe: TwoAxisTranslationRigRecipe,
): PuppetEditOperation[] {
  requireSemanticText(recipe.parameterNames.x, 'X parameter name');
  requireSemanticText(recipe.parameterNames.y, 'Y parameter name');
  if (recipe.parameterNames.x === recipe.parameterNames.y) {
    throw new InvalidBindingError('X and Y parameter names must be distinct');
  }
  if (!Array.isArray(recipe.targets) || recipe.targets.length === 0) {
    throw new InvalidAuthoringRequestError('Two-axis translation rig requires at least one target');
  }

  const targets = recipe.targets.map((target, index) => {
    requireSemanticText(target.path, `Target ${index} path`);
    requireFiniteNonNegative(target.x, `Target ${index} X translation`);
    requireFiniteNonNegative(target.y, `Target ${index} Y translation`);
    if (target.x === 0 && target.y === 0) {
      throw new InvalidBindingError(`Target ${index} must move on at least one axis`);
    }
    return { ...target };
  }).sort((left, right) => left.path.localeCompare(right.path));

  for (let index = 1; index < targets.length; index += 1) {
    if (targets[index - 1]!.path === targets[index]!.path) {
      throw new InvalidAuthoringRequestError(
        `Duplicate translation target path: ${targets[index]!.path}`,
      );
    }
  }

  const operations: PuppetEditOperation[] = [
    {
      type: 'parameter.create',
      name: recipe.parameterNames.x,
      dimensions: 1,
      min: [-1, 0],
      max: [1, 0],
      defaultValue: [0, 0],
    },
    {
      type: 'parameter.create',
      name: recipe.parameterNames.y,
      dimensions: 1,
      min: [-1, 0],
      max: [1, 0],
      defaultValue: [0, 0],
    },
  ];

  for (const target of targets) {
    if (target.x > 0) {
      operations.push({
        type: 'parameter.bind',
        parameterName: recipe.parameterNames.x,
        targetPath: target.path,
        property: 'transform.t.x',
        keypoints: [
          { at: [-1, 0], value: -target.x },
          { at: [1, 0], value: target.x },
        ],
      });
    }
    if (target.y > 0) {
      operations.push({
        type: 'parameter.bind',
        parameterName: recipe.parameterNames.y,
        targetPath: target.path,
        property: 'transform.t.y',
        keypoints: [
          { at: [-1, 0], value: -target.y },
          { at: [1, 0], value: target.y },
        ],
      });
    }
  }

  return operations;
}
