# Review 1

- Reviewed commit: `7b22f602bc66ff222575e35fb4efb7940a1c2337`
- Reviewer model: claude-opus-5-5
- Verdict: **go**

## Findings

- **minor** (`node/tests/test_vtt.py:52`) Duplicate test

  `test_gap_of_1_9_does_not_split_and_2_0_does` makes exactly the same assertion as `test_annotations_and_entities` (same fixture, same expected list). It adds nothing. Narrow it so it checks only the paragraph boundaries, or remove it.

- **minor** (`node/src/yt_digest_node/vtt.py:83`) The `\n\n` paragraph join from step 5 is neither implemented nor tested

  Spec 5.4 step 5 says paragraphs are joined with one blank line. `clean_cues` returns a list, and docs/decisions.md line 12 defers the join to the caller. That is a reasonable choice, since 5.5 and 5.6 work on paragraphs, and it is documented. Still, the join rule is not tested yet. A later ticket must cover it to meet spec section 6 ("every rule of section 5 is covered by a test").

- **minor** (`node/src/yt_digest_node/vtt.py:33`) Some parsing choices are not recorded in decisions.md

  The parser makes a few choices that docs/decisions.md does not mention: blocks are split only on truly empty lines, so whitespace-only lines stay as cue text; the timing line is looked for only in the first two lines of a block (an optional identifier, then the timing line); a block that has no timing line is dropped silently; cues are kept in file order, even when they overlap. These are minor readings of the WebVTT format rather than real gaps in the spec, but writing them down would be more complete.

- **minor** (`node/src/yt_digest_node/vtt.py:59`) Step 2 is implemented, while the ticket context says sponsor cuts come next

  The ticket's 'Context' says step 2 comes with the next ticket, but its 'Decided spec' asks for a function that applies steps 2 to 5. Implementing midpoint dropping now (inclusive start, exclusive end) follows the decided spec and is tested (`test_segments_drop_cues_by_midpoint`), so this is not scope creep. The next ticket should not redo it.

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

  `parse_vtt` covers step 1: it skips header, NOTE, STYLE and REGION blocks and drops cue settings through the timing regex. `_clean_line` covers step 3 in spec order: tags, then entities, then `[…]`, then whitespace collapse and trim. `clean_cues` covers step 4 (empty lines and duplicates of the previous kept line, across cues) and step 5 (gap of at least 2000 ms between kept cues). It also covers step 2 (midpoint dropping), as the ticket's decided spec asks. There are no extractors, no SponsorBlock call, no truncation and no pages. The only extra is the three fixtures the ticket asks for.

- met: The change is covered by tests that fail without it.

  node/tests/test_vtt.py is a new file and imports a new module, so every test fails without the change. On the fixtures: auto.vtt checks rolling duplicates and inline timestamps or `<c>` tags; annotated.vtt checks `[Musique]` and `[Applause]` removal and `&amp;`, `&lt;`, `&quot;` decoding; the 1.9 s gap (4.000→5.900) does not split and the 2.0 s gap (7.000→9.000) does, so changing `>=` to `>` would fail. manual.vtt checks NOTE, STYLE and REGION blocks, an identifier, cue settings, voice and `<i>` tags, and whitespace collapse. Extra unit tests cover CRLF, short timestamps, float-exact gaps, keyword-prefixed identifiers and segment midpoints. The checks replayed by Ariane are green.

- met: Every choice the spec leaves open is written down in docs/decisions.md.

  Four dated lines were added: module location and the return type (a list of paragraphs, joined by the caller); the definition of a kept cue for the gap rule; a single tag regex applied before entity decoding, with annotations limited to one line; gap comparison in milliseconds, and a cue whose lines are all duplicates not counting as kept. Small parsing details are not listed (see the minor finding), but the spec does not really leave them open.

## Proposed learnings (not decided)

- When a function returns structured output (a list of paragraphs) instead of the joined text the spec describes, record which later ticket must implement and test the join, so the rule is not lost.
- Avoid tests that repeat another test's exact assertion under a different name: they inflate apparent coverage without isolating the rule they claim to test.
- Compare caption timing thresholds in integer milliseconds; float sums such as 1.3 + 2.0 can make an exact 2.0 s boundary fail.
