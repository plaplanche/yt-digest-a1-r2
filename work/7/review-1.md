# Review 1

- Reviewed commit: `5e946d8672d56c9f1beb73fbe8f0bdb30d98ee20`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`node/tests/test_sponsorblock.py:88`) Log level of sponsorblock.call is never asserted

  docs/decisions.md says the `sponsorblock.call` line is `info` for `ok`/`none` and `warn` for `error`, but no test checks `line["level"]`. If the level expression were inverted or set to a constant, every test would still pass. The ticket asks for the 'right log line' in each case, so the 200/404/500/refused tests should assert the level too.

- **minor** (`node/tests/test_sponsorblock.py:157`) Midpoint edge test repeats an existing test and does not depend on this change

  The midpoint rule lives in `vtt.clean_cues` (`start <= middle < end`, vtt.py:58), which is unchanged here, and node/tests/test_vtt.py:73-76 already tests both edges. `test_midpoint_edges` passes without this diff. That is acceptable because the decision says step 2 reuses `clean_cues`, but the test adds no coverage and belongs next to the existing one in test_vtt.py, if anywhere.

- **minor** (`node/src/yt_digest_node/sponsorblock.py:30`) Booleans and reversed segments are accepted silently

  `float(True)` succeeds, so `{"segment": [true, 5]}` is parsed as (1.0, 5.0) with state `ok`. A segment where start > end is also kept in `segments`; `sponsor_ratio` and the midpoint rule then ignore it. Neither breaks the spec, but the 'malformed body counts as error' decision only covers non-finite bounds, so these cases are taken without being written down.

- **minor** (`node/src/yt_digest_node/sponsorblock.py:53`) urlopen honours proxy environment variables

  `urllib.request.urlopen` uses `HTTP(S)_PROXY` from the environment. With a proxy set and no `no_proxy` entry for 127.0.0.1, the local-server tests may go through the proxy, which can make them flaky depending on the environment. The behaviour is reasonable in production but is not listed among the urllib choices in docs/decisions.md.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  `fetch_segments` calls `{base}/api/skipSegments?videoID=..&categories=["sponsor","selfpromo","interaction"]` with the list URL-encoded (spec 5.3) and a 10 s timeout. It maps 200 to ok with segments, 404 to none, and any other status or a network error (status 0) to error with no segments. It logs `sponsorblock.call` with status, segments and duration_ms (spec 4.2), plus video_id and an optional request_id. `sponsor_ratio` takes the union, clips it to [0, duration], rounds to 3 decimals and returns 0 with no segment (spec 5.3). The midpoint cut reuses `clean_cues` (vtt.py:56-58). It does not touch extractors, truncation, pages or the command.

- met: The change is covered by tests that fail without it.

  node/tests/test_sponsorblock.py imports the new module, so every test fails without it. It runs against a local HTTPServer and covers 200 with segments (path and query checked), 404, 500, connection refused (status 0), a malformed or truncated body, a garbage status line, non-finite bounds and the 10 s timeout. The ratio tests cover overlap, clipping past the end and before 0, rounding, and no segments. Gaps: the log level is not asserted, and the midpoint test duplicates test_vtt.py.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Three dated 2026-10-16 lines record: urllib and the function signature, a malformed 200 counting as error, the info/warn log levels, ratio 0 for a non-positive duration, reuse of clean_cues for step 2, the timeout as a per-socket-operation limit, redirects being followed, non-finite bounds counting as error, and HTTPException counting as a network error. Minor cases not recorded: booleans and reversed segments are accepted, and proxy environment variables are honoured.

## Proposed learnings (not decided)

- When a decision fixes a log level for each outcome, assert `line["level"]` in the tests; otherwise the decision is untested.
- Before writing a test for an acceptance criterion, check whether existing tests already cover it (here, the midpoint edges in test_vtt.py), and extend those instead of duplicating them.
- Tests that hit a local HTTP server through urllib can be affected by proxy environment variables; consider an opener with an empty ProxyHandler, or document that proxies are honoured.
