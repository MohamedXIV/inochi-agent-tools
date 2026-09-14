import type { CliErrorDescriptor } from './errors.js';

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export function writeSuccess(
  io: CliIo,
  json: boolean,
  command: string,
  result: unknown,
): void {
  if (json) {
    io.stdout(`${JSON.stringify({ ok: true, command, result })}\n`);
    return;
  }

  if (typeof result === 'string') io.stdout(`${result}\n`);
  else io.stdout(`${JSON.stringify(result, null, 2)}\n`);
}

export function writeFailure(
  io: CliIo,
  json: boolean,
  command: string | null,
  error: CliErrorDescriptor,
): void {
  if (json) {
    io.stdout(
      `${JSON.stringify({
        ok: false,
        command,
        error: { code: error.code, message: error.message },
      })}\n`,
    );
    return;
  }

  io.stderr(`${error.code}: ${error.message}\n`);
}
