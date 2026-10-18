# Review 0

- Reviewed commit: `857bff2e55ec96dfcba76b0890cb794283baba56`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`worker/tests/worker/worker.test.ts:116`) Reset tests depend on test order and leave rows behind

  The beforeEach inserts node 'n' and invite 'a@b' with fixed primary keys. The 'does nothing when unauthenticated' test never cleans them up, and storage is not reset between tests. If that test ran before the reset test, or another test using the same fixture were added after it, the next beforeEach would fail on a primary-key conflict. Clean up in afterEach, or call /ops/reset at the end.

- **minor** (`worker/src/index.ts:50`) Bearer scheme matched case-sensitively

  `/^Bearer (.+)$/` refuses `bearer <token>`. RFC 7235 says auth schemes are case-insensitive. The spec only requires `Authorization: Bearer $OPS_TOKEN`, so this is not a violation, but a client that lowercases the scheme would get a 401.

- **minor** (`worker/src/index.ts:54`) Reset is not atomic across D1 and R2

  Order of writes: (1) one D1 batch deletes all ten tables in a single transaction, then (2) R2 is listed and deleted page by page. If R2 fails after the D1 batch, the reset is partial. Retrying is idempotent (deleting again is harmless), and authentication runs before any write, so this is acceptable for a local operator endpoint. Noted only for completeness.

- **minor** (`worker/package.json:23`) Vitest downgraded from ^5 to ^4.1.12 and the lockfile was generated with --legacy-peer-deps

  The decision is recorded in docs/decisions.md. `npm ci` in lint.sh and test-worker.sh still passes because the lockfile is complete. Later dependency changes have to repeat the --legacy-peer-deps workaround. Also, @cloudflare/vitest-pool-workers is marked deprecated (renamed to @cloudflare/vitest-plugin).

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- met: check e2e passes

  Replayed by Ariane: exit 0.

- met: The change does what the ticket and spec/lot-2.md (and spec/lot-1.md, which still applies) say, and nothing more.

  wrangler.toml sets main, compatibility_date, D1 `DB` (yt-digest, migrations_dir=migrations) and R2 `TRANSCRIPTS` (yt-digest-transcripts), with no account id or route. 0001_init.sql creates all ten tables and every column of 6.3, with hourly_budget default 60 and the (video_id, kind) primary key. index.ts: GET /health returns {status:'ok', version} from package.json; unknown routes and methods return 404 not_found with the 4.2 body and application/json. /ops/*: 404 when OPS_TOKEN is empty or unset, then the bearer check (SHA-256 digests compared in an XOR loop), and the body is never read before authentication. POST /ops/reset batch-deletes every table and every R2 key under transcripts/ (paginated), then returns {ok:true}. No out-of-scope routes, mocks or stack.sh were added. The lot 1 tests keep running in the `node` Vitest project.

- met: The change is covered by tests that fail without it.

  tests/worker/worker.test.ts runs under @cloudflare/vitest-pool-workers on Miniflare's D1 and R2, with migrations applied in setup.ts. It covers: the columns of every table via pragma_table_info, defaults and keys, /health with the package version, 404 not_found for an unknown route and for POST /health (validated against error.schema.json), 401 for a missing, wrong, Basic or empty bearer with and without a malformed body, 404 for an empty or unset OPS_TOKEN, and reset emptying all tables and transcripts/ objects while keeping other prefixes and leaving data untouched when unauthenticated. Without the change, none of these routes, bindings or tables exist.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Three dated lines added: the Vitest project split, the version pin and --legacy-peer-deps; the placeholder database_id, the constant-time compare method and 404 for an authenticated unknown ops route; the single migration, the NOT NULL policy and R2 objects outside transcripts/ being kept on reset.

## Proposed learnings (not decided)

- Tests that use the vitest-pool-workers pool share storage across a file unless isolation is configured: insert fixtures with unique keys, or clean up in afterEach.
- When a lockfile needs --legacy-peer-deps, record it in docs/decisions.md and check that the plain `npm ci` in the check scripts still succeeds.
