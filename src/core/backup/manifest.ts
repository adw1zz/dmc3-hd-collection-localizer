import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

/**
 * `manifest.json` inside the backup directory. One entry per target file we
 * have ever overwritten: the hash of the pristine original (what sits in the
 * backup copy) and, once applied, the hash of the file we wrote.
 */

export const MANIFEST_NAME = 'manifest.json';
export const MANIFEST_VERSION = 1;

const resultSchema = z.object({
  /** sha256 of the file we wrote into the target. */
  sha256: z.string().length(64),
  /** Relative path of the source file used, for the record. */
  source: z.string(),
  appliedAt: z.string(),
});

const entrySchema = z.object({
  size: z.number().int().nonnegative(),
  /** sha256 of the original (also of the backup copy). */
  sha256: z.string().length(64),
  backedUpAt: z.string(),
  result: resultSchema.optional(),
});

export const manifestSchema = z.object({
  version: z.literal(MANIFEST_VERSION),
  tool: z.string(),
  /** Absolute target directory this backup belongs to. */
  targetDir: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Keyed by target-relative path with forward slashes. */
  entries: z.record(z.string(), entrySchema),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestEntry = z.infer<typeof entrySchema>;
export type ManifestResult = z.infer<typeof resultSchema>;

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

export function manifestPath(backupDir: string): string {
  return path.join(backupDir, MANIFEST_NAME);
}

export function newManifest(tool: string, targetDir: string, now = new Date()): Manifest {
  const iso = now.toISOString();
  return {
    version: MANIFEST_VERSION,
    tool,
    targetDir,
    createdAt: iso,
    updatedAt: iso,
    entries: {},
  };
}

/** Returns null when no manifest exists; throws ManifestError when it is unreadable. */
export async function loadManifest(backupDir: string): Promise<Manifest | null> {
  let text: string;
  try {
    text = await readFile(manifestPath(backupDir), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ManifestError(`${manifestPath(backupDir)} is not valid JSON`);
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new ManifestError(
      `${manifestPath(backupDir)} has an unexpected format: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return parsed.data;
}

export async function saveManifest(
  backupDir: string,
  manifest: Manifest,
  now = new Date(),
): Promise<void> {
  manifest.updatedAt = now.toISOString();
  const sorted: Manifest = {
    ...manifest,
    entries: Object.fromEntries(Object.entries(manifest.entries).sort()),
  };
  await writeFile(manifestPath(backupDir), `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}
