# Scoring

The scoreboard turns the [principles](README.md) into one number from 0 to 100, plus the breakdown behind it. It is how the human and the test manager agree on what "good" means. The scorer is `scorer/score.mjs`; run `node scorer/check.mjs` to see it judge two fixture repos.

```
node scorer/score.mjs <repo>          # static checks only
node scorer/score.mjs <repo> --run    # also runs each layer and scores speed
node scorer/score.mjs <repo> --json   # print instead of writing the scoreboard files
node scorer/score.mjs <repo> --out reports/tests   # SCOREBOARD.html, SCOREBOARD.md, score.json and history.json go there
```

## Dimensions and weights

| Dimension | Weight | What it rewards |
| --- | ---: | --- |
| Rules purity | 15 | Rules tests that never reach a database, network, configuration or environment |
| Speed | 10 | Few milliseconds per line of source code, per layer (Rules 7, Journeys 3) |
| Overtesting | 25 | No squared loops, no restated implementation, no piles of tests on one function |
| Undertesting | 25 | Rules named in tests, changed code reached by tests, Journeys that check outcomes, mutants killed |
| Journey coverage | 15 | Entry points (routes, tools, configured entries) that some Journey goes through |
| Determinism | 5 | No unseeded randomness, real clocks, sleeps or retries in tests |
| Journey freshness | 5 | Journeys rewritten since the code they cover last changed |

**Unmeasured is not perfect.** A dimension the scorer can't measure (speed without `--run`, freshness with no Journeys) shows as `n/a` and is left out. The headline is the weighted average of the measured dimensions, and the scoreboard says how much weight was measured ("measured 75 of 100").

**A squared loop fails the run.** One squared loop sets Overtesting to 0 and caps the headline at 50, whatever else is true.

## How each dimension is measured

Everything is a static heuristic over the source and test files, except speed (timed with `--run`) and the mutation score (read from a Stryker report). The heuristics are cheap and explainable on purpose: the scoreboard is for agreeing on direction, and the test manager reads the findings before acting on them.

### Layers

- **Rules tests:** files matching `rules` globs (default `**/*.{test,spec}.*`).
- **Journeys:** files matching `journeys` globs (default `*.journey.*`, anything under `journeys/`, `e2e/`, `integration/`, `features/` or `acceptance/`, `.feature` files and `.journey.md` goal files).
- **Source:** `source` globs (default `src/`, `lib/`, `app/`). **Core** (the part Rules should name directly) defaults to all source; set `core` to your pure layer.

### Rules purity

For each Rules test, follow its relative imports through the repo. The file is impure if anything it reaches:

- imports a forbidden package (database drivers and ORMs, HTTP clients, `http`/`https`/`net`, `@aws-sdk/*`; configurable);
- is a forbidden module (default: files named `database`, `db`, `config` or `env`; configurable);
- or if the test itself reads `process.env` or calls `fetch`.

The score is the percentage of pure Rules files. Type-only imports don't count.

### Speed

`--run` runs `commands.rules` and `commands.journeys` and divides wall time by non-blank, non-comment lines of source. The score falls on a log curve:

| Layer | 100 at | 0 at |
| --- | ---: | ---: |
| Rules | ≤ 0.05 ms per line | ≥ 2 ms per line |
| Journeys | ≤ 0.5 ms per line | ≥ 20 ms per line |

A failing run scores 0. There are no budgets: a bigger codebase earns a longer suite.

### Overtesting

Start at 100 and subtract:

| Finding | Penalty |
| --- | --- |
| Own-module mock (`vi.mock('./…')`, `jest.mock('../…')`) | 10 each |
| Call assertion (`toHaveBeenCalled*`, `calledWith`) | 2 each, at most 30 |
| External snapshot (`toMatchSnapshot`) | 1 each, at most 10. Inline snapshots are fine: reviewers can read them. |
| Test pile: a Rules file with more than 20 tests on one or two imported functions | 5 each |
| A Journey importing a rule module directly instead of entering through an entry point (`index`, `app`, `server`, `main`, `routes`, `mcp`, `api`) | 5 each |
| Any squared loop | Overtesting scores 0 |

Not measured statically: assertions on data instead of rules (for example, one test per catalog entry). The test manager checks for these when it reshapes a folder.

#### What a squared loop is

A **squared loop** is a test generator (`it`, `test`, `it.each`, `test.each`) nested inside two or more loops: `for`, `forEach`, `map`, `flatMap`, `describe.each`, or the generator's own `.each`. A `.each` table built as a cartesian product (`flatMap` around a `map`) also counts. Either way, X inputs times Y inputs become X × Y tests that prove the same fact over and over.

This fails:

```ts
for (const base of [1, 10, 100, 1000]) {
  for (const region of ['eu', 'us', 'ca']) {
    it(`prices ${base} in ${region}`, () => expect(price(base, region)).toBe(expected(base, region)));
  }
}
```

So does this:

```ts
it.each(prices.flatMap(p => rates.map(r => [p, r])))('fee on %i at %f', …);
```

One loop is fine: `describe.each(cases)` around a plain `it`, or a single `it.each(cases)` of representative examples.

### Undertesting

A weighted average of whichever of these can be measured:

| Signal | Weight | How it's measured |
| --- | ---: | --- |
| Core exports named in Rules tests | 40 | Exported functions, constants and classes in `core` whose name appears in Rules tests or their support files |
| Changed code reached by tests | 25 | Source files changed in the last 30 days (`git log`; `--since <days>`) that any test reaches through imports |
| Journeys that check an outcome | 10 | Journey files with an `expect`, `assert`, `should` or `Then` |
| Mutation score | 25 | Killed ÷ (killed + survived + no coverage) from `reports/mutation/mutation.json` (Stryker). Tests that can't fail show up here. |

### Journey coverage

Entry points are:

- Express-style routes (`app.get('/path'`, `router.post(…)`);
- MCP tools (`registerTool('name'`, `.tool('name'`);
- anything listed in `entryPoints`.

An entry point is covered when its path or name appears in a Journey or its step code.

### Determinism

Start at 100 and subtract 10 per finding in test code:

- unseeded `Math.random`;
- `Date.now()` or `new Date()` without fake timers or a seed;
- `setTimeout`, `sleep` or `delay`;
- `retry` settings.

### Journey freshness

A Journey's goal file records the source area it covers and a hash of that area in its front matter:

```markdown
---
goal: A new player founds a guild, recruits from the Tavern and clears the first room of a crawl.
area:
  - src/game.ts
  - src/combat*.ts
generated: 2026-11-26
sourceHash: 50745af6279a66c9
---
```

The hash is SHA-256 over each matched file's repo path and contents (NUL-separated, in path order); the scorer compares as many hex characters as are recorded. Comment headers (`// journey-covers:` and `// journey-source-hash:`) in the step code are also accepted. A Journey is fresh when the hash still matches. The test manager rewrites stale Journeys on its schedule, choosing a new path; that is where Journeys get their variety (principle 4).

## Per layer and per folder

- **Layers:** files, test count, findings and time (with `--run`) for Rules and for Journeys.
- **Folders:** each source folder (two levels deep) gets:
  - its file and line counts;
  - its exports named in Rules tests;
  - its files reached by any test;
  - its changed-but-untested files;
  - a folder score: 60% exports named plus 40% files reached.

  The test manager works through the lowest-scoring folders first, one per PR.

## Output

- **`SCOREBOARD.md`:**
  - the headline (with FAIL if there's a squared loop);
  - the measured weight;
  - the dimension table;
  - the layers;
  - the 30 largest folders;
  - entry points, ticked when a Journey covers them;
  - the first 50 findings, as `file:line` and a one-line reason.
- **`score.json`:** the same data, complete, for tools and trend lines.

## Configuration

Put an optional `rules-and-journeys.json` at the repo root:

```json
{
  "rules": ["test/rules/**/*.test.ts"],
  "journeys": ["test/journeys/**/*.{ts,md}"],
  "source": ["src/**/*.ts"],
  "core": ["src/rules/**/*.ts", "src/behaviors/**/*.ts"],
  "forbiddenModules": ["(^|/)(database|config)\\.ts$", "-store\\.ts$"],
  "entryPoints": ["recruit_hero", "enter_module"],
  "commands": { "rules": "pnpm test", "journeys": "pnpm test:journeys" },
  "recentDays": 30,
  "areas": [
    { "name": "Checkout", "description": "A shopper pays for their cart.", "entryPoints": ["POST /api/checkout", "POST /api/cart/"] }
  ]
}
```
