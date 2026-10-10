import type { LocalizationMode, Pair } from '../../core/analyser/types.js';
import { audioVideoSpec } from './spec.js';

export const audioVideoMode: LocalizationMode = {
  spec: audioVideoSpec,
  apply(_pair: Pair): Promise<void> {
    return Promise.reject(new Error('av apply: not implemented yet'));
  },
};
