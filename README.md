# Rules and Journeys

**Testing principles for software written with AI agents.** A companion to the [AI-First Software Development (AIFSD) Manifesto](https://github.com/tembo/aifsd).

Agents made tests cheap. They write a hundred in a minute, and the hundred tend to restate the code, loop over every combination of inputs, and boot the whole stack to check one rule. Suites like that get slow, so agents skip them, and humans stop reading them. The same AI makes testing well possible: an agent can keep a suite in shape on its own, if someone tells it what shape to keep.

That shape was worked out once already. In Rails' golden age, every app shipped with a test directory on day one. RSpec turned tests into sentences, Cucumber turned features into readable scenarios, and factories replaced fixtures. VCR recorded the outside world once and replayed it, and SQLite stood in for the production database. Fast tests gave fast feedback. These principles carry that practice forward to agents that write, run and maintain the tests themselves.

## Principles

### 1. Two layers, each with its own job

- **Rules** prove the logic: wide, fast and isolated.
- **Journeys** prove the system works end to end on its golden paths.
- A Journey re-proves only the rules its path passes through, never all of them. No blocks of tests spanning every layer and every rule.

### 2. Rules are pure

- No database, network, environment or test doubles.
- If a rule needs a mock, move its input and output out of it (functional core, imperative shell).
- Name tests as sentences: what the rule does, not how.

### 3. Journeys run all of your own code; what you don't own is recorded

- Every layer you wrote runs for real: HTTP, services, rules, queries.
- Third-party services are recorded once and replayed (VCR). You can re-record, or run live, on demand.
- Infrastructure you own but can't run cheaply gets a lightweight stand-in: SQLite in the Rails days, in-memory Postgres now.

### 4. Journeys are goals; the agent picks the path

- A Journey is a short English goal a human can review: "a new player founds a guild, recruits a fighter and clears the first room."
- The agent turns it into step code, and every run of that code is deterministic.
- On a schedule, when code in a Journey's area has changed, the agent rewrites the path. Variety comes from rewrites, never from individual runs.

### 5. Never combinatorial

- Two nested loops that produce X × Y test runs (a *squared loop*) fail the score.
- Pick representative cases, or prove the rule once where it lives.

### 6. Neither overtested nor undertested

- **Overtesting:** squared loops; the same fact asserted in both layers; piles of tests on one small function; tests that restate the implementation; assertions on data instead of rules.
- **Undertesting:** rules nobody tests; tests that can't fail (surviving mutants); entry points no Journey reaches; changed code no test touches; Journeys that never check an outcome.

### 7. Speed is measured, not budgeted

- Milliseconds per line of code, per layer and per folder.
- A slow Rules suite is a design smell, not a timeout to raise.

### 8. Autonomous, and pleasant to inspect

- The agent writes, runs, scores and reshapes tests on its own.
- The scoreboard (0–100) is the shared understanding between human and agent. Humans should like what they see whenever they look in.

### 9. Ship first, conform after

- New code lands with whatever tests it has.
- A test manager running on its own schedule, not triggered by commits, reshapes those tests toward these principles.

## Naming the layers

Call them what fits your team: **Rules / Journeys**, **Core / Integration**, **Unit / Flight**, or **Proof / Rehearsal**. What matters is that each layer has one job and doesn't redo the other's.

## How to adopt

Get the tool: `git clone https://github.com/ryw/rules-and-journeys` (Node 22 or newer; the scorer has no dependencies).

1. **Score it.** `node scorer/score.mjs path/to/repo` writes `SCOREBOARD.html` (a self-contained report with the score's trend), `SCOREBOARD.md`, `score.json` and `history.json`. Or add it to a project: `pnpm add -D github:ryw/rules-and-journeys`, then run `rules-and-journeys . --run --out reports/tests`. [SCORING.md](SCORING.md) explains every number.
2. **Give your agent the skill.** [skills/test-manager](skills/test-manager/SKILL.md) assesses, reshapes tests a folder at a time, writes and rewrites Journeys, and refreshes recordings. There are recipes for TypeScript, Ruby and Python.
3. **Schedule the test manager.** [bot/test-manager.md](bot/test-manager.md) runs the skill on a schedule of its own and opens one small PR per run with the score change.

## Keep the history: mount the reports in your app

Score history doesn't belong in your repo. Keep it in your own Postgres and mount the reports inside your app, behind your
own admin authentication, the way Sidekiq's web UI mounts into a Rails app. No new service, no new accounts:

```js
import { createReports, recordRun, schemaSql } from 'rules-and-journeys/server';

await pool.query(schemaSql());                                  // once, or copy it into a migration (schema "rj")
app.use('/admin/tests', requireAdmin, createReports({ db: pool }));

// In CI, after scoring main:
await recordRun(pool, JSON.parse(readFileSync('reports/tests/score.json', 'utf8')), { branch: 'main' });
```

`db` is anything with `query(text, params)`, such as a node-postgres `Pool`. The pages set their own strict
Content-Security-Policy. Prefer HTTP uploads? `createIngest({ db, token })` is a token-protected `POST` endpoint.

## Signed

1. [@rywalker](https://twitter.com/rywalker)

_(PR your signature to the bottom of this list, if you're in)_

## License

[MIT](LICENSE). Use it, fork it, host it.
