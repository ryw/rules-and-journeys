# Ruby recipe (where this started)

## Rules: RSpec

- Plain Ruby objects and modules for the logic: no ActiveRecord in the rule, no `Rails.application`, no `ENV`.
- `describe`/`it` sentences, and run with `--format documentation` so the output reads as a spec.
- **No call assertions on your own collaborators.** `expect(x).to receive(:y)` and `have_received` on your own classes restate the implementation; pass values in and assert on values out. Doubles stay for the boundary, if anywhere.
- **Builders:** `factory_bot` (`build`, not `create`, in Rules tests: nothing touches the database), or plain constructors with keyword defaults.
- Fast boots: keep Rules specs free of `rails_helper`, so they load in milliseconds without the framework.

## Journeys: the whole app, a light database, VCR

- **Database:** SQLite in memory when the app's SQL is portable. Otherwise use the real engine with transactional tests (`use_transactional_tests`), as close to "lightweight" as Postgres gets in Ruby.
- **Driving the app:** request specs (`type: :request`) for APIs, or system specs for the few golden paths that must go through the browser. Cucumber fits when non-developers review the goals; keep its steps high level.
- **Third-party HTTP:** [VCR](https://github.com/vcr/vcr) with WebMock.
  - `record: :none` in CI (replay only);
  - `:new_episodes` to add requests;
  - `:all` to re-record;
  - `VCR.turned_off` with `WebMock.allow_net_connect!` for live runs.
  - Filter secrets with `filter_sensitive_data`.
- **Determinism:** `travel_to` for time, and `srand` or a seeded `Random` passed into the code.

## Mutation testing

[mutant](https://github.com/mbj/mutant) on the rule namespaces.
