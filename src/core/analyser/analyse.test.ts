import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { audioVideoSpec } from '../../modes/audio-video/spec.js';
import { analyse } from './index.js';

let tmp: string;
let source: string;
let target: string;

/** Creates empty files; paths use `/` and are created relative to `root`. */
async function touch(root: string, rels: readonly string[]): Promise<void> {
  for (const rel of rels) {
    const full = path.join(root, ...rel.split('/'));
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, rel);
  }
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'dmc3-analyse-'));
  source = path.join(tmp, 'source');
  target = path.join(tmp, 'target');
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('analyse (av spec, layout like the real game dirs)', () => {
  it('builds the plan from a 2006-port-like source and an HDC-like target', async () => {
    await touch(target, [
      'Video/m01_s00.webm',
      'Video/GameOver.webm',
      'Video/GameOverF.webm',
      'afs/sound/m01_c00.ogg',
      'afs/sound/Battle_00.ogg',
      'afs/sound/dummy.ogg',
      'dmc3-0.nbz',
      'LOADERICON.dds',
    ]);
    await touch(source, [
      'DMC3SE.exe',
      'mov/m01_s00.mpg',
      'mov/GameOver.mpg',
      'mov/logo.mpg',
      'mov/ipu/m01_s00.bin', // IPU texture: a .bin with no .ogg counterpart → reported as unmatched source
      'sound/m01_c00.bin',
      'sound/Battle_00.bin',
      'sound/Versil_03_ver2.bin',
      'data2/msg_rus.pac',
    ]);

    const plan = await analyse({ spec: audioVideoSpec, sourceDir: source, targetDir: target });

    expect(plan.mode).toBe('av');
    expect(
      plan.pairs.map(
        (p) =>
          `${p.category}: ${p.target.rel} <- ${p.source.rel}${p.excluded ? ' (excluded)' : ''}`,
      ),
    ).toEqual([
      'fmv: Video/GameOver.webm <- mov/GameOver.mpg',
      'fmv: Video/m01_s00.webm <- mov/m01_s00.mpg',
      'sound: afs/sound/Battle_00.ogg <- sound/Battle_00.bin (excluded)',
      'sound: afs/sound/m01_c00.ogg <- sound/m01_c00.bin',
    ]);
    expect(plan.unmatchedTarget.map((u) => u.file.rel)).toEqual([
      'Video/GameOverF.webm',
      'afs/sound/dummy.ogg',
    ]);
    expect(plan.unmatchedSource.map((s) => s.rel)).toEqual([
      'mov/ipu/m01_s00.bin',
      'mov/logo.mpg',
      'sound/Versil_03_ver2.bin',
    ]);
    expect(plan.issues.map((i) => `${i.level}:${i.code}`)).toEqual(['warn:unmatched-source']);
  });

  it('accepts a prepared folder with target-style extensions', async () => {
    await touch(target, ['Video/m01_s00.webm', 'afs/sound/m01_c00.ogg']);
    await touch(source, ['anything/M01_S00.webm', 'voice/m01_c00.ogg']);

    const plan = await analyse({ spec: audioVideoSpec, sourceDir: source, targetDir: target });
    expect(plan.pairs.map((p) => p.source.rel)).toEqual([
      'anything/M01_S00.webm',
      'voice/m01_c00.ogg',
    ]);
  });

  it('flags an empty target category and an empty plan as errors', async () => {
    await touch(target, ['readme.txt']);
    await touch(source, ['mov/m01_s00.mpg']);

    const plan = await analyse({ spec: audioVideoSpec, sourceDir: source, targetDir: target });
    expect(plan.pairs).toEqual([]);
    expect(plan.issues.map((i) => i.code)).toEqual([
      'target-category-empty',
      'target-category-empty',
      'unmatched-source',
      'nothing-to-do',
    ]);
  });
});
