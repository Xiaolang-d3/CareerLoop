"""Parse downloaded RSS/Atom documents; never let the parser fetch a URL."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Any

import feedparser


def entries(content: str) -> list[dict[str, Any]]:
    # Keep strict XML validation before feedparser's tolerant HTML fallback.
    # The transport has already bounded the document size.
    if "<!DOCTYPE" in content.upper() or "<!ENTITY" in content.upper():
        raise ValueError("来源 XML 格式不受支持")
    try:
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        raise ValueError("来源订阅 XML 格式无效") from exc
    valid = (
        (root.tag == "rss" and root.find("channel") is not None)
        or root.tag == "{http://www.w3.org/2005/Atom}feed"
        or root.tag == "{http://purl.org/atom/ns#}feed"
        or root.tag == "{http://www.w3.org/1999/02/22-rdf-syntax-ns#}RDF"
    )
    if not valid:
        raise ValueError("来源未返回 RSS 或 Atom")
    # Bytes are always treated as data (strings can be interpreted as URLs).
    parsed = feedparser.parse(content.encode("utf-8"))
    result = []
    for entry in parsed.entries[:80]:
        images = [item.get("url") for item in entry.get("media_thumbnail", [])]
        images += [item.get("url") for item in entry.get("media_content", [])]
        images += [item.get("href") for item in entry.get("enclosures", [])]
        body = entry.get("summary") or next((part.get("value") for part in entry.get("content", []) if part.get("value")), "")
        result.append({
            "title": entry.get("title", ""), "summary": body,
            "url": entry.get("link", ""), "images": images,
            # updated is not evidence of original publication; no clock fallback.
            "published": entry.get("published"),
        })
    return result
