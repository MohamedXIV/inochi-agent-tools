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
