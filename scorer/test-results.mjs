// Normalize the Vitest JSON reporter output while the scorer still knows the checkout root.
import { relative, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

const duration = value => Number.isFinite(value) && value >= 0 ? value : null;
const firstError = text => typeof text === 'string' ? stripVTControlCharacters(text).split('\n')[0].slice(0, 500) : '';

export function readTestFiles(report, repo) {
  if (!Array.isArray(report.testResults)) throw new Error('Expected testResults in the runner JSON report');
  return report.testResults.map(file => {
    const path = relative(repo, resolve(repo, file.name)).split('\\').join('/');
    const cases = file.assertionResults.map(test => ({
      title: test.title, suites: test.ancestorTitles ?? [], status: test.status,
      ms: duration(test.duration), line: test.location?.line, outcomeId: test.meta?.rjOutcome,
      error: firstError(test.failureMessages?.[0]) || undefined,
    }));
    return { path, status: file.status, error: firstError(file.message) || undefined, cases };
  }).sort((a, b) => a.path.localeCompare(b.path));
}

export const folderOf = file => { const parts = file.split('/'); return parts.length > 2 ? parts.slice(0, 2).join('/') : parts.slice(0, -1).join('/') || '.'; };
