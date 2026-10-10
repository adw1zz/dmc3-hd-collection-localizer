import type { Issue, ModeSpec, Plan } from '../core/analyser/types.js';
import { ui } from '../core/console/index.js';

/** Renders the analysis result for the user, before confirmation. */
export function printPlanSummary(plan: Plan, spec: ModeSpec): void {
  ui.title('Analysis');

  for (const category of spec.categories) {
    const pairs = plan.pairs.filter((p) => p.category === category.id);
    const missing = plan.unmatchedTarget.filter((u) => u.category === category.id);
    ui.info(
      `${category.label}: ${ui.fmt.value(pairs.length)} to localize` +
        (missing.length > 0 ? `, ${missing.length} without source (kept as is)` : ''),
    );
    for (const p of pairs) {
      ui.debug(`${p.target.rel}  ←  ${p.source.rel}`);
      for (const i of p.issues) printIssue(i);
    }
    for (const m of missing) ui.debug(`${m.file.rel}  ←  (no source)`);
  }

  for (const i of plan.issues) {
    printIssue(i);
    if (i.code === 'unmatched-source') for (const s of plan.unmatchedSource) ui.debug(s.rel);
  }

  const warnings = countIssues(plan, 'warn');
  const errors = countIssues(plan, 'error');
  ui.log('');
  ui.info(
    `${ui.fmt.value(plan.pairs.length)} pair(s) total, ${warnings} warning(s), ${errors} error(s)` +
      ui.fmt.dim(' — run with -v to list every file'),
  );
}

export function hasErrors(plan: Plan): boolean {
  return countIssues(plan, 'error') > 0;
}

function countIssues(plan: Plan, level: Issue['level']): number {
  let n = plan.issues.filter((i) => i.level === level).length;
  for (const p of plan.pairs) n += p.issues.filter((i) => i.level === level).length;
  return n;
}

function printIssue(i: Issue): void {
  if (i.level === 'error') ui.error(i.message);
  else ui.warn(i.message);
}
