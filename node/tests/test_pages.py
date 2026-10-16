from yt_digest_node.pages import MARKER, count_words, paginate, truncate


def words(n: int, start: int = 0) -> str:
    return " ".join(f"w{i}" for i in range(start, start + n))


def test_truncate_keeps_head_and_tail() -> None:
    paragraphs, truncated = truncate([words(25)], 10)
    assert truncated
    assert paragraphs == [words(5), MARKER, words(5, 20)]
    assert count_words(paginate(paragraphs, 100)) == 10


def test_truncate_keeps_inner_paragraph_breaks() -> None:
    paragraphs, truncated = truncate([words(3), words(10, 3), words(3, 13)], 8)
    assert truncated
    assert paragraphs == [words(3), words(1, 3), MARKER, words(1, 12), words(3, 13)]


def test_truncate_leaves_short_text() -> None:
    assert truncate([words(10)], 10) == ([words(10)], False)


def test_pages_group_paragraphs_and_cut_long_ones() -> None:
    paragraphs = [words(3), words(2, 3), words(3, 5), words(12, 8)]
    pages = paginate(paragraphs, 5)
    assert pages[:2] == [f"{words(3)}\n\n{words(2, 3)}", words(3, 5)]
    assert all(len(p.split()) <= 5 for p in pages)
    assert " ".join(pages).split() == words(20).split()


def test_pages_join_back_without_cut() -> None:
    paragraphs = [words(3), words(4, 3), words(2, 7)]
    assert "\n\n".join(paginate(paragraphs, 5)) == "\n\n".join(paragraphs)


def test_marker_is_not_a_word() -> None:
    pages = paginate([words(2), MARKER, words(2, 2)], 4)
    assert pages == [f"{words(2)}\n\n{MARKER}\n\n{words(2, 2)}"]
    assert count_words(pages) == 4
