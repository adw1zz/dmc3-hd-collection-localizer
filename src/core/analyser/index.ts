import type { ModeSpec, Pair, Plan } from './types.js';
import { matchScans } from './match.js';
import { scanSource, scanTarget } from './scan.js';

export interface AnalyseInput {
  spec: ModeSpec;
  sourceDir: string;
  targetDir: string;
  /** `--all`: ignore the categories' include filters. */
  all?: boolean;
}

/**
 * Stage 1b — analysis. Scans both directories recursively, pairs files by
 * name per category and returns the {@link Plan} every later stage consumes.
 * (ffprobe enrichment of pairs is added in the next step.)
 */
export async function analyse({ spec, sourceDir, targetDir, all }: AnalyseInput): Promise<Plan> {
  const [target, source] = await Promise.all([
    scanTarget(targetDir, spec),
    scanSource(sourceDir, spec),
  ]);
  const match = matchScans(spec.categories, target, source, { all: all ?? false });

  const issues = [...match.issues];
  for (const category of spec.categories) {
    if ((target.get(category.id)?.length ?? 0) === 0) {
      issues.push({
        level: 'error',
        code: 'target-category-empty',
        message: `no ${category.label} files (${category.targetExts.join(', ')}) found in target`,
      });
    }
  }
  if (match.unmatchedSource.length > 0) {
    issues.push({
      level: 'warn',
      code: 'unmatched-source',
      message: `${match.unmatchedSource.length} source file(s) have no counterpart in target and are ignored`,
    });
  }
  if (match.pairs.filter((p) => !p.excluded).length === 0) {
    issues.push({ level: 'error', code: 'nothing-to-do', message: 'no file pairs to localize' });
  }

  return {
    mode: spec.id,
    sourceDir,
    targetDir,
    pairs: match.pairs,
    unmatchedTarget: match.unmatchedTarget,
    unmatchedSource: match.unmatchedSource,
    issues,
  };
}

/** A pair with at least one error is skipped by later stages; the rest of the plan proceeds. */
export function isSkipped(pair: Pair): boolean {
  return pair.issues.some((i) => i.level === 'error');
}

/** Left out by the category include filter (e.g. music) — neither localized nor an error. */
export function isExcluded(pair: Pair): boolean {
  return pair.excluded !== undefined;
}

/** Pairs that will actually be localized. */
export function activePairs(plan: Plan): Pair[] {
  return plan.pairs.filter((p) => !isExcluded(p) && !isSkipped(p));
}

export function skippedPairs(plan: Plan): Pair[] {
  return plan.pairs.filter((p) => !isExcluded(p) && isSkipped(p));
}

export function excludedPairs(plan: Plan): Pair[] {
  return plan.pairs.filter(isExcluded);
}

/** Plan-level errors block the run; per-pair errors only skip that pair. */
export function hasBlockingErrors(plan: Plan): boolean {
  return plan.issues.some((i) => i.level === 'error') || activePairs(plan).length === 0;
}

export { matchScans } from './match.js';
export { probePlan, type ProbeOptions } from './probe.js';
export { scanSource, scanTarget } from './scan.js';
