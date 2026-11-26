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
| Undertesting | 25 | Rules named in tests, changed core files in the Rules import graph, Journeys that check outcomes, mutants killed |
| Journey coverage | 15 | Configured user outcomes observed passing during this invocation |
| Determinism | 5 | No unseeded randomness, real clocks, sleeps or retries in tests |
| Journey freshness | 5 | Recorded source hashes matching their current source |

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
| Changed code reached by tests | 25 | Core files changed in the last 30 days (`git log`; `--since <days>`) reachable through Rules imports |
| Journeys that check an outcome | 10 | Journey files with an `expect`, `assert`, `should` or `Then` |
| Mutation score | 25 | Killed ÷ (killed + survived + no coverage) from `reports/mutation/mutation.json` (Stryker). Tests that can't fail show up here. |

### Journey coverage

Configure an ordered list of user goals in `outcomes`, each with a unique slug `id` and a human-readable `title`. During `--run`, the scorer gives the Journey command a fresh temporary directory in `RJ_EVIDENCE_DIR`. The test adapter writes one `<id>.json` after the assertions for that goal finish:

```json
{ "status": "passed", "routes": ["POST /orders", "GET /orders/:id"] }
```

Write `failed` if an assertion fails. Record route templates observed during requests, including the method, without user identifiers or parameters. The goal score is passed outcomes divided by configured outcomes. Missing observations earn no credit in a timed run. A static scan or an unconfigured goal list leaves this dimension unmeasured. The route inventory underneath is matched by exact ID and is diagnostic only. The summary prioritizes failed goals, then missing goals in configuration order.

`--run --require-pass` writes the report and returns a nonzero status if either suite failed or was missing. The runner output goes to stderr. CI can validate and score in one invocation.

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
- **Folders:** each core folder (two levels deep) gets:
  - its file and line counts;
  - its exports named in Rules tests;
  - its core files in the Rules import graph;
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
  - the first 50 check violations with file and line, followed by review leads from the run. The Findings badge counts each violation and each review item once. Changed files outside the Rules import graph are grouped by folder. Earlier runs can show folder totals even when only counts were saved. Review leads add no scoring penalty.
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

`areas` groups the app's entry points and describes each group in plain English; the report's Journeys section shows
each area's coverage. An entry is a detected id (`POST /api/checkout`) or a URL fragment the scorer can't find itself
(`POST /api/cart/`), matched against the exact method and route ID in runtime evidence. Detected entry points in no area are listed under "Other".

## Comparing runs

Rubric 2 starts a new series when the rubric, effective configuration, measured dimensions, or availability of mutation and timing inputs changes. Older reports remain readable. The commit and local-edit indicator identify the checkout. One observation provides a baseline, and subsequent comparable observations draw the sparklines.

Use `coreExclude` to share shell exclusions with a project's boundary checker. Folder scores blend export-name mentions and import reach in the Rules layer. `journeySetupImports` can allow specific named setup imports such as a random-seed setter. Other exports from the same module still undergo the boundary check.
