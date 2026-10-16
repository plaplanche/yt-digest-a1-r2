# Review 0

- Reviewed commit: `ab335f282637023203cf64a548a3bbd5749941f7`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`node/src/yt_digest_node/sponsorblock.py:56`) Malformed or truncated HTTP responses escape the client instead of becoming `error`

  The handler catches `HTTPError`, then `(OSError, ValueError, KeyError, TypeError)`. `http.client.HTTPException` subclasses are not `OSError`: `IncompleteRead` (body shorter than Content-Length, or a broken chunked body during `response.read()`), `BadStatusLine` with a garbage status line, `LineTooLong` and `UnknownProtocol` all propagate. Spec 5.3 says that 'anything else, or a network error' gives no segments and `sponsorblock` = `error', that 'the result is otherwise produced normally', and that 'each call logs `sponsorblock.call`'. In any of these cases the command crashes and no log line is written. Fix: also catch `http.client.HTTPException`, and add a local-server test that sends a short body or a bad status line.

- **minor** (`node/src/yt_digest_node/sponsorblock.py:47`) The 10 s timeout is per socket operation, and nothing records this choice

  `urlopen(timeout=10)` limits each blocking socket operation, not the whole call. A server that sends data slowly can keep the call running well past 10 s. Spec 5.3 only says 'timeout 10 s', so this reading is an open choice, and it is missing from docs/decisions.md. No test checks the timeout either, even a cheap one such as checking that `TIMEOUT_SECONDS` is passed.

- **minor** (`node/src/yt_digest_node/sponsorblock.py:28`) Non-finite segment bounds are accepted

  `json.loads` accepts `NaN` and `Infinity`, and `float()` keeps them. A `[NaN, NaN]` segment then gives `min(duration, nan)` = duration and `max(0, nan)` = 0, so `sponsor_ratio` comes out as 1.0, and `clean_cues` behaves unpredictably. Rejecting non-finite values (or treating them as `error`) would be safer.

- **minor** (`node/src/yt_digest_node/sponsorblock.py:53`) The HTTPError response is never closed

  The `HTTPError` caught for 404 and 500 holds an open response, and the code never closes it. Under CPython it is freed quickly, but this can trigger ResourceWarning in tests. `error.close()` would avoid it.

- **minor** (`node/tests/test_sponsorblock.py:109`) The midpoint test only re-tests existing code

  `clean_cues` and its midpoint rule were already in vtt.py and already tested in test_vtt.py (`test_segments_drop_cues_by_midpoint`). The new edge test is useful because it pins the inclusive start and the exclusive end. It does not fail without this change, but that is expected because the change adds no midpoint code.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  The URL, the encoded categories list, the 10 s timeout, the ok/none/error states, the `sponsorblock.call` attrs (status, or 0 on a network error, segments, duration_ms) and `sponsor_ratio` (union, clipping, 3 decimals, 0 with no segment) all match spec 5.3. Nothing out of scope was added. However, `http.client.HTTPException` errors (IncompleteRead, BadStatusLine) are not caught. Those network errors crash the call and no log line is written, which breaks the 'anything else, or a network error' rule of 5.3.

- **blocking** Definition of done not met: Every choice the spec leaves open is written down in docs/decisions.md.

  Two new lines record the urllib client and its signature, the malformed-200 → error rule, the info/warn levels, the duration ≤ 0 → 0 rule and the reuse of `clean_cues`. Missing: how the 10 s timeout is read (per socket operation, not the whole call), and that redirects are followed silently.

## Definition of done

- met: check lint passes

  Replayed by Ariane: exit 0.

- met: check contracts passes

  Replayed by Ariane: exit 0.

- met: check test-node passes

  Replayed by Ariane: exit 0.

- met: check test-worker passes

  Replayed by Ariane: exit 0.

- **not met**: The change does what the ticket and spec/lot-1.md say, and nothing more.

  The URL, the encoded categories list, the 10 s timeout, the ok/none/error states, the `sponsorblock.call` attrs (status, or 0 on a network error, segments, duration_ms) and `sponsor_ratio` (union, clipping, 3 decimals, 0 with no segment) all match spec 5.3. Nothing out of scope was added. However, `http.client.HTTPException` errors (IncompleteRead, BadStatusLine) are not caught. Those network errors crash the call and no log line is written, which breaks the 'anything else, or a network error' rule of 5.3.

- met: The change is covered by tests that fail without it.

  node/tests/test_sponsorblock.py runs a local HTTPServer and covers a 200 with segments (it also checks the query encoding and the log fields), a 404, a 500, a malformed 200 and a refused connection. It also covers the ratio with overlapping segments, clipping past the end and before 0, and rounding. The new module did not exist before, so these tests fail without it. The midpoint edges are tested, but the rule was already in the code. Gaps: no test for the timeout and none for a truncated or bad HTTP response.

- **not met**: Every choice the spec leaves open is written down in docs/decisions.md.

  Two new lines record the urllib client and its signature, the malformed-200 → error rule, the info/warn levels, the duration ≤ 0 → 0 rule and the reuse of `clean_cues`. Missing: how the 10 s timeout is read (per socket operation, not the whole call), and that redirects are followed silently.

## Proposed learnings (not decided)

- With urllib, catch `http.client.HTTPException` along with `OSError`: IncompleteRead and BadStatusLine are not OSError subclasses.
- `urlopen(timeout=...)` limits each socket operation, not the whole request; write down which reading a spec's 'timeout N s' gets.
- When a ticket asks for tests of rules that already exist, check them against the existing test file so the new tests do more than repeat old ones.
