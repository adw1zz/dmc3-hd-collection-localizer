import type { ModeSpec, Plan } from './types.js';
import { matchScans } from './match.js';
import { scanSource, scanTarget } from './scan.js';

export interface AnalyseInput {
  spec: ModeSpec;
  sourceDir: string;
  targetDir: string;
}

/**
 * Stage 1b — analysis. Scans both directories recursively, pairs files by
 * name per category and returns the {@link Plan} every later stage consumes.
 * (ffprobe enrichment of pairs is added in the next step.)
 */
export async function analyse({ spec, sourceDir, targetDir }: AnalyseInput): Promise<Plan> {
  const [target, source] = await Promise.all([
    scanTarget(targetDir, spec),
    scanSource(sourceDir, spec),
  ]);
  const match = matchScans(spec.categories, target, source);

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
  if (match.pairs.length === 0) {
    issues.push({ level: 'error', code: 'nothing-to-do', message: 'no file pairs found' });
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

export { matchScans } from './match.js';
export { scanSource, scanTarget } from './scan.js';
