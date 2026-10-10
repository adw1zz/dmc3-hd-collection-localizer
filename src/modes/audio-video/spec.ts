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
    },
  ],
};
