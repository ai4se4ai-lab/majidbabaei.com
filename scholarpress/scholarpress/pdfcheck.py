"""Structural PDF check: a usable, nonempty document."""
from __future__ import annotations

import io
import logging


def check_pdf(data: bytes) -> tuple[bool, int | None, str]:
    if not data or not data.lstrip()[:5] == b"%PDF-":
        return False, None, "missing %PDF- header"
    if b"%%EOF" not in data[-2048:]:
        return False, None, "missing end-of-file marker (truncated?)"
    try:
        from pypdf import PdfReader
        logging.getLogger("pypdf").setLevel(logging.ERROR)
        reader = PdfReader(io.BytesIO(data), strict=False)
        pages = len(reader.pages)
        if pages < 1:
            return False, 0, "the document has no pages"
        reader.pages[0].mediabox  # touch the first page object
        return True, pages, "ok"
    except Exception as e:  # pypdf raises many types for corrupt input
        return False, None, f"unreadable PDF ({type(e).__name__}: {e})"
