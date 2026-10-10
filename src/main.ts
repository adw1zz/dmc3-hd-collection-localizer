import pc from 'picocolors';

/**
 * Entry point. Business logic is wired in here later; for now it only proves
 * that the toolchain (tsx in dev, tsc build in prod) works end to end.
 */
function main(_argv: readonly string[]): number {
  console.log(
    `${pc.bold(pc.cyan('dmc3 HD Collection RU speech installer'))} ${pc.dim(`— node ${process.version}`)}`,
  );
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err: unknown) {
  console.error(pc.red(String(err)));
  process.exitCode = 1;
}
