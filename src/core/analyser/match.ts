import { compareRel, type FileEntry } from '../fs/index.js';
import type { FileCategory, Issue, Pair, UnmatchedTarget } from './types.js';
import type { Scan } from './scan.js';

/**
 * Pairs target files with source files by file name without extension,
 * case-insensitively, per category. Pure function — easy to unit-test.
 */

export interface MatchResult {
  pairs: Pair[];
  unmatchedTarget: UnmatchedTarget[];
  unmatchedSource: FileEntry[];
  issues: Issue[];
}

export function matchKey(file: FileEntry): string {
  return file.stem.toLowerCase();
}

export interface MatchOptions {
  /** Ignore category include filters — pair everything that matches by name. */
  all?: boolean;
}

export function matchScans(
  categories: readonly FileCategory[],
  target: Scan,
  source: Scan,
  opts: MatchOptions = {},
): MatchResult {
  const pairs: Pair[] = [];
  const unmatchedTarget: UnmatchedTarget[] = [];
  const unmatchedSource: FileEntry[] = [];
  const issues: Issue[] = [];

  for (const category of categories) {
    const targets = target.get(category.id) ?? [];
    const sources = source.get(category.id) ?? [];
    const byKey = groupSources(sources, category);
    const used = new Set<string>();

    for (const t of targets) {
      const key = matchKey(t);
      const candidates = byKey.get(key);
      if (!candidates || candidates.length === 0) {
        unmatchedTarget.push({ category: category.id, file: t });
        continue;
      }
      used.add(key);
      const [best, ...alternatives] = candidates;
      if (!best) continue;
      const pairIssues: Issue[] = [];
      if (alternatives.length > 0) {
        pairIssues.push({
          level: 'warn',
          code: 'duplicate-source',
          message:
            `${t.name}: ${candidates.length} source candidates, using ${best.rel} ` +
            `(ignored: ${alternatives.map((a) => a.rel).join(', ')})`,
        });
      }
      const pair: Pair = {
        category: category.id,
        key,
        target: t,
        source: best,
        alternatives,
        issues: pairIssues,
      };
      if (!opts.all && category.include && !category.include.some((re) => re.test(t.stem))) {
        pair.excluded = category.excludedLabel ?? 'not in the include list';
      }
      pairs.push(pair);
    }

    const seenTargetKeys = new Map<string, number>();
    for (const t of targets) {
      const k = matchKey(t);
      seenTargetKeys.set(k, (seenTargetKeys.get(k) ?? 0) + 1);
    }
    for (const [k, n] of seenTargetKeys) {
      if (n > 1) {
        issues.push({
          level: 'warn',
          code: 'duplicate-target',
          message: `${category.label}: ${n} target files named "${k}" — all will receive the same source`,
        });
      }
    }

    for (const [key, candidates] of byKey) {
      if (!used.has(key)) unmatchedSource.push(...candidates);
    }
  }

  unmatchedSource.sort((a, b) => compareRel(a.rel, b.rel));
  return { pairs, unmatchedTarget, unmatchedSource, issues };
}

/** key → candidates ordered by extension priority, then by shortest relative path. */
function groupSources(
  sources: readonly FileEntry[],
  category: FileCategory,
): Map<string, FileEntry[]> {
  const priority = new Map(category.sourceExts.map((e, i) => [e, i]));
  const byKey = new Map<string, FileEntry[]>();
  for (const s of sources) {
    const key = matchKey(s);
    const list = byKey.get(key) ?? [];
    list.push(s);
    byKey.set(key, list);
  }
  for (const list of byKey.values()) {
    list.sort((a, b) => {
      const pa = priority.get(a.ext) ?? Number.MAX_SAFE_INTEGER;
      const pb = priority.get(b.ext) ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      if (a.rel.length !== b.rel.length) return a.rel.length - b.rel.length;
      return compareRel(a.rel, b.rel);
    });
  }
  return byKey;
}
