import { describe, expect, it } from 'vitest';

import { hasBlockingErrors } from '../core/analyser/index.js';
import type { Pair, Plan } from '../core/analyser/types.js';
import type { FileEntry } from '../core/fs/index.js';
import { groupByDirectory } from './summary.js';

function entry(rel: string): FileEntry {
  const name = rel.split('/').at(-1) ?? rel;
  return { path: `/x/${rel}`, rel, name, stem: name, ext: '', size: 0 };
}

function pair(errors = 0): Pair {
  return {
    category: 'fmv',
    key: 'a',
    source: entry('a.mpg'),
    target: entry('a.webm'),
    alternatives: [],
    issues: Array.from({ length: errors }, () => ({ level: 'error', code: 'x', message: 'x' })),
  };
}

function plan(pairs: Pair[], planErrors = 0): Plan {
  return {
    mode: 'av',
    sourceDir: '/s',
    targetDir: '/t',
    pairs,
    unmatchedTarget: [],
    unmatchedSource: [],
    issues: Array.from({ length: planErrors }, () => ({ level: 'error', code: 'y', message: 'y' })),
  };
}

describe('groupByDirectory', () => {
  it('collapses big directories and lists small ones', () => {
    const files = [
      'mov/ipu/1.bin',
      'mov/ipu/2.bin',
      'mov/ipu/3.bin',
      'mov/ipu/4.bin',
      'mov/logo.mpg',
      'TGS.bin',
    ].map(entry);
    expect(groupByDirectory(files)).toEqual(['mov/ipu/ — 4 files', 'mov/logo.mpg', 'TGS.bin']);
  });
});

describe('hasBlockingErrors', () => {
  it('ignores per-pair errors while at least one pair is active', () => {
    expect(hasBlockingErrors(plan([pair(1), pair(0)]))).toBe(false);
  });
  it('blocks when every pair is skipped or a plan-level error exists', () => {
    expect(hasBlockingErrors(plan([pair(1)]))).toBe(true);
    expect(hasBlockingErrors(plan([pair(0)], 1))).toBe(true);
  });
});
