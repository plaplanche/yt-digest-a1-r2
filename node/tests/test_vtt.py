from pathlib import Path

from yt_digest_node.vtt import Cue, clean_cues, parse_vtt

FIXTURES = Path(__file__).parent / "fixtures" / "vtt"


def load(name: str) -> list[Cue]:
    return parse_vtt((FIXTURES / name).read_text())


def test_parse_ignores_header_blocks_and_settings() -> None:
    cues = load("manual.vtt")
    assert [(c.start, c.end) for c in cues] == [(1.0, 3.0), (3.5, 5.0), (7.0, 9.0)]
    assert cues[0].lines == ("Hello and welcome.",)
    assert cues[2].lines == ("A new paragraph starts here.", "<i>With   two lines.</i>")


def test_parse_short_timestamps_and_hours() -> None:
    cues = parse_vtt(
        "WEBVTT\n\n01:02:03.500 --> 01:02:04.000\na\n\n00:05.250 --> 00:06.000\nb\n"
    )
    assert [(c.start, c.end) for c in cues] == [(3723.5, 3724.0), (5.25, 6.0)]


def test_parse_crlf() -> None:
    cues = parse_vtt("WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nhi\r\n")
    assert cues == [Cue(1.0, 2.0, ("hi",))]


def test_manual_track() -> None:
    assert clean_cues(load("manual.vtt"), []) == [
        "Hello and welcome. This is a test.",
        "A new paragraph starts here. With two lines.",
    ]


def test_auto_track_removes_rolling_duplicates_and_inline_timestamps() -> None:
    assert clean_cues(load("auto.vtt"), []) == [
        "hello everyone today we start now bye all"
    ]


def test_annotations_and_entities() -> None:
    paragraphs = clean_cues(load("annotated.vtt"), [])
    assert paragraphs[0].startswith("Tom & Jerry <3 cheese")
    assert "[" not in "".join(paragraphs)
    assert paragraphs[1] == 'Gap of 2.0 seconds splits. "ok"'


def test_gap_of_1_9_does_not_split_and_2_0_does() -> None:
    assert clean_cues(load("annotated.vtt"), []) == [
        "Tom & Jerry <3 cheese Gap of 1.9 seconds stays.",
        'Gap of 2.0 seconds splits. "ok"',
    ]


def test_gap_is_measured_from_kept_cues() -> None:
    cues = [Cue(0, 1, ("a",)), Cue(1.5, 2.5, ("[Music]",)), Cue(2.9, 4, ("b",))]
    assert clean_cues(cues, []) == ["a b"]
    cues = [Cue(0, 1, ("a",)), Cue(1.5, 2.5, ("[Music]",)), Cue(3.0, 4, ("b",))]
    assert clean_cues(cues, []) == ["a", "b"]


def test_duplicate_is_compared_with_last_kept_line() -> None:
    cues = [Cue(0, 1, ("a", "[x]", "a", "b")), Cue(1, 2, ("b", "a"))]
    assert clean_cues(cues, []) == ["a b a"]


def test_segments_drop_cues_by_midpoint() -> None:
    cues = [Cue(0, 2, ("a",)), Cue(2, 4, ("b",)), Cue(4, 6, ("c",))]
    # midpoints 1, 3, 5: start inclusive, end exclusive
    assert clean_cues(cues, [(3.0, 5.0)]) == ["a", "c"]
    assert clean_cues(cues, [(1.0, 3.0)]) == ["b c"]
    assert clean_cues(cues, [(0.0, 6.0)]) == []


def test_empty_input() -> None:
    assert clean_cues([], []) == []
    assert parse_vtt("WEBVTT\n") == []
