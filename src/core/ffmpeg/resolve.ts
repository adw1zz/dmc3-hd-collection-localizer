import path from 'node:path';

import { isFile } from '../fs/index.js';

/**
 * Locates the ffmpeg / ffprobe executables (ADR-0003, revised 2026-10-10:
 * nothing is bundled). Order: explicit directory (`--ffmpeg-dir`) →
 * env `DMC3_FFMPEG_DIR` → `PATH`. Both binaries must come from the same
 * location.
 */

export type FfmpegOrigin = 'option' | 'env' | 'path';

export interface FfmpegBinaries {
  ffmpeg: string;
  ffprobe: string;
  origin: FfmpegOrigin;
}

export const FFMPEG_DIR_ENV = 'DMC3_FFMPEG_DIR';

export class FfmpegNotFoundError extends Error {
  constructor(public readonly tried: readonly string[]) {
    super(
      'ffmpeg/ffprobe not found. Tried:\n' +
        tried.map((t) => `  - ${t}`).join('\n') +
        '\nInstall ffmpeg (https://ffmpeg.org/download.html), add its bin folder to PATH,' +
        ` set ${FFMPEG_DIR_ENV}, or pass --ffmpeg-dir <dir>.`,
    );
    this.name = 'FfmpegNotFoundError';
  }
}

export interface ResolveOptions {
  /** `--ffmpeg-dir` value, already absolute. */
  dir?: string | undefined;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

const exeSuffix = (platform: NodeJS.Platform): string => (platform === 'win32' ? '.exe' : '');

export async function resolveFfmpeg(opts: ResolveOptions = {}): Promise<FfmpegBinaries> {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const tried: string[] = [];

  const fromDir = async (dir: string, origin: FfmpegOrigin): Promise<FfmpegBinaries | null> => {
    const ffmpeg = path.join(dir, `ffmpeg${exeSuffix(platform)}`);
    const ffprobe = path.join(dir, `ffprobe${exeSuffix(platform)}`);
    if ((await isFile(ffmpeg)) && (await isFile(ffprobe))) return { ffmpeg, ffprobe, origin };
    tried.push(`${origin}: ${dir}`);
    return null;
  };

  if (opts.dir) {
    const r = await fromDir(opts.dir, 'option');
    if (r) return r;
  }
  const envDir = env[FFMPEG_DIR_ENV];
  if (envDir) {
    const r = await fromDir(envDir, 'env');
    if (r) return r;
  }

  const onPath = await findOnPath(['ffmpeg', 'ffprobe'], env, platform);
  if (onPath) {
    const [ffmpeg, ffprobe] = onPath;
    if (ffmpeg && ffprobe) return { ffmpeg, ffprobe, origin: 'path' };
  }
  tried.push('PATH');

  throw new FfmpegNotFoundError(tried);
}

/** Finds all `names` in the same PATH entry; returns their full paths in order, or null. */
async function findOnPath(
  names: readonly string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<string[] | null> {
  const pathVar = env.PATH ?? env.Path ?? '';
  const dirs = pathVar.split(path.delimiter).filter(Boolean);
  const exts =
    platform === 'win32'
      ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase())
      : [''];

  for (const dir of dirs) {
    const found: string[] = [];
    for (const name of names) {
      let hit: string | null = null;
      for (const ext of exts) {
        const candidate = path.join(dir, name + ext);
        if (await isFile(candidate)) {
          hit = candidate;
          break;
        }
      }
      if (!hit) break;
      found.push(hit);
    }
    if (found.length === names.length) return found;
  }
  return null;
}
