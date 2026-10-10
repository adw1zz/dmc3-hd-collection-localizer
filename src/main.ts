import { createRequire } from 'node:module';
import { Command, InvalidArgumentError } from 'commander';

import {
  DEFAULT_BACKUP_DIR_NAME,
  LOCALIZATION_MODES,
  OptionsError,
  parseLocalizeOptions,
  type RawLocalizeOptions,
} from './cli/options.js';
import { hasErrors, printPlanSummary } from './cli/summary.js';
import { analyse } from './core/analyser/index.js';
import { setLogLevel, ui } from './core/console/index.js';
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
      'use ffmpeg/ffprobe from this directory instead of the bundled ones',
    )
    .option(
      '-j, --jobs <n>',
      'parallel ffmpeg/ffprobe processes (default: half of CPU cores)',
      parseIntOption,
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
  ui.debug(`ffmpeg-dir: ${options.ffmpegDir ?? '(bundled / PATH)'}`);
  if (options.dryRun) ui.warn('dry-run: nothing will be written');

  const mode = getMode(options.mode);
  const plan = await analyse({
    spec: mode.spec,
    sourceDir: options.source,
    targetDir: options.target,
  });
  printPlanSummary(plan, mode.spec);

  if (hasErrors(plan)) {
    ui.error('cannot continue — fix the errors above');
    process.exitCode = 1;
    return;
  }
  if (options.dryRun) return;

  // Stage 2 (confirm), 3 (backup), 4 (apply) plug in here.
  ui.warn('confirm/backup/apply: not implemented yet');
}

try {
  await buildProgram().parseAsync(process.argv);
} catch (e: unknown) {
  ui.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exitCode = 1;
}
