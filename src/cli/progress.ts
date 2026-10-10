import { SingleBar } from 'cli-progress';
import pc from 'picocolors';

import { getLogLevel, ui } from '../core/console/index.js';

/**
 * Progress for long stages. On a TTY (and not in verbose mode) a single bar
 * with the current file; otherwise plain lines, one per finished item, so
 * logs stay readable.
 */
export interface Progress {
  tick(name: string, status?: 'ok' | 'failed'): void;
  stop(): void;
}

export function startProgress(total: number, label: string): Progress {
  const useBar = process.stdout.isTTY === true && getLogLevel() === 'normal';
  if (!useBar) {
    let done = 0;
    return {
      tick(name, status = 'ok') {
        done += 1;
        const line = `[${done}/${total}] ${name}`;
        if (status === 'failed') ui.error(line);
        else ui.debug(line);
      },
      stop() {
        /* nothing to clear in line mode */
      },
    };
  }

  const bar = new SingleBar({
    format: `${label} ${pc.cyan('{bar}')} {value}/{total} ${pc.dim('{file}')}`,
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true,
    clearOnComplete: true,
    stopOnComplete: true,
  });
  bar.start(total, 0, { file: '' });
  return {
    tick(name) {
      bar.increment(1, { file: name });
    },
    stop() {
      bar.stop();
    },
  };
}
