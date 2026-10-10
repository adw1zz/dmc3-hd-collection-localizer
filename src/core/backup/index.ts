import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { isFile, isInside, isSamePath, sha256File } from '../fs/index.js';
import {
  loadManifest,
  ManifestError,
  newManifest,
  saveManifest,
  type Manifest,
  type ManifestEntry,
} from './manifest.js';

export {
  loadManifest,
  MANIFEST_NAME,
  ManifestError,
  manifestPath,
  saveManifest,
  type Manifest,
  type ManifestEntry,
} from './manifest.js';

/**
 * One backup directory per target directory, no timestamps (Ivan, 2026-10-10).
 * Originals are copied once; later runs never overwrite a backed-up original.
 *
 * Classification of a target file against the manifest:
 * - `new`               — never seen: will be backed up before overwriting.
 * - `original`          — seen, hash equals the backed-up original: nothing to back up.
 * - `already-localized` — hash equals the result we wrote last time: skip the pair.
 * - `changed`           — seen, but hash matches neither (Steam verify, another mod):
 *                         treated as a new original, backup copy replaced (with a warning).
 */
export type TargetState = 'new' | 'original' | 'already-localized' | 'changed';

export interface BackupOptions {
  backupDir: string;
  targetDir: string;
  /** Written into the manifest for the record. */
  tool: string;
}

export class Backup {
  private constructor(
    readonly backupDir: string,
    readonly targetDir: string,
    readonly manifest: Manifest,
    /** True when the manifest did not exist before this run. */
    readonly isNew: boolean,
  ) {}

  /** Loads the manifest (or prepares a fresh one). Does not create anything on disk yet. */
  static async open(opts: BackupOptions): Promise<Backup> {
    if (isInside(opts.targetDir, opts.backupDir)) {
      throw new ManifestError(
        `backup directory must not be inside the target directory: ${opts.backupDir}`,
      );
    }
    const existing = await loadManifest(opts.backupDir);
    if (existing && !isSamePath(existing.targetDir, opts.targetDir)) {
      throw new ManifestError(
        `${opts.backupDir} already holds a backup of a different target:\n` +
          `  manifest: ${existing.targetDir}\n  requested: ${opts.targetDir}\n` +
          'Use another --backup-dir.',
      );
    }
    return new Backup(
      opts.backupDir,
      opts.targetDir,
      existing ?? newManifest(opts.tool, opts.targetDir),
      existing === null,
    );
  }

  /** Where the pristine copy of a target-relative path lives. */
  copyPath(rel: string): string {
    return path.join(this.backupDir, ...rel.split('/'));
  }

  entry(rel: string): ManifestEntry | undefined {
    return this.manifest.entries[rel];
  }

  /** Classifies the current target file. Hashes it only when a manifest entry exists. */
  async classify(rel: string): Promise<{ state: TargetState; sha256?: string }> {
    const entry = this.entry(rel);
    if (!entry) return { state: 'new' };
    const sha256 = await sha256File(this.targetPath(rel));
    if (sha256 === entry.sha256) return { state: 'original', sha256 };
    if (sha256 === entry.result?.sha256) return { state: 'already-localized', sha256 };
    return { state: 'changed', sha256 };
  }

  /**
   * Ensures the original of `rel` is in the backup. Copies only for `new` and
   * `changed`; returns the state it acted on. The copy is hashed after writing,
   * which both records it and verifies the copy.
   */
  async backup(rel: string, state?: TargetState): Promise<TargetState> {
    const s = state ?? (await this.classify(rel)).state;
    if (s === 'original' || s === 'already-localized') return s;

    const src = this.targetPath(rel);
    const dst = this.copyPath(rel);
    await mkdir(path.dirname(dst), { recursive: true });
    await copyFile(src, dst);
    const [copyHash, { size }] = await Promise.all([sha256File(dst), stat(dst)]);
    const srcHash = await sha256File(src);
    if (copyHash !== srcHash) {
      throw new ManifestError(`backup copy of ${rel} does not match the original (disk error?)`);
    }
    this.manifest.entries[rel] = { size, sha256: copyHash, backedUpAt: new Date().toISOString() };
    return s;
  }

  /** Records what we wrote into the target for `rel` (stage 4 calls this after a successful apply). */
  recordResult(rel: string, resultSha256: string, source: string): void {
    const entry = this.manifest.entries[rel];
    if (!entry) throw new ManifestError(`recordResult: ${rel} was never backed up`);
    entry.result = { sha256: resultSha256, source, appliedAt: new Date().toISOString() };
  }

  async save(): Promise<void> {
    await mkdir(this.backupDir, { recursive: true });
    await saveManifest(this.backupDir, this.manifest);
  }

  /**
   * Copies every backed-up original back into the target. Verifies the backup
   * copy against the manifest hash first; a corrupt copy is reported, not written.
   */
  async restore(
    onFile?: (rel: string, status: 'restored' | 'missing' | 'corrupt') => void,
  ): Promise<{ restored: string[]; missing: string[]; corrupt: string[] }> {
    const restored: string[] = [];
    const missing: string[] = [];
    const corrupt: string[] = [];
    for (const [rel, entry] of Object.entries(this.manifest.entries)) {
      const copy = this.copyPath(rel);
      if (!(await isFile(copy))) {
        missing.push(rel);
        onFile?.(rel, 'missing');
        continue;
      }
      if ((await sha256File(copy)) !== entry.sha256) {
        corrupt.push(rel);
        onFile?.(rel, 'corrupt');
        continue;
      }
      const dst = this.targetPath(rel);
      await mkdir(path.dirname(dst), { recursive: true });
      await copyFile(copy, dst);
      delete entry.result;
      restored.push(rel);
      onFile?.(rel, 'restored');
    }
    return { restored, missing, corrupt };
  }

  private targetPath(rel: string): string {
    return path.join(this.targetDir, ...rel.split('/'));
  }
}
