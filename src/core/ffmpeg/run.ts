import { execa } from 'execa';

export class FfmpegError extends Error {
  constructor(
    public readonly args: readonly string[],
    public readonly stderr: string,
  ) {
    super(`ffmpeg failed: ${lastLines(stderr, 3) || 'no output'}`);
    this.name = 'FfmpegError';
  }
}

/** Runs ffmpeg with `-hide_banner -nostdin -y` prepended; throws FfmpegError with its stderr tail. */
export async function runFfmpeg(ffmpegBin: string, args: readonly string[]): Promise<void> {
  const full = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args];
  try {
    await execa(ffmpegBin, full, { windowsHide: true, stdin: 'ignore' });
  } catch (e) {
    const stderr =
      e instanceof Error && 'stderr' in e && typeof e.stderr === 'string'
        ? e.stderr
        : e instanceof Error
          ? e.message
          : String(e);
    throw new FfmpegError(full, stderr);
  }
}

function lastLines(text: string, n: number): string {
  return text.trim().split(/\r?\n/).filter(Boolean).slice(-n).join(' | ');
}
