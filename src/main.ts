import { createRequire } from 'node:module';
import { Command, InvalidArgumentError } from 'commander';

import {
  DEFAULT_BACKUP_DIR_NAME,
  LOCALIZATION_MODES,
  OptionsError,
  parseLocalizeOptions,
  type RawLocalizeOptions,
} from './cli/options.js';
import { hasBlockingErrors, printPlanSummary } from './cli/summary.js';
import { analyse, probePlan } from './core/analyser/index.js';
import { activePairs } from './core/analyser/index.js';
import { confirm, NotInteractiveError, setLogLevel, ui } from './core/console/index.js';
import { FfmpegNotFoundError, resolveFfmpeg } from './core/ffmpeg/index.js';
import { getMode } from './modes/index.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { name: string; version: string; description: string };

function parseIntOption(value: string): number {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) throw new InvalidArgumentError('expected an integer');
  return n;
}

function buildProgram(): Command {
  const program = new Command()
    .name(pkg.name)
    .description(pkg.description)
    .version(pkg.version, '-V, --version')
    .showHelpAfterError('(use --help for the list of options)');

  program
    .command('localize')
    .description('Apply a localization to the HD Collection game files')
    .requiredOption(
      '-s, --source <dir>',
      'directory with the localized files (a 2006 PC port install or a prepared folder)',
    )
    .requiredOption('-t, --target <dir>', String.raw`HD Collection data directory (...\data\dmc3)`)
    .option(
      '-m, --mode <mode>',
      `what to localize: ${LOCALIZATION_MODES.join(' | ')} (text is not implemented yet)`,
      'av',
    )
    .option(
      '-b, --backup-dir <dir>',
      `where to copy originals before overwriting (default: ./${DEFAULT_BACKUP_DIR_NAME}/<timestamp>)`,
    )
    .option(
      '--ffmpeg-dir <dir>',
      'directory containing ffmpeg and ffprobe (default: $DMC3_FFMPEG_DIR, then PATH)',
    )
    .option(
      '-j, --jobs <n>',
      'parallel ffmpeg/ffprobe processes (default: half of CPU cores)',
      parseIntOption,
    )
    .option(
      '-a, --all',
      'localize every matched file, including ones the mode treats as non-speech (music)',
      false,
    )
    .option('-y, --yes', 'do not ask for confirmation', false)
    .option('-n, --dry-run', 'analyse and print the plan, change nothing', false)
    .option('-v, --verbose', 'print details of every step', false)
    .action(async (raw: RawLocalizeOptions) => {
      await runLocalize(raw);
    });

  program
    .command('restore')
    .description('Restore original game files from a backup directory')
    .requiredOption('-b, --backup-dir <dir>', 'backup directory created by `localize`')
    .option('-y, --yes', 'do not ask for confirmation', false)
    .action(() => {
      ui.error('restore: not implemented yet');
      process.exitCode = 2;
    });

  return program;
}

async function runLocalize(raw: RawLocalizeOptions): Promise<void> {
  if (raw.verbose) setLogLevel('verbose');

  let options;
  try {
    options = await parseLocalizeOptions(raw);
  } catch (e) {
    if (e instanceof OptionsError) {
      ui.error('Invalid parameters:');
      for (const p of e.problems) ui.error(`  ${p}`);
      process.exitCode = 1;
      return;
    }
    throw e;
  }

  ui.title(`${pkg.name} ${pkg.version}`);
  ui.info(`mode:    ${ui.fmt.value(options.mode)}`);
  ui.info(`source:  ${ui.fmt.path(options.source)}`);
  ui.info(`target:  ${ui.fmt.path(options.target)}`);
  ui.info(`backup:  ${ui.fmt.path(options.backupDir)}`);
  ui.info(`jobs:    ${ui.fmt.value(options.jobs)}`);
  if (options.dryRun) ui.warn('dry-run: nothing will be written');

  let bins;
  try {
    bins = await resolveFfmpeg({ dir: options.ffmpegDir });
  } catch (e) {
    if (e instanceof FfmpegNotFoundError) {
      ui.error(e.message);
      process.exitCode = 1;
      return;
    }
    throw e;
  }
  ui.debug(`ffmpeg:  ${bins.ffmpeg} (${bins.origin})`);
  ui.debug(`ffprobe: ${bins.ffprobe} (${bins.origin})`);

  const mode = getMode(options.mode);
  const plan = await analyse({
    spec: mode.spec,
    sourceDir: options.source,
    targetDir: options.target,
    all: options.all,
  });

  const toProbe = plan.pairs.filter((p) => p.excluded === undefined);
  if (toProbe.length > 0) {
    const files = new Set(toProbe.flatMap((p) => [p.source.path, p.target.path])).size;
    ui.info(`probing ${ui.fmt.value(files)} files with ffprobe (${options.jobs} parallel)…`);
    const started = Date.now();
    await probePlan(plan, { ffprobeBin: bins.ffprobe, jobs: options.jobs });
    ui.debug(`probe finished in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }

  printPlanSummary(plan, mode.spec);

  if (hasBlockingErrors(plan)) {
    process.exitCode = 1;
    return;
  }
  if (options.dryRun) return;

  // Stage 2 — confirm.
  const n = activePairs(plan).length;
  if (!options.yes) {
    let ok: boolean;
    try {
      ok = await confirm(
        `Overwrite ${n} file(s) in ${ui.fmt.path(options.target)}? Originals go to ${ui.fmt.path(options.backupDir)}.`,
      );
    } catch (e) {
      if (e instanceof NotInteractiveError) {
        ui.error(e.message);
        process.exitCode = 1;
        return;
      }
      throw e;
    }
    if (!ok) {
      ui.info('aborted, nothing changed');
      return;
    }
  }

  // Stage 3 (backup), 4 (apply) plug in here.
  ui.warn('backup/apply: not implemented yet');
}

try {
  await buildProgram().parseAsync(process.argv);
} catch (e: unknown) {
  ui.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exitCode = 1;
}
