import { describe, expect, it } from 'vitest';

import type { FileEntry } from '../fs/index.js';
import { matchScans } from './match.js';
import type { Scan } from './scan.js';
import type { FileCategory } from './types.js';

function entry(rel: string, size = 1): FileEntry {
  const name = rel.split('/').at(-1) ?? rel;
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  return { path: `/abs/${rel}`, rel, name, stem: dot >= 0 ? name.slice(0, dot) : name, ext, size };
}

const fmv: FileCategory = {
  id: 'fmv',
  label: 'cutscene video',
  targetExts: ['.webm'],
  sourceExts: ['.mpg', '.wmv', '.webm'],
};
const sound: FileCategory = {
  id: 'sound',
  label: 'in-game audio',
  targetExts: ['.ogg'],
  sourceExts: ['.ogg', '.bin'],
};

function scan(entries: Record<string, string[]>): Scan {
  return new Map(Object.entries(entries).map(([k, v]) => [k, v.map((r) => entry(r))]));
}

describe('matchScans', () => {
  it('pairs by stem, case-insensitively, within a category', () => {
    const r = matchScans(
      [fmv],
      scan({ fmv: ['Video/M01_S00.webm', 'Video/GameOver.webm'] }),
      scan({ fmv: ['mov/m01_s00.mpg', 'mov/gameover.MPG'] }),
    );
    expect(r.pairs.map((p) => [p.target.rel, p.source.rel])).toEqual([
      ['Video/M01_S00.webm', 'mov/m01_s00.mpg'],
      ['Video/GameOver.webm', 'mov/gameover.MPG'],
    ]);
    expect(r.unmatchedTarget).toEqual([]);
    expect(r.unmatchedSource).toEqual([]);
    expect(r.issues).toEqual([]);
  });

  it('reports target files without source and source files without target', () => {
    const r = matchScans(
      [fmv],
      scan({ fmv: ['Video/GameOverF.webm', 'Video/m01_s00.webm'] }),
      scan({ fmv: ['mov/m01_s00.mpg', 'mov/logo.mpg'] }),
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.unmatchedTarget.map((u) => u.file.rel)).toEqual(['Video/GameOverF.webm']);
    expect(r.unmatchedSource.map((s) => s.rel)).toEqual(['mov/logo.mpg']);
  });

  it('does not pair across categories even if stems collide', () => {
    const r = matchScans(
      [fmv, sound],
      scan({ fmv: ['Video/m01_s00.webm'], sound: ['afs/sound/m01_s00.ogg'] }),
      scan({ fmv: ['mov/m01_s00.mpg'], sound: ['sound/m01_s00.bin'] }),
    );
    expect(r.pairs.map((p) => `${p.category}:${p.source.rel}`)).toEqual([
      'fmv:mov/m01_s00.mpg',
      'sound:sound/m01_s00.bin',
    ]);
  });

  it('picks the source by extension priority, then shortest path, and warns', () => {
    const r = matchScans(
      [fmv],
      scan({ fmv: ['Video/m01_s00.webm'] }),
      scan({ fmv: ['deep/dir/m01_s00.mpg', 'm01_s00.wmv', 'x/m01_s00.mpg'] }),
    );
    expect(r.pairs).toHaveLength(1);
    const p = r.pairs[0];
    expect(p?.source.rel).toBe('x/m01_s00.mpg');
    expect(p?.alternatives.map((a) => a.rel)).toEqual(['deep/dir/m01_s00.mpg', 'm01_s00.wmv']);
    expect(p?.issues.map((i) => i.code)).toEqual(['duplicate-source']);
    expect(r.unmatchedSource).toEqual([]);
  });

  it('maps one source to several same-named targets and warns about it', () => {
    const r = matchScans(
      [sound],
      scan({ sound: ['afs/sound/Battle_00.ogg', 'afs/sound/extra/battle_00.ogg'] }),
      scan({ sound: ['sound/Battle_00.bin'] }),
    );
    expect(r.pairs).toHaveLength(2);
    expect(r.issues.map((i) => i.code)).toEqual(['duplicate-target']);
  });

  it('marks pairs outside the include list as excluded unless all=true', () => {
    const speechOnly: FileCategory = {
      ...sound,
      include: [/^m\d\d_/i],
      excludedLabel: 'music',
    };
    const t = scan({ sound: ['afs/sound/M01_c00.ogg', 'afs/sound/Battle_00.ogg'] });
    const s = scan({ sound: ['sound/m01_c00.bin', 'sound/Battle_00.bin'] });

    const r = matchScans([speechOnly], t, s);
    expect(r.pairs.map((p) => [p.target.name, p.excluded])).toEqual([
      ['M01_c00.ogg', undefined],
      ['Battle_00.ogg', 'music'],
    ]);

    const all = matchScans([speechOnly], t, s, { all: true });
    expect(all.pairs.every((p) => p.excluded === undefined)).toBe(true);
  });

  it('handles an empty side', () => {
    const r = matchScans([fmv, sound], scan({ fmv: ['Video/a.webm'] }), scan({}));
    expect(r.pairs).toEqual([]);
    expect(r.unmatchedTarget).toHaveLength(1);
  });
});
