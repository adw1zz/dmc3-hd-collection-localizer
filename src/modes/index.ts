import { audioVideoMode } from './audio-video/index.js';
import type { LocalizationMode, LocalizationModeId } from '../core/analyser/types.js';

const registry: Partial<Record<LocalizationModeId, LocalizationMode>> = {
  av: audioVideoMode,
  // text: reserved
};

/** Ids that have an implementation. */
export const IMPLEMENTED_MODES: readonly LocalizationModeId[] = Object.keys(
  registry,
) as LocalizationModeId[];

export function getMode(id: LocalizationModeId): LocalizationMode {
  const mode = registry[id];
  if (!mode) throw new Error(`localization mode "${id}" is not implemented`);
  return mode;
}

export { LOCALIZATION_MODES } from '../core/analyser/types.js';
export type { LocalizationModeId } from '../core/analyser/types.js';
