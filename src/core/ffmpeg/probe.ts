import { execa } from 'execa';

/** Normalised subset of `ffprobe -show_format -show_streams` we care about. */
export interface ProbeStream {
  index: number;
  type: 'video' | 'audio' | 'other';
  codec: string;
  sampleRate?: number;
  channels?: number;
  channelLayout?: string;
  bitRate?: number;
}

export interface ProbeInfo {
  /** Comma-separated demuxer names, e.g. `matroska,webm`, `ogg`, `mpeg`. */
  formatName: string;
  /** Seconds; NaN when ffprobe could not determine it. */
  duration: number;
  streams: ProbeStream[];
}

export class ProbeError extends Error {
  constructor(
    public readonly file: string,
    detail: string,
  ) {
    super(`ffprobe failed for ${file}: ${detail}`);
    this.name = 'ProbeError';
  }
}

const ARGS = [
  '-v',
  'error',
  '-show_entries',
  'format=format_name,duration:stream=index,codec_type,codec_name,sample_rate,channels,channel_layout,bit_rate',
  '-of',
  'json',
] as const;

export async function ffprobe(ffprobeBin: string, file: string): Promise<ProbeInfo> {
  let stdout: string;
  try {
    ({ stdout } = await execa(ffprobeBin, [...ARGS, file], { windowsHide: true }));
  } catch (e) {
    const detail =
      e instanceof Error && 'stderr' in e && typeof e.stderr === 'string' && e.stderr.trim()
        ? e.stderr.trim()
        : e instanceof Error
          ? e.message
          : String(e);
    throw new ProbeError(file, detail);
  }
  return parseProbeOutput(stdout, file);
}

/** Raw JSON shape (only the fields we request). */
interface RawProbe {
  format?: { format_name?: string; duration?: string };
  streams?: {
    index?: number;
    codec_type?: string;
    codec_name?: string;
    sample_rate?: string;
    channels?: number;
    channel_layout?: string;
    bit_rate?: string;
  }[];
}

export function parseProbeOutput(json: string, file = '<stdin>'): ProbeInfo {
  let raw: RawProbe;
  try {
    raw = JSON.parse(json) as RawProbe;
  } catch {
    throw new ProbeError(file, 'invalid JSON from ffprobe');
  }
  if (!raw.format) throw new ProbeError(file, 'no format section (unrecognised file?)');

  const toNum = (v: string | number | undefined): number | undefined => {
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const streams: ProbeStream[] = (raw.streams ?? []).map((s) => {
    const stream: ProbeStream = {
      index: s.index ?? 0,
      type: s.codec_type === 'video' || s.codec_type === 'audio' ? s.codec_type : 'other',
      codec: s.codec_name ?? 'unknown',
    };
    const sampleRate = toNum(s.sample_rate);
    const bitRate = toNum(s.bit_rate);
    if (sampleRate !== undefined) stream.sampleRate = sampleRate;
    if (s.channels !== undefined) stream.channels = s.channels;
    if (s.channel_layout !== undefined) stream.channelLayout = s.channel_layout;
    if (bitRate !== undefined) stream.bitRate = bitRate;
    return stream;
  });

  return {
    formatName: raw.format.format_name ?? 'unknown',
    duration: toNum(raw.format.duration) ?? Number.NaN,
    streams,
  };
}

export function audioStream(info: ProbeInfo): ProbeStream | undefined {
  return info.streams.find((s) => s.type === 'audio');
}

export function videoStream(info: ProbeInfo): ProbeStream | undefined {
  return info.streams.find((s) => s.type === 'video');
}
