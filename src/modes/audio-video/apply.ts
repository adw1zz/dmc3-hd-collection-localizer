import { copyFile } from 'node:fs/promises';

import type { ApplyContext, ApplyOutput, Pair } from '../../core/analyser/types.js';
import {
  audioEncodeArgs,
  audioEncodeParams,
  audioStream,
  containerFormat,
  runFfmpeg,
  type AudioEncodeParams,
} from '../../core/ffmpeg/index.js';

/**
 * Audio/video conversions. Both require `pair.probe` (filled by the analyser);
 * the executor never calls apply for pairs that were not probed.
 */

export class ApplyPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplyPreconditionError';
  }
}

function requireProbe(pair: Pair): NonNullable<Pair['probe']> {
  if (!pair.probe) throw new ApplyPreconditionError(`${pair.target.name}: pair was not probed`);
  return pair.probe;
}

/**
 * FMV: keep the target's video stream untouched, replace its audio with the
 * source's, encoded to the target's audio parameters. The output is forced to
 * the target's duration: shorter audio is padded with silence, longer audio
 * is cut — so A/V length never drifts.
 */
export async function applyFmv(pair: Pair, ctx: ApplyContext): Promise<ApplyOutput> {
  const probe = requireProbe(pair);
  const targetAudio = audioStream(probe.target);
  const sourceAudio = audioStream(probe.source);
  if (!sourceAudio) throw new ApplyPreconditionError(`${pair.source.rel}: no audio stream`);
  if (!targetAudio)
    throw new ApplyPreconditionError(`${pair.target.rel}: no audio stream to match`);

  const params = audioEncodeParams(targetAudio, sourceAudio);
  const duration = probe.target.duration;
  const args = [
    '-i',
    pair.target.path,
    '-i',
    pair.source.path,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-map_metadata',
    '0',
    '-c:v',
    'copy',
    ...audioEncodeArgs(params),
    '-af',
    'apad',
    ...(Number.isNaN(duration) ? ['-shortest'] : ['-t', duration.toFixed(3)]),
    '-f',
    containerFormat(pair.target.ext),
    ctx.tmpPath,
  ];
  await runFfmpeg(ctx.ffmpeg, args);
  return {
    ...(Number.isNaN(duration) ? {} : { expectedDuration: duration }),
    how: `${sourceAudio.codec} → ${describe(params)}, video copied`,
  };
}

/**
 * In-game audio: when the source already is the same container + codec as the
 * target (the 2006 port's `.bin` is plain Ogg Vorbis) it is copied byte for
 * byte; otherwise it is transcoded to the target's parameters.
 */
export async function applySound(pair: Pair, ctx: ApplyContext): Promise<ApplyOutput> {
  const probe = requireProbe(pair);
  const targetAudio = audioStream(probe.target);
  const sourceAudio = audioStream(probe.source);
  if (!sourceAudio) throw new ApplyPreconditionError(`${pair.source.rel}: no audio stream`);
  if (!targetAudio)
    throw new ApplyPreconditionError(`${pair.target.rel}: no audio stream to match`);

  const sameContainer = probe.source.formatName
    .split(',')
    .includes(containerFormat(pair.target.ext));
  if (sameContainer && sourceAudio.codec === targetAudio.codec) {
    await copyFile(pair.source.path, ctx.tmpPath);
    return { expectedDuration: probe.source.duration, how: 'copied (same format)' };
  }

  const params = audioEncodeParams(targetAudio, sourceAudio);
  const args = [
    '-i',
    pair.source.path,
    '-vn',
    '-map',
    '0:a:0',
    ...audioEncodeArgs(params),
    '-f',
    containerFormat(pair.target.ext),
    ctx.tmpPath,
  ];
  await runFfmpeg(ctx.ffmpeg, args);
  return {
    expectedDuration: probe.source.duration,
    how: `${sourceAudio.codec} → ${describe(params)}`,
  };
}

function describe(p: AudioEncodeParams): string {
  return `${p.encoder} ${Math.round(p.bitRate / 1000)}k${p.sampleRate ? ` ${p.sampleRate}Hz` : ''}${p.channels ? ` ${p.channels}ch` : ''}`;
}
