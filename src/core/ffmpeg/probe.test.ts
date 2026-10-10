import { describe, expect, it } from 'vitest';

import { audioStream, parseProbeOutput, ProbeError, videoStream } from './probe.js';

const webm = JSON.stringify({
  programs: [],
  streams: [
    { index: 0, codec_name: 'vp9', codec_type: 'video' },
    {
      index: 1,
      codec_name: 'opus',
      codec_type: 'audio',
      sample_rate: '48000',
      channels: 2,
      channel_layout: 'stereo',
    },
  ],
  format: { format_name: 'matroska,webm', duration: '210.935000' },
});

const ogg = JSON.stringify({
  streams: [
    {
      index: 0,
      codec_name: 'vorbis',
      codec_type: 'audio',
      sample_rate: '48000',
      channels: 2,
      bit_rate: '128000',
    },
  ],
  format: { format_name: 'ogg', duration: '47.312521' },
});

describe('parseProbeOutput', () => {
  it('normalises a webm with video + audio', () => {
    const info = parseProbeOutput(webm);
    expect(info.formatName).toBe('matroska,webm');
    expect(info.duration).toBeCloseTo(210.935, 3);
    expect(videoStream(info)?.codec).toBe('vp9');
    expect(audioStream(info)).toEqual({
      index: 1,
      type: 'audio',
      codec: 'opus',
      sampleRate: 48000,
      channels: 2,
      channelLayout: 'stereo',
    });
  });

  it('normalises an audio-only ogg', () => {
    const info = parseProbeOutput(ogg);
    expect(videoStream(info)).toBeUndefined();
    expect(audioStream(info)?.bitRate).toBe(128000);
  });

  it('yields NaN duration when ffprobe omits it', () => {
    const info = parseProbeOutput(JSON.stringify({ format: { format_name: 'ogg' }, streams: [] }));
    expect(Number.isNaN(info.duration)).toBe(true);
  });

  it('throws ProbeError on garbage or missing format', () => {
    expect(() => parseProbeOutput('not json', 'x')).toThrow(ProbeError);
    expect(() => parseProbeOutput('{}', 'x')).toThrow(/no format section/);
  });
});
