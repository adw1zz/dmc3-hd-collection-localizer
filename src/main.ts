#!/usr/bin/env node
import { createRequire } from 'node:module';
import path from 'node:path';
import { Command, InvalidArgumentError } from 'commander';

import {
  DEFAULT_BACKUP_DIR_NAME,
  LOCALIZATION_MODES,
  OptionsError,
  parseLocalizeOptions,
  parseRestoreOptions,
  type RawLocalizeOptions,
} from './cli/options.js';
import {
  Backup,
  loadManifest,
  MANIFEST_NAME,
  ManifestError,
  manifestPath,
  type TargetState,
} from './core/backup/index.js';
import { startProgress } from './cli/progress.js';
import { hasBlockingErrors, printPlanSummary } from './cli/summary.js';
import { applyPlan, type ApplyReport } from './core/apply/index.js';
import { analyse, probePlan } from './core/analyser/index.js';
import { activePairs, donePairs, skippedPairs } from './core/analyser/index.js';
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
      `where to copy originals before overwriting (default: ./${DEFAULT_BACKUP_DIR_NAME})`,
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
    .option('-v, --verbose', 'print every restored file', false)
    .action(async (raw: { backupDir: string; yes?: boolean; verbose?: boolean }) => {
      await runRestore(raw);
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

  // Open the backup manifest early: a backup dir that belongs to another target
  // is a hard error, better reported before any work is done.
  let backup: Backup;
  try {
    backup = await Backup.open({
      backupDir: options.backupDir,
      targetDir: options.target,
      tool: `${pkg.name}@${pkg.version}`,
    });
  } catch (e) {
    if (e instanceof ManifestError) {
      ui.error(e.message);
      process.exitCode = 1;
      return;
    }
    throw e;
  }

  const toProbe = plan.pairs.filter((p) => p.excluded === undefined);
  if (toProbe.length > 0) {
    const files = new Set(toProbe.flatMap((p) => [p.source.path, p.target.path])).size;
    ui.info(`probing ${ui.fmt.value(files)} files with ffprobe (${options.jobs} parallel)…`);
    const started = Date.now();
    const probeProgress = startProgress(files, 'probing');
    try {
      await probePlan(plan, {
        ffprobeBin: bins.ffprobe,
        jobs: options.jobs,
        onProgress: (_done, _total, file) => probeProgress.tick(path.basename(file)),
      });
    } finally {
      probeProgress.stop();
    }
    ui.debug(`probe finished in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }

  // Stage 3a — compare targets against an existing backup manifest (before the
  // summary, so "already localized" counts are visible when the user confirms).
  const states = new Map<string, TargetState>();
  if (!backup.isNew) {
    const candidates = activePairs(plan);
    ui.info(
      `checking ${ui.fmt.value(candidates.length)} target file(s) against the backup manifest…`,
    );
    for (const p of candidates) {
      const { state } = await backup.classify(p.target.rel);
      states.set(p.target.rel, state);
      if (state === 'already-localized') {
        p.issues.push({
          level: 'info',
          code: 'already-localized',
          message: `${p.target.name}: already localized by a previous run`,
        });
      } else if (state === 'changed') {
        p.issues.push({
          level: 'warn',
          code: 'target-changed',
          message: `${p.target.name}: target differs from the backed-up original (Steam verify?) — backup copy will be replaced`,
        });
      }
    }
  }

  printPlanSummary(plan, mode.spec);

  if (hasBlockingErrors(plan)) {
    process.exitCode = 1;
    return;
  }
  const work = activePairs(plan);
  if (work.length === 0) {
    const skipped = skippedPairs(plan).length;
    ui.success(
      `nothing to do — ${donePairs(plan).length} file(s) already localized` +
        (skipped > 0 ? `, ${skipped} skipped because of errors (see above)` : ''),
    );
    if (skipped > 0) process.exitCode = 1;
    return;
  }
  if (options.dryRun) return;

  // Stage 2 — confirm.
  if (!options.yes) {
    let ok: boolean;
    try {
      ok = await confirm(
        `Overwrite ${work.length} file(s) in ${ui.fmt.path(options.target)}? Originals go to ${ui.fmt.path(options.backupDir)}.`,
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

  // Stage 3b — copy originals into the backup.
  ui.title('Backup');
  let copied = 0;
  const backupProgress = startProgress(work.length, 'backing up');
  try {
    for (const p of work) {
      const state = await backup.backup(p.target.rel, states.get(p.target.rel));
      if (state === 'new' || state === 'changed') copied += 1;
      backupProgress.tick(p.target.rel);
    }
  } finally {
    backupProgress.stop();
  }
  await backup.save();
  ui.success(
    `${copied} original(s) copied, ${work.length - copied} already in backup — manifest: ${ui.fmt.path(manifestPath(options.backupDir))}`,
  );

  // Stage 4 — apply.
  ui.title('Localizing');
  const applyProgress = startProgress(work.length, 'localizing');
  let report: ApplyReport;
  try {
    report = await applyPlan(plan, {
      mode,
      bins,
      backup,
      jobs: options.jobs,
      onProgress: (_done, _total, r) => {
        applyProgress.tick(r.pair.target.rel, r.status);
        if (r.status === 'ok')
          ui.debug(`${r.pair.target.rel}: ${r.how ?? 'ok'} (${(r.ms / 1000).toFixed(1)} s)`);
      },
    });
  } finally {
    applyProgress.stop();
  }

  // Stage 5 — report.
  ui.title('Result');
  for (const r of report.results) {
    if (r.status === 'failed') ui.error(`${r.pair.target.rel}: ${r.error ?? 'unknown error'}`);
  }
  const secs = (report.ms / 1000).toFixed(1);
  if (report.failed === 0) {
    ui.success(`${report.ok} file(s) localized in ${secs} s`);
  } else {
    ui.error(
      `${report.ok} file(s) localized, ${report.failed} failed in ${secs} s — failed targets were left untouched`,
    );
    process.exitCode = 1;
  }
  ui.info(
    `to undo: ${ui.fmt.value(`${pkg.name} restore -b "${options.backupDir}"`)}` +
      ui.fmt.dim(' (Steam "Verify integrity" also restores the originals)'),
  );
}

async function runRestore(raw: {
  backupDir: string;
  yes?: boolean;
  verbose?: boolean;
}): Promise<void> {
  if (raw.verbose) setLogLevel('verbose');
  let options;
  try {
    options = await parseRestoreOptions(raw);
  } catch (e) {
    if (e instanceof OptionsError) {
      ui.error('Invalid parameters:');
      for (const p of e.problems) ui.error(`  ${p}`);
      process.exitCode = 1;
      return;
    }
    throw e;
  }

  const manifest = await loadManifest(options.backupDir).catch((e: unknown) => {
    if (e instanceof ManifestError) return e;
    throw e;
  });
  if (manifest instanceof ManifestError || manifest === null) {
    ui.error(manifest === null ? `no ${MANIFEST_NAME} in ${options.backupDir}` : manifest.message);
    process.exitCode = 1;
    return;
  }

  const entries = Object.entries(manifest.entries);
  const localized = entries.filter(([, e]) => e.result).length;
  ui.title(`${pkg.name} ${pkg.version} — restore`);
  ui.info(`backup:  ${ui.fmt.path(options.backupDir)}`);
  ui.info(`target:  ${ui.fmt.path(manifest.targetDir)}`);
  ui.info(`files:   ${ui.fmt.value(entries.length)} backed up, ${localized} marked as localized`);

  if (!options.yes) {
    let ok: boolean;
    try {
      ok = await confirm(
        `Restore ${entries.length} original file(s) into ${ui.fmt.path(manifest.targetDir)}?`,
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

  const backup = await Backup.open({
    backupDir: options.backupDir,
    targetDir: manifest.targetDir,
    tool: `${pkg.name}@${pkg.version}`,
  });
  const result = await backup.restore((rel, status) => {
    if (status === 'restored') ui.debug(`restored ${rel}`);
    else ui.error(`${rel}: backup copy ${status}`);
  });
  await backup.save();

  ui.log('');
  ui.success(`${result.restored.length} file(s) restored`);
  if (result.missing.length + result.corrupt.length > 0) {
    ui.error(
      `${result.missing.length} missing, ${result.corrupt.length} corrupt backup copies — ` +
        'use Steam "Verify integrity of game files" for those',
    );
    process.exitCode = 1;
  }
}

try {
  await buildProgram().parseAsync(process.argv);
} catch (e: unknown) {
  ui.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exitCode = 1;
}
