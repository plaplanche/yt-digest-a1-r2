import argparse
import os
import re
import sys
import time
from collections.abc import Sequence
from importlib.metadata import version

from yt_digest_node.contracts.transcript_result import TranscriptResult
from yt_digest_node.extractors import choose_track, make_extractor
from yt_digest_node.log import emit
from yt_digest_node.pages import count_words, paginate, truncate
from yt_digest_node.sponsorblock import SponsorBlockState, fetch_segments, sponsor_ratio
from yt_digest_node.vtt import clean_cues, parse_vtt

_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def _video_id(value: str) -> str:
    if not _VIDEO_ID.fullmatch(value):
        raise argparse.ArgumentTypeError(f"invalid video id: {value!r}")
    return value


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="yt-digest-node")
    commands = parser.add_subparsers(dest="command", required=True)
    transcript = commands.add_parser("transcript")
    transcript.add_argument("video_id", type=_video_id)
    transcript.add_argument("--langs")
    transcript.add_argument("--request-id")
    return parser


def _positive(env: dict[str, str], name: str, default: int) -> int:
    value = int(env.get(name, default))
    if value < 1:
        raise ValueError(f"{name} must be at least 1")
    return value


def run(
    video_id: str, langs: Sequence[str], request_id: str | None, env: dict[str, str]
) -> TranscriptResult:
    max_words = _positive(env, "MAX_WORDS", 60000)
    page_words = _positive(env, "PAGE_WORDS", 12000)
    base_url = env.get("SPONSORBLOCK_URL", "https://sponsor.ajay.app")
    extractor = make_extractor(env)
    started = time.monotonic()
    ids: dict[str, str] = {"video_id": video_id}
    if request_id is not None:
        ids["request_id"] = request_id

    result = TranscriptResult(
        video_id=video_id,
        status="no_transcript",
        lang=None,
        source=None,
        word_count=0,
        truncated=False,
        sponsor_ratio=None,
        pages=[],
    )
    state: SponsorBlockState = "none"
    extraction = extractor.extract(video_id, langs)
    if isinstance(extraction, str):
        result.status = extraction
    else:
        track = choose_track(extraction.tracks, langs)
        if track is not None:
            sponsorblock = fetch_segments(base_url, video_id, request_id)
            state = sponsorblock.state
            paragraphs = clean_cues(parse_vtt(track.vtt), sponsorblock.segments)
            paragraphs, truncated = truncate(paragraphs, max_words)
            pages = paginate(paragraphs, page_words)
            result = TranscriptResult(
                video_id=video_id,
                status="ok",
                lang=track.lang,
                source=track.kind,
                word_count=count_words(pages),
                truncated=truncated,
                sponsor_ratio=(
                    None
                    if state == "error"
                    else sponsor_ratio(sponsorblock.segments, extraction.duration)
                ),
                pages=pages,
            )
    emit(
        "fetch.transcript",
        attrs={
            "outcome": result.status,
            "source": result.source,
            "words": result.word_count,
            "pages": len(result.pages),
            "sponsor_ratio": result.sponsor_ratio,
            "sponsorblock": state,
            "duration_ms": round((time.monotonic() - started) * 1000),
        },
        **ids,
    )
    return result


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    env = dict(os.environ)
    raw_langs = (
        args.langs if args.langs is not None else env.get("TRANSCRIPT_LANGS", "fr,en")
    )
    langs = [lang.strip() for lang in raw_langs.split(",") if lang.strip()]
    if not langs:
        print("yt-digest-node: no language given", file=sys.stderr)
        return 2
    emit("service.started", attrs={"version": version("yt-digest-node")})
    try:
        result = run(args.video_id, langs, args.request_id, env)
    except ValueError as error:
        print(f"yt-digest-node: {error}", file=sys.stderr)
        return 2
    sys.stdout.write(result.model_dump_json() + "\n")
    return 0


def cli() -> None:
    sys.exit(main())
