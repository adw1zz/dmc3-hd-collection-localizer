import type { ProbeStream } from './probe.js';

/**
 * Builds `-c:a … -b:a … -ar … -ac …` so the output audio matches the target's
 * stream. Rule (Ivan, 2026-10-10): every parameter comes from the target
 * probe; when the target lacks it (e.g. bit rate inside WebM), fall back to the
 * source stream; otherwise a sane default.
 */

const ENCODERS: Record<string, string> = {
  opus: 'libopus',
  vorbis: 'libvorbis',
  aac: 'aac',
  mp3: 'libmp3lame',
  mp2: 'mp2',
  flac: 'flac',
  pcm_s16le: 'pcm_s16le',
};

export const DEFAULT_AUDIO_BITRATE = 128_000;

export class UnsupportedCodecError extends Error {
  constructor(codec: string) {
    super(`no encoder known for target audio codec "${codec}"`);
    this.name = 'UnsupportedCodecError';
  }
}

export interface AudioEncodeParams {
  encoder: string;
  bitRate: number;
  sampleRate: number | undefined;
  channels: number | undefined;
}

export function audioEncodeParams(target: ProbeStream, source?: ProbeStream): AudioEncodeParams {
  const encoder = ENCODERS[target.codec];
  if (!encoder) throw new UnsupportedCodecError(target.codec);
  return {
    encoder,
    bitRate: target.bitRate ?? source?.bitRate ?? DEFAULT_AUDIO_BITRATE,
    sampleRate: target.sampleRate ?? source?.sampleRate,
    channels: target.channels ?? source?.channels,
  };
}

/** ffmpeg output options for the audio stream. */
export function audioEncodeArgs(p: AudioEncodeParams): string[] {
  const args = ['-c:a', p.encoder, '-b:a', String(p.bitRate)];
  if (p.sampleRate !== undefined) args.push('-ar', String(p.sampleRate));
  if (p.channels !== undefined) args.push('-ac', String(p.channels));
  return args;
}

/** `-f` value for a container, by lower-case extension. */
export function containerFormat(ext: string): string {
  const map: Record<string, string> = {
    '.webm': 'webm',
    '.mkv': 'matroska',
    '.mp4': 'mp4',
    '.ogg': 'ogg',
    '.oga': 'ogg',
    '.wav': 'wav',
    '.flac': 'flac',
    '.mp3': 'mp3',
  };
  const f = map[ext.toLowerCase()];
  if (!f) throw new Error(`no ffmpeg container format known for "${ext}"`);
  return f;
}
