export interface McpToolError {
  code: string;
  message: string;
  details?: unknown;
}

export type McpToolResult<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: McpToolError };

interface SemanticErrorLike extends Error {
  code?: unknown;
  details?: unknown;
}

export function invalidArguments(message: string): McpToolResult<never> {
  return {
    ok: false,
    error: {
      code: 'INVALID_ARGUMENTS',
      message,
    },
  };
}

export function semanticFailure(error: unknown): McpToolResult<never> {
  if (error instanceof Error) {
    const semantic = error as SemanticErrorLike;
    if (typeof semantic.code === 'string' && semantic.code.length > 0) {
      return {
        ok: false,
        error: {
          code: semantic.code,
          message: semantic.message,
          ...(semantic.details === undefined ? {} : { details: semantic.details }),
        },
      };
    }
  }

  return {
    ok: false,
    error: {
      code: 'MCP_ADAPTER_FAILURE',
      message: 'MCP adapter failed to complete the semantic operation',
    },
  };
}
