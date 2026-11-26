import { formatDuration } from './timing.mjs';
import { folderOf } from './test-results.mjs';

export function testExplorer(result, esc) {
  const outcomes = result.outcomes ?? [];
  const groups = ['rules', 'journeys'].flatMap(layer => (result.layers?.[layer]?.testFiles ?? []).map((file, i) => ({
    ...file, layer, id: `file-${layer}-${i}`,
    cases: file.cases.map((test, j) => ({ ...test, id: `case-${layer}-${i}-${j}` })),
  })));
  const count = groups.reduce((sum, file) => sum + file.cases.length, 0);
  const link = (id, title) => `<a href="#${id}">${esc(title)}</a>`;
  const badge = status => `<span class="state ${esc(status)}">${esc(status)}</span>`;
  const caseTime = test => Number.isFinite(test.ms) ? formatDuration(test.ms) : 'Time unavailable';
  function total(cases) {
    const timed = cases.filter(test => Number.isFinite(test.ms));
    return timed.length ? formatDuration(timed.reduce((sum, test) => sum + test.ms, 0)) + ' case time' : 'Time unavailable';
  }
  function source(file, line) {
    const label = esc(file + (line ? ':' + line : ''));
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/blob\/[0-9a-f]+$/.test(result.sourceUrl ?? '')) return `<code>${label}</code>`;
    const href = result.sourceUrl + '/' + file.split('/').map(encodeURIComponent).join('/') + (Number.isInteger(line) ? '#L' + line : '');
    return `<a href="${esc(href)}"><code>${label}</code></a>`;
  }
  function caseRow(file, test) {
    const outcome = outcomes.find(o => o.id === test.outcomeId);
    return `<details class="case-row" id="${test.id}">
      <summary><span>${esc(test.title)}</span>${badge(test.status)}<span class="case-time">${caseTime(test)}</span></summary>
      <div class="case-body">${test.suites.length ? `<p>${esc(test.suites.join(' › '))}</p>` : ''}
        <p>${source(file.path, test.line)}</p>
        ${test.error ? `<p class="error-text">${esc(test.error)}</p>` : ''}
        ${outcome ? `<p>${esc(outcome.title)}</p>${outcome.routes.map(route => `<code class="observed-route">${esc(route)}</code>`).join('')}` : ''}
      </div></details>`;
  }
  function fileRow(file) {
    const stem = file.path.split('/').at(-1).replace(/(?:\.journey)?\.(?:test|spec)\.[^.]+$/, '').replaceAll('-', ' ');
    const name = stem.charAt(0).toUpperCase() + stem.slice(1);
    return `<details class="test-file" id="${file.id}">
      <summary><span>${esc(name)}</span>${badge(file.status)}<span>${file.cases.length} ${file.cases.length === 1 ? 'test' : 'tests'} · ${total(file.cases)}</span></summary>
      <p>${source(file.path)}</p>
      ${file.error ? `<p class="error-text">${esc(file.error)}</p>` : ''}
      ${file.coreSources?.length ? `<details class="evidence"><summary>Direct core imports</summary>${file.coreSources.map(path => `<p>${source(path)}</p>`).join('')}</details>` : ''}
      ${file.cases.map(test => caseRow(file, test)).join('')}
    </details>`;
  }
  function layerPanel(layer) {
    const data = result.layers?.[layer];
    return `<section id="tests-${layer}"><h2>${layer === 'rules' ? 'Rules' : 'Journeys'}</h2>
      <div class="card">${data?.testFiles?.length ? groups.filter(f => f.layer === layer).map(fileRow).join('') :
        `<p class="muted small">${Array.isArray(data?.testFiles) ? 'The runner reported no test files.' : 'This run has no individual test records.'}</p>`}</div></section>`;
  }
  function folderFiles(folder) {
    const files = groups.filter(file => file.coreSources?.some(path => folderOf(path) === folder));
    return files.length ? files.map(file => `<p>${link(file.id, file.path)} · ${total(file.cases)}</p>`).join('') :
      '<p>No recorded test file directly imports this folder.</p>';
  }
  function outcomeLinks(ids) {
    const tests = groups.flatMap(f => f.cases).filter(t => t.outcomeId && ids.includes(t.outcomeId));
    return tests.map(t => `<p>${link(t.id, t.title)} · ${caseTime(t)}</p>`).join('');
  }
  function findingSource(path, line) {
    const file = groups.find(f => f.path === path);
    if (!file) return source(path, line);
    const test = file.cases.find(t => line && t.line === line);
    return link(test?.id ?? file.id, path + (line ? ':' + line : ''));
  }
  return { count, layerPanel, folderFiles, outcomeLinks, findingSource };
}
