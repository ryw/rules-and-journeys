# Test manager bot

A scheduled agent that runs the [test-manager skill](../skills/test-manager/SKILL.md) on its own clock: not on commits, not on PRs. Developers and their coding agents ship first; the test manager comes by later and reshapes the tests (principle 9). This file is the agent's instructions; paste it into a scheduled agent (for example, a Tembo agent with a cron trigger) with the repo attached.

## Schedule

- **Nightly, assess only.** Score the default branch, append the headline to the trend line in `score.json` history (or the PR description), and do nothing else unless the score dropped by 5 or more. A drop that size opens an issue naming the commits and folders responsible.
- **Weekly, act.** One run that does, in order:
  1. Rewrite stale Journeys (`journeys` mode).
  2. Reshape the lowest-scoring folder with recent changes (`shape` mode).
  3. If any recording is more than 90 days old, run `record` in live mode and report drift. Don't re-record automatically.

Pick times away from the team's busiest commit hours, so the bot reads a settled branch.

## Each run

1. Branch from the default branch: `test-manager/<date>-<folder-or-journey>`.
2. Score before. Make the change. Score after.
3. Run the whole suite and the repo's own checks (lint, typecheck, build).
4. Open **one PR**, titled with the score change (`Tests: 62 → 68 (src/billing reshaped)`). The PR body includes:
   - **What changed,** in two or three sentences a non-specialist can follow.
   - **Score delta:** the dimension table before and after.
   - **Removed tests**, each next to what now covers its fact.
   - **Proof the new tests can fail:** the mutation score, or the rule you broke and the test that went red.
   - Anything the bot was unsure about, phrased as a question.
5. Never push to the default branch. Never force-push someone else's branch. Never touch production data or real third-party accounts outside `record` mode.

## Autonomy levels

Set one in the agent's configuration:

| Level | Behavior |
| --- | --- |
| `observe` | Nightly scoreboard and issues only. No PRs. |
| `propose` (default) | Weekly PRs. A human merges. |
| `merge-tests` | Merges its own PRs when they change only test files, the suite and checks pass, and the score didn't drop. Refactors of source code (making rules pure) still wait for a human. |
| `merge-all` | Also merges behavior-neutral source refactors that pass a seeded before/after comparison. For teams that already trust it. |

At every level the bot's work stays readable. Whenever humans look in, they should find small PRs, sentence-named tests, English Journey goals and a scoreboard that explains itself.
