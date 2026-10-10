import { access, constants, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Thin, promise-based helpers over node:fs used by validation and analysis.
 * All functions resolve to booleans instead of throwing for "not there" cases.
 */

export async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

export async function isReadable(p: string): Promise<boolean> {
  try {
    await access(p, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function isWritable(p: string): Promise<boolean> {
  try {
    await access(p, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Absolute, normalised path; `~` is not expanded (shells do that). */
export function toAbsolute(p: string, cwd: string = process.cwd()): string {
  return path.resolve(cwd, p);
}

/** True when both paths point at the same location (case-insensitive on Windows). */
export function isSamePath(a: string, b: string): boolean {
  const na = path.normalize(toAbsolute(a));
  const nb = path.normalize(toAbsolute(b));
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

/** True when `child` is inside (or equal to) `parent`. */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(toAbsolute(parent), toAbsolute(child));
  if (rel === '') return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

export interface FileEntry {
  /** Absolute path. */
  path: string;
  /** Path relative to the directory that was listed (forward slashes). */
  rel: string;
  /** File name with extension. */
  name: string;
  /** File name without extension. */
  stem: string;
  /** Extension in lower case, including the dot (`.webm`). */
  ext: string;
  size: number;
}

export interface ListOptions {
  /** Keep only these lower-case extensions (with dot). */
  exts?: readonly string[];
  /** Descend into subdirectories (default: true). */
  recursive?: boolean;
}

/**
 * Lists regular files under `dir` (recursively by default), sorted by relative path.
 * Symlinks are not followed. Unreadable subdirectories are skipped.
 */
export async function listFiles(dir: string, opts: ListOptions = {}): Promise<FileEntry[]> {
  const wanted = opts.exts ? new Set(opts.exts.map((e) => e.toLowerCase())) : undefined;
  const recursive = opts.recursive ?? true;
  const root = toAbsolute(dir);
  const files: FileEntry[] = [];

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive) await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rawExt = path.extname(entry.name);
      const ext = rawExt.toLowerCase();
      if (wanted && !wanted.has(ext)) continue;
      const { size } = await stat(full);
      files.push({
        path: full,
        rel: path.relative(root, full).split(path.sep).join('/'),
        name: entry.name,
        stem: entry.name.slice(0, entry.name.length - rawExt.length),
        ext,
        size,
      });
    }
  }

  await walk(root);
  files.sort((a, b) => compareRel(a.rel, b.rel));
  return files;
}

/** Locale-independent ordering (by code point) so results are stable across machines. */
export function compareRel(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
