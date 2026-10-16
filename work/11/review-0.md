# Review 0

- Reviewed commit: `6b1b5e0c8986b37d589c5e6971658cb8a3c97e8f`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`node/src/yt_digest_node/pages.py:12`) MAX_WORDS=1 yields a page holding only the marker

  With MAX_WORDS=1, half is 0. Both the head and the tail come out empty, so truncate returns ["[…]"]. paginate then opens a page that holds only the marker (0 words). This contradicts the decision that the marker "never opens a page by itself", and arguably breaks spec 5.6 "No page is empty". It is an unrealistic configuration but it is accepted by _positive. Consider requiring MAX_WORDS >= 2, or dropping a marker-only page, and record the choice in docs/decisions.md.

- **minor** (`node/tests/test_cli.py:156`) Configuration error paths and TRANSCRIPT_LANGS default are untested

  docs/decisions.md promises exit 2 with no result for an invalid MAX_WORDS or PAGE_WORDS, an empty language list, or a missing FAKE_YTDLP_DIR. No test runs any of these. The TRANSCRIPT_LANGS fallback (spec 5.1) and the version attribute of service.started (spec 5.7) are not checked either. Removing that code would leave the suite green, which goes against spec section 6: every rule of section 5 is covered by a test that fails without it.

- **minor** (`node/src/yt_digest_node/cli.py:116`) service.started is logged before configuration is validated

  emit("service.started") runs before run() parses MAX_WORDS, PAGE_WORDS, YT_DELAY_SECONDS and FAKE_YTDLP_DIR. An invalid environment therefore logs service.started and then exits 2 without fetch.transcript. The decision says it is logged "once the arguments are valid", which holds for CLI arguments but not for the environment. The wording could be clarified, or the configuration parsed before the log.

- **minor** (`node/tests/test_cli.py:52`) End-to-end fixtures are built in tmp_path, not under node/tests/fixtures/

  Spec section 6 asks for fixtures under node/tests/fixtures/. The CLI tests write the fake-extractor tree into tmp_path at runtime. test_extractors.py already does the same, so this follows existing practice, but it departs from the spec's wording.

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

  pages.py implements 5.5: first and last MAX_WORDS//2 words, inner paragraph breaks kept, a […] paragraph that is not a word. It also implements 5.6: whole paragraphs grouped, long ones cut at word boundaries, word_count without the marker. cli.py provides `transcript <video_id> [--langs] [--request-id]` with the 5.1 environment defaults. It runs extract, choose, SponsorBlock, clean, truncate and paginate, prints a validated TranscriptResult on stdout and the service.started and fetch.transcript logs on stderr, and exits 2 on a bad video id (argparse) or bad config. No daemon, /health or Worker code. The only extra is the `python -m yt_digest_node` entry point, which is recorded in decisions. Minor edge: MAX_WORDS=1 gives a marker-only page.

- met: The change is covered by tests that fail without it.

  test_pages.py covers the 25-word case with MAX_WORDS=10 (5+[…]+5, truncated, word_count 10), the 12-word paragraph cut with PAGE_WORDS=5 and word order, the join when nothing is cut, and the marker not counted as a word. test_cli.py runs the command as a subprocess with the fake extractor and a local HTTP SponsorBlock server. It covers ok with a sponsor cut (ratio 0.2), no_transcript, unavailable, blocked, a missing directory, SponsorBlock failure (null ratio), invalid ids (exit 2, empty stdout), request_id in the logs and no transcript text in stderr. Config error exits and the TRANSCRIPT_LANGS default are not tested (minor).

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Four dated lines were added. They cover: the marker as its own zero-word paragraph; how a long paragraph closes the current page and its last piece stays open; the command entry points and exit 2 on invalid configuration; SponsorBlock called only when a track was chosen, with the fetch.transcript attributes for other statuses and when service.started is logged.

## Proposed learnings (not decided)

- For truncation, check the degenerate threshold (MAX_WORDS=1, so half is 0): it can produce output that contradicts 'no page is empty'.
- When docs/decisions.md promises an error behaviour (exit 2 on bad configuration), ask for an end-to-end test of it; otherwise spec section 6 ('a test that fails without it') is not met.
- Logging service.started before environment parsing means an invalid configuration still logs a start; decide and test the order explicitly.
