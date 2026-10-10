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
  /** File name with extension. */
  name: string;
  /** File name without extension. */
  stem: string;
  /** Extension in lower case, including the dot (`.webm`). */
  ext: string;
  size: number;
}

/**
 * Non-recursive listing of regular files in `dir`.
 * Optional `exts` filters by lower-case extension (with dot).
 */
export async function listFiles(dir: string, exts?: readonly string[]): Promise<FileEntry[]> {
  const wanted = exts ? new Set(exts.map((e) => e.toLowerCase())) : undefined;
  const entries = await readdir(dir, { withFileTypes: true });
  const files: FileEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (wanted && !wanted.has(ext)) continue;
    const full = path.join(dir, entry.name);
    const { size } = await stat(full);
    files.push({ path: full, name: entry.name, stem: path.basename(entry.name, ext), ext, size });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}
