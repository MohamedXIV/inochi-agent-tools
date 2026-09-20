import type { NodeKind, ParameterBindingProperty } from './inspection.js';

export interface ParameterBindingCapability {
  property: ParameterBindingProperty;
  targetKinds: readonly NodeKind[];
  value?: {
    min?: number;
    max?: number;
  };
}

const CAPABILITIES: readonly ParameterBindingCapability[] = [
  { property: 'zSort', targetKinds: ['node', 'part', 'mesh-deformer', 'other'] },
  { property: 'opacity', targetKinds: ['part'], value: { min: 0, max: 1 } },
  { property: 'transform.t.x', targetKinds: ['node', 'part', 'mesh-deformer', 'other'] },
  { property: 'transform.t.y', targetKinds: ['node', 'part', 'mesh-deformer', 'other'] },
  { property: 'transform.t.z', targetKinds: ['node', 'part', 'mesh-deformer', 'other'] },
  { property: 'transform.r.x', targetKinds: ['node', 'part', 'mesh-deformer', 'other'] },
  { property: 'transform.r.y', targetKinds: ['node', 'part', 'mesh-deformer', 'other'] },
  { property: 'transform.r.z', targetKinds: ['node', 'part', 'mesh-deformer', 'other'] },
  { property: 'transform.s.x', targetKinds: ['node', 'part', 'mesh-deformer', 'other'] },
  { property: 'transform.s.y', targetKinds: ['node', 'part', 'mesh-deformer', 'other'] },
] as const;

/**
 * Returns the stable semantic parameter-binding surface supported by this build.
 * Native enum values and implementation-specific handles are intentionally absent.
 */
export function parameterBindingCapabilities(): readonly ParameterBindingCapability[] {
  return CAPABILITIES;
}
