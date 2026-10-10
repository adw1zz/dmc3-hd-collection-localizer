import pc from 'picocolors';

/**
 * Console output for the CLI. Every module prints through this so that
 * colours, verbosity and (later) log-file mirroring live in one place.
 */

export type LogLevel = 'silent' | 'normal' | 'verbose';

let level: LogLevel = 'normal';

export function setLogLevel(next: LogLevel): void {
  level = next;
}

export function getLogLevel(): LogLevel {
  return level;
}

function out(line: string): void {
  if (level !== 'silent') process.stdout.write(`${line}\n`);
}

function err(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** Named `ui` so it never shadows the global `console`. */
export const ui = {
  /** Plain line, no prefix. */
  log(message: string): void {
    out(message);
  },
  /** Section title. */
  title(message: string): void {
    out(`\n${pc.bold(pc.cyan(message))}`);
  },
  info(message: string): void {
    out(`${pc.blue('i')} ${message}`);
  },
  success(message: string): void {
    out(`${pc.green('✓')} ${message}`);
  },
  warn(message: string): void {
    out(`${pc.yellow('!')} ${pc.yellow(message)}`);
  },
  error(message: string): void {
    err(`${pc.red('✗')} ${pc.red(message)}`);
  },
  /** Printed only with --verbose. */
  debug(message: string): void {
    if (level === 'verbose') out(pc.dim(`  ${message}`));
  },
  /** Helpers for inline emphasis inside messages. */
  fmt: {
    path: (p: string): string => pc.underline(p),
    value: (v: string | number): string => pc.bold(String(v)),
    dim: (s: string): string => pc.dim(s),
  },
};
