// SCOREBOARD.html: the scoreboard as one self-contained page. Charts are drawn with Observable Plot when the report is
// generated (server-side, into static SVG), so the page ships no chart library and stays small, printable and CSP-clean:
// one <style> block and one small <script> (theme toggle and tooltips), both allowed by hash. Colors are CSS variables,
// so light and dark each get their own palette. All text from the scored repo is escaped; every value a tooltip shows is
// also in the table view.
import { reviewItems } from './review-items.mjs';
import { formatDuration, formatTiming, speedDetail } from './timing.mjs';
import * as Plot from '@observablehq/plot';
import { parseHTML } from 'linkedom';

const { document } = parseHTML('<!doctype html><html><body></body></html>');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n, digits = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const when = iso => new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
const NAMES = { rulesPurity: 'Purity', speed: 'Speed', overtesting: 'Avoid overtesting', undertesting: 'Avoid undertesting', journeyCoverage: 'Journey coverage', determinism: 'Determinism', freshness: 'Freshness' };
/** What each dimension measures, in plain English (shown on hover). */
const EXPLAIN = {
  rulesPurity: 'Rules tests run with no database, network, environment variables or test doubles. The static check follows imports and scans the test files for direct environment and network access.',
  speed: 'Test time per line of source code, for each layer. A fast suite gets run on every change, by people and by agents.',
  overtesting: 'Penalizes tests that multiply (X × Y loops), mocks that restate the code, snapshots of internals, piles of tests on one small function, and Journeys that reach into rules.',
  undertesting: 'Rewards rules that have tests, recently changed code that some test reaches, Journeys that check an outcome and, when there is a mutation report, tests that catch mutations.',
  journeyCoverage: "Share of configured user outcomes observed passing in this run.",
  determinism: 'Static scan for random values, real clocks, sleeps and retries.',
  freshness: 'Checks whether the source files named by a Journey still match the hash recorded at its last review.',
};
/** Relative time, filled in by the page's script when it loads (so it stays right as the page ages). */
const ago = iso => `{ago:${new Date(iso).toISOString()}}`;

/** A Plot chart as static SVG; its per-chart <style> is dropped (the page carries one copy). */
const chart = options => Plot.plot({ document, className: 'rjp', ...options }).outerHTML.replace(/<style>[\s\S]*?<\/style>/, '');
const PLOT_CSS = `:where(.rjp) { display: block; height: auto; max-width: 100%; overflow: visible; } :where(.rjp text), :where(.rjp tspan) { white-space: pre; }`;

/** A score's band, as an icon that travels with its color (never color alone). */
function status(score) {
  if (score === null || score === undefined) return { key: 'none', label: 'Not measured', icon: '–' };
  if (score >= 85) return { key: 'good', label: '85 or more', icon: '✓' };
  if (score >= 60) return { key: 'warning', label: '60 to 84', icon: '!' };
  return { key: 'critical', label: 'Under 60', icon: '✕' };
}
const dot = s => `<span class="dot dot-${s.key}" role="img" aria-label="${esc(s.label)}" data-tip="${esc(s.label)}">${s.icon}</span>`;
const deltaTag = (now, before, { invert = false, unit = '' } = {}) => {
  if (before === null || before === undefined || now === null || now === undefined) return '';
  const d = Math.round((now - before) * 10) / 10;
  if (!d) return '';
  const better = invert ? d < 0 : d > 0;
  return `<span class="delta ${better ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d), Math.abs(d) < 10 && !Number.isInteger(d) ? 1 : 0)}${unit}</span>`;
};

/** Hover columns: one full-height transparent band per run, so the pointer only has to be in the right column. */
const columns = (data, domain) => Plot.rect(data, { x1: d => d.i - 0.5, x2: d => d.i + 0.5, y1: domain[0], y2: domain[1], fill: 'transparent', title: 'tip' });

/** The headline score over every run: area + line on 0–100. */
function trendChart(points) {
  if (!points.length) return '';
  const data = points.map((p, i) => ({ i, score: p.score, tip: `${p.score}/100 · ${ago(p.scoredAt)}` }));
  return chart({ width: 380, height: 132, marginLeft: 28, marginRight: 8, marginTop: 10, marginBottom: 8,
    x: { axis: null, domain: [-0.5, data.length - 0.5] }, y: { domain: [0, 100], ticks: [0, 50, 100], tickSize: 0, label: null },
    marks: [
      Plot.gridY([0, 50, 100], { stroke: 'var(--hairline)', strokeOpacity: 1 }),
      Plot.areaY(data, { x: 'i', y: 'score', fill: 'var(--series-1)', fillOpacity: 0.1 }),
      Plot.lineY(data, { x: 'i', y: 'score', stroke: 'var(--series-1)', strokeWidth: 2 }),
      Plot.dot(data.slice(-1), { x: 'i', y: 'score', r: 4.5, fill: 'var(--series-1)', stroke: 'var(--surface-1)', strokeWidth: 2 }),
      columns(data, [0, 100]),
    ] });
}

/** A small-multiple sparkline: values on a fixed domain (0–100 for scores), the latest point marked, a hover column per run. */
function sparkline(values, { domain = [0, 100], tips = [], height = 40 } = {}) {
  const data = values.map((v, i) => ({ i, v, tip: tips[i] ?? '' }));
  const defined = data.filter(d => d.v !== null && d.v !== undefined);
  if (defined.length < 2) return '';
  return chart({ width: 230, height, margin: 4, marginTop: 6, x: { axis: null, domain: [-0.5, data.length - 0.5] }, y: { axis: null, domain },
    marks: [
      Plot.ruleY([domain[0]], { stroke: 'var(--hairline)' }),
      Plot.areaY(data, { x: 'i', y: 'v', y1: domain[0], fill: 'var(--series-1)', fillOpacity: 0.08 }),
      Plot.lineY(data, { x: 'i', y: 'v', stroke: 'var(--series-1)', strokeWidth: 1.75 }),
      Plot.dot(defined.slice(-1), { x: 'i', y: 'v', r: 3, fill: 'var(--series-1)' }),
      columns(defined, domain),
    ] });
}

/** Ranked horizontal bars, one hue, value printed at the bar end. */
function bars(rows, { domain, label = r => fmt(r.value), height = 26, width = 480 } = {}) {
  if (!rows.length) return '<p class="muted small">Nothing here.</p>';
  const longest = Math.max(...rows.map(r => r.name.length));
  return chart({ width, height: rows.length * height + 6, marginLeft: Math.min(200, 7 * longest + 12), marginRight: 44, marginTop: 2, marginBottom: 4,
    x: { axis: null, domain: domain ?? [0, Math.max(...rows.map(r => r.value), 1)] }, y: { domain: rows.map(r => r.name), tickSize: 0, label: null, padding: 0.32 },
    marks: [
      Plot.barX(rows, { y: 'name', x: domain ? domain[1] : Math.max(...rows.map(r => r.value), 1), fill: 'var(--track)', rx: 4 }),
      Plot.barX(rows, { y: 'name', x: 'value', fill: 'var(--series-1)', rx: 4, title: r => r.tip ?? `${r.name}: ${label(r)}` }),
      Plot.text(rows, { y: 'name', x: domain ? domain[1] : Math.max(...rows.map(r => r.value), 1), text: label, textAnchor: 'start', dx: 8, fill: 'var(--text-primary)', fontWeight: 600, fontSize: 12 }),
    ] });
}

/**
 * The scoreboard page. history: earlier runs, oldest first, the current run last:
 * [{ scoredAt, commit, score, dimensions: { key: score|null }, layers: { rules: { ms }, journeys: { ms } } }].
 * nav (optional, from a server that keeps many runs): { back?, branches?: [{ name, href, current }], runs?: [{ href, score, commit, branch, scoredAt, current }] }.
 */
export function renderHtml(result, history = [], nav = {}) {
  const allRuns = history.length ? history : [{ scoredAt: result.scoredAt, commit: result.commit, score: result.score, dimensions: Object.fromEntries(Object.entries(result.dimensions).map(([k, d]) => [k, d.score])) }];
  // Compare only the uninterrupted stretch measured under the current rubric.
  const split = result.comparisonKey ? allRuns.findLastIndex(r => r.comparisonKey !== result.comparisonKey) + 1 : 0;
  const runs = allRuns.slice(split);
  if (!runs.length) runs.push({ scoredAt: result.scoredAt, score: result.score, dimensions: {}, layers: result.layers });
  const legacy = !result.rubricVersion;
  const outcomes = result.outcomes ?? [];
  const statusOf = layer => layer?.passed === true ? 'Passed' : layer?.passed === false ? 'Failed' : 'Unmeasured';
  const gaps = outcomes.filter(o => o.status === 'failed' || o.status === 'unobserved');
  const next = gaps.find(o => o.status === 'failed') ?? gaps[0];
  const observed = outcomes.filter(o => o.status === 'passed');
  const prev = runs.length >= 2 ? runs[runs.length - 2] : null;
  const D = { ...result.dimensions };
  // Stored runs include a preformatted speed description. Render it from the recorded numbers when available.
  const timingDetail = speedDetail(result.layers);
  if (D.speed?.score != null && timingDetail) D.speed = { ...D.speed, detail: timingDetail };
  const total = result.measuredWeight || 1;
  const opportunities = Object.entries(D).filter(([, d]) => d.score !== null).map(([key, d]) => ({ name: NAMES[key] ?? d.name, value: (d.weight * (100 - d.score)) / total, tip: `${NAMES[key] ?? d.name}: ${d.detail}` }))
    .filter(l => l.value >= 0.5).sort((a, b) => b.value - a.value);
  const repoName = result.name ?? (String(result.repo ?? '').split('/').filter(s => s && s !== '.').pop() || 'repo');
  const folders = Object.entries(result.folders ?? {}).map(([name, f]) => ({ name, value: f.score, tip: `${name}: ${f.tested} of ${f.exports} exports named in Rules text · ${f.reached} of ${f.files} files in the ${legacy ? 'test' : 'Rules'} import graph` }))
    .sort((a, b) => a.value - b.value);
  const entries = result.entryPoints ?? [];
  const areas = result.areas?.length ? result.areas : entries.length ? [{ name: 'Entry points', description: 'Routes and tools the scorer found. Group and describe them under "areas" in rules-and-journeys.json.', entryPoints: entries.map(e => ({ id: e.id, covered: e.covered })) }] : [];
  const findings = result.findings ?? [];
  const review = result.reviewItems ?? reviewItems(result);
  const findingCount = findings.length + review.length;
  const runTip = (value, i) => `${value === null || value === undefined ? 'n/a' : value} · ${ago(runs[i].scoredAt)}`;

  const card = key => {
    const d = D[key]; if (!d) return '';
    const series = runs.map((r, i) => i === runs.length - 1 ? d.score : r.dimensions?.[key] ?? null);
    return `<div class="card dim">
      <div class="dim-top"><span class="dim-name">${esc(NAMES[key] ?? d.name)}<span class="info" tabindex="0" data-tip="${esc(`${legacy && key === 'journeyCoverage' ? 'Historical score based on route text matches.' : EXPLAIN[key] ?? ''} Now: ${d.score === null ? d.reason ?? 'not measured' : d.detail} (weight ${d.weight})`)}" aria-label="What this measures">i</span></span>${dot(status(d.score))}</div>
      <div class="dim-score"><b>${d.score === null ? '–' : fmt(d.score)}</b>${key === 'speed' ? '' : deltaTag(d.score, prev?.dimensions?.[key])}</div>
      ${sparkline(series, { tips: series.map(runTip) })}
      <details class="evidence"><summary>Evidence</summary><p>${esc(d.detail ?? d.reason)}</p></details>
    </div>`;
  };
  const layer = name => {
    const l = result.layers?.[name]; if (!l) return '';
    const ms = runs.map((r, i) => i === runs.length - 1 ? l.ms ?? null : r.layers?.[name]?.ms ?? null), max = Math.max(...ms.filter(v => v !== null), 1);
    return `<div class="card dim">
      <div class="dim-top"><span class="dim-name">${name === 'rules' ? 'Rules' : 'Journeys'} tests<span class="info" tabindex="0" data-tip="${esc(`${l.files} test files · ${l.command ? `run with ${l.command}` : 'no command configured'}${l.passed === false ? ' · last run failed' : ''}`)}" aria-label="What this measures">i</span></span></div>
      <div class="dim-score"><b>${fmt(l.tests)}</b><span class="unit">${formatTiming(l)}</span></div>
      ${sparkline(ms, { domain: [0, max * 1.15], tips: ms.map((v, i) => `${v === null ? 'n/a' : formatDuration(v)} · ${ago(runs[i].scoredAt)}`) })}
    </div>`;
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(repoName)} · ${result.score}/100 · Rules and Journeys</title>
<style>
.viz-root {
  color-scheme: light;
  --page: #f9f9f7; --surface-1: #fcfcfb; --surface-2: #f3f2ee;
  --text-primary: #0b0b0b; --text-secondary: #52514e; --text-muted: #6f6d68;
  --hairline: #e1e0d9; --ring: rgba(11,11,11,0.10);
  --series-1: #2a78d6; --track: #e4eefb;
  --good: #0ca30c; --good-text: #006300; --warning: #fab219; --critical: #d03b3b; --critical-text: #b42d2d; --on-warning: #0b0b0b;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .viz-root {
    color-scheme: dark;
    --page: #0d0d0d; --surface-1: #1a1a19; --surface-2: #222220;
    --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #a3a197;
    --hairline: #2c2c2a; --ring: rgba(255,255,255,0.10);
    --series-1: #3987e5; --track: #1c2a3d;
    --good: #0ca30c; --good-text: #0ca30c; --critical-text: #e66767;
  }
}
:root[data-theme="dark"] .viz-root {
  color-scheme: dark;
  --page: #0d0d0d; --surface-1: #1a1a19; --surface-2: #222220;
  --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #a3a197;
  --hairline: #2c2c2a; --ring: rgba(255,255,255,0.10);
  --series-1: #3987e5; --track: #1c2a3d;
  --good: #0ca30c; --good-text: #0ca30c; --critical-text: #e66767;
}
${PLOT_CSS}
* { box-sizing: border-box; }
html, body { margin: 0; }
body.viz-root { background: var(--page); color: var(--text-primary); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
main { max-width: 1120px; margin: 0 auto; padding: 28px 24px 40px; }
.rjp { color: var(--text-muted); font-size: 11px; }
.rjp rect[data-tip] { cursor: default; }
.rjp rect[data-tip]:hover { fill: var(--series-1); fill-opacity: .1; }
header.top { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 14px; }
h1 { font-size: 22px; line-height: 1.2; margin: 0; font-weight: 650; letter-spacing: -.01em; }
.meta { color: var(--text-muted); font-size: 12.5px; margin-top: 3px; }
code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
button.theme { background: var(--surface-1); color: var(--text-secondary); border: 1px solid var(--ring); border-radius: 8px; padding: 6px 10px; font: inherit; font-size: 12.5px; cursor: pointer; }
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--hairline); margin-bottom: 18px; }
.tabs button { background: none; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px; padding: 8px 12px; font: inherit; font-weight: 600; color: var(--text-muted); cursor: pointer; display: inline-flex; gap: 7px; align-items: center; }
.tabs button[aria-selected="true"] { color: var(--text-primary); border-bottom-color: var(--series-1); }
.tabs button:hover { color: var(--text-primary); }
.pill { font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 99px; background: var(--surface-2); box-shadow: 0 0 0 1px var(--ring); color: var(--text-secondary); }
.pill.hot { background: var(--critical); color: #fff; box-shadow: none; }
h2 { font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--text-secondary); margin: 26px 0 10px; }
h2:first-child { margin-top: 4px; }
.card { background: var(--surface-1); border-radius: 14px; box-shadow: 0 0 0 1px var(--ring); padding: 16px 18px; }
.label { font-size: 11px; font-weight: 650; letter-spacing: .07em; text-transform: uppercase; color: var(--text-muted); margin: 0 0 10px; }
.muted { color: var(--text-muted); } .small { font-size: 12.5px; margin: 0; }
.diagnostics { margin-top:12px; }
.row { display: grid; gap: 12px; margin-bottom: 12px; }
.combined { grid-template-columns: minmax(280px, 1.8fr) minmax(150px, .7fr) minmax(220px, 1.2fr); }
.suite-line { display:flex; gap:8px 18px; flex-wrap:wrap; margin:4px 0 10px; }
.outcome { display:grid; grid-template-columns:auto 1fr; align-items:baseline; gap:8px; padding:5px 0; }
.state { font-size:12px; font-weight:650; color:var(--text-secondary); }
.state.passed { color:var(--good-text); } .state.failed { color:var(--critical-text); }
.next { border-top:1px solid var(--hairline); padding-top:8px; margin:8px 0 0; }
details summary { cursor:pointer; font-size:13px; font-weight:600; }
.evidence { color:var(--text-secondary); font-size:12px; } .evidence p { margin:4px 0; }
.evidence summary { font-size:12px; font-weight:500; }
.trend-note { font-size:12px; color:var(--text-muted); margin:0; }
@media(max-width:640px){ main { padding:16px; } .combined .run-outcomes { grid-row:1; } .combined .headline .figure b { font-size:42px; } .findings li { display:block; overflow-wrap:anywhere; } }

@media (max-width: 980px) { .combined { grid-template-columns: 1fr 1fr; } .combined .run-outcomes { grid-column: 1 / -1; } }
@media (max-width: 640px) { .combined { grid-template-columns: 1fr; } }
.cards { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
.figure { display: flex; align-items: baseline; gap: 6px; }
.figure b { font-size: 72px; line-height: .95; font-weight: 700; letter-spacing: -.035em; }
.figure span { font-size: 18px; color: var(--text-muted); }
.headline .delta { display: inline-block; margin-top: 12px; font-size: 13px; }
.dot { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; font-size: 10px; font-weight: 800; color: #fff; flex: none; cursor: default; }
.dot-good { background: var(--good); } .dot-warning { background: var(--warning); color: var(--on-warning); } .dot-critical { background: var(--critical); }
.dot-none { background: var(--hairline); color: var(--text-secondary); }
.delta { font-size: 12px; font-weight: 600; color: var(--text-muted); white-space: nowrap; } .delta.up { color: var(--good-text); } .delta.down { color: var(--critical-text); }
.dim { padding: 14px 16px 10px; display: flex; flex-direction: column; gap: 4px; }
.dim-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.dim-name { font-weight: 600; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; }
.info { display: inline-grid; place-items: center; width: 15px; height: 15px; border-radius: 50%; box-shadow: inset 0 0 0 1.25px currentColor; color: var(--text-muted); font: italic 700 10px/1 Georgia, serif; cursor: help; outline: none; }
.info:hover, .info:focus-visible { color: var(--series-1); }
.dim-score { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; } .dim-score b { font-size: 28px; font-weight: 700; letter-spacing: -.02em; }
.unit { font-size: 12px; color: var(--text-muted); }
.spark-empty { height: 40px; display: grid; place-items: center start; color: var(--text-muted); font-size: 12px; }
.areas { display: grid; gap: 0; }
.area { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 16px; align-items: center; padding: 11px 0; border-top: 1px solid var(--hairline); }
.area:first-of-type { border-top: 0; padding-top: 2px; }
.area .name { font-weight: 600; } .area .desc { grid-column: 1; font-size: 12.5px; color: var(--text-muted); }
.area .count { grid-row: 1 / span 2; grid-column: 2; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.area .count b { font-size: 13px; }
.squares { display: flex; flex-wrap: wrap; gap: 3px; justify-content: flex-end; max-width: 240px; }
.squares span { width: 14px; height: 14px; border-radius: 4px; background: var(--track); outline: none; }
.squares span.on { background: var(--good); }
.squares span:focus-visible { box-shadow: 0 0 0 2px var(--series-1); }
.findings { list-style: none; margin: 0; padding: 0; }
.findings li { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 2px 14px; font-size: 13px; padding: 10px 0; border-top: 1px solid var(--hairline); }
.findings li:first-child { border-top: 0; }
.findings .check { font-weight: 650; color: var(--text-secondary); grid-row: span 2; }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin: 0 0 14px; font-size: 13px; }
.bar a { color: var(--text-secondary); text-decoration: none; } .bar a:hover { color: var(--text-primary); }
.branches { display: inline-flex; gap: 4px; padding: 3px; border-radius: 9px; background: var(--surface-2); box-shadow: 0 0 0 1px var(--ring); }
.branches a { padding: 3px 10px; border-radius: 6px; }
.branches a[aria-current="page"] { background: var(--surface-1); color: var(--text-primary); font-weight: 600; box-shadow: 0 0 0 1px var(--ring); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--hairline); }
th { color: var(--text-muted); font-weight: 600; } td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr[aria-current="true"] td { font-weight: 650; } td a { color: var(--text-primary); }
footer { margin-top: 22px; text-align: right; font-size: 12px; } footer a { color: var(--text-muted); }
#tip { position: fixed; pointer-events: none; z-index: 10; max-width: 320px; background: var(--surface-1); color: var(--text-primary); box-shadow: 0 0 0 1px var(--ring), 0 8px 24px rgba(0,0,0,.18); border-radius: 8px; padding: 7px 10px; font-size: 12px; opacity: 0; transition: opacity .08s; }
</style>
</head>
<body class="viz-root">
<main>
  <header class="top">
    <div>
      <h1>${esc(repoName)} <span class="muted">· tests</span></h1>
      <div class="meta"><code>${esc(result.commit ?? '')}</code> ${result.dirty ? ' · local edits' : ''} ${result.runSource === 'deployment' ? ' · deployed commits' : result.runSource === 'local' ? ' · local run' : ''} · scored <span data-ago="${esc(new Date(result.scoredAt).toISOString())}">${esc(when(result.scoredAt))} UTC</span></div>
    </div>
    <button class="theme" type="button" id="theme">Theme</button>
  </header>
  ${nav.back || nav.branches?.length ? `<nav class="bar" aria-label="Branches">
    ${nav.back ? `<a href="${esc(nav.back.href)}">← ${esc(nav.back.label)}</a>` : ''}
    ${nav.branches?.length ? `<span class="branches">${nav.branches.map(b => `<a href="${esc(b.href)}"${b.current ? ' aria-current="page"' : ''}>${esc(b.name)}</a>`).join('')}</span>` : ''}
  </nav>` : ''}

  <div class="tabs" role="tablist">
    <button role="tab" id="tab-scoreboard" aria-controls="scoreboard" aria-selected="true">Scoreboard</button>
    <button role="tab" id="tab-findings" aria-controls="findings" aria-selected="false">Findings <span class="pill${findings.length || review.some(item => item.label.startsWith('Failed ')) ? ' hot' : ''}">${findingCount}</span></button>
    ${nav.runs?.length ? `<button role="tab" id="tab-runs" aria-controls="runs" aria-selected="false">Runs <span class="pill">${nav.runs.length}</span></button>` : ''}
  </div>

  <div role="tabpanel" id="scoreboard" aria-labelledby="tab-scoreboard">
    <h2>Combined</h2>
    <div class="row combined">
      <section class="card run-outcomes" aria-label="Suite results and outcomes">
        <p class="label">Latest suite results</p>
        <div class="suite-line">${['rules', 'journeys'].map(k => `<span><b>${k === 'rules' ? 'Rules' : 'Journeys'}</b> <span class="state ${statusOf(result.layers?.[k]).toLowerCase()}">${statusOf(result.layers?.[k])}</span></span>`).join('')}</div>
        ${observed.map(o => `<div class="outcome"><span class="state passed" aria-label="Passed">✓</span><span>${esc(o.title)}</span></div>`).join('')}
        ${next ? `<p class="next"><b>${next.status === 'failed' ? 'Failed outcome' : 'Next gap'}</b> · ${esc(next.title)}</p>` : !observed.length ? '<p class="trend-note">No outcome evidence recorded for this run.</p>' : ''}
      </section>
      <div class="card headline">
        <p class="label">Score</p>
        <div class="figure"><b>${result.score}</b><span>/100</span></div>
        ${deltaTag(result.score, prev?.score) || (runs.length < 2 ? '<span class="delta">baseline</span>' : '')}
        ${result.squaredLoopFail ? '<p class="small">Capped at 50: a test runs in a squared loop.</p>' : ''}
      </div>
      <div class="card">
        <p class="label">Score trend</p>
        <p class="trend-note">${runs.length} ${runs.length === 1 ? 'run' : 'runs'} · ${legacy ? 'earlier rubric' : 'comparable settings'}${split ? ` · ${split} earlier` : ''}</p>
        ${trendChart(runs)}
      </div>
    </div>
    <details class="card"><summary>Opportunities · available score points</summary>${bars(opportunities, { label: r => `+${fmt(r.value)}`, width: 440, height: 26 })}</details>
    <div class="row cards diagnostics">${card('speed')}${card('determinism')}${card('overtesting')}${card('undertesting')}</div>
    <h2>Rules</h2>
    <div class="row cards">${layer('rules')}${card('rulesPurity')}</div>
    ${folders.length ? `<div class="row"><div class="card">
      <p class="label">${legacy ? 'Historical folder scores' : 'Rules evidence by core folder'}</p>
      <p class="trend-note">${legacy ? 'Legacy import and export-name score' : 'Export names in Rules text and files in the Rules import graph'} · Mutation evidence: ${result.mutation ? esc(fmt(result.mutation.score) + '%') : 'unmeasured'}</p>
      ${bars(folders, { domain: [0, 100], width: 1000, height: 26 })}
    </div></div>` : ''}

    <h2>Journeys</h2>
    <div class="row cards">${layer('journeys')}${card('journeyCoverage')}${card('freshness')}</div>
    ${outcomes.length ? `<div class="row"><section class="card"><p class="label">User outcomes</p>${outcomes.map(o => `<div class="outcome"><span class="state ${esc(o.status)}">${esc(o.status)}</span><div>${esc(o.title)}${o.routes?.length ? `<details class="evidence"><summary>Observed routes (${o.routes.length})</summary>${o.routes.map(r => `<p><code>${esc(r)}</code></p>`).join('')}</details>` : ''}</div></div>`).join('')}</section></div>` : ''}
    ${areas.length ? `<div class="row"><div class="card">
      <p class="label">${legacy ? 'Route mentions · historical static scan' : 'Route inventory · observed during Journeys'}</p>
      <div class="areas">${areas.map(a => { const on = a.entryPoints.filter(e => e.covered).length;
        return `<div class="area"><span class="name">${esc(a.name)}</span>
          <span class="count"><b>${on}/${a.entryPoints.length}</b><span class="squares">${a.entryPoints.map(e => `<span class="${e.covered ? 'on' : ''}" tabindex="0" data-tip="${esc(`${e.id} · ${e.covered ? legacy ? 'mentioned' : 'observed' : legacy ? 'no mention' : 'no observation'}`)}" aria-label="${esc(`${e.id}: ${e.covered ? legacy ? 'mentioned' : 'observed' : legacy ? 'no mention' : 'no observation'}`)}"></span>`).join('')}</span></span>
          <span class="desc">${esc(a.description)}</span></div>`; }).join('')}</div>
    </div></div>` : ''}
  </div>

  <div role="tabpanel" id="findings" aria-labelledby="tab-findings" hidden>
    <h2>Check violations · ${findings.length}</h2>
    <div class="card">${findings.length ? `<ul class="findings">${findings.map(f => `<li><span class="check">${esc(f.check)}</span><code>${esc(f.file)}${f.line ? `:${esc(f.line)}` : ''}</code><span class="muted">${esc(f.message)}</span></li>`).join('')}</ul>` : '<p class="muted small">No check violations were recorded.</p>'}</div>
    ${review.length ? `<h2>Evidence to review · ${review.length}</h2>
    <div class="card"><ul class="findings">${review.map(item => `<li><span class="check">${esc(item.label)}</span><div>${esc(item.message)}
      ${item.paths?.length ? `<details class="evidence"><summary>File paths</summary>${item.paths.map(path => `<p><code>${esc(path)}</code></p>`).join('')}</details>` : ''}</div></li>`).join('')}</ul></div>` : ''}
  </div>

  ${nav.runs?.length ? `<div role="tabpanel" id="runs" aria-labelledby="tab-runs" hidden><div class="card">
    <table><thead><tr><th>Scored</th><th>Branch</th><th>Commit</th><th class="num">Score</th></tr></thead><tbody>
    ${nav.runs.map(r => `<tr${r.current ? ' aria-current="true"' : ''}><td><a href="${esc(r.href)}" data-ago="${esc(new Date(r.scoredAt).toISOString())}">${esc(when(r.scoredAt))}</a></td><td>${esc(r.branch)}</td><td><code>${esc(r.commit ?? '')}</code></td><td class="num">${esc(r.score)}</td></tr>`).join('')}
    </tbody></table>
  </div></div>` : ''}

  <footer><a href="https://github.com/ryw/rules-and-journeys">Rules and Journeys</a></footer>
</main>
<div id="tip" role="tooltip"></div>
<script>
(() => {
  const root = document.documentElement, key = 'rj-theme', saved = (() => { try { return localStorage.getItem(key); } catch { return null; } })();
  if (saved) root.dataset.theme = saved;
  const button = document.getElementById('theme');
  const label = () => { const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; button.textContent = dark ? 'Light' : 'Dark'; return dark; };
  label();
  button.addEventListener('click', () => { root.dataset.theme = label() ? 'light' : 'dark'; try { localStorage.setItem(key, root.dataset.theme); } catch {} label(); });
  // "3 hours ago", computed now, so the page stays right as it ages.
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const ago = iso => { const s = (Date.parse(iso) - Date.now()) / 1000, a = Math.abs(s);
    for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) if (a >= size) return rtf.format(Math.round(s / size), unit);
    return 'just now'; };
  const fill = text => text.replace(/\\{ago:([^}]+)\\}/g, (_, iso) => ago(iso));
  for (const el of document.querySelectorAll('[data-ago]')) { el.title = el.textContent; el.textContent = ago(el.dataset.ago); }
  // Chart marks carry their readout in an SVG <title>; move it to data-tip so one styled tooltip shows it.
  for (const t of document.querySelectorAll('svg.rjp title')) { t.parentNode.dataset.tip = t.textContent; t.remove(); }
  const tip = document.getElementById('tip');
  const show = (text, x, y) => { if (!text) return; tip.textContent = fill(text); tip.style.opacity = 1;
    const r = tip.getBoundingClientRect(); tip.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x + 14)) + 'px'; tip.style.top = Math.max(8, y - r.height - 12) + 'px'; };
  const hide = () => { tip.style.opacity = 0; };
  document.addEventListener('pointermove', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) show(el.dataset.tip, e.clientX, e.clientY); else hide(); });
  document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) { const r = el.getBoundingClientRect(); show(el.dataset.tip, r.left + r.width / 2, r.top); } });
  document.addEventListener('focusout', hide);
  // Tabs (and #findings / #runs links open their tab).
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const select = id => { for (const t of tabs) { const on = t.getAttribute('aria-controls') === id; t.setAttribute('aria-selected', on); document.getElementById(t.getAttribute('aria-controls')).hidden = !on; } };
  for (const t of tabs) t.addEventListener('click', () => { select(t.getAttribute('aria-controls')); history.replaceState(null, '', '#' + t.getAttribute('aria-controls')); });
  if (tabs.some(t => '#' + t.getAttribute('aria-controls') === location.hash)) select(location.hash.slice(1));
})();
</script>
</body>
</html>
`;
}
