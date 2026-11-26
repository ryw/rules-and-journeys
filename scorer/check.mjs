#!/usr/bin/env node
// Self-check for the scorer: each fixture must score the way the rubric says it should.
//   node scorer/check.mjs
import { readTestFiles } from './test-results.mjs';
import { renderHtml } from './report-html.mjs';
import { formatDuration, speedDetail } from './timing.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const score = repo => JSON.parse(execFileSync(process.execPath, [join(here, 'score.mjs'), repo, '--json'], { encoding: 'utf8' }));
const failures = [];
const expect = (ok, message) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`); if (!ok) failures.push(message); };

const timings = { rules: { ms: 1864, msPerLoc: 0.139 }, journeys: { ms: 14972, msPerLoc: 1.113 } };
expect(speedDetail(timings) === 'Rules 1.86 s (0.139 ms/LOC); Journeys 15.0 s (1.11 ms/LOC)', 'timings retain three significant digits in the appropriate unit');
expect(formatDuration(999.9) === '1.00 s' && formatDuration(60_000) === '1.00 min', 'rounded timings promote to the next unit');

const squared = score(join(here, 'fixtures/squared'));
expect(squared.squaredLoopFail, 'squared: the squared loop fails the run');
expect(squared.findings.some(f => f.check === 'squared-loop' && f.line === 12), 'squared: the nested for loops are found at line 12');
expect(squared.findings.some(f => f.check === 'own-module-mock'), 'squared: mocking its own tax module is found');
expect(squared.findings.some(f => f.check === 'call-assertion'), 'squared: the call assertion is found');
expect(squared.dimensions.overtesting.score === 0, 'squared: overtesting scores 0');
expect(squared.score <= 50, `squared: headline capped at 50 (got ${squared.score})`);

const clean = score(join(here, 'fixtures/clean'));
expect(!clean.squaredLoopFail && clean.findings.length === 0, 'clean: no findings');
expect(clean.dimensions.speed.score === null, 'clean: speed is n/a without --run, not 100');
expect(clean.measuredWeight === 75, `clean: measured weight excludes speed and unobserved outcomes (got ${clean.measuredWeight})`);
expect(clean.dimensions.journeyCoverage.score === null && !clean.entryPoints.some(e => e.covered), 'clean: route mentions alone provide no runtime coverage');
expect(clean.dimensions.freshness.score === 100, 'clean: the recorded source hash matches');
expect(clean.score === 100, `clean: scores 100 (got ${clean.score})`);

// Earlier runs retained folder counts but not paths. Their Findings tab still explains reviewable gaps.
const historic = { ...clean, rubricVersion: 2, folders: { src: { ...clean.folders.src, recentUntouched: 2 } } };
delete historic.reviewItems;
const oldPage = renderHtml(historic);
expect(oldPage.includes('Check violations · 0') && oldPage.includes('Evidence to review · 2') &&
  oldPage.includes('2 recently changed files are outside the Rules import graph.'), 'saved runs explain coverage gaps even when static checks are clean');

const files = readTestFiles({ testResults: [{ name: '/repo/test/checkout.test.ts', status: 'failed', assertionResults: [
  { title: 'a buyer pays', status: 'failed', duration: 12.34, location: { line: 5 }, meta: { rjOutcome: 'checkout' }, failureMessages: ['Incorrect total\ninternal stack'] },
  { title: 'a buyer waits', status: 'skipped' },
] }] }, '/repo');
const casePage = renderHtml({ ...clean, layers: { journeys: { ...clean.layers.journeys, testFiles: files } },
  outcomes: [{ id: 'checkout', title: 'Checkout', status: 'failed', routes: ['POST /sell'] }] });
expect(files[0].path === 'test/checkout.test.ts' && files[0].cases[1].ms === null, 'runner paths are relative and skipped cases retain missing timing');
expect(casePage.includes('href="#case-journeys-0-0"') && casePage.includes('12.3 ms') && casePage.includes('checkout.test.ts:5') &&
  casePage.includes('Incorrect total') && !casePage.includes('internal stack'), 'outcomes drill into the matching case, timing, source line and first failure');
expect(oldPage.includes('This run has no individual test records.'), 'historical runs explain missing case measurements');

// Change the code a Journey covers: the Journey goes stale.
const copy = mkdtempSync(join(tmpdir(), 'rj-clean-'));
try {
  cpSync(join(here, 'fixtures/clean'), copy, { recursive: true });
  // The runner adapter reports evidence from this invocation. An omitted outcome earns no credit.
  writeFileSync(join(copy, 'report.mjs'), `import { writeFileSync } from 'node:fs';
    writeFileSync(process.env.RJ_EVIDENCE_DIR + '/sale.json', JSON.stringify({ status: 'passed', routes: ['POST /sell'] }));`);
  writeFileSync(join(copy, 'rules-and-journeys.json'), JSON.stringify({
    core: ['src/fee.ts'], commands: { rules: 'exit 0', journeys: 'node report.mjs' },
    outcomes: [{ id: 'sale', title: 'A seller gets paid' }, { id: 'refund', title: 'A buyer gets a refund' }],
  }));
  const observed = JSON.parse(execFileSync(process.execPath, [join(here, 'score.mjs'), copy, '--run', '--require-pass', '--json'], { encoding: 'utf8' }));
  expect(observed.dimensions.journeyCoverage.score === 50 && observed.entryPoints.find(e => e.id === 'POST /sell')?.covered, 'one of two goals passed and the request was observed');
  writeFileSync(join(copy, 'report.mjs'), 'process.exit(1);');
  const failed = spawnSync(process.execPath, [join(here, 'score.mjs'), copy, '--run', '--require-pass', '--json'], { encoding: 'utf8' });
  const failedScore = JSON.parse(failed.stdout);
  expect(failedScore.reviewItems.some(item => item.label === 'Failed suite'), 'failed validation appears in Findings');
  expect(failed.status === 1 && failedScore.layers.journeys.passed === false && !failedScore.entryPoints.some(e => e.covered), 'a failed validation still produces a report and cannot reuse old evidence');
  writeFileSync(join(copy, 'src/fee.ts'), 'export const saleFee = (price: number) => Math.floor(price * 0.06);\n');
  expect(score(copy).dimensions.freshness.score === 0, 'clean, edited: the Journey is stale once its source changes');
} finally { rmSync(copy, { recursive: true, force: true }); }

// Cartesian tables count as squared loops too.
const cartesian = mkdtempSync(join(tmpdir(), 'rj-cartesian-'));
try {
  cpSync(join(here, 'fixtures/clean'), cartesian, { recursive: true });
  writeFileSync(join(cartesian, 'test/fee.test.ts'), `import { expect, it } from 'vitest';\nimport { saleFee } from '../src/fee.js';\nconst prices = [1, 20, 100], rates = [0.05, 0.1];\nit.each(prices.flatMap(p => rates.map(r => [p, r])))('fee on %i at %f', (p, r) => expect(saleFee(p)).toBe(Math.floor(p * r)));\n`);
  expect(score(cartesian).squaredLoopFail, 'cartesian: an it.each over a flatMap × map table fails');
  writeFileSync(join(cartesian, 'test/fee.test.ts'), `import { describe, expect, it } from 'vitest';\nimport { saleFee } from '../src/fee.js';\ndescribe.each([['small', 19, 0], ['large', 100, 5]])('a %s sale', (_n, p, fee) => {\n  it('pays the fee', () => expect(saleFee(p)).toBe(fee));\n});\n`);
  expect(!score(cartesian).squaredLoopFail, 'single loop: describe.each around a plain it passes');
} finally { rmSync(cartesian, { recursive: true, force: true }); }

if (failures.length) { console.error(`\n${failures.length} check(s) failed.`); process.exit(1); }
console.log('\nAll scorer checks pass.');
