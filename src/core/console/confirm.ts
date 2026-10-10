import { createInterface } from 'node:readline/promises';
import pc from 'picocolors';

export interface ConfirmOptions {
  /** Answer assumed when the user just presses Enter (default: false). */
  defaultAnswer?: boolean;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export class NotInteractiveError extends Error {
  constructor() {
    super('stdin is not a terminal — pass --yes to skip the confirmation');
    this.name = 'NotInteractiveError';
  }
}

/**
 * Asks a yes/no question. Accepts y/yes/д/да and n/no/н/нет (any case); anything
 * else re-asks. Throws {@link NotInteractiveError} when stdin is not a TTY so
 * scripts fail loudly instead of hanging.
 */
export async function confirm(question: string, opts: ConfirmOptions = {}): Promise<boolean> {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const def = opts.defaultAnswer ?? false;

  if (!opts.input && !process.stdin.isTTY) throw new NotInteractiveError();

  // Lines are consumed through the async iterator (not `rl.question`) so answers
  // that arrive in one chunk — piped input, fast typing — are never lost.
  const rl = createInterface({ input, terminal: false });
  const prompt = `${pc.bold('?')} ${question} ${pc.dim(def ? '[Y/n]' : '[y/N]')} `;
  try {
    output.write(prompt);
    for await (const raw of rl) {
      const answer = parseYesNo(raw);
      if (answer !== undefined) return answer;
      if (raw.trim() === '') return def;
      output.write(pc.dim('  please answer y or n\n') + prompt);
    }
    // Input closed without an answer (Ctrl-D / EOF).
    return false;
  } finally {
    rl.close();
  }
}

export function parseYesNo(raw: string): boolean | undefined {
  const v = raw.trim().toLowerCase();
  if (['y', 'yes', 'д', 'да'].includes(v)) return true;
  if (['n', 'no', 'н', 'нет'].includes(v)) return false;
  return undefined;
}
