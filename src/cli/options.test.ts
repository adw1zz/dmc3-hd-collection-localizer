import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OptionsError, parseLocalizeOptions, timestampForDir } from './options.js';

let tmp: string;
let source: string;
let target: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'dmc3-opts-'));
  source = path.join(tmp, 'source');
  target = path.join(tmp, 'target');
  await mkdir(source);
  await mkdir(target);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function problemsOf(raw: Parameters<typeof parseLocalizeOptions>[0]): Promise<string[]> {
  try {
    await parseLocalizeOptions(raw, tmp);
  } catch (e) {
    if (e instanceof OptionsError) return [...e.problems];
    throw e;
  }
  return [];
}

describe('parseLocalizeOptions', () => {
  it('accepts valid directories and applies defaults', async () => {
    const o = await parseLocalizeOptions({ source, target }, tmp);
    expect(o.mode).toBe('av');
    expect(o.source).toBe(source);
    expect(o.target).toBe(target);
    expect(o.backupDir.startsWith(path.join(tmp, 'dmc3-localizer-backup'))).toBe(true);
    expect(o.jobs).toBeGreaterThanOrEqual(1);
    expect(o.yes).toBe(false);
    expect(o.dryRun).toBe(false);
    expect(o.ffmpegDir).toBeUndefined();
  });

  it('resolves relative paths against cwd', async () => {
    const o = await parseLocalizeOptions({ source: 'source', target: 'target' }, tmp);
    expect(o.source).toBe(source);
    expect(o.target).toBe(target);
  });

  it('reports every problem at once', async () => {
    const problems = await problemsOf({
      source: path.join(tmp, 'missing-src'),
      target: path.join(tmp, 'missing-dst'),
      ffmpegDir: path.join(tmp, 'missing-ffmpeg'),
    });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/--source: not a directory/);
    expect(problems[1]).toMatch(/--target: not a directory/);
    expect(problems[2]).toMatch(/--ffmpeg-dir: not a directory/);
  });

  it('rejects source == target', async () => {
    const problems = await problemsOf({ source, target: source });
    expect(problems).toEqual(['--source and --target must be different directories']);
  });

  it('rejects unimplemented mode', async () => {
    const problems = await problemsOf({ source, target, mode: 'text' });
    expect(problems[0]).toMatch(/--mode text: not implemented/);
  });

  it('rejects malformed values before touching the filesystem', async () => {
    const problems = await problemsOf({ source, target, jobs: 0 });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^--jobs:/);
  });
});

describe('timestampForDir', () => {
  it('is sortable and Windows-safe', () => {
    const s = timestampForDir(new Date(2026, 9, 10, 9, 5, 3));
    expect(s).toBe('2026-10-10_09-05-03');
    expect(s).not.toMatch(/[:<>"/\\|?*]/);
  });
});
