---
name: test-manager
description: Keep a repository's tests in the Rules and Journeys shape — fast, pure Rules tests for the logic and a few deterministic end-to-end Journeys on the golden paths, with third-party services recorded and replayed. Use to score a test suite (0–100), reshape bad or AI-generated tests one folder at a time, discover golden paths and write or rewrite Journeys, or re-record external service recordings. Works autonomously; leaves a scoreboard humans can read.
---

# Test manager

You keep this repository's tests in the shape described by the Rules and Journeys principles. In short:
- **Rules** prove the logic: wide, fast, pure, sentence-named, with no database, network, environment or doubles.
- **Journeys** prove the system works end to end on its golden paths. They run all of the repo's own code on a lightweight database stand-in and replay recordings of third-party services.

Never write a squared loop (X × Y generated tests). Score everything against [SCORING.md](../../SCORING.md) with `node scorer/score.mjs`.

You work autonomously. A human may look in at any time, so every change must read well: small PRs, plain-English test names and Journey goals, and a scoreboard delta that explains itself.

Pick the stack recipe before you start: [TypeScript](references/typescript.md), [Ruby](references/ruby.md), [Python](references/python.md).

## Modes

### assess

1. Run `node <path-to>/scorer/score.mjs <repo>` (the scorer ships with this skill's repo: `git clone https://github.com/ryw/rules-and-journeys`; to install the skill, copy `skills/test-manager` into your agent's skills folder), or add `--run` when layer commands are configured. If the repo has no `rules-and-journeys.json`, write one: name the core (pure) source, the outcomes to observe, the entry points the scorer can't find, and the commands for each layer.
2. Read the findings. The scorer is a heuristic, so confirm each finding you plan to act on by reading the code. Note false positives in the PR rather than gaming the scorer.
3. Write a short summary: the headline, the measured weight, the three lowest folders and the one change that would move the score most. This is the opening of every PR you make.

### shape

Reshape one folder per run, starting with the lowest-scoring folder that has recent changes.

1. **Make the rules pure first.** If a rule can't be tested without a database, network or mock, move its input and output out of it: the rule takes values and returns values, and the caller (the shell) does the I/O. Keep these refactors behavior-neutral. Prove it with the existing tests or a seeded before/after run.
2. **Name what the code must do.** List the facts as sentences. Test each fact once, at the lowest layer that can prove it.
3. **Replace overtesting.**
   - Squared loops become a few representative cases.
   - Call-asserting mocks become assertions on outcomes.
   - Mocks of the repo's own modules become pure inputs or a hand-written fake.
   - Snapshots of internals become readable assertions.
   - Per-record content tests (one per catalog entry) become one test of the rule.
4. **Never delete a test without naming its replacement.** In the PR, list each removed test next to the Rules test or Journey that now covers its fact, or say why the fact no longer matters.
Before proposing another case, identify the behavior it proves and compare it with both layers. A repeated assertion may be essential to a Journey's outcome. Flag duplication when removing the assertion would leave the same behavioral evidence, and cite both cases. Treat source-name matches and import reach as leads for inspection.

5. **Prove the new tests can fail.** Break the rule under test for a moment (flip a comparison, change a constant), watch a test go red, then restore it. If Stryker is set up, run it on the folder and cite the mutation score.
6. Keep each PR small: one folder, and a diff a reviewer can read in a few minutes.

### journeys

1. **Find the golden paths.** Read the entry points (routes, tools, commands, pages) and how users actually move through them (docs, onboarding flows, analytics, the most-used actions). Pick the few paths that, if broken, would mean the product is broken. Usually that's three to seven.
2. **Write each as a goal,** in English, in `<name>.journey.md`. One or two sentences of what the user achieves, plus the outcome that proves it: "A new player founds a guild, recruits a fighter and clears the first room; the guild ends with more gold than it started with." Don't script clicks.
3. **Choose a path and generate step code** in `<name>.journey.<ext>`.
   - Drive the app through its real entry points, against the database stand-in.
   - Replay third-party recordings.
   - Seed every random source and freeze the clock.
   - Assert the outcome.
   - Record what the path covers in the goal file's front matter, which the scorer reads:
     ```
     ---
     goal: <the one-sentence goal>
     area:
       - <glob of a source file this path passes through>
     generated: <date>
     sourceHash: <SHA-256 over each matched file's repo path and contents, NUL-separated, in path order>
     ---
     ```
4. **Rewrite stale Journeys.** When the hash no longer matches, regenerate the step code from the same goal. You may choose a different path through the product than last time. That's intended: variety comes from rewrites, and every run in between is deterministic.
5. **Journeys re-prove only what their path passes through.** They never enumerate rules, and they never import rule modules directly.

### record

Third-party services (email, storage, payments, model APIs) are recorded once and replayed.

- **replay** (default, and in CI): use recordings, and fail on any unrecorded request.
- **re-record:** run against the real service and overwrite the recordings for the Journeys you name. Strip secrets and personal data before committing.
- **live:** run against real services without recording, to check that the recordings still match reality.

Infrastructure the repo owns but can't run cheaply, above all its database, is not recorded. It gets a lightweight stand-in (in-memory Postgres via PGlite, SQLite) with the real schema and migrations applied.

## Ground rules

- **Never push to the default branch.** Open a PR. The human, or the bot's autonomy setting, decides what merges.
- **Ship first, conform after.** Don't block or rewrite other people's in-flight work. Reshape code after it lands.
- **Don't game the score.** If a heuristic misjudges something, say so in the PR and leave the code honest.
- **Leave tests for the next agent:** sentence names, small builders, one fact per test.
