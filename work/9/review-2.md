# Review 2

- Reviewed commit: `dce796152bf779dd298c909dd4c5e1674f108863`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`node/src/yt_digest_node/extractors.py:81`) The yt-dlp extractor returns only the chosen track, which narrows the 5.2 contract

  Spec 5.2 says an extractor returns 'for a video id' the duration and 'its subtitle tracks'. Here `extract` also takes `langs`, and `YtDlpExtractor` runs the track choice itself (a second copy of `choose_track`'s rule at lines 101-109), so it returns at most one track. The fake extractor returns every track. The reason, avoiding one download per caption language, is sound and recorded in docs/decisions.md. Still, the choice rule now lives in two places that could drift apart. Calling `choose_track` on lightweight track descriptors before the download would keep a single source.

- **minor** (`node/src/yt_digest_node/extractors.py:126`) The `-orig` auto-caption filter goes beyond the literal choice rule

  When any `<lang>-orig` key exists, every other auto track is dropped, including machine translations into an earlier-preferred language. With langs fr,en on an English video, the strict 5.2 rule would pick the `fr` auto track; this code picks `en`. The behaviour is defensible and recorded in docs/decisions.md, and a test covers it. It is still an interpretation the spec does not state, so it is worth confirming with the spec owner.

- **minor** (`node/src/yt_digest_node/extractors.py:107`) Errors while downloading the subtitle (such as HTTP 429) propagate instead of mapping to `blocked`

  `ydl.urlopen` raises yt-dlp networking errors, not `DownloadError`. A rate-limit (429) on the timedtext request is a common form of YouTube blocking, and here it would crash the future command instead of returning `blocked`. Likewise, any non-bot `DownloadError` (a 429 during extraction or a network failure) becomes `unavailable`. This is documented as a decision but fits poorly with the `blocked` status.

- **minor** (`node/src/yt_digest_node/extractors.py:43`) The fake extractor crashes on a fixture directory without `meta.json` or without `duration`

  A missing `meta.json` raises FileNotFoundError, and a status-less meta without `duration` raises KeyError. Spec 5.2 says meta.json holds the duration, so these are bad fixtures, but the behaviour is untested and not written down.

- **minor** (`node/tests/test_extractors.py:218`) A test reads the private `_delay` attribute

  `test_delay_range_reaches_sleep` asserts on `extractor._delay`, which ties the test to an internal detail. It could instead check that the `YT_DELAY_SECONDS` value reaches the sleep function. There is also no test for the age-restricted or removed mappings that spec 5.2 lists, though the ticket only requires the private and bot cases.

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

  The change adds the extractor interface with `unavailable`/`blocked` or an `Extraction`; the fake extractor selected by FETCHER_FAKE_YTDLP=1 that reads FAKE_YTDLP_DIR/<id>/ and meta.json status and turns each <lang>.<manual|auto>.vtt file into a track; the yt-dlp extractor with the four spec options and no cookies, the YT_DELAY_SECONDS random delay (never applied on the fake path), and mapping of the bot check to `blocked` and other DownloadErrors to `unavailable`; and `choose_track` (manual then auto, in language order, None meaning no_transcript). Truncation, pages and the command are not touched. Deviations from the literal spec (the `langs` parameter, a single returned track, the `-orig` filter) are recorded in docs/decisions.md and reported as minor findings.

- met: The change is covered by tests that fail without it.

  node/tests/test_extractors.py imports the new module, so every test fails without the change. It covers every acceptance case: missing directory gives unavailable; meta status blocked/unavailable; fr.auto plus en.manual with fr,en gives English manual; only de.manual gives None/no_transcript; the stubbed yt-dlp options with no cookies; Private video gives unavailable; 'not a bot' gives blocked. It also tests the delay calls, the env selection and non-UTF-8 bodies. The reported test-node run passes.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Six dated 2026-10-16 lines record: yt-dlp as a runtime dependency and the injected module, sleep and delay; a null duration becoming 0 plus the quiet/no_warnings options; choose_track returning None; the `extract(video_id, langs)` interface with a single-track download and the delay before each request; the `-orig` handling; and the error mapping, exception propagation and UTF-8 replacement decoding. Not recorded: how the fake extractor behaves when meta.json is missing (minor).

## Proposed learnings (not decided)

- When an extractor needs the language order to avoid many downloads, record the interface change against the spec wording in decisions.md, as was done here, and keep one choice function instead of duplicating the rule.
- yt-dlp's `automatic_captions` lists machine translations under plain language keys; the original spoken-language track appears as `<lang>-orig`. Any 'auto tracks in language order' rule has to decide how to treat them.
- yt-dlp's `YoutubeDL.urlopen` raises networking errors, not `DownloadError`. Mapping only `DownloadError` leaves rate limits (429) during the subtitle download unmapped.
