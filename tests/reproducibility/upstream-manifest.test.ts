import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const manifestPath = new URL('../../upstream/inochi2d.json', import.meta.url);

describe('Inochi2D upstream contract', () => {
  it('pins one immutable full SHA', async () => {
    const m = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      repository: string;
      branch: string;
      commit: string;
      declaredVersion: string;
    };

    expect(m.repository).toBe('https://github.com/Inochi2D/inochi2d.git');
    expect(m.branch).toBe('v0_8');
    expect(m.commit).toBe('fdb241da048dbe330152f7b0015e2129dc392844');
    expect(m.declaredVersion).toBe('v0.8.7');
  });
});
