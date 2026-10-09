from app.library.sources import _guess_mime_type


def test_text_formats_do_not_depend_on_host_mime_table() -> None:
    assert _guess_mime_type("reading.md") == "text/markdown"
    assert _guess_mime_type("NOTES.MARKDOWN") == "text/markdown"
    assert _guess_mime_type("notes.txt") == "text/plain"
    assert _guess_mime_type("scan.pdf") == "application/pdf"
