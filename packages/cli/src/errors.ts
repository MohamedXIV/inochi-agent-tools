import {
  InvalidAuthoringRequestError,
  InvalidBindingError,
  InvalidHierarchyError,
  InvalidPuppetError,
  InvalidTextureAssetError,
  MissingTextureError,
  NativeBridgeError,
  PuppetAlreadyExistsError,
  RoundTripMismatchError,
} from '@inochi-agent-tools/core';

export interface CliErrorDescriptor {
  exitCode: number;
  code: string;
  message: string;
}

const SEMANTIC_ERROR_MAP = [
  [InvalidAuthoringRequestError, 10, 'INVALID_AUTHORING_REQUEST'],
  [InvalidPuppetError, 11, 'INVALID_PUPPET'],
  [PuppetAlreadyExistsError, 12, 'PUPPET_ALREADY_EXISTS'],
  [InvalidHierarchyError, 13, 'INVALID_HIERARCHY'],
  [MissingTextureError, 14, 'MISSING_TEXTURE'],
  [InvalidTextureAssetError, 15, 'INVALID_TEXTURE_ASSET'],
  [InvalidBindingError, 16, 'INVALID_BINDING'],
  [RoundTripMismatchError, 17, 'ROUND_TRIP_MISMATCH'],
  [NativeBridgeError, 20, 'NATIVE_BRIDGE_FAILURE'],
] as const;

function messageFrom(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return String(error);
}

export function classifyCliError(error: unknown): CliErrorDescriptor {
  for (const [ErrorType, exitCode, code] of SEMANTIC_ERROR_MAP) {
    if (error instanceof ErrorType) {
      return { exitCode, code, message: messageFrom(error) };
    }
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'UNSUPPORTED_UPSTREAM_VERSION'
  ) {
    return {
      exitCode: 18,
      code: 'UNSUPPORTED_UPSTREAM_VERSION',
      message: messageFrom(error),
    };
  }

  return {
    exitCode: 1,
    code: 'UNEXPECTED_FAILURE',
    message: messageFrom(error),
  };
}
