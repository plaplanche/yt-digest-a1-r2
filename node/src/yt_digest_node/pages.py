MARKER = "[…]"


def _words(paragraph: str) -> list[str]:
    return [] if paragraph == MARKER else paragraph.split()


def truncate(paragraphs: list[str], max_words: int) -> tuple[list[str], bool]:
    """Keeps the first and last `max_words // 2` words around a `[…]` paragraph."""
    total = sum(len(p.split()) for p in paragraphs)
    if total <= max_words:
        return paragraphs, False
    half = max_words // 2
    head: list[str] = []
    left = half
    for paragraph in paragraphs:
        if left <= 0:
            break
        words = paragraph.split()
        head.append(" ".join(words[:left]))
        left -= len(words)
    tail: list[str] = []
    left = half
    for paragraph in reversed(paragraphs):
        if left <= 0:
            break
        words = paragraph.split()
        tail.append(" ".join(words[-left:]))
        left -= len(words)
    return [*head, MARKER, *reversed(tail)], True


def paginate(paragraphs: list[str], page_words: int) -> list[str]:
    """Groups whole paragraphs into pages of at most `page_words` words, cutting long ones."""
    pages: list[list[str]] = []
    count = 0
    for paragraph in paragraphs:
        words = _words(paragraph)
        if pages and count + len(words) <= page_words:
            pages[-1].append(paragraph)
            count += len(words)
            continue
        if len(words) <= page_words:
            pages.append([paragraph])
            count = len(words)
            continue
        for i in range(0, len(words), page_words):
            chunk = words[i : i + page_words]
            pages.append([" ".join(chunk)])
            count = len(chunk)
    return ["\n\n".join(page) for page in pages]


def count_words(pages: list[str]) -> int:
    """Words of all pages together, the `[…]` marker excluded."""
    return sum(len(_words(p)) for page in pages for p in page.split("\n\n"))
