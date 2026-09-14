#!/usr/bin/env node

import { runCli } from './run.js';

async function readStdin(): Promise<string> {
  process.stdin.setEncoding('utf8');
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

const exitCode = await runCli(process.argv.slice(2), {
  stdout(text) {
    process.stdout.write(text);
  },
  stderr(text) {
    process.stderr.write(text);
  },
  stdin: readStdin,
});

process.exitCode = exitCode;
