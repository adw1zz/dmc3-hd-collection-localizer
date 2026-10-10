import { describe, expect, it } from 'vitest';

import {
  audioEncodeArgs,
  audioEncodeParams,
  containerFormat,
  UnsupportedCodecError,
} from './encode.js';
import type { ProbeStream } from './probe.js';

const opusTarget: ProbeStream = {
  index: 1,
  type: 'audio',
  codec: 'opus',
  sampleRate: 48000,
  channels: 2,
  channelLayout: 'stereo',
};
const mp2Source: ProbeStream = {
  index: 1,
  type: 'audio',
  codec: 'mp2',
  sampleRate: 48000,
  channels: 2,
  bitRate: 128000,
};

describe('audioEncodeParams', () => {
  it('takes everything from the target, bit rate from the source when the target has none', () => {
    const p = audioEncodeParams(opusTarget, mp2Source);
    expect(p).toEqual({ encoder: 'libopus', bitRate: 128000, sampleRate: 48000, channels: 2 });
    expect(audioEncodeArgs(p)).toEqual([
      '-c:a',
      'libopus',
      '-b:a',
      '128000',
      '-ar',
      '48000',
      '-ac',
      '2',
    ]);
  });

  it('prefers the target bit rate and falls back to the default', () => {
    expect(audioEncodeParams({ ...opusTarget, bitRate: 96000 }, mp2Source).bitRate).toBe(96000);
    expect(audioEncodeParams(opusTarget).bitRate).toBe(128000);
  });

  it('rejects codecs we cannot encode', () => {
    expect(() => audioEncodeParams({ ...opusTarget, codec: 'atrac3' })).toThrow(
      UnsupportedCodecError,
    );
  });
});

describe('containerFormat', () => {
  it('maps known extensions and rejects unknown ones', () => {
    expect(containerFormat('.webm')).toBe('webm');
    expect(containerFormat('.OGG')).toBe('ogg');
    expect(() => containerFormat('.bin')).toThrow(/container/);
  });
});
