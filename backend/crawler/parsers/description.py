"""Safe, deterministic conversion of provider HTML to structured plain text."""

from __future__ import annotations

import re

from bs4 import BeautifulSoup


_REMOVED_ELEMENTS = (
    "script", "style", "noscript", "template", "iframe", "object", "embed",
    "svg", "math",
)
_BLOCK_ELEMENTS = (
    "address", "article", "aside", "blockquote", "div", "dl", "dt", "dd",
    "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3",
    "h4", "h5", "h6", "header", "hr", "main", "nav", "p", "pre", "section",
    "table", "tbody", "td", "tfoot", "th", "thead", "tr",
)


def html_to_structured_text(value: object) -> str:
    """Return provider wording as plain text while retaining semantic line breaks.

    Active/embedded elements are removed before text extraction. HTML is never
    returned to callers, so provider markup and event attributes cannot reach the UI.
    """
    if not value:
        return ""

    soup = BeautifulSoup(str(value), "html.parser")
    for element in soup.find_all(_REMOVED_ELEMENTS):
        element.decompose()

    for br in soup.find_all("br"):
        br.replace_with("\n")

    for item in soup.find_all("li"):
        parent = item.parent
        if parent and parent.name == "ol":
            siblings = [child for child in parent.find_all("li", recursive=False)]
            marker = f"{siblings.index(item) + 1}. " if item in siblings else "- "
        else:
            marker = "- "
        item.insert_before("\n")
        item.insert(0, marker)
        item.insert_after("\n")

    for element in soup.find_all(_BLOCK_ELEMENTS):
        element.insert_before("\n")
        element.insert_after("\n")

    raw = soup.get_text("", strip=False).replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[\t\f\v ]+", " ", line).strip() for line in raw.split("\n")]
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return re.sub(r"(?m)(^|\n)(- |\d+\. )([^\n]+)\n\n(?=(?:- |\d+\. ))", r"\1\2\3\n", text)
