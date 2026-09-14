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
