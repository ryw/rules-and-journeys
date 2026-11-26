# TypeScript and JavaScript recipe

## Rules: Vitest

- **Run:** `vitest run` over `test/rules/**/*.test.ts`. The suite must pass with an empty environment: `env -i PATH=$PATH npx vitest run`.
- **Names:** sentence-style `describe`/`it` names, such as `describe('the sale fee')` with `it('is nothing on a sale under 20 gold')`.
- **Seeds and clocks:** seed every random source in a `beforeEach` (route game or business randomness through one `random()` you can seed), and use `vi.useFakeTimers()` with `vi.setSystemTime()` for clocks.
- **Builders, not fixtures.**
  - Build test data through the app's real schema or factory, so defaults and validation match production. For example, `schema.parse({ ...minimal, ...overrides })`, or the app's own `createX()` given an in-memory dependency.
  - A builder states only what the test cares about.
  - Never copy production records into the repo.
- **Keep the boundary honest:** add a lint step that fails when a pure module transitively imports the database, config or server. A small import-graph walk is enough; oxlint and ESLint `no-restricted-imports` only see direct imports.

## Journeys: the real app, in-memory Postgres, replayed HTTP

### Postgres: PGlite

[PGlite](https://pglite.dev) is real Postgres compiled to WebAssembly. It runs inside the Node process, in memory by default (`new PGlite()`). Verified against `@electric-sql/pglite` 0.6.0:

- **Per-test databases:** `await db.clone()` copies a migrated database, so each Journey can start from the same state without re-running migrations.
- **Snapshots:** `dumpDataDir()` and the `loadDataDir` option save a migrated database and load it again.

If the app talks to Postgres through a normal driver (`pg`, postgres.js), expose PGlite over the wire protocol with [`@electric-sql/pglite-socket`](https://github.com/electric-sql/pglite/tree/main/packages/pglite-socket), verified against 0.3.0:

```ts
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const db = await PGlite.create();
const server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' }); // port 0: the OS picks one
await server.start();
// Point the app's DATABASE_URL at this server, run migrations, then boot the app in-process.
```

PGlite is a single-connection database. The socket server allows one connection by default. Multiple connections go through a multiplexer: the CLI exposes it as `--max-connections`, and "not all use cases are guaranteed to work". When an app opens several pools, either set each pool to one connection or check the multiplexer's programmatic option in the package source first. The README documents only the CLI flag.

SSL isn't supported, so connect with `sslmode=disable`.

### Third-party HTTP: nock back

[nock](https://github.com/nock/nock)'s `back` mode records and replays HTTP, verified against nock 15.0.6. Set `nockBack.fixtures` to a directory, then choose the mode with `nockBack.setMode()` or the `NOCK_BACK_MODE` environment variable:

| Mode | Behavior | Use it for |
| --- | --- | --- |
| `lockdown` | Use recordings; block every unrecorded request | Replay in CI |
| `record` | Use recordings, and record new requests | Adding a Journey |
| `update` | Delete the recordings and record afresh | Re-record |
| `wild` | Real network; nothing replayed or recorded | Live |
| `dryrun` | Nock's default: use recordings, allow other HTTP | Not for CI |

ES modules that import `node:http` before nock loads aren't intercepted. Preload it with `NODE_OPTIONS=--import=nock`. Check that the client you use (global `fetch`, axios, an SDK) is intercepted before trusting a recording; axios may need `axios.defaults.adapter = 'http'`.

### Driving the app

- Boot the HTTP app in-process and call it like a client: supertest for Express, or `fetch` to a server on port 0.
- For MCP or CLI entry points, call their handlers through the same transport the real client uses.

### Goal and step files

- `test/journeys/<name>.journey.md` holds the goal.
- `test/journeys/<name>.journey.ts` holds the generated steps, with the `journey-covers` and `journey-source-hash` header.
- Keep Journey runs serial: one app, one database.

## Mutation testing

[Stryker](https://stryker-mutator.io) writes `reports/mutation/mutation.json`, which the scorer reads. Run it on one folder at a time (`--mutate 'src/rules/**'`); it is too slow to run over the whole repo on every PR.
