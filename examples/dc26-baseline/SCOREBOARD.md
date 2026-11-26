# Scoreboard: 0/100

Scored 2026-11-26 at 752076e. Measured 40 of 100 weight; dimensions marked n/a weren't measured and are left out of the score, not counted as 100.

| Dimension | Weight | Score | Detail |
| --- | ---: | ---: | --- |
| Rules purity | 15 | n/a | no Rules tests |
| Speed (ms per line) | 10 | n/a | not run (pass --run) |
| Overtesting | 25 | n/a | no tests to judge |
| Undertesting | 25 | 0 | 0 of 1188 core exports named in Rules tests; 0 of 380 source files changed in 30 days are reached by a test; mutation score n/a (no reports/mutation/mutation.json) |
| Journey coverage | 15 | 0 | 0 of 19 entry points appear in a Journey (no Journeys yet) |
| Determinism | 5 | n/a | no tests |
| Journey freshness | 5 | n/a | no Journeys |

## Layers

| Layer | Files | Tests | Findings | Time |
| --- | ---: | ---: | ---: | --- |
| rules | 0 | 0 | 0 | not run |
| journeys | 0 | 0 | 0 | not run |

## Folders (380 source files, 13,420 lines)

| Folder | Files | Lines | Exports named in Rules tests | Reached by tests | Changed, untested | Score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| src | 133 | 10026 | 0/657 | 0/133 | 133 | 0 |
| src/behaviors | 247 | 3394 | 0/531 | 0/247 | 247 | 0 |

## Entry points (0/19 on a Journey)

- ⬜ `GET /health` (src/index.ts)
- ⬜ `POST /api/guest` (src/index.ts)
- ⬜ `POST /api/auth/sign-in/anonymous` (src/index.ts)
- ⬜ `GET /api/auth/oauth2/authorize` (src/index.ts)
- ⬜ `POST /api/auth/oauth2/token` (src/index.ts)
- ⬜ `ALL /api/auth/{*path}` (src/index.ts)
- ⬜ `ALL /.well-known/{*path}` (src/index.ts)
- ⬜ `POST /mcp` (src/index.ts)
- ⬜ `ALL /mcp` (src/index.ts)
- ⬜ `POST /mcp/account` (src/index.ts)
- ⬜ `ALL /mcp/account` (src/index.ts)
- ⬜ `GET /api/game` (src/index.ts)
- ⬜ `POST /api/game/:action` (src/index.ts)
- ⬜ `GET /api/session` (src/index.ts)
- ⬜ `GET /api/hall` (src/index.ts)
- ⬜ `GET /api/hall/heroes/:id` (src/index.ts)
- ⬜ `GET /companion` (src/index.ts)
- ⬜ `tool start_guest` (src/mcp.ts)
- ⬜ `tool claim_account` (src/mcp.ts)

## Findings (0)


_Heuristics, not proofs: see SCORING.md for how each number is measured._
