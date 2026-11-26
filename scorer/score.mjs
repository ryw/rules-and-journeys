#!/usr/bin/env node
// Rules and Journeys scorer: scores a repository's tests 0–100 against the principles in README.md (rubric: SCORING.md).
// Zero dependencies, Node 22+. TypeScript and JavaScript first; everything here is a static heuristic unless --run is given.
//
//   node scorer/score.mjs <repo> [--run] [--json] [--out <dir>] [--since <days>]
//
// --run   also runs each layer's command (rules-and-journeys.json "commands") and scores speed in ms per line of source.
// --json  prints the result as JSON instead of writing SCOREBOARD.md and score.json.
// --out   where SCOREBOARD.md and score.json go (default: the repo root).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, globSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

// ---------- arguments and configuration ----------
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const repo = resolve(args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out' && args[args.indexOf(a) - 1] !== '--since') ?? '.');
if (!existsSync(repo)) { console.error(`No such directory: ${repo}`); process.exit(2); }

const CODE = '{ts,tsx,js,jsx,mjs,cjs}';
const DEFAULTS = {
  rules: [`**/*.{test,spec}.${CODE}`],
  journeys: [`**/*.journey.${CODE}`, `**/{journeys,e2e,integration,features,acceptance}/**/*.${CODE}`, '**/*.feature', '**/*.journey.md'],
  source: [`src/**/*.${CODE}`, `lib/**/*.${CODE}`, `app/**/*.${CODE}`],
  // Source the Rules layer is expected to cover by name (the pure core). Defaults to all source.
  core: null,
  exclude: ['**/*.d.ts', '**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**', '**/fixtures/**'],
  forbiddenPackages: ['pg', 'postgres', 'mysql', 'mysql2', 'mongodb', 'mongoose', 'redis', 'ioredis', 'kysely', 'knex', '@prisma/client', 'sequelize', 'typeorm',
    'better-sqlite3', 'sqlite3', 'axios', 'node-fetch', 'got', 'undici', 'superagent', 'http', 'https', 'net', 'node:http', 'node:https', 'node:net', '@aws-sdk/*'],
  forbiddenModules: ['(^|/)(database|db|config|env)\\.(t|j)sx?$'],
  entryPoints: [],
  commands: {},
  recentDays: 30,
};
const configPath = join(repo, 'rules-and-journeys.json');
const config = { ...DEFAULTS, ...(existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {}) };
const recentDays = Number(option('--since', config.recentDays));

// ---------- files ----------
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'vendor', 'reports', 'public', '.turbo', '.cache']);
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(join(dir, entry.name), out); }
    else if (entry.isFile()) out.push(relative(repo, join(dir, entry.name)).split('\\').join('/'));
  }
  return out;
}
function globToRegExp(glob) {
  let re = '', i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 3; } else { re += '.*'; i += 2; } continue; }
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') { const end = glob.indexOf('}', i); re += `(?:${glob.slice(i + 1, end).split(',').map(s => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`; i = end; }
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
    i++;
  }
  return new RegExp(`^${re}$`);
}
const matcher = globs => { const res = (globs ?? []).map(globToRegExp); return file => res.some(r => r.test(file)); };
const all = walk(repo);
const excluded = matcher(config.exclude);
const isJourney = matcher(config.journeys), isRule = matcher(config.rules), isSource = matcher(config.source);
const journeyFiles = all.filter(f => !excluded(f) && isJourney(f));
const rulesFiles = all.filter(f => !excluded(f) && isRule(f) && !journeyFiles.includes(f));
const testFiles = [...rulesFiles, ...journeyFiles];
const sourceFiles = all.filter(f => !excluded(f) && isSource(f) && !testFiles.includes(f) && /\.(t|j)sx?$|\.m?js$|\.cjs$/.test(f));
const coreFiles = config.core ? sourceFiles.filter(matcher(config.core)) : sourceFiles;
const read = file => { try { return readFileSync(join(repo, file), 'utf8'); } catch { return ''; } };
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// Blank out comments and string contents (keeping offsets) so structure can be scanned safely.
function scrub(code) {
  let out = '', i = 0;
  while (i < code.length) {
    const c = code[i], n = code[i + 1];
    if (c === '/' && n === '/') { const end = code.indexOf('\n', i); const stop = end < 0 ? code.length : end; out += ' '.repeat(stop - i); i = stop; continue; }
    if (c === '/' && n === '*') { const end = code.indexOf('*/', i + 2); const stop = end < 0 ? code.length : end + 2; out += code.slice(i, stop).replace(/[^\n]/g, ' '); i = stop; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < code.length && code[j] !== c) { if (code[j] === '\\') j++; if (c !== '`' && code[j] === '\n') break; j++; }
      out += c + code.slice(i + 1, j).replace(/[^\n]/g, ' ') + (code[j] ?? ''); i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}
const OPEN = { '(': ')', '{': '}', '[': ']' };
function matchClose(s, open) {
  const want = OPEN[s[open]]; let depth = 0;
  for (let i = open; i < s.length; i++) { if (s[i] === s[open]) depth++; else if (s[i] === want && --depth === 0) return i; }
  return s.length - 1;
}
const skipWs = (s, i) => { while (i < s.length && /\s/.test(s[i])) i++; return i; };

// ---------- imports ----------
const importRe = /^[ \t]*(?:import|export)[ \t]+(type[ \t]+)?(\{[^}]*\}|\*(?:[ \t]+as[ \t]+\w+)?|\w+(?:[ \t]*,[ \t]*(?:\{[^}]*\}|\*[ \t]+as[ \t]+\w+))?)[ \t]*from[ \t]*['"]([^'"]+)['"]/gm;
const bareImportRe = /^[ \t]*import[ \t]*['"]([^'"]+)['"]/gm;
const requireRe = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
const dynamicRe = /\bimport\(\s*['"]([^'"]+)['"]\s*\)(?:\s*\.\s*(\w+))?/g;
function importsOf(code) {
  const out = [];
  for (const m of code.matchAll(importRe)) {
    const names = m[2];
    if (m[1] || (names.startsWith('{') && names.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean).every(s => s.startsWith('type ')))) continue;
    out.push({ spec: m[3], names: names.startsWith('{') ? names.slice(1, -1).split(',').map(s => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]).filter(Boolean) : [] });
  }
  for (const m of code.matchAll(bareImportRe)) out.push({ spec: m[1], names: [] });
  for (const m of code.matchAll(requireRe)) out.push({ spec: m[1], names: [] });
  for (const m of code.matchAll(dynamicRe)) if (!m[2] || ['then', 'catch', 'finally'].includes(m[2])) out.push({ spec: m[1], names: [] });
  return out;
}
const fileSet = new Set(all);
function resolveImport(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = join(dirname(from), spec).split('\\').join('/');
  const stem = base.replace(/\.(m?js|cjs|jsx)$/, '');
  for (const candidate of [base, `${stem}.ts`, `${stem}.tsx`, `${stem}.js`, `${stem}.mjs`, `${stem}.jsx`, `${base}/index.ts`, `${base}/index.js`]) if (fileSet.has(candidate)) return candidate;
  return null;
}
const importCache = new Map();
const importsOfFile = file => { if (!importCache.has(file)) importCache.set(file, importsOf(read(file))); return importCache.get(file); };
function reachable(starts) {
  const seen = new Set(), queue = [...starts];
  while (queue.length) {
    const f = queue.pop(); if (seen.has(f)) continue; seen.add(f);
    for (const { spec } of importsOfFile(f)) { const r = resolveImport(f, spec); if (r && !seen.has(r)) queue.push(r); }
  }
  return seen;
}
const isSourceFile = new Set(sourceFiles);
// Test code: the test files plus support files they import that aren't source (builders, helpers, step definitions).
const supportOf = files => [...reachable(files)].filter(f => !isSourceFile.has(f));
const rulesCorpus = supportOf(rulesFiles), journeyCorpus = supportOf(journeyFiles), testCorpus = [...new Set([...rulesCorpus, ...journeyCorpus])];
const reachedByTests = new Set([...reachable(testFiles)].filter(f => isSourceFile.has(f)));

// ---------- findings ----------
const findings = [];
const find = (check, file, line, message, layer) => findings.push({ check, file, line, message, layer });
const layerOf = file => (journeyFiles.includes(file) ? 'journeys' : 'rules');
const TEST_CALL = /\b(?:it|test|specify|scenario|Scenario)(?:\.(?:only|skip|concurrent|todo|fails))?\s*\(/g;
const countTests = code => [...code.matchAll(TEST_CALL)].length + [...code.matchAll(/\b(?:it|test)\.each\b/g)].length;

/** Squared loops: a test generator nested in two or more loops (for/forEach/map/.each), or a cartesian .each table. */
function squaredLoops(file) {
  const raw = read(file), s = scrub(raw), loops = [], generators = [];
  for (const m of s.matchAll(/\bfor\s*\(/g)) {
    const parenOpen = s.indexOf('(', m.index), parenClose = matchClose(s, parenOpen), body = skipWs(s, parenClose + 1);
    loops.push([m.index, s[body] === '{' ? matchClose(s, body) : s.indexOf('\n', body)]);
  }
  for (const m of s.matchAll(/\.(?:forEach|map|flatMap)\s*\(/g)) { const open = s.indexOf('(', m.index); loops.push([m.index, matchClose(s, open)]); }
  for (const m of s.matchAll(/\b(describe|it|test|context|suite)\.each\s*(\(|`)/g)) {
    let i = m.index + m[0].length - 1, cartesian = false;
    if (s[i] === '(') { const close = matchClose(s, i); const table = s.slice(i, close); cartesian = /flatMap\s*\(/.test(table) && /\.map\s*\(/.test(table); i = close + 1; }
    else { i = s.indexOf('`', i + 1) + 1; }
    i = skipWs(s, i);
    const end = s[i] === '(' ? matchClose(s, i) : i;
    loops.push([m.index, end]);
    if (m[1] !== 'describe' && m[1] !== 'context' && m[1] !== 'suite') generators.push({ at: m.index, each: true, cartesian });
  }
  for (const m of s.matchAll(/(?<![.\w])(?:it|test|specify)(?:\.(?:only|skip|concurrent))?\s*\(/g)) generators.push({ at: m.index, each: false });
  const hits = [];
  for (const g of generators) {
    const depth = loops.filter(([a, b]) => a < g.at && g.at < b).length + (g.each ? 1 : 0) + (g.cartesian ? 1 : 0);
    if (depth >= 2) hits.push(g);
  }
  return hits.map(g => ({ line: lineOf(raw, g.at), cartesian: !!g.cartesian }));
}
const ownModule = spec => /^(\.{1,2}\/|@\/|~\/|src\/)/.test(spec);
for (const file of testFiles) {
  if (/\.(feature|md)$/.test(file)) continue;
  const raw = read(file), s = scrub(raw), layer = layerOf(file);
  const reported = new Set();
  for (const hit of squaredLoops(file)) if (!reported.has(hit.line)) { reported.add(hit.line); find('squared-loop', file, hit.line, hit.cartesian ? 'Cartesian .each table: X × Y generated tests.' : 'Test generator nested in two loops: X × Y generated tests.', layer); }
  for (const m of raw.matchAll(/\b(?:vi|jest)\.mock\(\s*['"]([^'"]+)['"]/g)) if (ownModule(m[1])) find('own-module-mock', file, lineOf(raw, m.index), `Mocks your own module ${m[1]}: the test restates the implementation.`, layer);
  for (const m of s.matchAll(/\.(?:toHaveBeenCalled\w*|toBeCalled\w*|toHaveBeenNthCalledWith|toHaveBeenLastCalledWith|calledWith|calledOnce|calledTwice)\b/g)) find('call-assertion', file, lineOf(raw, m.index), 'Asserts on calls made, not on the outcome.', layer);
  for (const m of s.matchAll(/\.toMatchSnapshot\s*\(/g)) find('snapshot', file, lineOf(raw, m.index), 'External snapshot: reviewers can’t read the expectation in the test.', layer);
  const tests = countTests(s), sourceNames = importsOfFile(file).filter(i => resolveImport(file, i.spec) && isSourceFile.has(resolveImport(file, i.spec))).flatMap(i => i.names);
  if (layer === 'rules' && tests > 20 && sourceNames.length > 0 && sourceNames.length <= 2) find('test-pile', file, 1, `${tests} tests on ${sourceNames.join(', ')}: prove the rule with representative cases.`, layer);
  if (layer === 'journeys') {
    const rulesImports = new Set(rulesFiles.flatMap(r => importsOfFile(r).map(i => resolveImport(r, i.spec)).filter(Boolean)));
    for (const i of importsOfFile(file)) { const target = resolveImport(file, i.spec); if (target && isSourceFile.has(target) && rulesImports.has(target) && !/(^|\/)(index|app|server|main|routes?|mcp|api)\.(t|j)sx?$/.test(target)) find('journey-reaches-rules', file, 1, `Imports rule module ${target} directly: Journeys should enter through the app's entry points.`, layer); }
  }
  // Determinism
  const fake = /useFakeTimers|setSystemTime|freezeTime|seed/i.test(raw);
  for (const m of s.matchAll(/\bMath\.random\s*\(/g)) find('nondeterminism', file, lineOf(raw, m.index), 'Unseeded Math.random in a test.', layer);
  if (!fake) for (const m of s.matchAll(/\bDate\.now\s*\(|\bnew Date\s*\(\s*\)/g)) find('nondeterminism', file, lineOf(raw, m.index), 'Reads the real clock without fake timers.', layer);
  for (const m of s.matchAll(/\b(?:setTimeout|sleep|delay)\s*\(|\bretry\s*:|\.retry\s*\(/g)) find('nondeterminism', file, lineOf(raw, m.index), 'Sleep or retry in a test: hides timing bugs.', layer);
}

// Rules purity: a Rules test must not reach the database, network, configuration or environment, even indirectly.
const forbiddenPackage = spec => config.forbiddenPackages.some(p => p.endsWith('/*') ? spec.startsWith(p.slice(0, -1)) : spec === p || spec.startsWith(`${p}/`));
const forbiddenModule = file => config.forbiddenModules.some(p => new RegExp(p).test(file));
const chains = new Map();
function impureChain(file, visiting = new Set()) {
  if (chains.has(file)) return chains.get(file);
  if (visiting.has(file)) return null; visiting.add(file);
  let found = null;
  for (const { spec } of importsOfFile(file)) {
    if (!spec.startsWith('.') && forbiddenPackage(spec)) { found = [spec]; break; }
    const target = resolveImport(file, spec);
    if (target && forbiddenModule(target)) { found = [target]; break; }
  }
  if (!found) for (const { spec } of importsOfFile(file)) { const target = resolveImport(file, spec); if (!target) continue; const rest = impureChain(target, visiting); if (rest) { found = [target, ...rest]; break; } }
  visiting.delete(file); chains.set(file, found); return found;
}
const impureRules = [];
for (const file of rulesFiles) {
  const raw = read(file), s = scrub(raw), chain = impureChain(file);
  const direct = [...s.matchAll(/\bprocess\.env\b|\bfetch\s*\(/g)];
  if (chain) { impureRules.push(file); find('impure-rule', file, 1, `Reaches ${chain.at(-1)}: ${[file, ...chain].join(' → ')}`, 'rules'); }
  else if (direct.length) { impureRules.push(file); find('impure-rule', file, lineOf(raw, direct[0].index), 'Reads the environment or the network directly.', 'rules'); }
}

// ---------- undertesting ----------
const exportRe = /^[ \t]*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|class)\s+(\w+)/gm;
const exportsOf = file => [...read(file).matchAll(exportRe)].map(m => ({ name: m[1], line: lineOf(read(file), m.index) }));
const rulesText = rulesCorpus.map(read).join('\n'), testText = testCorpus.map(read).join('\n');
const mentioned = (name, text) => new RegExp(`\\b${name}\\b`).test(text);
const coreExports = coreFiles.flatMap(f => exportsOf(f).map(e => ({ ...e, file: f })));
const coreTested = coreExports.filter(e => mentioned(e.name, rulesText));
let recent = null;
try {
  const log = execFileSync('git', ['-C', repo, 'log', `--since=${recentDays}.days`, '--name-only', '--pretty=format:'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  recent = [...new Set(log.split('\n').map(s => s.trim()).filter(f => isSourceFile.has(f)))];
} catch { recent = null; }
const recentUntouched = recent ? recent.filter(f => !reachedByTests.has(f)) : [];
const journeyCode = journeyFiles.filter(f => !/\.(feature|md)$/.test(f));
const journeysWithOutcome = journeyCode.filter(f => /\bexpect\s*\(|\bassert\w*\s*\(|\.should\b|\bThen\b/.test(read(f)));
let mutation = null;
const mutationPath = join(repo, 'reports/mutation/mutation.json');
if (existsSync(mutationPath)) {
  const report = JSON.parse(readFileSync(mutationPath, 'utf8')); let killed = 0, total = 0;
  for (const f of Object.values(report.files ?? {})) for (const m of f.mutants ?? []) { if (['Killed', 'Timeout'].includes(m.status)) { killed++; total++; } else if (['Survived', 'NoCoverage'].includes(m.status)) total++; }
  mutation = total ? { killed, total, score: (100 * killed) / total } : null;
}

// ---------- entry points (Journey coverage) ----------
const entries = new Map();
for (const file of sourceFiles) {
  const raw = read(file);
  for (const m of raw.matchAll(/\b(?:app|router|server|api|route)\.(get|post|put|patch|delete|all)\(\s*['"`](\/[^'"`]*)['"`]/g)) entries.set(`${m[1].toUpperCase()} ${m[2]}`, { kind: 'route', key: m[2], file });
  for (const m of raw.matchAll(/\b(?:registerTool|\.tool)\(\s*['"]([\w.-]+)['"]/g)) entries.set(`tool ${m[1]}`, { kind: 'tool', key: m[1], file });
}
for (const e of config.entryPoints ?? []) entries.set(e, { kind: 'configured', key: e, file: configPath });
const journeyText = journeyCorpus.map(read).join('\n') + journeyFiles.filter(f => /\.(feature|md)$/.test(f)).map(read).join('\n');
const entryList = [...entries].map(([id, e]) => ({ id, ...e, covered: journeyText.includes(e.key) }));

// ---------- Journey freshness ----------
const fresh = [];
for (const file of journeyFiles) {
  const raw = read(file);
  // Preferred: Markdown front matter with an `area` list of globs and a `sourceHash` (sha256 over each matched file's
  // repo path and contents, NUL-separated). Also accepted: `// journey-covers:` and `// journey-source-hash:` comments.
  const front = /^---\n([\s\S]*?)\n---/.exec(raw)?.[1];
  const globs = front && /^area:/m.test(front) ? [...front.matchAll(/^\s+-\s+(.+)$/gm)].map(m => m[1].trim()) : /journey-covers:\s*(.+)/.exec(raw)?.[1]?.split(',').map(s => s.trim());
  const hash = (front && /^sourceHash:\s*([0-9a-f]+)/m.exec(front)?.[1]) || /journey-source-hash:\s*([0-9a-f]+)/.exec(raw)?.[1];
  if (!globs?.length || !hash) continue;
  const files = [...new Set(globs.flatMap(g => globSync(g, { cwd: repo })))].filter(f => statSync(join(repo, f)).isFile()).sort();
  const h = createHash('sha256'); for (const f of files) h.update(f).update('\0').update(readFileSync(join(repo, f))).update('\0');
  fresh.push({ file, fresh: h.digest('hex').startsWith(hash) });
}

// ---------- speed (--run) ----------
const loc = file => read(file).split('\n').filter(l => l.trim() && !/^\s*(\/\/|\*|\/\*)/.test(l)).length;
const sourceLoc = sourceFiles.reduce((n, f) => n + loc(f), 0);
const timings = {};
if (flag('--run')) for (const layer of ['rules', 'journeys']) {
  const command = config.commands?.[layer]; if (!command) continue;
  const started = performance.now(), result = spawnSync(command, { cwd: repo, shell: true, stdio: 'ignore', env: process.env });
  const ms = performance.now() - started;
  timings[layer] = { command, ms: Math.round(ms), passed: result.status === 0, msPerLoc: sourceLoc ? ms / sourceLoc : null };
}
const curve = (x, good, bad) => x <= good ? 100 : x >= bad ? 0 : (100 * (Math.log(bad) - Math.log(x))) / (Math.log(bad) - Math.log(good));

// ---------- dimensions ----------
const na = reason => ({ score: null, reason });
const clamp = n => Math.max(0, Math.min(100, n));
const count = check => findings.filter(f => f.check === check).length;
const dims = {};
dims.rulesPurity = rulesFiles.length ? { score: (100 * (rulesFiles.length - impureRules.length)) / rulesFiles.length, detail: `${rulesFiles.length - impureRules.length} of ${rulesFiles.length} Rules test files are pure` } : na('no Rules tests');
{
  const parts = [];
  if (timings.rules) parts.push({ w: 7, s: timings.rules.passed ? curve(timings.rules.msPerLoc, 0.05, 2) : 0, d: `Rules ${timings.rules.ms} ms (${timings.rules.msPerLoc.toFixed(3)} ms/LOC)${timings.rules.passed ? '' : ', FAILED'}` });
  if (timings.journeys) parts.push({ w: 3, s: timings.journeys.passed ? curve(timings.journeys.msPerLoc, 0.5, 20) : 0, d: `Journeys ${timings.journeys.ms} ms (${timings.journeys.msPerLoc.toFixed(3)} ms/LOC)${timings.journeys.passed ? '' : ', FAILED'}` });
  dims.speed = parts.length ? { score: parts.reduce((n, p) => n + p.w * p.s, 0) / parts.reduce((n, p) => n + p.w, 0), detail: parts.map(p => p.d).join('; ') }
    : na(flag('--run') ? 'no layer commands in rules-and-journeys.json' : 'not run (pass --run)');
}
const squared = count('squared-loop');
dims.overtesting = testFiles.length ? { score: squared ? 0 : clamp(100 - 10 * count('own-module-mock') - Math.min(30, 2 * count('call-assertion')) - Math.min(10, count('snapshot')) - 5 * count('test-pile') - 5 * count('journey-reaches-rules')),
  detail: `${squared} squared loops, ${count('own-module-mock')} own-module mocks, ${count('call-assertion')} call assertions, ${count('snapshot')} snapshots, ${count('test-pile')} test piles, ${count('journey-reaches-rules')} Journeys reaching into rules` } : na('no tests to judge');
{
  const parts = [];
  if (coreExports.length) parts.push({ w: 40, s: (100 * coreTested.length) / coreExports.length, d: `${coreTested.length} of ${coreExports.length} core exports named in Rules tests` });
  if (recent && recent.length) parts.push({ w: 25, s: (100 * (recent.length - recentUntouched.length)) / recent.length, d: `${recent.length - recentUntouched.length} of ${recent.length} source files changed in ${recentDays} days are reached by a test` });
  if (journeyCode.length) parts.push({ w: 10, s: (100 * journeysWithOutcome.length) / journeyCode.length, d: `${journeysWithOutcome.length} of ${journeyCode.length} Journeys check an outcome` });
  if (mutation) parts.push({ w: 25, s: mutation.score, d: `mutation score ${mutation.score.toFixed(1)}% (${mutation.killed}/${mutation.total} killed)` });
  dims.undertesting = parts.length ? { score: parts.reduce((n, p) => n + p.w * p.s, 0) / parts.reduce((n, p) => n + p.w, 0), detail: parts.map(p => p.d).join('; ') + (mutation ? '' : '; mutation score n/a (no reports/mutation/mutation.json)') } : na('no source exports or history found');
}
dims.journeyCoverage = entryList.length ? { score: (100 * entryList.filter(e => e.covered).length) / entryList.length, detail: `${entryList.filter(e => e.covered).length} of ${entryList.length} entry points appear in a Journey${journeyFiles.length ? '' : ' (no Journeys yet)'}` }
  : na('no entry points detected (list them in rules-and-journeys.json "entryPoints")');
const nondet = count('nondeterminism');
dims.determinism = testFiles.length ? { score: clamp(100 - 10 * nondet), detail: `${nondet} nondeterminism findings (static only)` } : na('no tests');
dims.freshness = fresh.length ? { score: (100 * fresh.filter(f => f.fresh).length) / fresh.length, detail: `${fresh.filter(f => f.fresh).length} of ${fresh.length} Journeys rewritten since their area last changed` }
  : na(journeyFiles.length ? 'no Journey records an area and sourceHash' : 'no Journeys');

const WEIGHTS = { rulesPurity: 15, speed: 10, overtesting: 25, undertesting: 25, journeyCoverage: 15, determinism: 5, freshness: 5 };
const NAMES = { rulesPurity: 'Rules purity', speed: 'Speed (ms per line)', overtesting: 'Overtesting', undertesting: 'Undertesting', journeyCoverage: 'Journey coverage', determinism: 'Determinism', freshness: 'Journey freshness' };
const measured = Object.entries(dims).filter(([, d]) => d.score !== null);
const measuredWeight = measured.reduce((n, [k]) => n + WEIGHTS[k], 0);
let score = measuredWeight ? measured.reduce((n, [k, d]) => n + WEIGHTS[k] * d.score, 0) / measuredWeight : 0;
if (squared) score = Math.min(score, 50);
score = Math.round(score);

// ---------- per layer and per folder ----------
const layers = Object.fromEntries(['rules', 'journeys'].map(layer => {
  const files = layer === 'rules' ? rulesFiles : journeyFiles;
  return [layer, { files: files.length, tests: files.reduce((n, f) => n + countTests(scrub(read(f))), 0), findings: findings.filter(f => f.layer === layer).length, ...(timings[layer] ?? {}) }];
}));
const folderOf = file => { const parts = file.split('/'); return parts.length > 2 ? parts.slice(0, 2).join('/') : parts.slice(0, -1).join('/') || '.'; };
const folders = {};
for (const file of sourceFiles) {
  const f = folders[folderOf(file)] ??= { files: 0, loc: 0, exports: 0, tested: 0, reached: 0, recentUntouched: 0 };
  const ex = exportsOf(file);
  f.files++; f.loc += loc(file); f.exports += ex.length; f.tested += ex.filter(e => mentioned(e.name, rulesText)).length;
  if (reachedByTests.has(file)) f.reached++;
  if (recentUntouched.includes(file)) f.recentUntouched++;
}
for (const f of Object.values(folders)) f.score = Math.round(0.6 * (f.exports ? (100 * f.tested) / f.exports : 0) + 0.4 * ((100 * f.reached) / f.files));

let sha = null; try { sha = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* not a git repo */ }
const result = {
  repo: relative(process.cwd(), repo) || '.', commit: sha, scoredAt: new Date().toISOString(), score, squaredLoopFail: squared > 0,
  measuredWeight, dimensions: Object.fromEntries(Object.entries(dims).map(([k, d]) => [k, { name: NAMES[k], weight: WEIGHTS[k], ...d, score: d.score === null ? null : Math.round(d.score) }])),
  layers, sourceLoc, folders, entryPoints: entryList, findings,
};

if (flag('--json')) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }

// ---------- SCOREBOARD.md ----------
const md = [];
md.push(`# Scoreboard: ${score}/100${squared ? ' — FAIL (squared loop)' : ''}`, '');
md.push(`Scored ${result.scoredAt.slice(0, 10)}${sha ? ` at ${sha}` : ''}. Measured ${measuredWeight} of 100 weight; dimensions marked n/a weren't measured and are left out of the score, not counted as 100.`, '');
md.push('| Dimension | Weight | Score | Detail |', '| --- | ---: | ---: | --- |');
for (const [k, d] of Object.entries(result.dimensions)) md.push(`| ${d.name} | ${d.weight} | ${d.score === null ? 'n/a' : d.score} | ${d.score === null ? d.reason : d.detail} |`);
md.push('', '## Layers', '', '| Layer | Files | Tests | Findings | Time |', '| --- | ---: | ---: | ---: | --- |');
for (const [name, l] of Object.entries(layers)) md.push(`| ${name} | ${l.files} | ${l.tests} | ${l.findings} | ${l.ms !== undefined ? `${l.ms} ms (${l.msPerLoc?.toFixed(3)} ms/LOC)` : 'not run'} |`);
md.push('', `## Folders (${sourceFiles.length} source files, ${sourceLoc.toLocaleString('en-US')} lines)`, '', '| Folder | Files | Lines | Exports named in Rules tests | Reached by tests | Changed, untested | Score |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const [name, f] of Object.entries(folders).sort((a, b) => b[1].loc - a[1].loc).slice(0, 30)) md.push(`| ${name} | ${f.files} | ${f.loc} | ${f.tested}/${f.exports} | ${f.reached}/${f.files} | ${f.recentUntouched} | ${f.score} |`);
if (entryList.length) { md.push('', `## Entry points (${entryList.filter(e => e.covered).length}/${entryList.length} on a Journey)`, ''); for (const e of entryList.slice(0, 40)) md.push(`- ${e.covered ? '✅' : '⬜'} \`${e.id}\` (${e.file})`); if (entryList.length > 40) md.push(`- …and ${entryList.length - 40} more`); }
md.push('', `## Findings (${findings.length})`, '');
for (const f of findings.slice(0, 50)) md.push(`- **${f.check}** \`${f.file}:${f.line}\` ${f.message}`);
if (findings.length > 50) md.push(`- …and ${findings.length - 50} more (score.json has all of them)`);
md.push('', '_Heuristics, not proofs: see SCORING.md for how each number is measured._', '');
const out = resolve(option('--out', repo));
writeFileSync(join(out, 'SCOREBOARD.md'), md.join('\n'));
writeFileSync(join(out, 'score.json'), JSON.stringify(result, null, 2));
console.log(`${score}/100${squared ? ' FAIL (squared loop)' : ''} — measured ${measuredWeight}/100 weight. Wrote ${relative(process.cwd(), join(out, 'SCOREBOARD.md'))} and score.json.`);
