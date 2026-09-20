export class InvalidPuppetError extends Error {
  readonly code = 'INVALID_PUPPET' as const;

  constructor(message = 'Invalid Inochi puppet') {
    super(message);
    this.name = 'InvalidPuppetError';
  }
}

export class NativeBridgeError extends Error {
  readonly code = 'NATIVE_BRIDGE_FAILURE' as const;

  constructor(message = 'Native bridge failure') {
    super(message);
    this.name = 'NativeBridgeError';
  }
}

export class UnsupportedAuthoringCapabilityError extends Error {
  readonly code = 'UNSUPPORTED_AUTHORING_CAPABILITY' as const;

  constructor(message = 'Authoring capability is not supported by the pinned Inochi2D runtime') {
    super(message);
    this.name = 'UnsupportedAuthoringCapabilityError';
  }
}

export class InvalidAuthoringRequestError extends Error {
  readonly code = 'INVALID_AUTHORING_REQUEST' as const;

  constructor(message = 'Invalid authoring request') {
    super(message);
    this.name = 'InvalidAuthoringRequestError';
  }
}

export class PuppetAlreadyExistsError extends Error {
  readonly code = 'PUPPET_ALREADY_EXISTS' as const;

  constructor(message = 'Puppet output already exists') {
    super(message);
    this.name = 'PuppetAlreadyExistsError';
  }
}

export class RoundTripMismatchError extends Error {
  readonly code = 'ROUND_TRIP_MISMATCH' as const;

  constructor(message = 'Puppet round-trip validation mismatch') {
    super(message);
    this.name = 'RoundTripMismatchError';
  }
}

export class InvalidHierarchyError extends Error {
  readonly code = 'INVALID_HIERARCHY' as const;

  constructor(message = 'Invalid or ambiguous puppet hierarchy operation') {
    super(message);
    this.name = 'InvalidHierarchyError';
  }
}

export class MissingTextureError extends Error {
  readonly code = 'MISSING_TEXTURE' as const;

  constructor(message = 'Unknown transaction-local texture alias') {
    super(message);
    this.name = 'MissingTextureError';
  }
}

export class InvalidTextureAssetError extends Error {
  readonly code = 'INVALID_TEXTURE_ASSET' as const;

  constructor(message = 'Invalid texture asset') {
    super(message);
    this.name = 'InvalidTextureAssetError';
  }
}

export class InvalidBindingError extends Error {
  readonly code = 'INVALID_BINDING' as const;

  constructor(message = 'Invalid parameter definition or binding') {
    super(message);
    this.name = 'InvalidBindingError';
  }
}
