import {
  activePairs,
  donePairs,
  excludedPairs,
  hasBlockingErrors,
  isDone,
  isExcluded,
  isSkipped,
  skippedPairs,
} from '../core/analyser/index.js';
import type { Issue, ModeSpec, Pair, Plan } from '../core/analyser/types.js';
import { ui } from '../core/console/index.js';
import { audioStream, type ProbeInfo } from '../core/ffmpeg/index.js';
import type { FileEntry } from '../core/fs/index.js';

/** Renders the analysis result for the user, before confirmation. */
export function printPlanSummary(plan: Plan, spec: ModeSpec): void {
  ui.title('Analysis');

  for (const category of spec.categories) {
    const pairs = plan.pairs.filter((p) => p.category === category.id);
    const excluded = pairs.filter(isExcluded);
    const skipped = pairs.filter((p) => !isExcluded(p) && isSkipped(p));
    const done = pairs.filter((p) => !isExcluded(p) && !isSkipped(p) && isDone(p));
    const active = pairs.filter((p) => !isExcluded(p) && !isSkipped(p) && !isDone(p));
    const missing = plan.unmatchedTarget.filter((u) => u.category === category.id);
    ui.info(
      `${category.label}: ${ui.fmt.value(active.length)} to localize` +
        (done.length > 0 ? `, ${done.length} already localized` : '') +
        (skipped.length > 0 ? `, ${skipped.length} skipped (errors)` : '') +
        (excluded.length > 0 ? `, ${excluded.length} excluded (${excluded[0]?.excluded})` : '') +
        (missing.length > 0 ? `, ${missing.length} without source (kept as is)` : ''),
    );
    for (const p of active) {
      ui.debug(`${p.target.rel}  ←  ${p.source.rel}${describeProbe(p)}`);
      for (const i of p.issues) printIssue(i);
    }
    for (const p of done) ui.debug(`${p.target.rel}  ←  ${p.source.rel}  (already localized)`);
    for (const p of skipped) {
      ui.debug(`${p.target.rel}  ←  ${p.source.rel}${describeProbe(p)}`);
      for (const i of p.issues) printIssue(i, 'skipped');
    }
    for (const p of excluded) ui.debug(`${p.target.rel}  ←  ${p.source.rel}  (excluded)`);
    for (const m of missing) ui.debug(`${m.file.rel}  ←  (no source)`);
  }

  for (const i of plan.issues) {
    printIssue(i);
    if (i.code === 'unmatched-source') {
      for (const line of groupByDirectory(plan.unmatchedSource)) ui.debug(line);
    }
  }

  const warnings = countIssues(plan, 'warn');
  const errors = countIssues(plan, 'error');
  ui.log('');
  ui.info(
    `${ui.fmt.value(activePairs(plan).length)} pair(s) to localize, ` +
      (donePairs(plan).length > 0 ? `${donePairs(plan).length} already localized, ` : '') +
      `${skippedPairs(plan).length} skipped, ${excludedPairs(plan).length} excluded, ` +
      `${warnings} warning(s), ${errors} error(s)` +
      ui.fmt.dim(' — run with -v to list every file'),
  );
  if (hasBlockingErrors(plan)) ui.error('cannot continue — fix the errors above');
}

export { hasBlockingErrors } from '../core/analyser/index.js';

function countIssues(plan: Plan, level: Issue['level']): number {
  let n = plan.issues.filter((i) => i.level === level).length;
  for (const p of plan.pairs) n += p.issues.filter((i) => i.level === level).length;
  return n;
}

/** `dir/ — N file(s)` for big directories, individual lines for ≤ 3 files. */
export function groupByDirectory(files: readonly FileEntry[], threshold = 3): string[] {
  const byDir = new Map<string, FileEntry[]>();
  for (const f of files) {
    const dir = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/') + 1) : './';
    byDir.set(dir, [...(byDir.get(dir) ?? []), f]);
  }
  const lines: string[] = [];
  for (const [dir, list] of byDir) {
    if (list.length > threshold) lines.push(`${dir} — ${list.length} files`);
    else for (const f of list) lines.push(f.rel);
  }
  return lines;
}

/** `  [mp2 48000Hz 2ch 211.54s → opus 48000Hz 2ch 210.94s, Δ+0.60s]` for verbose listings. */
function describeProbe(p: Pair): string {
  if (!p.probe) return '';
  const one = (info: ProbeInfo): string => {
    const a = audioStream(info);
    const codec = a
      ? `${a.codec}${a.sampleRate ? ` ${a.sampleRate}Hz` : ''}${a.channels ? ` ${a.channels}ch` : ''}`
      : 'no audio';
    return `${codec} ${Number.isNaN(info.duration) ? '?' : info.duration.toFixed(2)}s`;
  };
  const d = p.probe.durationDelta;
  const delta = Number.isNaN(d) ? '' : `, Δ${d >= 0 ? '+' : ''}${d.toFixed(2)}s`;
  return ui.fmt.dim(`  [${one(p.probe.source)} → ${one(p.probe.target)}${delta}]`);
}

function printIssue(i: Issue, suffix?: string): void {
  const msg = suffix ? `${i.message} → ${suffix}` : i.message;
  if (i.level === 'error') ui.error(msg);
  else if (i.level === 'warn') ui.warn(msg);
  else ui.debug(msg);
}
