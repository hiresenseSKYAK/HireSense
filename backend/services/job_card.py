"""Short facts for the job list cards.

Two pieces of text sit under a card's title:

* card_summary_line: one line from the stored AI summary (job_ai_summaries),
  used only when that summary was written from the job's current description.
  The summary itself has already passed job_summary's evidence checks.
* internship_details: the internship term, length, and graduation window,
  read straight from the posting with fixed patterns, never AI. A fact is shown
  only when the posting states it once, or states the same value every time it
  does; anything ambiguous or contradictory is left out.

Kept free of heavy imports so the job list query can use it.
"""
from __future__ import annotations

import hashlib
import html
import json
import re
from datetime import date

try:
    from services.interview_context import safe_text
    from services.interview_service import _description_text
except ImportError:
    from backend.services.interview_context import safe_text
    from backend.services.interview_service import _description_text

MAX_DESCRIPTION_CHARS = 12000
CARD_LINE_MAX_CHARS = 180


def summary_source_text(job_description) -> str:
    """The description text that job summaries are written from (and hashed)."""
    return safe_text(_description_text({'job_description': job_description}), MAX_DESCRIPTION_CHARS)


def summary_source_hash(job_description) -> str:
    return hashlib.sha256(summary_source_text(job_description).encode('utf-8')).hexdigest()


def _first_sentence(text: str) -> str:
    match = re.match(r'(.+?[.!?])(?:\s|$)', text)
    return (match.group(1) if match else text).strip()


def _shorten(text: str) -> str:
    text = ' '.join(text.split())
    if len(text) <= CARD_LINE_MAX_CHARS:
        return text
    cut = text[:CARD_LINE_MAX_CHARS].rsplit(' ', 1)[0].rstrip(',;:-')
    return cut + '…'


def card_summary_line(summary_json, summary_hash, job_description) -> str | None:
    """First responsibility from the AI summary, else its first overview sentence.

    Returns None when there is no summary, it was rejected (stored as null), it
    cannot be read, or it was written from an older version of the description.
    """
    if not summary_json or not summary_hash:
        return None
    if summary_hash != summary_source_hash(job_description):
        return None
    try:
        summary = json.loads(summary_json)
    except (TypeError, ValueError):
        return None
    if not isinstance(summary, dict):
        return None
    responsibilities = summary.get('responsibilities')
    if isinstance(responsibilities, list):
        for item in responsibilities:
            if isinstance(item, str) and (text := safe_text(item, 400)):
                return _shorten(text)
    overview = summary.get('overview')
    if isinstance(overview, str) and (text := safe_text(overview, 700)):
        return _shorten(_first_sentence(text))
    return None


# ---------------------------------------------------------------- internships

_SEASON = r'(spring|summer|fall|autumn|winter)'
_MONTHS = {
    'jan': 'Jan', 'january': 'Jan', 'feb': 'Feb', 'february': 'Feb', 'mar': 'Mar', 'march': 'Mar',
    'apr': 'Apr', 'april': 'Apr', 'may': 'May', 'jun': 'Jun', 'june': 'Jun', 'jul': 'Jul', 'july': 'Jul',
    'aug': 'Aug', 'august': 'Aug', 'sep': 'Sep', 'sept': 'Sep', 'september': 'Sep', 'oct': 'Oct',
    'october': 'Oct', 'nov': 'Nov', 'november': 'Nov', 'dec': 'Dec', 'december': 'Dec',
}
_MONTH = r'(' + '|'.join(sorted(_MONTHS, key=len, reverse=True)) + r')\.?'
_YEAR = r"(?:20(\d\d)|'(\d\d))"

# "Summer 2027", "Summer '27", "Summer-2027", "Summer of 2027" ... and "2027 Summer".
_TERM_SEASON_FIRST = re.compile(rf"\b{_SEASON}\s*(?:of\s+|,\s*|-\s*)?{_YEAR}(?!\d)", re.I)
_TERM_YEAR_FIRST = re.compile(rf"(?<![\d'])20(\d\d)\s+{_SEASON}\b", re.I)

# "12-week", "10-12 weeks", "10 – 13 weeks", "Duration: 12 weeks"
_WEEKS = re.compile(r'(?<![\d.])(\d{1,2})(?:\s*(?:-|–|—|to)\s*(\d{1,2}))?[\s-]*weeks?\b', re.I)
_MONTHS_LONG = re.compile(r'(?<![\d.])(\d{1,2})[\s-]*months?[\s-]+(?:paid\s+|full[\s-]time\s+)?(?:internship|co-?op)\b', re.I)
_DURATION_CONTEXT = re.compile(r'\bintern|\bco-?op\b|\bprogram\b|\bsummer\b|\bduration\b', re.I)
_NOT_DURATION = re.compile(r'\bleave\b|\bpto\b|\bvacation\b|\bholiday|\bnotice\b|'
                           r'\bparental\b|\bmaternity\b|\bpaternity\b|\bsabbatical\b|\bwithin\b|\bafter\b|\bprior to\b|'
                           r'\btypically\b|\brange in length\b', re.I)

_GRAD_POINT = rf'(?:{_SEASON}|{_MONTH})\s*,?\s*{_YEAR}(?!\d)'
_GRADUATION = re.compile(
    rf'\bgraduat\w*(?:\s+(?:date|dates|timeline))?(?:\s+(?:of|is|in|by|between|from|on))?\s*:?\s*'
    rf'(?P<a>{_GRAD_POINT})'
    rf'(?:\s*(?P<joiner>-|–|—|/|to|and|through|or)\s*(?P<b>{_GRAD_POINT}))?'
    rf'(?P<later>\s+or\s+(?:later|after))?',
    re.I,
)
# More dates right after a match ("December 2027 or May/August 2028") mean the match missed part of the window.
_MORE_DATES = re.compile(rf'\s*(?:,|-|–|—|/|to|and|or|through)?\s*(?:{_SEASON}|{_MONTH}|20\d\d)\b', re.I)
_CLASS_OF = re.compile(r'\bclass\s+of\s+20(\d\d)\b', re.I)

_TAG = re.compile(r'<[^>]+>')
_SENTENCE_BREAK = re.compile(r'\n+|(?<=[.!?;])\s+|\s+[•·]\s+|\s-\s(?=[A-Z])')


def _plain_text(value) -> str:
    text = _description_text({'job_description': value})
    text = re.sub(r'<\s*(?:br|/p|/li|/div|li|p|h\d)[^>]*>', '\n', text, flags=re.I)
    text = html.unescape(_TAG.sub(' ', text))
    return text


def _sentences(text: str) -> list[str]:
    return [part.strip() for part in _SENTENCE_BREAK.split(text) if part and part.strip()]


def _year(two_digits: str | None, four_tail: str | None) -> int:
    return 2000 + int(four_tail or two_digits)


def _terms_in(text: str, earliest_year: int) -> set[str]:
    found = set()
    for match in _TERM_SEASON_FIRST.finditer(text):
        year = _year(match.group(3), match.group(2))
        season = match.group(1).lower().replace('autumn', 'fall')
        if earliest_year <= year <= earliest_year + 3:
            found.add(f'{season.title()} {year}')
    for match in _TERM_YEAR_FIRST.finditer(text):
        year = 2000 + int(match.group(1))
        season = match.group(2).lower().replace('autumn', 'fall')
        if earliest_year <= year <= earliest_year + 3:
            found.add(f'{season.title()} {year}')
    return found


def _internship_term(title: str, sentences: list[str], earliest_year: int) -> str | None:
    title_terms = _terms_in(title or '', earliest_year)
    if title_terms:
        return title_terms.pop() if len(title_terms) == 1 else None
    terms = set()
    for sentence in sentences:
        # "Expected to graduate between Fall 2027 and Summer 2028" names graduation terms, not the internship's.
        if re.search(r'graduat|\bclass of\b|\bdegree\b|\benrolled\b|\bsemester\b.*\breturn', sentence, re.I):
            continue
        terms |= _terms_in(sentence, earliest_year)
    return terms.pop() if len(terms) == 1 else None


def _internship_length(sentences: list[str]) -> str | None:
    lengths = set()
    for sentence in sentences:
        if not _DURATION_CONTEXT.search(sentence) or _NOT_DURATION.search(sentence):
            continue
        for match in _WEEKS.finditer(sentence):
            low, high = int(match.group(1)), int(match.group(2) or 0)
            if high and not (4 <= low < high <= 16):
                continue
            if not high and not 4 <= low <= 16:
                continue
            lengths.add(f'{low}–{high} weeks' if high else f'{low} weeks')
        for match in _MONTHS_LONG.finditer(sentence):
            months = int(match.group(1))
            if 2 <= months <= 12:
                lengths.add(f'{months} months')
    return lengths.pop() if len(lengths) == 1 else None


def _grad_point(text: str, earliest_year: int) -> str | None:
    match = re.fullmatch(_GRAD_POINT, text.strip(), re.I)
    if not match:
        return None
    season, month, four_tail, two_digits = match.group(1), match.group(2), match.group(3), match.group(4)
    year = _year(two_digits, four_tail)
    if not earliest_year <= year <= earliest_year + 6:
        return None
    if season:
        return f"{season.lower().replace('autumn', 'fall').title()} {year}"
    return f'{_MONTHS[month.lower().rstrip(".")]} {year}'


def _graduation_window(sentences: list[str], earliest_year: int) -> str | None:
    windows = set()
    for sentence in sentences:
        for match in _GRADUATION.finditer(sentence):
            start = _grad_point(match.group('a'), earliest_year)
            if start is None or _MORE_DATES.match(sentence, match.end()):
                return None  # a graduation date we cannot read completely: show nothing
            if match.group('b'):
                end = _grad_point(match.group('b'), earliest_year)
                if end is None:
                    return None
                joiner = ' or ' if match.group('joiner').lower() in {'or', '/'} else ' – '
                windows.add(f'Graduating {start}{joiner}{end}')
            elif match.group('later'):
                windows.add(f'Graduating {start} or later')
            else:
                windows.add(f'Graduating {start}')
        for match in _CLASS_OF.finditer(sentence):
            year = 2000 + int(match.group(1))
            if earliest_year <= year <= earliest_year + 6:
                windows.add(f'Class of {year}')
    return windows.pop() if len(windows) == 1 else None


def internship_details(title, job_description, experience_level, job_type=None, *, today: date | None = None) -> list[str]:
    """['Summer 2027', '12 weeks', 'Graduating Fall 2027 – Summer 2028'], each part only when certain."""
    if 'intern' not in f'{experience_level or ""} {job_type or ""}'.lower():
        return []
    earliest_year = (today or date.today()).year
    sentences = _sentences(_plain_text(job_description))
    details = [
        _internship_term(str(title or ''), sentences, earliest_year),
        _internship_length(sentences),
        _graduation_window(sentences, earliest_year),
    ]
    return [detail for detail in details if detail]
