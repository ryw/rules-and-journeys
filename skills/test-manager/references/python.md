# Python recipe

## Rules: pytest

- Pure functions and dataclasses for the logic: no ORM session, no `os.environ`, no network.
- Test names are sentences (`test_fee_is_nothing_on_a_sale_under_20`). Use `pytest.mark.parametrize` with a few representative cases, never stacked `parametrize` decorators that multiply (that is a squared loop).
- **Builders:** `factory_boy` factories that `build()` objects without saving them, or plain constructors with defaults. With Pydantic models, build through the model so validation matches production.
- **Determinism:** pass a seeded `random.Random` into the code, and freeze time with `time-machine` or `freezegun`.

## Journeys: the whole app, a light database, recorded HTTP

- **Database:**
  - SQLite in memory when the app's SQL is portable (SQLAlchemy's `sqlite://`).
  - For Postgres-specific SQL, run PGlite through `pglite-socket`'s CLI (`pglite-server --port 0 --run "pytest …" --include-database-url`) and connect with a normal driver. Check the CLI flags against the version you install.
- **Driving the app:** FastAPI's or Starlette's `TestClient`, or Django's test `Client`, against the app in-process.
- **Third-party HTTP:** [vcrpy](https://github.com/kevin1024/vcrpy) or `pytest-recording`:
  - `record_mode="none"` in CI;
  - `"new_episodes"` to add requests;
  - `"all"` to re-record;
  - `--disable-recording` for live runs.
  - Scrub headers and bodies with `filter_headers` and `before_record_response`.

## Mutation testing

[mutmut](https://github.com/boxed/mutmut) or cosmic-ray on the rule packages.
