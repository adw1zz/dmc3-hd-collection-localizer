import { describe, expect, it, vi } from 'vitest';

import type * as FfmpegModule from '../ffmpeg/index.js';
import type { FileEntry } from '../fs/index.js';
import type { Pair, Plan } from './types.js';

vi.mock('../ffmpeg/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof FfmpegModule>();
  return {
    ...actual,
    ffprobe: vi.fn((_bin: string, file: string) => {
      const table: Record<string, string> = {
        '/s/m01.mpg':
          '{"streams":[{"index":1,"codec_type":"audio","codec_name":"mp2"}],"format":{"format_name":"mpeg","duration":"211.536"}}',
        '/t/m01.webm':
          '{"streams":[{"index":1,"codec_type":"audio","codec_name":"opus"}],"format":{"format_name":"matroska,webm","duration":"210.935"}}',
        '/s/guro.mpg':
          '{"streams":[{"index":1,"codec_type":"audio","codec_name":"mp2"}],"format":{"format_name":"mpeg","duration":"6.42"}}',
        '/t/guro.webm':
          '{"streams":[{"index":1,"codec_type":"audio","codec_name":"opus"}],"format":{"format_name":"matroska,webm","duration":"11.77"}}',
        '/s/mute.mpg':
          '{"streams":[{"index":0,"codec_type":"video","codec_name":"mpeg1video"}],"format":{"format_name":"mpeg","duration":"5"}}',
        '/t/mute.webm':
          '{"streams":[{"index":1,"codec_type":"audio","codec_name":"opus"}],"format":{"format_name":"matroska,webm","duration":"5"}}',
        '/s/ok.bin':
          '{"streams":[{"index":0,"codec_type":"audio","codec_name":"vorbis"}],"format":{"format_name":"ogg","duration":"47.31"}}',
        '/t/ok.ogg':
          '{"streams":[{"index":0,"codec_type":"audio","codec_name":"vorbis"}],"format":{"format_name":"ogg","duration":"47.31"}}',
      };
      const json = table[file];
      if (!json) return Promise.reject(new actual.ProbeError(file, 'Invalid data found'));
      return Promise.resolve(actual.parseProbeOutput(json, file));
    }),
  };
});

const { probePlan } = await import('./probe.js');
const { ffprobe } = await import('../ffmpeg/index.js');

function entry(p: string): FileEntry {
  const name = p.split('/').at(-1) ?? p;
  const dot = name.lastIndexOf('.');
  return {
    path: p,
    rel: p.slice(1),
    name,
    stem: name.slice(0, dot),
    ext: name.slice(dot),
    size: 1,
  };
}

function pair(category: string, s: string, t: string): Pair {
  return {
    category,
    key: entry(t).stem,
    source: entry(s),
    target: entry(t),
    alternatives: [],
    issues: [],
  };
}

function plan(pairs: Pair[]): Plan {
  return {
    mode: 'av',
    sourceDir: '/s',
    targetDir: '/t',
    pairs,
    unmatchedTarget: [],
    unmatchedSource: [],
    issues: [],
  };
}

describe('probePlan', () => {
  it('attaches probe info and derives duration / stream issues', async () => {
    const p = plan([
      pair('fmv', '/s/m01.mpg', '/t/m01.webm'),
      pair('fmv', '/s/guro.mpg', '/t/guro.webm'),
      pair('fmv', '/s/mute.mpg', '/t/mute.webm'),
      pair('sound', '/s/ok.bin', '/t/ok.ogg'),
      pair('sound', '/s/broken.bin', '/t/ok.ogg'),
      { ...pair('sound', '/s/music.bin', '/t/music.ogg'), excluded: 'music' },
    ]);
    const seen: number[] = [];
    await probePlan(p, { ffprobeBin: 'ffprobe', jobs: 2, onProgress: (d) => seen.push(d) });

    const codes = p.pairs.map((x) => x.issues.map((i) => `${i.level}:${i.code}`));
    expect(codes).toEqual([
      ['warn:duration-mismatch'],
      ['error:duration-mismatch-large'],
      ['error:source-no-audio'],
      [],
      ['error:probe-failed'],
      [], // excluded: never probed, no issues
    ]);
    expect(p.pairs[0]?.probe?.durationDelta).toBeCloseTo(0.601, 3);
    expect(p.pairs[4]?.probe).toBeUndefined();
    expect(p.pairs[5]?.probe).toBeUndefined();

    // each distinct file probed once: 8 ok + 1 broken = 9 (ok.ogg shared; excluded pair not probed)
    expect(vi.mocked(ffprobe)).toHaveBeenCalledTimes(9);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
