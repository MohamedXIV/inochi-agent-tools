import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { InvalidBindingError, NativeBridgeError } from '../src/errors.js';
import { evaluateParameterValues } from '../src/parameter-evaluation.js';

const tempRoots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fakeHost(source: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'iat-parameter-evaluation-'));
  tempRoots.push(root);
  const hostPath = path.join(root, 'fake-host.mjs');
  await writeFile(hostPath, source, 'utf8');
  await chmod(hostPath, 0o755);
  return hostPath;
}

describe('evaluateParameterValues', () => {
  it('parses a valid isolated-host evaluation result', async () => {
    const hostPath = await fakeHost(`#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({appliedParameters:[{name:'Move X',value:[1,0]}],targets:[{parameterName:'Move X',targetPath:'/Root/Rig',property:'transform.t.x',appliedValue:20,restoredValue:0}],restoredParameters:[{name:'Move X',value:[0,0]}]}));\n`);

    await expect(evaluateParameterValues({
      inputPath: 'fixture.inp',
      values: { 'Move X': [1, 0] },
      hostPath,
    })).resolves.toEqual({
      appliedParameters: [{ name: 'Move X', value: [1, 0] }],
      targets: [{
        parameterName: 'Move X',
        targetPath: '/Root/Rig',
        property: 'transform.t.x',
        appliedValue: 20,
        restoredValue: 0,
      }],
      restoredParameters: [{ name: 'Move X', value: [0, 0] }],
    });
  });

  it('maps binding validation failures to InvalidBindingError', async () => {
    const hostPath = await fakeHost(`#!/usr/bin/env node\nprocess.stderr.write('unknown parameter'); process.exit(10);\n`);
    await expect(evaluateParameterValues({
      inputPath: 'fixture.inp',
      values: { Missing: [0, 0] },
      hostPath,
    })).rejects.toBeInstanceOf(InvalidBindingError);
  });

  it('rejects malformed host JSON as NativeBridgeError', async () => {
    const hostPath = await fakeHost(`#!/usr/bin/env node\nprocess.stdout.write('{not-json');\n`);
    await expect(evaluateParameterValues({
      inputPath: 'fixture.inp',
      values: { 'Move X': [0, 0] },
      hostPath,
    })).rejects.toBeInstanceOf(NativeBridgeError);
  });
});
