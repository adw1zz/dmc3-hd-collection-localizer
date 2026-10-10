import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { analyse, probePlan } from '../analyser/index.js';
import { Backup } from '../backup/index.js';
import {
  audioStream,
  ffprobe,
  resolveFfmpeg,
  runFfmpeg,
  type FfmpegBinaries,
} from '../ffmpeg/index.js';
import { listFiles, sha256File } from '../fs/index.js';
import { audioVideoMode } from '../../modes/audio-video/index.js';
import { applyPlan, TMP_SUFFIX } from './index.js';

/**
 * End-to-end on real ffmpeg: builds tiny fixtures shaped like the game files,
 * runs analyse → probe → backup → apply and checks the outputs. Skipped when
 * ffmpeg/ffprobe are not available (CI without ffmpeg).
 */

let bins: FfmpegBinaries | null = null;
let tmp = '';
let source = '';
let target = '';
let backupDir = '';

const ff = (args: string[]): Promise<void> => {
  if (!bins) throw new Error('ffmpeg not resolved');
  return runFfmpeg(bins.ffmpeg, args);
};
const tone = (d: number): string[] => [
  '-f',
  'lavfi',
  '-i',
  `sine=frequency=440:duration=${d}:sample_rate=48000`,
];
const black = (d: number, r: number): string[] => [
  '-f',
  'lavfi',
  '-i',
  `color=c=black:s=64x64:r=${r}:d=${d}`,
];

beforeAll(async () => {
  try {
    bins = await resolveFfmpeg();
  } catch {
    return;
  }
  tmp = await mkdtemp(path.join(os.tmpdir(), 'dmc3-apply-'));
  source = path.join(tmp, 'src');
  target = path.join(tmp, 'dst');
  backupDir = path.join(tmp, 'bk');
  for (const d of ['mov', 'sound', 'other']) await mkdir(path.join(source, d), { recursive: true });
  for (const d of ['Video', path.join('afs', 'sound')])
    await mkdir(path.join(target, d), { recursive: true });

  // target fmv: VP9 + Opus, 2.0 s; source fmv: mpeg1 + mp2, 2.4 s (will be cut to 2.0)
  await ff([
    ...black(2, 10),
    ...tone(2),
    '-c:v',
    'libvpx-vp9',
    '-b:v',
    '50k',
    '-c:a',
    'libopus',
    '-ac',
    '2',
    path.join(target, 'Video', 'm01_s00.webm'),
  ]);
  await ff([
    ...black(2.4, 25),
    ...tone(2.4),
    '-c:v',
    'mpeg1video',
    '-c:a',
    'mp2',
    '-ac',
    '2',
    '-f',
    'mpeg',
    path.join(source, 'mov', 'm01_s00.mpg'),
  ]);
  // target sound: ogg vorbis 1.5 s; source .bin = same ogg (copy path); plus a .wav source (transcode path)
  await ff([
    ...tone(1.5),
    '-c:a',
    'libvorbis',
    '-ac',
    '2',
    path.join(target, 'afs', 'sound', 'm01_c00.ogg'),
  ]);
  await ff([
    ...tone(1.5),
    '-c:a',
    'libvorbis',
    '-ac',
    '2',
    path.join(target, 'afs', 'sound', 'm02_c00.ogg'),
  ]);
  await ff([
    ...tone(1.5),
    '-c:a',
    'libvorbis',
    '-ac',
    '2',
    '-f',
    'ogg',
    path.join(source, 'sound', 'm01_c00.bin'),
  ]);
  await ff([
    ...tone(1.7),
    '-c:a',
    'pcm_s16le',
    '-ac',
    '2',
    path.join(source, 'other', 'm02_c00.wav'),
  ]);
}, 120_000);

afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe('applyPlan (real ffmpeg)', () => {
  it('replaces fmv audio, copies ogg, transcodes wav, records results', async () => {
    if (!bins) return; // no ffmpeg on this machine — nothing to test

    // widen the av spec to accept .wav sources for this test
    const mode = {
      ...audioVideoMode,
      spec: {
        ...audioVideoMode.spec,
        categories: audioVideoMode.spec.categories.map((c) =>
          c.id === 'sound' ? { ...c, sourceExts: [...c.sourceExts, '.wav'] } : c,
        ),
      },
    };

    const plan = await analyse({ spec: mode.spec, sourceDir: source, targetDir: target });
    await probePlan(plan, { ffprobeBin: bins.ffprobe, jobs: 2 });
    expect(
      plan.pairs.map((p) => `${p.category}:${p.target.name}<-${p.source.name}`).sort(),
    ).toEqual([
      'fmv:m01_s00.webm<-m01_s00.mpg',
      'sound:m01_c00.ogg<-m01_c00.bin',
      'sound:m02_c00.ogg<-m02_c00.wav',
    ]);

    const backup = await Backup.open({ backupDir, targetDir: target, tool: 'test' });
    for (const p of plan.pairs) await backup.backup(p.target.rel);
    await backup.save();

    const originalWebm = await sha256File(path.join(target, 'Video', 'm01_s00.webm'));
    const report = await applyPlan(plan, { mode, bins, backup, jobs: 2 });
    expect(report.results.map((r) => [r.pair.target.name, r.status, r.error])).toEqual([
      ['m01_s00.webm', 'ok', undefined],
      ['m01_c00.ogg', 'ok', undefined],
      ['m02_c00.ogg', 'ok', undefined],
    ]);
    expect(report.results.map((r) => r.how)).toEqual([
      expect.stringMatching(/^mp2 → libopus \d+k 48000Hz 2ch, video copied$/),
      'copied (same format)',
      expect.stringMatching(/^pcm_s16le → libvorbis/),
    ]);

    // fmv: video stream untouched (vp9), audio now opus, duration forced to the target's 2.0 s
    const webm = await ffprobe(bins.ffprobe, path.join(target, 'Video', 'm01_s00.webm'));
    expect(webm.streams.find((s) => s.type === 'video')?.codec).toBe('vp9');
    expect(audioStream(webm)?.codec).toBe('opus');
    expect(Math.abs(webm.duration - 2.0)).toBeLessThan(0.15);
    expect(await sha256File(path.join(target, 'Video', 'm01_s00.webm'))).not.toBe(originalWebm);

    // sound copy: byte-identical to the source .bin
    expect(await readFile(path.join(target, 'afs', 'sound', 'm01_c00.ogg'))).toEqual(
      await readFile(path.join(source, 'sound', 'm01_c00.bin')),
    );
    // sound transcode: vorbis now, ~1.7 s
    const ogg = await ffprobe(bins.ffprobe, path.join(target, 'afs', 'sound', 'm02_c00.ogg'));
    expect(audioStream(ogg)?.codec).toBe('vorbis');
    expect(Math.abs(ogg.duration - 1.7)).toBeLessThan(0.1);

    // manifest has results and the second run sees everything as already localized
    const again = await Backup.open({ backupDir, targetDir: target, tool: 'test' });
    for (const p of plan.pairs) {
      expect(again.entry(p.target.rel)?.result?.source).toBe(p.source.rel);
      expect((await again.classify(p.target.rel)).state).toBe('already-localized');
    }

    // no temp files left behind
    const leftovers = await listFiles(target);
    expect(leftovers.filter((f) => f.name.endsWith(TMP_SUFFIX))).toEqual([]);
  }, 120_000);

  it('reports a failed pair without touching its target', async () => {
    if (!bins) return;
    await writeFile(path.join(source, 'mov', 'broken.mpg'), 'not a video');
    await ff([
      ...black(1, 10),
      ...tone(1),
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '50k',
      '-c:a',
      'libopus',
      '-ac',
      '2',
      path.join(target, 'Video', 'broken.webm'),
    ]);
    const before = await sha256File(path.join(target, 'Video', 'broken.webm'));

    const plan = await analyse({ spec: audioVideoMode.spec, sourceDir: source, targetDir: target });
    await probePlan(plan, { ffprobeBin: bins.ffprobe, jobs: 2 });
    // the broken source fails ffprobe → pair is skipped by the analyser, not applied at all
    const broken = plan.pairs.find((p) => p.target.name === 'broken.webm');
    expect(broken?.issues.map((i) => i.code)).toEqual(['probe-failed']);

    // force an apply failure instead: a mode whose apply throws
    const failingMode = { ...audioVideoMode, apply: () => Promise.reject(new Error('boom')) };
    const backup = await Backup.open({ backupDir, targetDir: target, tool: 'test' });
    const report = await applyPlan(plan, { mode: failingMode, bins, backup, jobs: 1 });
    expect(report.failed).toBe(report.results.length);
    expect(report.results.every((r) => r.error === 'boom')).toBe(true);
    expect(await sha256File(path.join(target, 'Video', 'broken.webm'))).toBe(before);
  }, 60_000);
});
