# Review 0

- Reviewed commit: `371839d35ef386259aeea34765be4e8d3fcea026`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`node/src/yt_digest_node/daemon.py:100`) `--once` can send more than one heartbeat

  Spec section 9 says `--once` is "one heartbeat, one claim, the claimed jobs". `work(once=True)` calls `_heartbeat()` and then `cycle()`. `cycle()` calls `_heartbeat_if_due()` again before the claim and between the jobs of the batch. With `HEARTBEAT_SECONDS=0`, two heartbeats always go out before the claim. With the default of 60 s, a batch of slow real pipelines also sends extra heartbeats, and a failure of one of them is swallowed. The heartbeat between jobs should be limited to the loop mode.

- **minor** (`node/src/yt_digest_node/worker_client.py:59`) `http.client.HTTPException` is not treated as a network error

  `_post` catches `HTTPError`, `OSError` and `ValueError` only. A truncated or malformed reply raises `http.client.IncompleteRead` or `BadStatusLine`, which are `HTTPException`s and not `OSError`s. When that happens: (1) the call is not logged as a `worker.call` with status 0; (2) it is not retried on result or release; (3) in the loop, the daemon crashes with a Python traceback on stderr (not a JSON line) without releasing the claimed jobs. Section 9 wants network errors retried and stderr to hold only log lines.

- **minor** (`node/src/yt_digest_node/daemon.py:146`) `CLAIM_BATCH` accepts fractions; `POLL_SECONDS` accepts `inf`

  `int(_number(...))` accepts `CLAIM_BATCH=2.5` and silently truncates it to 2. `POLL_SECONDS=inf` is accepted, and the daemon then waits forever after an empty claim. The spec defines `CLAIM_BATCH` as an integer from 1 to 10, so a fraction should exit 2.

- **minor** (`node/src/yt_digest_node/worker_client.py:14`) The 30 s HTTP timeout is an open choice that is not recorded

  `TIMEOUT_SECONDS = 30` decides when a call to the Worker counts as a network error, which then triggers the retries. The spec leaves this value open, and it is not in docs/decisions.md.

- **minor** (`node/src/yt_digest_node/daemon.py:68`) No `fetch.transcript` line for a job whose pipeline raised

  Section 9 asks for one `fetch.transcript` per job. When `run()` raises (for example a bad `MAX_WORDS`), the daemon posts `error` but logs no `fetch.transcript` for that job. Lot 1 never reached that case because it exited 2. Either emit the event with outcome `error`, or record the choice in docs/decisions.md.

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

  `daemon.py` and `worker_client.py` implement section 9:
- variables and their defaults, exit 2 on a missing `WORKER_URL` or `NODE_TOKEN` before any request
- heartbeat with the optional fields omitted (`exclude_none` for heartbeat), then claim, the in-process `run()` per job, and a result with `outcome` = status and `transcript` only when `ok`; an exception gives `error`
- retries after 1, 2 and 4 s on network errors or 5xx for result and release only, no retry on 4xx
- `--once` exits 1 on a failed heartbeat or claim; in the loop, a 401 exits 1
- SIGTERM and SIGINT set a stop event: the job in progress posts its result, the others are released, exit 0
- one `worker.call` per attempt with `video_id`; the token is never logged

The generated contracts are used for every request and response. Nothing from OAuth or MCP is added. Remaining deviations are minor: extra heartbeats in `--once`, `HTTPException` not handled.

- met: The change is covered by tests that fail without it.

  `node/tests/test_daemon.py` runs the real CLI in a subprocess against a local fake Worker. It covers:
- `--once` sends heartbeat, claim and two results with the `ok` and `unavailable` outcomes and the transcript
- a pipeline exception gives `error`
- a 503 is retried, with logged statuses `[503, 200]`
- a 409 is not retried
- a claim 500 exits 1, a 401 exits 1
- a missing `NODE_TOKEN` or `WORKER_URL` exits 2 with no request
- SIGTERM posts the result and then releases the second lease, exit 0

Every stderr line is parsed as a `LogEvent`, and the token is absent. The e2e test `e2e/tests/node.api.spec.ts` (`api` project, matched by `*.api.spec.ts`) processes a queued fixture and reads `GET /ops/transcripts/nodedaemon1`. These tests cannot pass without the new `work` command.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Three dated lines record: the use of `urllib`; the plain stderr line and exit 2 for missing or invalid variables; non-fatal heartbeat and claim errors in the loop; dropped results and releases recovered by lease expiry; the heartbeat between jobs with `jobs_in_progress`; one `worker.call` per attempt. Minor gaps: the 30 s timeout and the missing `fetch.transcript` on a pipeline exception are not recorded (see the minor findings).

## Proposed learnings (not decided)

- With urllib, catching `OSError` alone misses `http.client.HTTPException` (`IncompleteRead`, `BadStatusLine`). Classify those as network errors too.
- When a spec gives a mode an exact count ("one heartbeat"), check every helper the mode reuses (here `cycle()`'s heartbeat-if-due) for extra calls.
- A daemon's own constants, such as the HTTP timeout, are spec-open choices and belong in docs/decisions.md.
