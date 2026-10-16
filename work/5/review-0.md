# Review 0

- Reviewed commit: `e106ea248f7253368ca07f3f703995b544dedec3`
- Reviewer model: claude-opus-5-5
- Verdict: **no-go** (the reviewer answered no-go)

## Findings

- **blocking** (`node/src/yt_digest_node/vtt.py:73`) The 2.0 s paragraph gap uses float subtraction, so some exact 2.0 s gaps don't start a paragraph

  `_seconds` turns millisecond timestamps into binary floats, and the gap is computed as `cue.start - previous_end >= PARAGRAPH_GAP`. For some timestamp pairs the difference comes out just under 2.0. Example: a cue ending at 00:00:01.300 and the next starting at 00:00:03.300 give 3.3 - 1.3 = 1.9999999999999998, so no new paragraph starts. Spec 5.4 step 5 says 'at least 2.0 s', and the ticket's acceptance criterion is this exact boundary. The fixture only passes because 9.0 - 7.0 happens to be exact. VTT times are whole milliseconds, so the fix is to keep start and end as integer milliseconds (or round the gap to milliseconds) before comparing. Add a test with a pair like 1.300 / 3.300 that fails today.

- **minor** (`node/src/yt_digest_node/vtt.py:36`) Prefix match on WEBVTT/NOTE/STYLE/REGION can drop real cues, and no test exercises the check

  `lines[0].startswith(_IGNORED_BLOCKS)` also matches a cue whose identifier starts with one of these words (e.g. `NOTE1` or `REGION-intro` followed by a timing line), and that cue is silently dropped. The WebVTT keywords must be followed by a space, tab or end of line. The fixtures' NOTE, STYLE and REGION blocks have no timing line, so the parser would skip them even without this check: no test fails if it is removed. Match the keyword followed by whitespace or end of line, and add a test where a NOTE block would otherwise parse as a cue, plus one with a cue identifier like `NOTE1`.

- **minor** (`docs/decisions.md:13`) A whole cue lost to duplicate removal counts as not kept, which can split auto tracks

  With this recorded choice, a cue whose lines are all rolling duplicates is not a 'kept cue'. If an auto caption stays on screen across a long cue (e.g. 0–2 s 'x', then 2–5 s 'x' again, then 5–6 s 'y'), a paragraph starts even though the captions never paused. This is defensible and written down. Still, check that it is the intended reading of step 5 before the pages and truncation tickets build on it.

- **minor** (`node/tests/test_vtt.py:47`) The annotations test checks a prefix, not the full output

  `paragraphs[0].startswith(...)` and `'[' not in ...` are weaker than an exact-equality check. The next test compares the full output anyway, so this one adds little.

- **blocking** Definition of done not met: The change does what the ticket and spec/lot-1.md say, and nothing more.

  Scope is right: parse_vtt and clean_cues, steps 1–5, and the three fixtures, with no extractors, truncation or pages. But step 5's 'at least 2.0 s' is not always met because the gap is a float subtraction: end 1.300 / start 3.300 gives 1.9999999999999998 and no new paragraph (vtt.py:73).

- **blocking** Definition of done not met: The change is covered by tests that fail without it.

  Cue settings, inline tags and timestamps, voice tags, entities, annotations, whitespace collapse, empty lines, rolling duplicates, the 1.9 s and 2.0 s gaps, and the segment midpoint bounds are all tested on the fixtures or inline cues. But the NOTE/STYLE/REGION check is never exercised (removing it fails no test), and no test covers a 2.0 s gap that is not exact in floating point.

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

  Scope is right: parse_vtt and clean_cues, steps 1–5, and the three fixtures, with no extractors, truncation or pages. But step 5's 'at least 2.0 s' is not always met because the gap is a float subtraction: end 1.300 / start 3.300 gives 1.9999999999999998 and no new paragraph (vtt.py:73).

- **not met**: The change is covered by tests that fail without it.

  Cue settings, inline tags and timestamps, voice tags, entities, annotations, whitespace collapse, empty lines, rolling duplicates, the 1.9 s and 2.0 s gaps, and the segment midpoint bounds are all tested on the fixtures or inline cues. But the NOTE/STYLE/REGION check is never exercised (removing it fails no test), and no test covers a 2.0 s gap that is not exact in floating point.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Three dated lines record: the module location and signatures (segments as (start, end) tuples, paragraphs returned as a list with joining left to the caller), the meaning of 'kept cue' for the gap, and tag removal before entity decoding with annotations not spanning lines. The keyword-prefix matching for ignored blocks is unrecorded, but it is an implementation detail rather than an open spec choice.

## Proposed learnings (not decided)

- Compute and compare VTT times in integer milliseconds; float seconds break 'at least N s' boundaries (3.3 - 1.3 < 2.0).
- A boundary test passing on one fixture value (9.0 - 7.0) does not prove the boundary; add a test with a value that is not exact in floating point.
- Check that each guard in a parser is the only thing making its test pass; blocks with no timing line are skipped anyway, so the NOTE/STYLE/REGION check went untested.
