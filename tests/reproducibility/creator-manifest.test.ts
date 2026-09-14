import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const manifestPath = new URL('../../upstream/inochi-creator.json', import.meta.url);

describe('official Inochi Creator compatibility target', () => {
  it('pins the exact stable Linux release asset used by the compatibility gate', async () => {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      repository: string;
      release: string;
      linuxAssetId: number;
      linuxAssetName: string;
      linuxAssetSize: number;
      downloadUrl: string;
    };

    expect(manifest).toEqual({
      repository: 'https://github.com/Inochi2D/inochi-creator',
      release: 'v0.8.6',
      linuxAssetId: 193284190,
      linuxAssetName: 'inochi-creator-linux.zip',
      linuxAssetSize: 22341517,
      downloadUrl: 'https://github.com/Inochi2D/inochi-creator/releases/download/v0.8.6/inochi-creator-linux.zip',
    });
  });
});
