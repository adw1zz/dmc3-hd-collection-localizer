import type {
  ApplyContext,
  ApplyOutput,
  LocalizationMode,
  Pair,
} from '../../core/analyser/types.js';
import { applyFmv, applySound } from './apply.js';
import { audioVideoSpec } from './spec.js';

export const audioVideoMode: LocalizationMode = {
  spec: audioVideoSpec,
  apply(pair: Pair, ctx: ApplyContext): Promise<ApplyOutput> {
    switch (pair.category) {
      case 'fmv':
        return applyFmv(pair, ctx);
      case 'sound':
        return applySound(pair, ctx);
      default:
        return Promise.reject(new Error(`av mode: unknown category "${pair.category}"`));
    }
  },
};
