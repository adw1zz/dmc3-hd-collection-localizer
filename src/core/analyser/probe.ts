import pLimit from 'p-limit';

import { audioStream, ffprobe, type ProbeInfo } from '../ffmpeg/index.js';
import type { Issue, Pair, Plan } from './types.js';

/**
 * Probe step: runs ffprobe on every file referenced by the plan (each file
 * once), attaches the results to the pairs and derives issues the user should
 * see before confirming. Failures become per-pair errors, never exceptions.
 */

export interface ProbeOptions {
  ffprobeBin: string;
  jobs: number;
  /** Warn when |source − target| duration exceeds this (seconds). */
  warnDeltaSec?: number;
  /** Above this the pair is treated as a different cut and skipped (seconds). */
  manualCheckDeltaSec?: number;
  onProgress?: (done: number, total: number, file: string) => void;
}

export const DEFAULT_WARN_DELTA_SEC = 0.5;
export const DEFAULT_MANUAL_CHECK_DELTA_SEC = 3;

export async function probePlan(plan: Plan, opts: ProbeOptions): Promise<void> {
  const warnDelta = opts.warnDeltaSec ?? DEFAULT_WARN_DELTA_SEC;
  const manualDelta = opts.manualCheckDeltaSec ?? DEFAULT_MANUAL_CHECK_DELTA_SEC;

  const candidates = plan.pairs.filter((p) => p.excluded === undefined);
  const files = new Set<string>();
  for (const p of candidates) {
    files.add(p.source.path);
    files.add(p.target.path);
  }
  const results = new Map<string, ProbeInfo | Error>();
  const limit = pLimit(Math.max(1, opts.jobs));
  let done = 0;
  const total = files.size;

  await Promise.all(
    [...files].map((file) =>
      limit(async () => {
        try {
          results.set(file, await ffprobe(opts.ffprobeBin, file));
        } catch (e) {
          results.set(file, e instanceof Error ? e : new Error(String(e)));
        }
        done += 1;
        opts.onProgress?.(done, total, file);
      }),
    ),
  );

  for (const pair of candidates) {
    const src = results.get(pair.source.path);
    const dst = results.get(pair.target.path);
    const failed = [
      [pair.source.rel, src],
      [pair.target.rel, dst],
    ].filter((x): x is [string, Error] => x[1] instanceof Error);
    if (failed.length > 0 || !src || !dst || src instanceof Error || dst instanceof Error) {
      for (const [rel, err] of failed) {
        pair.issues.push({
          level: 'error',
          code: 'probe-failed',
          message: `${rel}: ${err.message}`,
        });
      }
      continue;
    }
    const durationDelta = src.duration - dst.duration;
    pair.probe = { source: src, target: dst, durationDelta };
    pair.issues.push(...checkPair(pair, { warnDelta, manualDelta }));
  }
}

function checkPair(pair: Pair, t: { warnDelta: number; manualDelta: number }): Issue[] {
  const issues: Issue[] = [];
  const probe = pair.probe;
  if (!probe) return issues;
  const name = pair.target.name;

  if (!audioStream(probe.source)) {
    issues.push({
      level: 'error',
      code: 'source-no-audio',
      message: `${name}: source ${pair.source.rel} has no audio stream`,
    });
    return issues; // nothing else is meaningful without audio
  }
  if (!audioStream(probe.target)) {
    issues.push({
      level: 'warn',
      code: 'target-no-audio',
      message: `${name}: target has no audio stream (nothing to compare against)`,
    });
  }

  const delta = probe.durationDelta;
  if (Number.isNaN(delta)) {
    issues.push({
      level: 'warn',
      code: 'duration-unknown',
      message: `${name}: could not read duration of source or target`,
    });
  } else if (Math.abs(delta) > t.manualDelta) {
    // A different cut would desync badly; refuse rather than guess (reported as skipped).
    issues.push({
      level: 'error',
      code: 'duration-mismatch-large',
      message: `${name}: source is ${fmtDelta(delta)} than target — different cut, not safe to apply`,
    });
  } else if (Math.abs(delta) > t.warnDelta) {
    issues.push({
      level: 'warn',
      code: 'duration-mismatch',
      message: `${name}: source is ${fmtDelta(delta)} than target — audio will be trimmed/padded`,
    });
  }
  return issues;
}

function fmtDelta(delta: number): string {
  return `${Math.abs(delta).toFixed(2)} s ${delta > 0 ? 'longer' : 'shorter'}`;
}
