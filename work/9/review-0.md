# Review 0

- Reviewed commit: `3c505e4acc6f8d201b2315f7c6d741e59d70475e`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`node/src/yt_digest_node/extractors.py:106`) Subtitle-fetch errors from yt-dlp escape the extractor instead of mapping to a failure

  Only `yt_dlp.utils.DownloadError` is caught. The subtitle bodies are fetched with `ydl.urlopen(item['url'])`, and that call raises yt-dlp's networking errors (`yt_dlp.networking.exceptions.HTTPError`, `TransportError`), not `DownloadError`. A 429 from YouTube's timedtext endpoint is the most common way the bot check shows up when fetching subtitles, so this case is the norm, not a corner case. Today it propagates as an uncaught exception. Spec 5.2 says the extractor returns either `unavailable`/`blocked` or the result, and that it maps yt-dlp's errors (with `blocked` for the bot check). Spec 5 says the command exits 0 and prints a result whatever the status. The decisions.md line 'other exceptions propagate' writes the gap down but does not close it. The fix: map the networking errors raised while fetching tracks (at least HTTP 429/403 to `blocked`) and add a stub test where `urlopen` raises.

- **minor** (`node/tests/test_extractors.py:55`) `no_transcript` acceptance test checks `None`, not `no_transcript`

  The ticket asks for this test: 'with only `de.manual.vtt`, `no_transcript`'. `choose_track` returns `None` and the test checks that. Nothing in the change maps that to `no_transcript`, and decisions.md does not say that `None` stands for `no_transcript`. The test also builds the track in memory instead of reading a `de.manual.vtt` fixture. The same goes for the fr.auto/en.manual case: the fake-extractor parsing test and the choice test are separate, and no test goes from the fixture files to the choice.

- **minor** (`node/src/yt_digest_node/extractors.py:109`) Missing yt-dlp duration silently becomes 0 and is not recorded

  `float(info.get('duration') or 0)` turns a missing or null duration (live streams, premieres) into 0. Downstream, `sponsor_ratio` then becomes 0. The spec leaves this case open, and the choice is not written in docs/decisions.md. The extra `quiet`/`no_warnings` options are also missing from decisions.md.

- **minor** (`node/src/yt_digest_node/extractors.py:110`) Any non-bot DownloadError, network failures included, is reported as `unavailable`

  The spec limits `unavailable` to private, age-restricted and removed videos. With this code, DNS errors, timeouts and HTTP 429 during `extract_info` (which yt-dlp wraps in `DownloadError`) are reported as `unavailable`, which says the video is permanently gone. 429 is a rate limit or bot block, so it fits `blocked` better. The choice is written down, but consider mapping 429 / 'Too Many Requests' to `blocked`.

- **minor** (`node/tests/test_extractors.py:119`) The delay range is never checked as passed to sleep

  The test uses (0.0, 0.0) and only counts the sleep calls. Nothing shows that the `YT_DELAY_SECONDS` range reaches `random.uniform`, or that `make_extractor` passes the parsed env value (the test only checks the default type). For example, `YT_DELAY_SECONDS=1-1` should produce sleeps of 1.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  The interface, the fake extractor, the yt-dlp options without cookies, the per-request delay (none in the fake), the bot/private mapping and the manual-then-auto choice all match spec 5.2. However, yt-dlp errors raised by `ydl.urlopen` while fetching subtitles (e.g. a 429 bot block) are not mapped and propagate (extractors.py:106-112), so the extractor does not always return `unavailable`/`blocked` as 5.2 requires.

- **blocking** Definition of done not met: Every choice the spec leaves open is written down in docs/decisions.md.

  Three dated lines record the dependency, the stub injection, exact language matching, the error-string rule, that meta.json is required and that other file names are ignored. Not recorded: a missing/null yt-dlp duration becomes 0, the extra `quiet`/`no_warnings` options, and `choose_track` returning None to stand for `no_transcript`.

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

  The interface, the fake extractor, the yt-dlp options without cookies, the per-request delay (none in the fake), the bot/private mapping and the manual-then-auto choice all match spec 5.2. However, yt-dlp errors raised by `ydl.urlopen` while fetching subtitles (e.g. a 429 bot block) are not mapped and propagate (extractors.py:106-112), so the extractor does not always return `unavailable`/`blocked` as 5.2 requires.

- met: The change is covered by tests that fail without it.

  node/tests/test_extractors.py imports the new module `yt_digest_node.extractors`, so every test fails without the change. The tests cover a missing directory, the blocked/unavailable meta, track parsing, the choice order, None for de-only, the stubbed options/no cookies/download=False, the delay count, private to unavailable and bot to blocked. Gaps: there is no test of urlopen errors and no end-to-end test from fixture files to the choice.

- **not met**: Every choice the spec leaves open is written down in docs/decisions.md.

  Three dated lines record the dependency, the stub injection, exact language matching, the error-string rule, that meta.json is required and that other file names are ignored. Not recorded: a missing/null yt-dlp duration becomes 0, the extra `quiet`/`no_warnings` options, and `choose_track` returning None to stand for `no_transcript`.

## Proposed learnings (not decided)

- When reviewing a yt-dlp integration, check every call that touches the network (extract_info and ydl.urlopen): only extract_info wraps errors in DownloadError.
- An acceptance criterion that names a status value (e.g. `no_transcript`) should be checked against that value, or decisions.md should record what stands in for it.
- Delay injection tests should use a non-zero range to show that the configured range actually reaches the sleep function.
