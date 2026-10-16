# Review 1

- Reviewed commit: `96e0f5b0e6fea4d61bddc8d641b297b67633379b`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`node/src/yt_digest_node/extractors.py:100`) yt-dlp extractor downloads every subtitle language, including all auto-translated captions, with a 2-5 s delay before each one

  For YouTube, `info['automatic_captions']` lists the original auto track plus machine translations into about 150 languages, and each has a `vtt` format. The loop calls `self._wait()` and `ydl.urlopen` for every language, even though `choose_track` will use only one of them. With the default `YT_DELAY_SECONDS=2-5`, a single video would mean about 150 subtitle requests and several minutes of sleeping. That many requests is very likely to get rate-limited (HTTP 429). Because any `RequestError` makes the whole extraction fail, the result would come back `blocked` even when the manual track was already fetched. The tests never catch this because the stub returns one or two languages. Fix: pass the language order to the extractor, or return tracks whose text is fetched only when chosen, so that only the chosen track is downloaded. The 'fetches the vtt entry of each language' line in docs/decisions.md writes this design down but does not make it workable.

- **minor** (`node/src/yt_digest_node/extractors.py:101`) Machine-translated auto captions match the requested languages exactly

  yt-dlp lists translated auto captions under plain language keys (for example `fr` translated from an English original, while the original appears as `en` or `en-orig`). With langs `fr,en`, a video that has only English auto captions would get a machine translation into French instead of the original English. The spec does not settle this; it is worth a decision line.

- **minor** (`node/src/yt_digest_node/extractors.py:119`) Error mapping goes beyond the spec's 'bot check' for blocked

  The spec maps only the bot check to `blocked`. 'Too Many Requests' and HTTP 403/429 also become `blocked`. This is documented in docs/decisions.md and defensible, but it is an addition to the spec. Also, every other `DownloadError` (network failures, missing formats) becomes `unavailable`, not just private, age-restricted or removed videos.

- **minor** (`node/src/yt_digest_node/extractors.py:106`) Non-UTF-8 subtitle body raises instead of mapping to a failure

  `body.decode('utf-8')` raises `UnicodeDecodeError`, which propagates out of `extract()`. That is an unhandled crash path rather than a result status.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  The fake extractor, the env selection, the options, the error mapping and `choose_track` match section 5.2. However, the yt-dlp extractor fetches the VTT of every listed language, including about 150 auto-translated captions on real YouTube, each preceded by the random delay. This makes the default extractor impractical and likely to be rate-limited. It also adds mappings beyond the spec (429/403 and 'Too Many Requests' become blocked).

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

  The fake extractor, the env selection, the options, the error mapping and `choose_track` match section 5.2. However, the yt-dlp extractor fetches the VTT of every listed language, including about 150 auto-translated captions on real YouTube, each preceded by the random delay. This makes the default extractor impractical and likely to be rate-limited. It also adds mappings beyond the spec (429/403 and 'Too Many Requests' become blocked).

- met: The change is covered by tests that fail without it.

  node/tests/test_extractors.py imports the new module and covers all the acceptance cases: missing directory gives unavailable; meta status blocked/unavailable; fr.auto + en.manual gives en manual; only de.manual gives None (no_transcript); stub tests for the options, no cookies, private video gives unavailable, bot check gives blocked, request-error mapping and the delay count.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Six dated lines cover: the yt-dlp dependency and injection, extract_info/urlopen, exact language matching, the error mapping, missing duration becoming 0, quiet/no_warnings, a required meta.json, ignored file names, and choose_track returning None for no_transcript. Not covered: how machine-translated auto captions are handled.

## Proposed learnings (not decided)

- Stubs for yt-dlp should mirror real YouTube metadata shapes (for example, automatic_captions with many translated languages); otherwise scaling problems in per-track fetching go unnoticed.
- When the spec requires a delay before each external request, check how many requests one operation makes in production, not just in the stub.
