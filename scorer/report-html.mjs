// SCOREBOARD.html: the scoreboard as one self-contained page. Charts are drawn with Observable Plot when the report is
// generated (server-side, into static SVG), so the page ships no chart library and stays small, printable and CSP-clean:
// one <style> block and one small <script> (theme toggle and tooltips), both allowed by hash. Colors are CSS variables,
// so light and dark each get their own palette. All text from the scored repo is escaped; every value a tooltip shows is
// also in the table view.
import * as Plot from '@observablehq/plot';
import { parseHTML } from 'linkedom';

const { document } = parseHTML('<!doctype html><html><body></body></html>');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n, digits = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const seconds = ms => ms >= 10_000 ? `${fmt(ms / 1000, 1)} s` : ms >= 1000 ? `${fmt(ms / 1000, 2)} s` : `${fmt(ms)} ms`;
const when = iso => new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
const SHORT = { rulesPurity: 'Purity', speed: 'Speed', overtesting: 'Overtesting', undertesting: 'Undertesting', journeyCoverage: 'Journey coverage', determinism: 'Determinism', freshness: 'Freshness' };

/** A Plot chart as static SVG; its per-chart <style> is dropped (the page carries one copy). */
const chart = options => Plot.plot({ document, className: 'rjp', ...options }).outerHTML.replace(/<style>[\s\S]*?<\/style>/, '');
const PLOT_CSS = `:where(.rjp) { display: block; height: auto; max-width: 100%; overflow: visible; } :where(.rjp text), :where(.rjp tspan) { white-space: pre; }`;

/** Status of a 0–100 score: an icon and a word always travel with the color. */
function status(score) {
  if (score === null || score === undefined) return { key: 'none', label: 'Not measured', icon: '–' };
  if (score >= 85) return { key: 'good', label: 'Golden path', icon: '✓' };
  if (score >= 60) return { key: 'warning', label: 'On the way', icon: '!' };
  return { key: 'critical', label: 'Needs work', icon: '✕' };
}
const dot = s => `<span class="dot dot-${s.key}" role="img" aria-label="${esc(s.label)}">${s.icon}</span>`;
const chip = s => `<span class="chip">${dot(s)}${esc(s.label)}</span>`;
const deltaTag = (now, before, { invert = false, unit = '' } = {}) => {
  if (before === null || before === undefined || now === null || now === undefined) return '';
  const d = Math.round((now - before) * 10) / 10;
  if (!d) return '';
  const better = invert ? d < 0 : d > 0;
  return `<span class="delta ${better ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d), Math.abs(d) < 10 && !Number.isInteger(d) ? 1 : 0)}${unit}</span>`;
};

/** The headline score over every run: area + line, 0–100, with a hover target per run. */
function trendChart(points) {
  if (points.length < 2) return '<p class="muted small">The trend starts with the next run.</p>';
  const data = points.map((p, i) => ({ i, score: p.score, tip: `${p.score}/100 · ${p.commit ?? ''} · ${when(p.scoredAt)}` }));
  return chart({ width: 380, height: 132, marginLeft: 28, marginRight: 14, marginTop: 10, marginBottom: 18,
    x: { axis: null, domain: [0, Math.max(1, data.length - 1)] }, y: { domain: [0, 100], ticks: [0, 50, 100], tickSize: 0, label: null },
    marks: [
      Plot.gridY([0, 50, 100], { stroke: 'var(--hairline)', strokeOpacity: 1 }),
      Plot.areaY(data, { x: 'i', y: 'score', fill: 'var(--series-1)', fillOpacity: 0.1 }),
      Plot.lineY(data, { x: 'i', y: 'score', stroke: 'var(--series-1)', strokeWidth: 2 }),
      Plot.dot(data, { x: 'i', y: 'score', r: 10, fill: 'transparent', title: 'tip' }),
      Plot.dot(data.slice(-1), { x: 'i', y: 'score', r: 4.5, fill: 'var(--series-1)', stroke: 'var(--surface-1)', strokeWidth: 2 }),
    ] });
}

/** A small-multiple sparkline: values on a fixed domain (0–100 for scores), the latest point marked. */
function sparkline(values, { domain = [0, 100], tips = [], height = 40 } = {}) {
  const data = values.map((v, i) => ({ i, v, tip: tips[i] ?? '' }));
  const defined = data.filter(d => d.v !== null && d.v !== undefined);
  if (defined.length < 2) return `<div class="spark-empty">${defined.length ? 'first run' : 'not measured'}</div>`;
  return chart({ width: 230, height, margin: 4, marginTop: 6, x: { axis: null, domain: [0, Math.max(1, data.length - 1)] }, y: { axis: null, domain },
    marks: [
      Plot.ruleY([domain[0]], { stroke: 'var(--hairline)' }),
      Plot.areaY(defined, { x: 'i', y: 'v', y1: domain[0], fill: 'var(--series-1)', fillOpacity: 0.08 }),
      Plot.lineY(defined, { x: 'i', y: 'v', stroke: 'var(--series-1)', strokeWidth: 1.75 }),
      Plot.dot(defined, { x: 'i', y: 'v', r: 7, fill: 'transparent', title: 'tip' }),
      Plot.dot(defined.slice(-1), { x: 'i', y: 'v', r: 3, fill: 'var(--series-1)' }),
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
  const runs = history.length ? history : [{ scoredAt: result.scoredAt, commit: result.commit, score: result.score, dimensions: Object.fromEntries(Object.entries(result.dimensions).map(([k, d]) => [k, d.score])) }];
  const prev = runs.length >= 2 ? runs[runs.length - 2] : null;
  const dims = Object.entries(result.dimensions);
  const total = result.measuredWeight || 1;
  const lost = dims.filter(([, d]) => d.score !== null).map(([key, d]) => ({ key, name: SHORT[key] ?? d.name, value: (d.weight * (100 - d.score)) / total, tip: `${d.name}: ${d.detail}` }))
    .filter(l => l.value >= 0.5).sort((a, b) => b.value - a.value);
  const head = status(result.score);
  const repoName = result.name ?? (String(result.repo ?? '').split('/').filter(s => s && s !== '.').pop() || 'repo');
  const layers = Object.entries(result.layers ?? {});
  const folders = Object.entries(result.folders ?? {}).map(([name, f]) => ({ name, value: f.score, tip: `${name}: ${f.score} · ${f.tested}/${f.exports} exports tested · ${f.reached}/${f.files} files reached` }))
    .sort((a, b) => a.value - b.value);
  const entries = result.entryPoints ?? [], covered = entries.filter(e => e.covered).length;
  const findings = result.findings ?? [];
  const runTips = runs.map(r => `${when(r.scoredAt)} · ${r.commit ?? ''}`);

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
main { max-width: 1120px; margin: 0 auto; padding: 32px 24px 56px; }
.rjp { color: var(--text-muted); font-size: 11px; }
header.top { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 20px; }
h1 { font-size: 22px; line-height: 1.2; margin: 0; font-weight: 650; letter-spacing: -.01em; }
.meta { color: var(--text-muted); font-size: 12.5px; margin-top: 3px; }
code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
button.theme { background: var(--surface-1); color: var(--text-secondary); border: 1px solid var(--ring); border-radius: 8px; padding: 6px 10px; font: inherit; font-size: 12.5px; cursor: pointer; }
.card { background: var(--surface-1); border-radius: 14px; box-shadow: 0 0 0 1px var(--ring); padding: 18px 20px; }
.label { font-size: 11px; font-weight: 650; letter-spacing: .07em; text-transform: uppercase; color: var(--text-muted); margin: 0 0 10px; }
.muted { color: var(--text-muted); } .gap { margin-top: 18px; } .small { font-size: 12.5px; margin: 0; }
.row { display: grid; gap: 14px; margin-bottom: 14px; }
.hero { grid-template-columns: 250px 1fr 1fr; }
@media (max-width: 980px) { .hero { grid-template-columns: 1fr 1fr; } .hero .headline { grid-column: 1 / -1; } }
@media (max-width: 640px) { .hero { grid-template-columns: 1fr; } }
.figure { display: flex; align-items: baseline; gap: 6px; }
.figure b { font-size: 72px; line-height: .95; font-weight: 700; letter-spacing: -.035em; }
.figure span { font-size: 18px; color: var(--text-muted); }
.headline .chips { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 12px; }
.chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--text-secondary); }
.dot { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; font-size: 10px; font-weight: 800; color: #fff; flex: none; }
.dot-good { background: var(--good); } .dot-warning { background: var(--warning); color: var(--on-warning); } .dot-critical { background: var(--critical); }
.dot-none { background: var(--hairline); color: var(--text-secondary); }
.delta { font-size: 12px; font-weight: 600; color: var(--text-muted); white-space: nowrap; } .delta.up { color: var(--good-text); } .delta.down { color: var(--critical-text); }
.dims { grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
.dim { padding: 14px 16px 10px; display: flex; flex-direction: column; gap: 4px; outline: none; }
.dim:focus-visible { box-shadow: 0 0 0 2px var(--series-1); }
.dim-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.dim-name { font-weight: 600; font-size: 13px; } .weight { font-size: 11px; color: var(--text-muted); font-weight: 500; }
.dim-score { display: flex; align-items: baseline; gap: 8px; } .dim-score b { font-size: 28px; font-weight: 700; letter-spacing: -.02em; }
.spark-empty { height: 40px; display: grid; place-items: center start; color: var(--text-muted); font-size: 12px; }
.two { grid-template-columns: 1fr 1fr; } @media (max-width: 820px) { .two { grid-template-columns: 1fr; } }
.layer { display: grid; grid-template-columns: auto 1fr; gap: 6px 18px; align-items: center; }
.layer + .layer { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--hairline); }
.layer .big { font-size: 26px; font-weight: 700; letter-spacing: -.02em; } .layer .big small { font-size: 12px; color: var(--text-muted); font-weight: 500; margin-left: 3px; }
.layer .name { font-weight: 600; } .layer .sub { font-size: 12px; color: var(--text-muted); }
.waffle { display: grid; grid-template-columns: repeat(auto-fill, 22px); gap: 4px; margin-top: 4px; }
.waffle span { width: 22px; height: 22px; border-radius: 5px; background: var(--track); outline: none; }
.waffle span.on { background: var(--good); }
.waffle span:focus-visible { box-shadow: 0 0 0 2px var(--series-1); }
.waffle-key { display: flex; gap: 14px; font-size: 12px; color: var(--text-muted); margin-top: 10px; } .waffle-key i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; background: var(--track); } .waffle-key i.on { background: var(--good); }
.findings { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.findings li { display: flex; gap: 10px; align-items: baseline; font-size: 12.5px; padding: 6px 0; border-top: 1px solid var(--hairline); }
.findings li:first-child { border-top: 0; }
.findings .check { flex: none; font-weight: 650; color: var(--text-secondary); }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin: -6px 0 16px; font-size: 13px; }
.bar a { color: var(--text-secondary); text-decoration: none; } .bar a:hover { color: var(--text-primary); }
.branches { display: inline-flex; gap: 4px; padding: 3px; border-radius: 9px; background: var(--surface-2); box-shadow: 0 0 0 1px var(--ring); }
.branches a { padding: 3px 10px; border-radius: 6px; }
.branches a[aria-current="page"] { background: var(--surface-1); color: var(--text-primary); font-weight: 600; box-shadow: 0 0 0 1px var(--ring); }
details summary { cursor: pointer; color: var(--text-secondary); font-size: 12.5px; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12.5px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--hairline); vertical-align: top; }
th { color: var(--text-muted); font-weight: 600; } td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr[aria-current="true"] td { font-weight: 650; } td a { color: var(--text-primary); }
footer { margin-top: 22px; color: var(--text-muted); font-size: 12px; } footer a { color: inherit; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
#tip { position: fixed; pointer-events: none; z-index: 10; max-width: 320px; background: var(--surface-1); color: var(--text-primary); box-shadow: 0 0 0 1px var(--ring), 0 8px 24px rgba(0,0,0,.18); border-radius: 8px; padding: 7px 10px; font-size: 12px; opacity: 0; transition: opacity .08s; }
</style>
</head>
<body class="viz-root">
<main>
  <header class="top">
    <div>
      <h1>${esc(repoName)} <span class="muted">· tests</span></h1>
      <div class="meta"><code>${esc(result.commit ?? '')}</code> · ${esc(when(result.scoredAt))} UTC · ${fmt(result.sourceLoc ?? 0)} lines</div>
    </div>
    <button class="theme" type="button" id="theme">Theme</button>
  </header>
  ${nav.back || nav.branches?.length ? `<nav class="bar" aria-label="Branches">
    ${nav.back ? `<a href="${esc(nav.back.href)}">← ${esc(nav.back.label)}</a>` : ''}
    ${nav.branches?.length ? `<span class="branches">${nav.branches.map(b => `<a href="${esc(b.href)}"${b.current ? ' aria-current="page"' : ''}>${esc(b.name)}</a>`).join('')}</span>` : ''}
  </nav>` : ''}

  <section class="row hero">
    <div class="card headline">
      <p class="label">Score</p>
      <div class="figure"><b>${result.score}</b><span>/100</span></div>
      <div class="chips">${chip(head)}${deltaTag(result.score, prev?.score)}${result.squaredLoopFail ? `<span class="chip">${dot(status(0))}Squared loop · capped at 50</span>` : ''}</div>
    </div>
    <div class="card">
      <p class="label">Trend · ${runs.length} ${runs.length === 1 ? 'run' : 'runs'}</p>
      ${trendChart(runs)}
    </div>
    <div class="card">
      <p class="label">Points to gain</p>
      ${bars(lost, { label: r => `+${fmt(r.value)}`, width: 340, height: 24 })}
    </div>
  </section>

  <section class="row dims" aria-label="Dimensions">
    ${dims.map(([key, d]) => { const s = status(d.score), series = runs.map((r, i) => i === runs.length - 1 ? d.score : r.dimensions?.[key] ?? null);
      return `<div class="card dim" tabindex="0" data-tip="${esc(d.score === null ? `${d.name}: ${d.reason ?? 'not measured'}` : `${d.name} (weight ${d.weight}): ${d.detail}`)}">
        <div class="dim-top"><span class="dim-name">${esc(SHORT[key] ?? d.name)} <span class="weight">×${d.weight}</span></span>${dot(s)}</div>
        <div class="dim-score"><b>${d.score === null ? '–' : fmt(d.score)}</b>${deltaTag(d.score, prev?.dimensions?.[key])}</div>
        ${sparkline(series, { tips: runs.map((r, i) => `${series[i] ?? 'n/a'} · ${runTips[i]}`) })}
      </div>`; }).join('')}
  </section>

  <section class="row two">
    <div class="card">
      <p class="label">Layers</p>
      ${layers.map(([name, l]) => { const ms = runs.map((r, i) => i === runs.length - 1 ? l.ms ?? null : r.layers?.[name]?.ms ?? null), max = Math.max(...ms.filter(v => v !== null), l.ms ?? 0, 1);
        return `<div class="layer">
          <div><div class="name">${name === 'rules' ? 'Rules' : name === 'journeys' ? 'Journeys' : esc(name)}</div><div class="big">${fmt(l.tests)}<small>tests</small></div></div>
          <div><div class="sub">${l.ms !== undefined ? `${seconds(l.ms)} · ${fmt(l.msPerLoc ?? 0, 3)} ms/line${l.passed === false ? ' · failed' : ''}` : 'not timed'} ${deltaTag(l.ms, prev?.layers?.[name]?.ms, { invert: true, unit: ' ms' })}</div>
          ${sparkline(ms, { domain: [0, max * 1.15], height: 34, tips: runs.map((r, i) => `${ms[i] === null ? 'n/a' : seconds(ms[i])} · ${runTips[i]}`) })}</div>
        </div>`; }).join('')}
    </div>
    <div class="card">
      <p class="label">Folders</p>
      ${bars(folders, { domain: [0, 100] })}
      <p class="label gap">Entry points on a Journey · ${covered}/${entries.length}</p>
      <div class="waffle">${entries.map(e => `<span class="${e.covered ? 'on' : ''}" tabindex="0" data-tip="${esc(`${e.id}${e.file ? ` · ${e.file}` : ''}${e.covered ? ' · on a Journey' : ' · no Journey'}`)}" aria-label="${esc(`${e.id}: ${e.covered ? 'covered' : 'not covered'}`)}"></span>`).join('')}</div>
      <div class="waffle-key"><span><i class="on"></i>on a Journey</span><span><i></i>not yet</span></div>
    </div>
  </section>

  ${findings.length ? `<section class="row"><div class="card">
    <p class="label">Findings · ${findings.length}</p>
    <ul class="findings">${findings.slice(0, 20).map(f => `<li><span class="check">${esc(f.check)}</span><code>${esc(f.file)}${f.line ? `:${f.line}` : ''}</code><span class="muted">${esc(f.message)}</span></li>`).join('')}</ul>
  </div></section>` : ''}

  <section class="row"><div class="card">
    <details><summary>Show the numbers as tables</summary>
      <table><thead><tr><th>Dimension</th><th class="num">Weight</th><th class="num">Score</th><th>Detail</th></tr></thead><tbody>
      ${dims.map(([, d]) => `<tr><td>${esc(d.name)}</td><td class="num">${d.weight}</td><td class="num">${d.score === null ? 'n/a' : fmt(d.score)}</td><td>${esc(d.score === null ? d.reason : d.detail)}</td></tr>`).join('')}
      </tbody></table>
      <table><thead><tr><th>Run</th><th>Commit</th><th class="num">Score</th></tr></thead><tbody>
      ${runs.slice().reverse().slice(0, 30).map(r => `<tr><td>${esc(when(r.scoredAt))}</td><td><code>${esc(r.commit ?? '')}</code></td><td class="num">${r.score}</td></tr>`).join('')}
      </tbody></table>
      <table><thead><tr><th>Entry point</th><th>File</th><th>On a Journey</th></tr></thead><tbody>
      ${entries.map(e => `<tr><td><code>${esc(e.id)}</code></td><td>${esc(e.file)}</td><td>${e.covered ? 'yes' : 'no'}</td></tr>`).join('')}
      </tbody></table>
    </details>
  </div></section>

  ${nav.runs?.length ? `<section class="row"><div class="card">
    <p class="label">Recent runs</p>
    <table><thead><tr><th>Scored</th><th>Branch</th><th>Commit</th><th class="num">Score</th></tr></thead><tbody>
    ${nav.runs.map(r => `<tr${r.current ? ' aria-current="true"' : ''}><td><a href="${esc(r.href)}">${esc(when(r.scoredAt))}</a></td><td>${esc(r.branch)}</td><td><code>${esc(r.commit ?? '')}</code></td><td class="num">${esc(r.score)}</td></tr>`).join('')}
    </tbody></table>
  </div></section>` : ''}

  <footer><a href="https://github.com/ryw/rules-and-journeys/blob/main/SCORING.md">How it's scored</a> · charts by <a href="https://observablehq.com/plot/">Observable Plot</a> · <a href="https://github.com/ryw/rules-and-journeys">Rules and Journeys</a></footer>
</main>
<div id="tip" role="tooltip"></div>
<script>
(() => {
  const root = document.documentElement, key = 'rj-theme', saved = localStorage.getItem(key);
  if (saved) root.dataset.theme = saved;
  const button = document.getElementById('theme');
  const label = () => { const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; button.textContent = dark ? 'Light' : 'Dark'; return dark; };
  label();
  button.addEventListener('click', () => { root.dataset.theme = label() ? 'light' : 'dark'; localStorage.setItem(key, root.dataset.theme); label(); });
  // Chart marks carry their readout in an SVG <title>; move it to data-tip so one styled tooltip shows it.
  for (const t of document.querySelectorAll('svg.rjp title')) { const el = t.parentNode; el.dataset.tip = t.textContent; t.remove(); }
  const tip = document.getElementById('tip');
  const show = (text, x, y) => { if (!text) return; tip.textContent = text; tip.style.opacity = 1;
    const r = tip.getBoundingClientRect(); tip.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x + 14)) + 'px'; tip.style.top = Math.max(8, y - r.height - 12) + 'px'; };
  const hide = () => { tip.style.opacity = 0; };
  document.addEventListener('pointermove', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) show(el.dataset.tip, e.clientX, e.clientY); else hide(); });
  document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) { const r = el.getBoundingClientRect(); show(el.dataset.tip, r.left + r.width / 2, r.top); } });
  document.addEventListener('focusout', hide);
})();
</script>
</body>
</html>
`;
}
