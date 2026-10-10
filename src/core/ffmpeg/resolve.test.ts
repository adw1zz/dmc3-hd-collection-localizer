import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FFMPEG_DIR_ENV, FfmpegNotFoundError, resolveFfmpeg } from './resolve.js';

let tmp: string;
const exe = process.platform === 'win32' ? '.exe' : '';

async function fakeBins(
  dir: string,
  names: readonly string[] = ['ffmpeg', 'ffprobe'],
): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const n of names) await writeFile(path.join(dir, n + exe), '');
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'dmc3-ffmpeg-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('resolveFfmpeg', () => {
  it('prefers --ffmpeg-dir over env and PATH', async () => {
    const dir = path.join(tmp, 'opt');
    const envDir = path.join(tmp, 'env');
    await fakeBins(dir);
    await fakeBins(envDir);
    const r = await resolveFfmpeg({ dir, env: { [FFMPEG_DIR_ENV]: envDir, PATH: envDir } });
    expect(r.origin).toBe('option');
    expect(r.ffmpeg).toBe(path.join(dir, `ffmpeg${exe}`));
  });

  it('falls through to the env directory when --ffmpeg-dir is incomplete', async () => {
    const dir = path.join(tmp, 'opt');
    const envDir = path.join(tmp, 'env');
    await fakeBins(dir, ['ffmpeg']); // ffprobe missing
    await fakeBins(envDir);
    const r = await resolveFfmpeg({ dir, env: { [FFMPEG_DIR_ENV]: envDir, PATH: '' } });
    expect(r.origin).toBe('env');
  });

  it('finds both binaries in the same PATH entry, skipping entries with only one', async () => {
    const a = path.join(tmp, 'a');
    const b = path.join(tmp, 'b');
    await fakeBins(a, ['ffmpeg']);
    await fakeBins(b);
    const r = await resolveFfmpeg({ env: { PATH: [a, b].join(path.delimiter), PATHEXT: '.EXE' } });
    expect(r.origin).toBe('path');
    expect(r.ffmpeg).toBe(path.join(b, `ffmpeg${exe}`));
    expect(r.ffprobe).toBe(path.join(b, `ffprobe${exe}`));
  });

  it('throws FfmpegNotFoundError listing every location it tried', async () => {
    const dir = path.join(tmp, 'nothing');
    const envDir = path.join(tmp, 'env-nothing');
    await expect(
      resolveFfmpeg({ dir, env: { [FFMPEG_DIR_ENV]: envDir, PATH: path.join(tmp, 'empty') } }),
    ).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(FfmpegNotFoundError);
      const tried = (e as FfmpegNotFoundError).tried;
      expect(tried).toEqual([`option: ${dir}`, `env: ${envDir}`, 'PATH']);
      expect((e as Error).message).toMatch(/--ffmpeg-dir/);
      return true;
    });
  });
});
