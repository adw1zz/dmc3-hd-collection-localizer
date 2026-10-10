import { rename, rm, stat } from 'node:fs/promises';
import pLimit from 'p-limit';

import { activePairs } from '../analyser/index.js';
import type { LocalizationMode, Pair, Plan } from '../analyser/types.js';
import type { Backup } from '../backup/index.js';
import { audioStream, ffprobe, type FfmpegBinaries } from '../ffmpeg/index.js';
import { sha256File } from '../fs/index.js';

/**
 * Stage 4 executor. For every active pair, in parallel:
 *   mode.apply → tmp file → verify (ffprobe opens it, has audio, duration ok,
 *   size > 0) → atomic rename over the target → backup.recordResult → manifest saved.
 * One failure never stops the others; the report lists every outcome.
 */

export const TMP_SUFFIX = '.dmc3tmp';
export const DEFAULT_DURATION_TOLERANCE_SEC = 0.5;

export type ApplyStatus = 'ok' | 'failed';

export interface ApplyResult {
  pair: Pair;
  status: ApplyStatus;
  /** What the mode did (from ApplyOutput.how). */
  how?: string;
  error?: string;
  ms: number;
}

export interface ApplyReport {
  results: ApplyResult[];
  ok: number;
  failed: number;
  ms: number;
}

export interface ApplyOptions {
  mode: LocalizationMode;
  bins: FfmpegBinaries;
  backup: Backup;
  jobs: number;
  durationToleranceSec?: number;
  onProgress?: (done: number, total: number, result: ApplyResult) => void;
}

export async function applyPlan(plan: Plan, opts: ApplyOptions): Promise<ApplyReport> {
  const pairs = activePairs(plan);
  const tolerance = opts.durationToleranceSec ?? DEFAULT_DURATION_TOLERANCE_SEC;
  const limit = pLimit(Math.max(1, opts.jobs));
  const started = Date.now();
  let done = 0;

  // Manifest writes are serialised so concurrent finishes never interleave.
  let saveChain: Promise<void> = Promise.resolve();
  const save = (): Promise<void> => {
    saveChain = saveChain.then(() => opts.backup.save());
    return saveChain;
  };

  const results = await Promise.all(
    pairs.map((pair) =>
      limit(async (): Promise<ApplyResult> => {
        const t0 = Date.now();
        const result = await applyOne(pair, opts, tolerance, save);
        const r: ApplyResult = { ...result, ms: Date.now() - t0 };
        done += 1;
        opts.onProgress?.(done, pairs.length, r);
        return r;
      }),
    ),
  );
  await saveChain;

  return {
    results,
    ok: results.filter((r) => r.status === 'ok').length,
    failed: results.filter((r) => r.status === 'failed').length,
    ms: Date.now() - started,
  };
}

async function applyOne(
  pair: Pair,
  opts: ApplyOptions,
  tolerance: number,
  save: () => Promise<void>,
): Promise<Omit<ApplyResult, 'ms'>> {
  const tmpPath = pair.target.path + TMP_SUFFIX;
  try {
    const out = await opts.mode.apply(pair, {
      ffmpeg: opts.bins.ffmpeg,
      ffprobe: opts.bins.ffprobe,
      tmpPath,
    });

    await verify(opts.bins.ffprobe, tmpPath, out.expectedDuration, tolerance);
    const hash = await sha256File(tmpPath);
    await rename(tmpPath, pair.target.path);
    opts.backup.recordResult(pair.target.rel, hash, pair.source.rel);
    await save();
    return { pair, status: 'ok', how: out.how };
  } catch (e) {
    await rm(tmpPath, { force: true });
    return { pair, status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}

export class VerifyError extends Error {
  constructor(message: string) {
    super(`output verification failed: ${message}`);
    this.name = 'VerifyError';
  }
}

async function verify(
  ffprobeBin: string,
  file: string,
  expectedDuration: number | undefined,
  tolerance: number,
): Promise<void> {
  const { size } = await stat(file);
  if (size === 0) throw new VerifyError('empty file');
  const info = await ffprobe(ffprobeBin, file);
  if (!audioStream(info)) throw new VerifyError('no audio stream in output');
  if (expectedDuration !== undefined && !Number.isNaN(info.duration)) {
    const delta = Math.abs(info.duration - expectedDuration);
    if (delta > tolerance) {
      throw new VerifyError(
        `duration ${info.duration.toFixed(2)} s differs from expected ${expectedDuration.toFixed(2)} s by ${delta.toFixed(2)} s`,
      );
    }
  }
}
