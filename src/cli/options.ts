import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

import { isDirectory, isReadable, isSamePath, isWritable, toAbsolute } from '../core/fs/index.js';
import { IMPLEMENTED_MODES, LOCALIZATION_MODES, type LocalizationModeId } from '../modes/index.js';

/**
 * Stage 1 — validation of CLI parameters.
 * Shape/format checks are done by zod; filesystem checks (exists, readable,
 * writable) are done afterwards so the user gets all errors at once.
 */

export { LOCALIZATION_MODES } from '../modes/index.js';

export const DEFAULT_BACKUP_DIR_NAME = 'dmc3-localizer-backup';

const defaultJobs = Math.max(1, Math.floor(os.cpus().length / 2));

const positiveInt = z.coerce.number().int().min(1);

export const localizeOptionsSchema = z.object({
  mode: z.enum(LOCALIZATION_MODES).default('av'),
  source: z.string().min(1, 'source path must not be empty'),
  target: z.string().min(1, 'target path must not be empty'),
  backupDir: z.string().min(1).optional(),
  ffmpegDir: z.string().min(1).optional(),
  jobs: positiveInt.max(64).default(defaultJobs),
  all: z.boolean().default(false),
  yes: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  verbose: z.boolean().default(false),
});

/** Raw values as commander hands them over. */
export type RawLocalizeOptions = z.input<typeof localizeOptionsSchema>;

/** Validated, normalised options the rest of the program works with. */
export interface LocalizeOptions {
  mode: LocalizationModeId;
  /** Absolute path to the directory with the localized files (2006 PC port install or a prepared folder). */
  source: string;
  /** Absolute path to `...\Devil May Cry HD Collection\data\dmc3`. */
  target: string;
  /** Absolute path where originals are copied before being overwritten. */
  backupDir: string;
  /** Directory containing ffmpeg/ffprobe, or undefined for env/PATH lookup. */
  ffmpegDir: string | undefined;
  jobs: number;
  /** Ignore the modes' include filters (e.g. also replace music). */
  all: boolean;
  yes: boolean;
  dryRun: boolean;
  verbose: boolean;
}

export class OptionsError extends Error {
  constructor(public readonly problems: readonly string[]) {
    super(problems.join('\n'));
    this.name = 'OptionsError';
  }
}

/**
 * Validate and normalise raw options. Throws {@link OptionsError} listing
 * every problem found (format + filesystem), never just the first one.
 */
export async function parseLocalizeOptions(
  raw: RawLocalizeOptions,
  cwd: string = process.cwd(),
): Promise<LocalizeOptions> {
  const parsed = localizeOptionsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OptionsError(parsed.error.issues.map((i) => `--${i.path.join('.')}: ${i.message}`));
  }
  const o = parsed.data;
  const problems: string[] = [];

  if (!IMPLEMENTED_MODES.includes(o.mode)) {
    problems.push(
      `--mode ${o.mode}: not implemented yet (available: ${IMPLEMENTED_MODES.join(', ')})`,
    );
  }

  const source = toAbsolute(o.source, cwd);
  const target = toAbsolute(o.target, cwd);
  const backupDir = o.backupDir
    ? toAbsolute(o.backupDir, cwd)
    : path.join(cwd, DEFAULT_BACKUP_DIR_NAME, timestampForDir(new Date()));
  const ffmpegDir = o.ffmpegDir ? toAbsolute(o.ffmpegDir, cwd) : undefined;

  if (!(await isDirectory(source))) problems.push(`--source: not a directory: ${source}`);
  else if (!(await isReadable(source))) problems.push(`--source: not readable: ${source}`);

  if (!(await isDirectory(target))) problems.push(`--target: not a directory: ${target}`);
  else {
    if (!(await isReadable(target))) problems.push(`--target: not readable: ${target}`);
    if (!o.dryRun && !(await isWritable(target))) {
      problems.push(`--target: not writable: ${target} (is the game running?)`);
    }
  }

  if (isSamePath(source, target))
    problems.push('--source and --target must be different directories');

  if (ffmpegDir && !(await isDirectory(ffmpegDir))) {
    problems.push(`--ffmpeg-dir: not a directory: ${ffmpegDir}`);
  }

  if (problems.length > 0) throw new OptionsError(problems);

  return {
    mode: o.mode,
    source,
    target,
    backupDir,
    ffmpegDir,
    jobs: o.jobs,
    all: o.all,
    yes: o.yes,
    dryRun: o.dryRun,
    verbose: o.verbose,
  };
}

/** `2026-10-10_19-45-03` — sortable, Windows-safe. */
export function timestampForDir(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  );
}
