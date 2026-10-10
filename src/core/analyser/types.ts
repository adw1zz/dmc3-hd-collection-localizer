import type { ProbeInfo } from '../ffmpeg/index.js';
import type { FileEntry } from '../fs/index.js';

/**
 * Contracts shared by every localization mode and by the generic analyser.
 * A mode is data (`ModeSpec`: which files to look for) plus behaviour
 * (`apply`: how to localize one pair). The analyser only reads the spec.
 */

export const LOCALIZATION_MODES = ['av', 'text'] as const;
export type LocalizationModeId = (typeof LOCALIZATION_MODES)[number];

/** One kind of file a mode handles, e.g. "fmv" or "sound". */
export interface FileCategory {
  id: string;
  /** Human label for summaries. */
  label: string;
  /** Extensions (lower case, with dot) that identify this category in the target. */
  targetExts: readonly string[];
  /** Acceptable source extensions, in priority order (first wins on duplicates). */
  sourceExts: readonly string[];
  /**
   * If set, only files whose stem matches one of these patterns are localized
   * by default; the rest are reported as excluded (e.g. music). `--all` lifts it.
   */
  include?: readonly RegExp[];
  /** Short label for what the include filter keeps out, e.g. "music". */
  excludedLabel?: string;
}

export interface ModeSpec {
  id: LocalizationModeId;
  label: string;
  categories: readonly FileCategory[];
}

export type IssueLevel = 'warn' | 'error';

export interface Issue {
  level: IssueLevel;
  /** Stable machine-readable code, e.g. `duplicate-source`. */
  code: string;
  message: string;
}

/** A target file and the source file that will replace (or feed) it. */
export interface Pair {
  category: string;
  /** Match key: lower-cased file name without extension. */
  key: string;
  target: FileEntry;
  source: FileEntry;
  /** Other source candidates that lost to `source` on extension priority. */
  alternatives: readonly FileEntry[];
  /** ffprobe results, filled by the probe step; absent if probing was skipped or failed. */
  probe?: PairProbe;
  /** Set when the category's include filter left this pair out (reason). Not an error. */
  excluded?: string;
  issues: Issue[];
}

export interface PairProbe {
  source: ProbeInfo;
  target: ProbeInfo;
  /** `source.duration - target.duration`, seconds; NaN if either is unknown. */
  durationDelta: number;
}

export interface UnmatchedTarget {
  category: string;
  file: FileEntry;
}

/** Everything later stages need; produced once by the analyser. */
export interface Plan {
  mode: LocalizationModeId;
  sourceDir: string;
  targetDir: string;
  pairs: Pair[];
  /** Target files of a known category with no source counterpart — stay as they are. */
  unmatchedTarget: UnmatchedTarget[];
  /** Source files with an acceptable extension but no target counterpart — ignored. */
  unmatchedSource: FileEntry[];
  /** Plan-level issues (not tied to a single pair). */
  issues: Issue[];
}

export interface LocalizationMode {
  spec: ModeSpec;
  /** Localize one pair. Implemented per mode at stage 4. */
  apply(pair: Pair): Promise<void>;
}
