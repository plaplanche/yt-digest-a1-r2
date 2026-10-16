import html
import re
from dataclasses import dataclass

Segment = tuple[float, float]

PARAGRAPH_GAP = 2.0

_TIMING = re.compile(
    r"^\s*((?:\d+:)?\d+:\d{2}\.\d{3})\s+-->\s+((?:\d+:)?\d+:\d{2}\.\d{3})(?:\s.*)?$"
)
_TAG = re.compile(r"<[^>]*>")
_ANNOTATION = re.compile(r"\[[^\]]*\]")
_IGNORED_BLOCKS = ("WEBVTT", "NOTE", "STYLE", "REGION")


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    lines: tuple[str, ...]


def _seconds(stamp: str) -> float:
    total = 0.0
    for part in stamp.split(":"):
        total = total * 60 + float(part)
    return total


def parse_vtt(text: str) -> list[Cue]:
    cues: list[Cue] = []
    for block in re.split(r"\n{2,}", text.replace("\r\n", "\n").replace("\r", "\n")):
        lines = block.strip("\n").split("\n")
        if not lines or lines[0].startswith(_IGNORED_BLOCKS):
            continue
        for i, line in enumerate(lines[:2]):
            match = _TIMING.match(line)
            if match:
                cues.append(
                    Cue(_seconds(match[1]), _seconds(match[2]), tuple(lines[i + 1 :]))
                )
                break
    return cues


def _clean_line(line: str) -> str:
    line = html.unescape(_TAG.sub("", line))
    return " ".join(_ANNOTATION.sub("", line).split())


def _in_segment(cue: Cue, segments: list[Segment]) -> bool:
    middle = (cue.start + cue.end) / 2
    return any(start <= middle < end for start, end in segments)


def clean_cues(cues: list[Cue], segments: list[Segment]) -> list[str]:
    paragraphs: list[list[str]] = []
    previous_end: float | None = None
    last_line: str | None = None
    for cue in cues:
        if _in_segment(cue, segments):
            continue
        kept: list[str] = []
        for raw in cue.lines:
            line = _clean_line(raw)
            if line and line != last_line:
                kept.append(line)
                last_line = line
        if not kept:
            continue
        if previous_end is None or cue.start - previous_end >= PARAGRAPH_GAP:
            paragraphs.append([])
        paragraphs[-1].extend(kept)
        previous_end = cue.end
    return [" ".join(lines) for lines in paragraphs]
