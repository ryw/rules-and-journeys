// SCOREBOARD.html: the scoreboard as one self-contained page (no external fonts, scripts or requests), readable
// offline, in light and dark. The headline number leads, then where the points went, then each dimension, the two
// layers, folders, entry points and findings. Every value shown on hover is also printed on the page or in the table
// view. All text from the scored repo is escaped. No inline style attributes (meter widths are generated classes), so
// the page runs under a strict Content-Security-Policy that allows its one <style> and one <script> by hash.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n, digits = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const seconds = ms => ms >= 10_000 ? `${fmt(ms / 1000, 1)} s` : ms >= 1000 ? `${fmt(ms / 1000, 2)} s` : `${fmt(ms)} ms`;

/** Status of a 0–100 score: a word and an icon always travel with the color. */
function status(score) {
  if (score === null || score === undefined) return { key: 'none', label: 'Not measured', icon: '–' };
  if (score >= 85) return { key: 'good', label: 'Golden path', icon: '✓' };
  if (score >= 60) return { key: 'warning', label: 'On the way', icon: '!' };
  return { key: 'critical', label: 'Needs work', icon: '✕' };
}
const chip = s => `<span class="chip chip-${s.key}"><span class="chip-icon" aria-hidden="true">${s.icon}</span>${esc(s.label)}</span>`;

/** The trend of headline scores as a small line, with its last point marked. */
function sparkline(history) {
  if (history.length < 2) return '';
  const w = 252, h = 72, pad = 6, xs = history.map((_, i) => pad + (i * (w - 2 * pad)) / (history.length - 1));
  const ys = history.map(r => h - pad - (r.score / 100) * (h - 2 * pad));
  const d = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const last = history.length - 1;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="Headline score over the last ${history.length} runs, from ${history[0].score} to ${history[last].score}">
    <line x1="0" x2="${w}" y1="${h - pad}" y2="${h - pad}" class="spark-base"/>
    <line x1="0" x2="${w}" y1="${pad}" y2="${pad}" class="spark-base"/>
    <path d="${d}" class="spark-line"/>
    <circle cx="${xs[last].toFixed(1)}" cy="${ys[last].toFixed(1)}" r="4" class="spark-dot"/></svg>`;
}

/** One meter row: name, aligned bar, figure; the detail line sits under it. */
function meter({ name, score, aside = '', detail = '', tip = '' }) {
  const measured = score !== null && score !== undefined, s = status(score);
  return `<li class="meter" tabindex="0" data-tip="${esc(tip)}">
    <div class="meter-name">${esc(name)}${aside ? ` <span class="aside">${esc(aside)}</span>` : ''}</div>
    <div class="meter-track" aria-hidden="true">${measured ? `<div class="meter-fill w-${Math.round(Math.max(0, Math.min(100, score)))}"></div>` : ''}</div>
    <div class="meter-figure">${measured ? fmt(score) : 'n/a'}</div>
    <div class="meter-status">${chip(s)}</div>
    ${detail ? `<div class="meter-detail">${esc(detail)}</div>` : ''}
  </li>`;
}

/**
 * The scoreboard page. `nav` is optional, for a server that keeps many runs (server/index.mjs):
 * { back?: { label, href }, branches?: [{ name, href, current }], runs?: [{ href, score, commit, branch, scoredAt, current }] }.
 */
export function renderHtml(result, history = [], nav = {}) {
  const widths = new Set([...Object.values(result.dimensions).map(d => d.score), ...Object.values(result.folders ?? {}).map(f => f.score)]
    .filter(n => n !== null && n !== undefined).map(n => Math.round(Math.max(0, Math.min(100, n)))));
  const dims = Object.entries(result.dimensions);
  const measured = dims.filter(([, d]) => d.score !== null);
  const total = result.measuredWeight || 1;
  // Points each dimension gives up toward 100, scaled to the measured weight: where to work next.
  const lost = measured.map(([key, d]) => ({ key, name: d.name, detail: d.detail, points: (d.weight * (100 - d.score)) / total }))
    .filter(l => l.points >= 0.5).sort((a, b) => b.points - a.points);
  const head = status(result.score), prev = history.length >= 2 ? history[history.length - 2] : null;
  const delta = prev ? result.score - prev.score : null;
  const repoName = result.name ?? (String(result.repo ?? '').split('/').filter(s => s && s !== '.').pop() || 'repo');
  const when = new Date(result.scoredAt);
  const layers = Object.entries(result.layers ?? {});
  const folders = Object.entries(result.folders ?? {}).sort((a, b) => a[1].score - b[1].score);
  const entries = result.entryPoints ?? [], covered = entries.filter(e => e.covered).length;
  const findings = result.findings ?? [];

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
  --series-1: #2a78d6; --track: #cde2fb;
  --good: #0ca30c; --good-text: #006300; --warning: #fab219; --critical: #d03b3b; --critical-text: #b42d2d;
  --chip-on-warning: #0b0b0b;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .viz-root {
    color-scheme: dark;
    --page: #0d0d0d; --surface-1: #1a1a19; --surface-2: #222220;
    --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #a3a197;
    --hairline: #2c2c2a; --ring: rgba(255,255,255,0.10);
    --series-1: #3987e5; --track: #1f3554;
    --good: #0ca30c; --good-text: #0ca30c; --critical: #d03b3b; --critical-text: #e66767;
  }
}
:root[data-theme="dark"] .viz-root {
  color-scheme: dark;
  --page: #0d0d0d; --surface-1: #1a1a19; --surface-2: #222220;
  --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #a3a197;
  --hairline: #2c2c2a; --ring: rgba(255,255,255,0.10);
  --series-1: #3987e5; --track: #1f3554;
  --good: #0ca30c; --good-text: #0ca30c; --critical: #d03b3b; --critical-text: #e66767;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body.viz-root { background: var(--page); color: var(--text-primary); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
main { max-width: 1040px; margin: 0 auto; padding: 40px 24px 64px; }
header.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 28px; }
.eyebrow { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-muted); margin: 0 0 6px; }
h1 { font-size: 26px; line-height: 1.2; margin: 0; font-weight: 650; letter-spacing: -.01em; }
.meta { color: var(--text-secondary); font-size: 13px; margin-top: 6px; }
.meta code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
button.theme { background: var(--surface-1); color: var(--text-secondary); border: 1px solid var(--ring); border-radius: 8px; padding: 6px 10px; font: inherit; font-size: 13px; cursor: pointer; }
button.theme:hover { color: var(--text-primary); }
.card { background: var(--surface-1); border-radius: 14px; box-shadow: 0 0 0 1px var(--ring); padding: 22px 24px; }
.grid { display: grid; gap: 16px; }
.hero { display: grid; grid-template-columns: minmax(220px, 300px) 1fr; gap: 16px; margin-bottom: 16px; }
@media (max-width: 760px) { .hero { grid-template-columns: 1fr; } }
.headline { display: flex; flex-direction: column; justify-content: space-between; gap: 20px; }
.figure { display: flex; align-items: baseline; gap: 6px; }
.figure b { font-size: 76px; line-height: .95; font-weight: 700; letter-spacing: -.03em; }
.figure span { font-size: 20px; color: var(--text-muted); }
.delta { font-size: 13px; color: var(--text-secondary); }
.delta.up { color: var(--good-text); } .delta.down { color: var(--critical-text); }
.spark { display: block; width: 100%; height: auto; margin-bottom: 6px; }
.spark-base { stroke: var(--hairline); stroke-width: 1; }
.spark-scale { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
.spark-line { fill: none; stroke: var(--series-1); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.spark-dot { fill: var(--series-1); stroke: var(--surface-1); stroke-width: 2; }
h2 { font-size: 15px; margin: 0 0 4px; font-weight: 650; }
.sub { color: var(--text-secondary); font-size: 13px; margin: 0 0 16px; }
.gains { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.gains li { display: grid; grid-template-columns: 92px 1fr; gap: 12px; align-items: baseline; }
.gains .pts { font-size: 22px; font-weight: 650; text-align: right; white-space: nowrap; }
.gains .pts small { font-size: 12px; font-weight: 500; color: var(--text-muted); }
.gains .what b { font-weight: 600; } .gains .what div { color: var(--text-secondary); font-size: 13px; }
.meters { list-style: none; margin: 0; padding: 0; }
.meter { display: grid; grid-template-columns: minmax(170px, 220px) 1fr 44px 128px; column-gap: 14px; row-gap: 2px; align-items: center; padding: 12px 6px; border-top: 1px solid var(--hairline); border-radius: 6px; outline: none; }
.meter:first-child { border-top: 0; }
.meter:hover, .meter:focus-visible { background: var(--surface-2); }
.meter:focus-visible { box-shadow: 0 0 0 2px var(--series-1); }
.meter-name { font-weight: 600; } .meter-name .aside { display: block; margin: 1px 0 0; } .aside { font-weight: 400; color: var(--text-muted); font-size: 12px; margin-left: 4px; }
.meter-track { height: 8px; border-radius: 4px; background: var(--track); overflow: hidden; }
.meter-fill { height: 100%; border-radius: 4px; background: var(--series-1); }
.meter-figure { text-align: right; font-weight: 650; font-variant-numeric: tabular-nums; }
.meter-detail { grid-column: 1 / -1; color: var(--text-secondary); font-size: 13px; }
@media (max-width: 640px) { .meter { grid-template-columns: 1fr 44px; } .meter-track { grid-column: 1 / -1; grid-row: 2; } .meter-status { grid-column: 1 / -1; } }
.chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--text-secondary); white-space: nowrap; }
.chip-icon { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; font-size: 10px; font-weight: 800; color: #fff; }
.chip-good .chip-icon { background: var(--good); } .chip-warning .chip-icon { background: var(--warning); color: var(--chip-on-warning); }
.chip-critical .chip-icon { background: var(--critical); } .chip-none .chip-icon { background: var(--hairline); color: var(--text-secondary); }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
.tile h3 { margin: 0 0 2px; font-size: 13px; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
.tile .value { font-size: 34px; font-weight: 700; letter-spacing: -.02em; }
.tile .value small { font-size: 15px; font-weight: 500; color: var(--text-muted); margin-left: 4px; }
.tile dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 12px 0 0; font-size: 13px; }
.tile dt { color: var(--text-muted); } .tile dd { margin: 0; color: var(--text-primary); }
.entries { list-style: none; margin: 0; padding: 0; columns: 2 280px; column-gap: 24px; }
.entries li { break-inside: avoid; display: flex; gap: 10px; align-items: baseline; padding: 5px 0; font-size: 13px; }
.entries code { font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; }
.entries .off { color: var(--text-muted); }
.mark { flex: none; display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; font-size: 10px; font-weight: 800; }
.mark.on { background: var(--good); color: #fff; } .mark.off { box-shadow: inset 0 0 0 1.5px var(--hairline); }
.findings { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.findings li { padding: 12px 14px; border-radius: 10px; background: var(--surface-2); }
.findings .check { font-size: 12px; font-weight: 650; color: var(--text-secondary); }
.findings code { font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text-primary); }
.findings p { margin: 4px 0 0; font-size: 13px; color: var(--text-secondary); }
details { margin-top: 14px; } summary { cursor: pointer; color: var(--text-secondary); font-size: 13px; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--hairline); vertical-align: top; }
th { color: var(--text-muted); font-weight: 600; } td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.empty { color: var(--text-muted); font-size: 13px; margin: 0; }
footer { margin-top: 28px; color: var(--text-muted); font-size: 12px; }
footer a { color: inherit; }
#tip { position: fixed; pointer-events: none; z-index: 10; max-width: 300px; background: var(--surface-1); color: var(--text-primary); box-shadow: 0 0 0 1px var(--ring), 0 8px 24px rgba(0,0,0,.18); border-radius: 8px; padding: 8px 10px; font-size: 12.5px; opacity: 0; transition: opacity .08s; }
${[...widths].map(n => `.w-${n} { width: ${n}%; }`).join(' ')}
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin: -10px 0 22px; font-size: 13px; }
.bar a { color: var(--text-secondary); text-decoration: none; }
.bar a:hover { color: var(--text-primary); }
.branches { display: inline-flex; gap: 4px; padding: 3px; border-radius: 9px; background: var(--surface-2); box-shadow: 0 0 0 1px var(--ring); }
.branches a { padding: 3px 10px; border-radius: 6px; }
.branches a[aria-current="page"] { background: var(--surface-1); color: var(--text-primary); font-weight: 600; box-shadow: 0 0 0 1px var(--ring); }
.runs { margin-top: 16px; } .runs a { color: var(--text-primary); } .runs tr[aria-current="true"] td { font-weight: 650; }
.runs code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
.status-line { margin-top: 10px; } .section-heading { margin: 8px 0 12px; } b.failed { color: var(--critical-text); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (forced-colors: active) { .meter-fill, .spark-line { forced-color-adjust: none; } }
</style>
</head>
<body class="viz-root">
<main>
  <header class="top">
    <div>
      <p class="eyebrow">Rules and Journeys scoreboard</p>
      <h1>${esc(repoName)}</h1>
      <div class="meta">Commit <code>${esc(result.commit ?? 'unknown')}</code> · scored ${esc(when.toISOString().slice(0, 16).replace('T', ' '))} UTC · ${fmt(result.sourceLoc ?? 0)} lines of source · measured ${result.measuredWeight} of 100 weight</div>
    </div>
    <button class="theme" type="button" id="theme">Theme</button>
  </header>
  ${nav.back || nav.branches?.length ? `<nav class="bar" aria-label="Runs">
    ${nav.back ? `<a class="back" href="${esc(nav.back.href)}">← ${esc(nav.back.label)}</a>` : ''}
    ${nav.branches?.length ? `<span class="branches">${nav.branches.map(b => `<a href="${esc(b.href)}"${b.current ? ' aria-current="page"' : ''}>${esc(b.name)}</a>`).join('')}</span>` : ''}
  </nav>` : ''}

  <section class="hero" aria-label="Headline">
    <div class="card headline">
      <div>
        <div class="figure"><b>${result.score}</b><span>/ 100</span></div>
        <div class="status-line">${chip(head)}${result.squaredLoopFail ? ' <span class="chip chip-critical"><span class="chip-icon" aria-hidden="true">✕</span>Squared loop: capped at 50</span>' : ''}</div>
      </div>
      <div>
        ${history.length >= 2 ? '<div class="spark-scale"><span>Trend, top line = 100</span><span>' + history.length + ' runs</span></div>' : ''}
        ${sparkline(history)}
        <div class="delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${delta === null ? 'First recorded run' : delta === 0 ? `No change since the last run (${esc(prev.commit ?? '')})` : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)} since the last run (${esc(prev.commit ?? '')})`}</div>
      </div>
    </div>
    <div class="card">
      <h2>Where the points went</h2>
      <p class="sub">Points each dimension gives up toward 100, largest first: the best next moves.</p>
      ${lost.length ? `<ol class="gains">${lost.slice(0, 4).map(l => `<li><div class="pts">+${fmt(l.points)}<small> pts</small></div><div class="what"><b>${esc(l.name)}</b><div>${esc(l.detail)}</div></div></li>`).join('')}</ol>` : '<p class="empty">Nothing left on the table.</p>'}
    </div>
  </section>

  <div class="grid">
    <section class="card" aria-labelledby="dims">
      <h2 id="dims">Dimensions</h2>
      <p class="sub">Each dimension scores 0–100; its weight decides how much it moves the headline. Unmeasured dimensions are left out, not counted as 100.</p>
      <ul class="meters">${dims.map(([, d]) => meter({ name: d.name, score: d.score, aside: `weight ${d.weight}`, detail: d.score === null ? d.reason : d.detail,
        tip: d.score === null ? `${d.name}: not measured (${d.reason ?? ''})` : `${d.name}: ${fmt(d.score)} × weight ${d.weight} = ${fmt((d.score * d.weight) / 100, 1)} of ${d.weight} points` })).join('')}</ul>
      <details><summary>Show as a table</summary>
        <table><thead><tr><th>Dimension</th><th class="num">Weight</th><th class="num">Score</th><th>Detail</th></tr></thead><tbody>
        ${dims.map(([, d]) => `<tr><td>${esc(d.name)}</td><td class="num">${d.weight}</td><td class="num">${d.score === null ? 'n/a' : fmt(d.score)}</td><td>${esc(d.score === null ? d.reason : d.detail)}</td></tr>`).join('')}
        </tbody></table></details>
    </section>

    <section aria-labelledby="layers">
      <h2 id="layers" class="section-heading">Layers</h2>
      <div class="tiles">${layers.map(([name, l]) => `<div class="card tile">
        <h3>${name === 'rules' ? 'Rules' : name === 'journeys' ? 'Journeys' : esc(name)}</h3>
        <div class="value">${fmt(l.tests)}<small>${l.tests === 1 ? 'test' : 'tests'}</small></div>
        <dl>
          <dt>Files</dt><dd>${fmt(l.files)}</dd>
          <dt>Run time</dt><dd>${l.ms !== undefined ? `${seconds(l.ms)}${l.passed === false ? ' · <b class="failed">failed</b>' : ' · passed'}` : 'not run (use --run)'}</dd>
          <dt>Per line</dt><dd>${l.msPerLoc !== undefined && l.msPerLoc !== null ? `${fmt(l.msPerLoc, 3)} ms` : '–'}</dd>
          <dt>Findings</dt><dd>${fmt(l.findings)}</dd>
          ${l.command ? `<dt>Command</dt><dd><code>${esc(l.command)}</code></dd>` : ''}
        </dl></div>`).join('')}</div>
    </section>

    <section class="card" aria-labelledby="folders">
      <h2 id="folders">Folders</h2>
      <p class="sub">Weakest first.</p>
      <ul class="meters">${folders.map(([name, f]) => meter({ name, score: f.score, aside: `${fmt(f.files)} files · ${fmt(f.loc)} lines`,
        detail: `${fmt(f.tested)} of ${fmt(f.exports)} exports named in Rules tests · ${fmt(f.reached)} of ${fmt(f.files)} files reached by a test · ${fmt(f.recentUntouched)} changed recently with no test`,
        tip: `${name}: ${fmt(f.score)}` })).join('')}</ul>
    </section>

    <section class="card" aria-labelledby="entries">
      <h2 id="entries">Entry points on a Journey</h2>
      <p class="sub">${covered} of ${entries.length} covered.</p>
      ${entries.length ? `<ul class="entries">${entries.map(e => `<li class="${e.covered ? '' : 'off'}"><span class="mark ${e.covered ? 'on' : 'off'}" aria-hidden="true">${e.covered ? '✓' : ''}</span><span><code>${esc(e.id)}</code> <span class="aside">${esc(e.file)}</span><span class="visually-hidden">${e.covered ? ' (covered)' : ' (not covered)'}</span></span></li>`).join('')}</ul>` : '<p class="empty">No entry points found. List them under entryPoints in rules-and-journeys.json.</p>'}
    </section>

    <section class="card" aria-labelledby="findings">
      <h2 id="findings">Findings</h2>
      <p class="sub">${findings.length ? `${findings.length} to look at.` : 'None.'}</p>
      ${findings.length ? `<ul class="findings">${findings.map(f => `<li><div class="check">${esc(f.check)}</div><code>${esc(f.file)}${f.line ? `:${f.line}` : ''}</code><p>${esc(f.message)}</p></li>`).join('')}</ul>` : ''}
    </section>
  </div>

  ${nav.runs?.length ? `<section class="card runs" aria-labelledby="runs">
    <h2 id="runs">Recent runs</h2>
    <table><thead><tr><th>Scored</th><th>Branch</th><th>Commit</th><th class="num">Score</th></tr></thead><tbody>
    ${nav.runs.map(r => `<tr${r.current ? ' aria-current="true"' : ''}><td><a href="${esc(r.href)}">${esc(new Date(r.scoredAt).toISOString().slice(0, 16).replace('T', ' '))}</a></td><td>${esc(r.branch)}</td><td><code>${esc(r.commit ?? '')}</code></td><td class="num">${esc(r.score)}</td></tr>`).join('')}
    </tbody></table>
  </section>` : ''}

  <footer>Heuristics, not proofs: <a href="https://github.com/ryw/rules-and-journeys/blob/main/SCORING.md">SCORING.md</a> explains how each number is measured. Generated by <a href="https://github.com/ryw/rules-and-journeys">Rules and Journeys</a>.</footer>
</main>
<div id="tip" role="tooltip"></div>
<script>
(() => {
  const root = document.documentElement, key = 'rj-theme', saved = localStorage.getItem(key);
  if (saved) root.dataset.theme = saved;
  const button = document.getElementById('theme');
  const label = () => { const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; button.textContent = dark ? 'Light theme' : 'Dark theme'; return dark; };
  label();
  button.addEventListener('click', () => { root.dataset.theme = label() ? 'light' : 'dark'; localStorage.setItem(key, root.dataset.theme); label(); });
  const tip = document.getElementById('tip');
  const show = (el, x, y) => { const text = el.dataset.tip; if (!text) return; tip.textContent = text; tip.style.opacity = 1;
    const r = tip.getBoundingClientRect(); tip.style.left = Math.min(innerWidth - r.width - 8, x + 14) + 'px'; tip.style.top = Math.max(8, y - r.height - 10) + 'px'; };
  for (const el of document.querySelectorAll('[data-tip]')) {
    el.addEventListener('pointermove', e => show(el, e.clientX, e.clientY));
    el.addEventListener('pointerleave', () => { tip.style.opacity = 0; });
    el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); });
    el.addEventListener('blur', () => { tip.style.opacity = 0; });
  }
})();
</script>
</body>
</html>
`;
}
