import { listFiles, type FileEntry } from '../fs/index.js';
import type { ModeSpec } from './types.js';

/** Files found on one side, grouped by category id. */
export type Scan = Map<string, FileEntry[]>;

/** Target: each category owns the files with its `targetExts`. */
export async function scanTarget(dir: string, spec: ModeSpec): Promise<Scan> {
  const all = await listFiles(dir, { exts: spec.categories.flatMap((c) => c.targetExts) });
  return groupByCategory(all, spec, 'targetExts');
}

/** Source: each category owns the files with its `sourceExts`; a file may land in several. */
export async function scanSource(dir: string, spec: ModeSpec): Promise<Scan> {
  const all = await listFiles(dir, { exts: spec.categories.flatMap((c) => c.sourceExts) });
  return groupByCategory(all, spec, 'sourceExts');
}

function groupByCategory(
  files: readonly FileEntry[],
  spec: ModeSpec,
  side: 'targetExts' | 'sourceExts',
): Scan {
  const scan: Scan = new Map(spec.categories.map((c) => [c.id, []]));
  for (const c of spec.categories) {
    const exts = new Set(c[side]);
    const bucket = scan.get(c.id);
    if (!bucket) continue;
    for (const f of files) if (exts.has(f.ext)) bucket.push(f);
  }
  return scan;
}
