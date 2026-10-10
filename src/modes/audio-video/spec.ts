import type { ModeSpec } from '../../core/analyser/types.js';

/**
 * Audio/video mode: pre-rendered cutscenes (FMV) and in-game audio banks.
 *
 * Target (HD Collection `data\dmc3`): `Video\*.webm` (VP9 + Opus) and
 * `afs\sound\*.ogg` (Vorbis). Source: any folder tree — a 2006 PC port
 * install (`mov\*.mpg`, `sound\*.bin` — the .bin files are plain Ogg Vorbis)
 * or a prepared folder with the same file names.
 */
export const audioVideoSpec: ModeSpec = {
  id: 'av',
  label: 'audio/video',
  categories: [
    {
      id: 'fmv',
      label: 'cutscene video',
      targetExts: ['.webm'],
      sourceExts: ['.mpg', '.mpeg', '.wmv', '.webm', '.mkv', '.mp4'],
    },
    {
      id: 'sound',
      label: 'in-game audio',
      targetExts: ['.ogg'],
      sourceExts: ['.ogg', '.bin'],
      // Speech lives in mission-prefixed banks (m01_c00, m03_b00, m99_c01, …) and
      // in-engine demo tracks (m_demo_04_004). Everything else (Battle_*, Boss_*,
      // Stage_*, Hine_*, Staffroll, character themes …) is music — the 2006 port
      // ships different cuts of it, so it is excluded unless --all is given.
      include: [/^m\d\d_/i, /^m_demo_/i],
      excludedLabel: 'music, not speech — use --all to include',
    },
  ],
};
