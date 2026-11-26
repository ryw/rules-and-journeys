// Review leads explain the evidence collected for a run. Only the scorer's existing checks affect penalties.
export function reviewItems(result, changedPaths = {}) {
  const items = [];
  for (const [layer, data] of Object.entries(result.layers ?? {})) {
    if (data.passed === false) items.push({ label: 'Failed suite', message: `The ${layer} command failed. Inspect its runner output.` });
  }
  for (const outcome of result.outcomes ?? []) {
    if (outcome.status === 'failed' || outcome.status === 'unobserved')
      items.push({ label: outcome.status === 'failed' ? 'Failed outcome' : 'Unobserved outcome', message: outcome.title });
  }
  for (const [folder, data] of Object.entries(result.folders ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    const n = data.recentUntouched;
    if (!(n > 0)) continue;
    const scope = result.rubricVersion >= 2 ? 'Rules' : 'test';
    items.push({ label: folder, message: `${n} recently changed ${n === 1 ? 'file is' : 'files are'} outside the ${scope} import graph.`,
      paths: changedPaths[folder]?.sort() });
  }
  if (result.mutation === null || (result.mutation === undefined && result.dimensions?.undertesting?.detail?.includes('mutation score n/a'))) {
    items.push({ label: 'Unmeasured', message: 'This run has no measured mutation score. How often the suite catches deliberately changed behavior is unknown.' });
  }
  return items;
}
