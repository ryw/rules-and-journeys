#!/usr/bin/env node
// Self-check for the scorer: each fixture must score the way the rubric says it should.
//   node scorer/check.mjs
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const score = repo => JSON.parse(execFileSync(process.execPath, [join(here, 'score.mjs'), repo, '--json'], { encoding: 'utf8' }));
const failures = [];
const expect = (ok, message) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`); if (!ok) failures.push(message); };

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
expect(clean.measuredWeight === 90, `clean: measured weight excludes speed (got ${clean.measuredWeight})`);
expect(clean.dimensions.journeyCoverage.score === 100, 'clean: the POST /sell entry point is on a Journey');
expect(clean.dimensions.freshness.score === 100, 'clean: the Journey was rewritten since its area last changed');
expect(clean.score === 100, `clean: scores 100 (got ${clean.score})`);

// Change the code a Journey covers: the Journey goes stale.
const copy = mkdtempSync(join(tmpdir(), 'rj-clean-'));
try {
  cpSync(join(here, 'fixtures/clean'), copy, { recursive: true });
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
