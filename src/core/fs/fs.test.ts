import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isInside, isSamePath, listFiles } from './index.js';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'dmc3-fs-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('listFiles', () => {
  it('lists recursively, filters by extension, fills rel/stem/ext/size', async () => {
    await mkdir(path.join(tmp, 'a', 'b'), { recursive: true });
    await writeFile(path.join(tmp, 'Top.WEBM'), '12345');
    await writeFile(path.join(tmp, 'a', 'b', 'deep.ogg'), '1');
    await writeFile(path.join(tmp, 'a', 'skip.txt'), '1');

    const all = await listFiles(tmp);
    expect(all.map((f) => f.rel)).toEqual(['Top.WEBM', 'a/b/deep.ogg', 'a/skip.txt']);

    const media = await listFiles(tmp, { exts: ['.webm', '.ogg'] });
    expect(media.map((f) => [f.rel, f.stem, f.ext, f.size])).toEqual([
      ['Top.WEBM', 'Top', '.webm', 5],
      ['a/b/deep.ogg', 'deep', '.ogg', 1],
    ]);

    const flat = await listFiles(tmp, { recursive: false });
    expect(flat.map((f) => f.rel)).toEqual(['Top.WEBM']);
  });

  it('returns [] for a missing directory', async () => {
    expect(await listFiles(path.join(tmp, 'nope'))).toEqual([]);
  });
});

describe('path helpers', () => {
  it('isSamePath / isInside', () => {
    expect(isSamePath(tmp, path.join(tmp, '.'))).toBe(true);
    expect(isInside(tmp, path.join(tmp, 'x', 'y'))).toBe(true);
    expect(isInside(tmp, tmp)).toBe(true);
    expect(isInside(tmp, path.join(tmp, '..'))).toBe(false);
  });
});
