import re
from data.skills_keywords import SKILLS_KEYWORDS


SECTION_HEADERS = {
    "education": ["education", "academic background", "academics"],
    "experience": ["experience", "work experience", "professional experience", "employment"],
    "projects": ["projects", "personal projects", "academic projects"],
    "skills": ["skills", "technical skills", "core skills"],
    "leadership": [
        "leadership",
        "leadership/professional development",
        "professional development",
        "leadership experience",
        "leadership & professional development",
        "leadership / professional development",
    ],
}

ADDITIONAL_STOP_HEADERS = {
    "activities",
    "certifications",
    "awards",
    "volunteer",
    "volunteering",
    "organizations",
    "extracurriculars",
    "summary",
    "objective",
    "interests",
    "publications",
}

MONTH_PATTERN = re.compile(
    r"\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b",
    re.IGNORECASE,
)

DATE_PATTERN = re.compile(r"\b(19|20)\d{2}\b", re.IGNORECASE)
EMAIL_PATTERN = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_PATTERN = re.compile(r"(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})")
BULLET_PREFIX_PATTERN = re.compile(r"^[•●▪◦■□◆◇\-*]+\s*")
MULTISPACE_PATTERN = re.compile(r"\s+")


def normalize_whitespace(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\t", " ")
    text = re.sub(r"[ \u00A0]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def normalize_line(line: str) -> str:
    line = line.replace("—", "-").replace("–", "-")
    line = MULTISPACE_PATTERN.sub(" ", line.strip())
    return line


def canonicalize_header(text: str) -> str:
    value = normalize_line(text).lower()
    value = value.replace("&", "and")
    value = re.sub(r"\s*/\s*", "/", value)
    value = re.sub(r"\s*:\s*$", "", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


ALL_KNOWN_HEADERS = {
    canonicalize_header(header)
    for headers in SECTION_HEADERS.values()
    for header in headers
}

CANONICAL_STOP_HEADERS = {canonicalize_header(header) for header in ADDITIONAL_STOP_HEADERS}


def clean_bullet_text(line: str) -> str:
    line = BULLET_PREFIX_PATTERN.sub("", line.strip())
    line = MULTISPACE_PATTERN.sub(" ", line)
    return line.strip(" -–—|")


def normalize_phone(phone: str | None) -> str | None:
    if not phone:
        return None

    digits = re.sub(r"\D", "", phone)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]

    if len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    return phone.strip()


def _capitalize_name_word(word: str) -> str:
    """"o'neil" -> "O'Neil", "mary-jane" -> "Mary-Jane"."""
    return "-".join(
        "'".join(piece[:1].upper() + piece[1:].lower() for piece in chunk.split("'"))
        for chunk in word.split("-")
    )


def normalize_name(name: str | None) -> str | None:
    if not name:
        return None

    cleaned = MULTISPACE_PATTERN.sub(" ", name).strip()
    if not cleaned:
        return None

    parts = cleaned.split()
    # An all-caps name line ("ALI KHAN") is styling, not acronyms: title-case every word.
    all_caps = cleaned.isupper()
    normalized_parts = []
    for index, part in enumerate(parts):
        if index > 0 and not all_caps and part.islower() and part in SURNAME_PARTICLES:
            normalized_parts.append(part)  # "Maria de la Cruz"
        elif all_caps or part.islower():
            normalized_parts.append(_capitalize_name_word(part))
        else:
            # Already mixed case ("McDonald", "O'Neil", "Mary-Jane") or an initial: keep it.
            normalized_parts.append(part)

    return " ".join(normalized_parts)


def extract_email(text: str) -> str | None:
    match = EMAIL_PATTERN.search(text)
    return match.group(0) if match else None


def extract_phone(text: str) -> str | None:
    match = PHONE_PATTERN.search(text)
    return normalize_phone(match.group(0)) if match else None


def extract_name(text: str) -> str | None:
    lines = [normalize_line(line) for line in text.splitlines() if line.strip()]

    for line in lines[:6]:
        canonical = canonicalize_header(line)

        if "resume" in canonical:
            continue
        if "@" in line or re.search(r"\d", line):
            continue
        if len(line.split()) < 2 or len(line.split()) > 4:
            continue
        if canonical in ALL_KNOWN_HEADERS or canonical in CANONICAL_STOP_HEADERS:
            continue
        if match_section(line) or is_stop_header(line):
            continue
        return normalize_name(line)

    return None


NAME_SUFFIXES = {"jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "phd", "ph.d.", "md", "m.d."}
SURNAME_PARTICLES = {"de", "del", "della", "da", "di", "du", "la", "le", "van", "von", "der", "den", "bin", "al", "el", "st.", "mac"}
LINKEDIN_PATTERN = re.compile(r"(?:https?://)?(?:[a-z]{2,3}\.)?linkedin\.com/in/([A-Za-z0-9_%-]+)/?", re.IGNORECASE)
GITHUB_PATTERN = re.compile(
    r"(?:https?://)?(?:www\.)?github\.com/(?!orgs/|topics/|features/|about\b)([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/?",
    re.IGNORECASE,
)
HEADER_SEGMENT_SPLIT = re.compile(r"\s*(?:[|•·●◦▪♦✉☎]|\s[–—]\s|\t|\s{2,})\s*")
MAX_HEADER_LINES = 10


def split_name(name: str | None) -> tuple[str | None, str | None]:
    """Split a full name into (first, last); middle names and initials are dropped.

    "Saad A. Syed" -> ("Saad", "Syed"); "Maria de la Cruz" -> ("Maria", "de la Cruz");
    "John Smith Jr." -> ("John", "Smith").
    """
    if not name:
        return None, None
    words = name.replace(",", " ").split()
    while len(words) > 1 and words[-1].lower() in NAME_SUFFIXES:
        words.pop()
    if len(words) < 2:
        return (words[0] if words else None), None
    last_start = len(words) - 1
    while last_start > 1 and words[last_start - 1].lower() in SURNAME_PARTICLES:
        last_start -= 1
    return words[0], " ".join(words[last_start:])


def _header_lines(text: str) -> list[str]:
    """Lines before the first section heading: where name, location, and links live."""
    lines: list[str] = []
    for raw in text.splitlines():
        line = normalize_line(raw)
        if not line:
            continue
        if match_section(line) or is_stop_header(line):
            break
        lines.append(line)
        if len(lines) >= MAX_HEADER_LINES:
            break
    return lines


def extract_location(text: str) -> tuple[str | None, str | None]:
    """Find the applicant's "City, ST" in the contact header.

    Accepts "Dallas, TX", "Dallas, Texas 75201", "123 Main St, Dallas, TX 75201", and
    contact lines split by | • · or wide spacing.
    """
    for line in _header_lines(text):
        # Remove email, URLs, and phone numbers so only the location text is left behind.
        line = EMAIL_PATTERN.sub(" | ", line)
        line = re.sub(r"\S*(?:https?://|www\.|\.com/|\.io/|\.dev/)\S*", " | ", line, flags=re.IGNORECASE)
        line = PHONE_PATTERN.sub(" | ", line)
        for segment in HEADER_SEGMENT_SPLIT.split(line):
            segment = segment.strip(" ()|")
            if not segment:
                continue
            split = _split_location(segment)
            if not split:
                continue
            rest, city, state = split
            # Only the location itself, or a street address in front of it.
            if rest and not re.match(r"^\d", rest):
                continue
            return city, state
    return None, None


def extract_profile_links(text: str, links: list[str] | None = None) -> dict:
    """LinkedIn/GitHub from visible text or from hyperlinks hidden behind words like "LinkedIn"."""
    haystack = "\n".join([text or "", *(links or [])])
    linkedin = LINKEDIN_PATTERN.search(haystack)
    github = GITHUB_PATTERN.search(haystack)
    return {
        "linkedin": f"https://www.linkedin.com/in/{linkedin.group(1)}" if linkedin else None,
        "github": f"https://github.com/{github.group(1)}" if github else None,
    }


def extract_skills(text: str) -> list[str]:
    found_skills: list[str] = []

    for skill in SKILLS_KEYWORDS:
        cleaned = skill.strip()
        if not cleaned:
            continue
        pattern = r"(?<!\w)" + re.escape(cleaned) + r"(?!\w)"
        if re.search(pattern, text, re.IGNORECASE):
            found_skills.append(cleaned)

    return sorted(set(found_skills), key=str.lower)


SECTION_STEMS = {
    "education": ("education", "academic"),
    "experience": ("experience", "employment"),
    "projects": ("project",),
    "skills": ("skill", "certification", "certificate", "cert"),
    "leadership": ("leadership",),
}

SECTION_MODIFIERS = {
    "relevant",
    "professional",
    "work",
    "technical",
    "core",
    "personal",
    "academic",
    "selected",
    "other",
    "additional",
    "key",
    "and",
    "cert",
    "certs",
    "certification",
    "certifications",
    "certificate",
    "certificates",
    "development",
    "history",
    "background",
    "intern",
    "internship",
}

ROLE_WORDS = {
    "intern",
    "internship",
    "engineer",
    "analyst",
    "developer",
    "manager",
    "assistant",
    "specialist",
    "associate",
    "consultant",
    "technician",
    "designer",
    "coordinator",
    "director",
    "officer",
}

STOP_STEMS = (
    "summary",
    "objective",
    "award",
    "activity",
    "volunteer",
    "interest",
    "publication",
    "reference",
)

MONTH_LOOKUP = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}

MONTH_LABELS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

MONTH_TOKEN = (
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
    r"aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(?:19|20)\d{2}"
)
NUMERIC_TOKEN = r"(?:0?[1-9]|1[0-2])[/-](?:19|20)\d{2}"
YEAR_TOKEN = r"(?:19|20)\d{2}"
DATE_TOKEN = rf"(?:{MONTH_TOKEN}|{NUMERIC_TOKEN}|{YEAR_TOKEN})"
DATE_RANGE_PATTERN = re.compile(
    rf"(?P<start>{DATE_TOKEN})\s*(?:-|to)\s*(?P<end>present|current|now|ongoing|{DATE_TOKEN})",
    re.IGNORECASE,
)
SINGLE_DATE_PATTERN = re.compile(
    rf"(?P<label>expected|since|from)?\s*(?P<date>{DATE_TOKEN})",
    re.IGNORECASE,
)
DEGREE_PATTERN = re.compile(
    r"\b("
    r"ph\.?\s*d\.?|"
    r"m\.?\s*b\.?\s*a\.?|"
    r"bachelor(?:'s)?(?:\s+of\s+[a-z]+)?|"
    r"master(?:'s)?(?:\s+of\s+[a-z]+)?|"
    r"associate(?:'s)?(?:\s+of\s+[a-z]+)?|"
    r"doctor(?:ate)?|"
    r"b\.?\s*s\.?(?:\s*c\.?)?|"
    r"m\.?\s*s\.?(?:\s*c\.?)?|"
    r"b\.?\s*a\.?|"
    r"m\.?\s*a\.?|"
    r"b\.?\s*e\.?|"
    r"m\.?\s*e\.?"
    r")\b",
    re.IGNORECASE,
)
EDUCATION_SKIP_PATTERN = re.compile(
    r"^(gpa|relevant coursework|coursework|course work|relevant courses|dean'?s list|honors|activities|"
    r"minor|concentration|specialization|awards?|scholarships?)\b",
    re.IGNORECASE,
)

US_STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri",
    "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
    "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio",
    "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
    "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
    "DC": "District of Columbia",
}
_STATE_NAMES = {name.lower(): name for name in US_STATES.values()}
# First words of two-word city names, so "College Station, TX" is not read as "Station".
_CITY_PREFIX_WORDS = {
    "san", "los", "las", "new", "fort", "ft.", "el", "college", "grand", "round", "sugar", "corpus",
    "cedar", "salt", "st.", "saint", "santa", "palo", "ann", "baton", "little", "long", "des",
    "bowling", "coral", "palm", "boca", "glen", "lake", "virginia", "kansas", "oklahoma", "jersey",
    "carson", "the", "north", "south", "east", "west", "mount", "mt.", "port", "royal", "farmers", "flower",
}
_TRAILING_STATE_PATTERN = re.compile(
    r",\s*(?P<state>[A-Za-z][A-Za-z .]{1,24}?)\.?(?:\s+\d{5}(?:-\d{4})?)?"
    r"(?:\s*,\s*(?:usa|us|u\.s\.a?\.?|united states(?: of america)?))?\s*$",
    re.IGNORECASE,
)
_LOCATION_SEPARATOR = re.compile(r"\s*(?:[|•·]|\s[–—-]\s|,|\s{2,}|\t)\s*")
_CITY_PATTERN = re.compile(r"[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3}")


def _us_state(token: str) -> str | None:
    cleaned = token.strip(" .")
    # Only accept upper-case codes so words like "in", "or", "me" are not states.
    if len(cleaned) == 2 and cleaned.isupper() and cleaned in US_STATES:
        return cleaned
    return _STATE_NAMES.get(cleaned.lower())


def _split_location(text: str) -> tuple[str, str, str] | None:
    """Split "<anything> City, ST" into (anything, city, state); None if no US location ends the text."""
    match = _TRAILING_STATE_PATTERN.search(text)
    if not match:
        return None
    state = _us_state(match.group("state"))
    if not state:
        return None
    before = text[: match.start()].rstrip()
    pieces = _LOCATION_SEPARATOR.split(before)
    if len(pieces) > 1:
        city = pieces[-1].strip()
        rest = before[: before.rfind(city)].rstrip(" ,|•·–—-\t")
    else:
        words = before.split()
        take = 2 if len(words) >= 2 and words[-2].lower() in _CITY_PREFIX_WORDS else 1
        city = " ".join(words[-take:])
        rest = " ".join(words[:-take])
    if not city or not _CITY_PATTERN.fullmatch(city):
        return None
    return rest.strip(), city, state


def _strip_trailing_location(text: str) -> str:
    """"The University of Texas at Dallas Richardson, TX" -> "The University of Texas at Dallas"."""
    split = _split_location(text)
    if split and split[0]:
        return split[0]
    return text


def word_is_stem(word: str, stem: str) -> bool:
    if stem == "cert":
        return word in {"cert", "certs"}
    return word == stem or (word.startswith(stem) and len(word) > len(stem) and word[len(stem)] == "s")


def match_section(line: str) -> str | None:
    if looks_like_bullet(line):
        return None

    canonical = canonicalize_header(line)
    if not canonical or "@" in line or "|" in line or "," in canonical:
        return None

    words = canonical.split()
    if not words or len(words) > 6 or DATE_PATTERN.search(canonical):
        return None
    if any(word in ROLE_WORDS and word not in SECTION_MODIFIERS for word in words):
        return None

    matches: list[tuple[int, str, str]] = []
    for section, stems in SECTION_STEMS.items():
        for index, word in enumerate(words):
            if any(word_is_stem(word, stem) for stem in stems):
                matches.append((index, section, word))

    if not matches:
        return None

    content_matches = [item for item in matches if item[2] not in SECTION_MODIFIERS]
    _chosen_index, section, _chosen_word = content_matches[-1] if content_matches else matches[0]
    for word in words:
        if word in SECTION_MODIFIERS:
            continue
        if any(word_is_stem(word, stem) for stems in SECTION_STEMS.values() for stem in stems):
            continue
        return None
    return section


def is_stop_header(line: str) -> bool:
    if match_section(line) or looks_like_bullet(line):
        return False

    canonical = canonicalize_header(line)
    words = canonical.split()
    if not words or len(words) > 6 or DATE_PATTERN.search(canonical):
        return False
    if canonical in CANONICAL_STOP_HEADERS:
        return True
    connectors = {"and", "of", "the", "for"}
    return all(
        word in connectors or any(word.startswith(stem) for stem in STOP_STEMS)
        for word in words
    ) and any(any(word.startswith(stem) for stem in STOP_STEMS) for word in words)


def extract_section(text: str, section_name: str) -> list[str]:
    lines = [normalize_line(line) for line in text.splitlines()]
    collected: list[str] = []
    inside_section = False

    for line in lines:
        matched = match_section(line) if line else None

        if not line:
            if inside_section and collected and collected[-1] != "":
                collected.append("")
            continue

        if matched == section_name:
            inside_section = True
            continue

        if inside_section and (matched or is_stop_header(line)):
            break

        if inside_section:
            collected.append(line)

    return collected


def dedupe_preserve_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []

    for item in items:
        key = item.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(item.strip())

    return result


def clean_section_lines(lines: list[str]) -> list[str]:
    cleaned: list[str] = []

    for line in lines:
        stripped = normalize_line(line)
        canonical = canonicalize_header(stripped)

        if not stripped:
            continue
        if set(stripped) == {"_"}:
            continue
        if canonical in ALL_KNOWN_HEADERS or canonical in CANONICAL_STOP_HEADERS:
            continue

        cleaned.append(stripped)

    return dedupe_preserve_order(cleaned)


def looks_like_bullet(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False

    if stripped.startswith(("•", "-", "*", "●", "▪", "◦", "■", "◆")):
        return True

    lower = stripped.lower()
    bullet_starters = (
        "built ",
        "developed ",
        "designed ",
        "collaborated ",
        "participated ",
        "conducted ",
        "engineered ",
        "implemented ",
        "deployed ",
        "created ",
        "led ",
        "improved ",
        "analyzed ",
        "automated ",
        "worked ",
        "promote ",
        "promoted ",
        "assisted ",
        "supported ",
        "focused ",
        "configured ",
        "integrated ",
        "used ",
        "delivered ",
        "managed ",
        "generated ",
        "applied ",
        "researched ",
        "documented ",
        "optimized ",
        "reduced ",
        "increased ",
        "maintained ",
        "tested ",
        "debugged ",
        "launched ",
        "trained ",
        "completed ",
    )
    return lower.startswith(bullet_starters)


def _is_role_line(line: str) -> bool:
    if looks_like_bullet(line):
        return False
    words = set(re.findall(r"[a-z]+", line.lower()))
    return bool(words & ROLE_WORDS)


def _is_school_line(line: str) -> bool:
    lowered = line.lower().strip()
    if lowered.startswith("school of"):
        return False
    if any(keyword in lowered for keyword in ("university", "college", "institute", "academy")):
        return True
    return bool(re.search(r"\b(high school|secondary school)\b", lowered) or lowered.endswith(" school"))


def _is_pipe_project_heading(line: str) -> bool:
    if looks_like_bullet(line) or "|" not in line:
        return False
    if line[:1].islower() or line.rstrip().endswith("."):
        return False
    left, right = [part.strip() for part in line.split("|", 1)]
    if not left or not right or left[:1].islower() or len(line.split()) > 10:
        return False
    right_first = right.split()[0].strip(".,").lower()
    return right_first not in {
        "using", "with", "and", "that", "into", "for", "to", "from", "by",
        "while", "which", "where", "the", "a", "an",
    }


def _is_named_project_heading(line: str) -> bool:
    if looks_like_bullet(line) or "|" in line or line[:1].islower() or line.rstrip().endswith("."):
        return False
    words = line.split()
    if not words or len(words) > 4:
        return False
    glue = {"a", "an", "the", "and", "with", "that", "using", "into", "for", "to", "from", "by", "of", "on", "in"}
    if any(word.strip(".,").lower() in glue for word in words):
        return False
    return all(word[:1].isupper() for word in words)


def _is_project_title(line: str) -> bool:
    return _is_pipe_project_heading(line)


def _month_number(token: str) -> int | None:
    letters = re.sub(r"[^a-z]", "", token.lower())[:3]
    return MONTH_LOOKUP.get(letters)


def _parse_date_token(token: str) -> tuple[str, str]:
    cleaned = token.strip().rstrip(".")
    month_match = re.match(
        rf"(?i)(?P<month>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(?P<year>(?:19|20)\d{{2}})",
        cleaned,
    )
    if month_match:
        month = _month_number(month_match.group("month")) or 1
        year = month_match.group("year")
        return f"{year}-{month:02d}-01", f"{MONTH_LABELS[month - 1]} {year}"

    numeric_match = re.match(r"(?P<month>0?[1-9]|1[0-2])[/-](?P<year>(?:19|20)\d{2})", cleaned)
    if numeric_match:
        month = int(numeric_match.group("month"))
        year = numeric_match.group("year")
        return f"{year}-{month:02d}-01", f"{MONTH_LABELS[month - 1]} {year}"

    if re.fullmatch(r"(?:19|20)\d{2}", cleaned):
        return "", cleaned
    return "", ""


def _empty_dates() -> dict:
    return {
        "startDate": "",
        "endDate": "",
        "current": False,
        "start_display": "",
        "end_display": "",
    }


def _apply_range(match: re.Match[str]) -> dict:
    dates = _empty_dates()
    start_iso, start_display = _parse_date_token(match.group("start"))
    dates["startDate"] = start_iso
    dates["start_display"] = start_display
    end_token = match.group("end").strip().lower()
    if end_token in {"present", "current", "now", "ongoing"}:
        dates["current"] = True
        dates["end_display"] = "Present"
        return dates
    end_iso, end_display = _parse_date_token(match.group("end"))
    dates["endDate"] = end_iso
    dates["end_display"] = end_display
    return dates


def _apply_single(match: re.Match[str], purpose: str) -> dict | None:
    token = match.group("date")
    label = (match.group("label") or "").lower()
    has_month = _parse_date_token(token)[0] != ""
    other = normalize_line(match.string[: match.start()] + match.string[match.end() :])
    # A bare year closing an education line ("..., University of North Texas 2026") is the graduation year.
    ends_education_line = purpose == "education" and not match.string[match.end():].strip(" )|,.-")
    if (not has_month and label not in {"expected", "since", "from"} and other and len(other.split()) > 2
            and not ends_education_line):
        return None

    iso_date, display = _parse_date_token(token)
    dates = _empty_dates()
    if label == "expected" or (purpose == "education" and label != "since"):
        dates["endDate"] = iso_date
        dates["end_display"] = display
    else:
        dates["startDate"] = iso_date
        dates["start_display"] = display
        if label == "since":
            dates["current"] = True
    return dates


def take_dates(line: str, purpose: str) -> tuple[str, dict | None]:
    range_match = DATE_RANGE_PATTERN.search(line)
    if range_match:
        remainder = normalize_line(f"{line[: range_match.start()]} {line[range_match.end() :]}")
        return remainder.strip(" -|,"), _apply_range(range_match)

    single_match = SINGLE_DATE_PATTERN.search(line)
    if not single_match:
        return line, None
    dates = _apply_single(single_match, purpose)
    if dates is None:
        return line, None
    remainder = normalize_line(f"{line[: single_match.start()]} {line[single_match.end() :]}")
    return remainder.strip(" -|,"), dates


def _merge_dates(current: dict, found: dict) -> dict:
    if current["startDate"] or current["endDate"] or current["current"] or current["start_display"] or current["end_display"]:
        return current
    return found


def _display_span(dates: dict) -> str:
    left = dates["start_display"]
    right = "Present" if dates["current"] else dates["end_display"]
    if left and right:
        return f"{left} – {right}"
    return left or right


def _starts_new_history_entry(line: str, kind: str) -> bool:
    words = line.split()
    if not words:
        return False
    if kind == "education":
        return _is_school_line(line)
    if kind == "project":
        return _is_pipe_project_heading(line) or _is_named_project_heading(line)
    if "|" in line and len(words) <= 12:
        return True
    if _location_segment(line):
        return True
    if _block_has_date([line], "experience") and len(words) <= 12:
        return True
    return bool(_is_role_line(line) and len(words) <= 8 and not line.rstrip().endswith("."))


def _is_bullet_continuation(line: str, previous: str, kind: str) -> bool:
    if _starts_new_history_entry(line, kind):
        return False
    if line[:1].islower():
        return True
    if previous and not previous.rstrip().endswith((".", "!", "?", ";")):
        return True
    return False


def _last_bullet_text(lines: list[str]) -> str:
    for line in reversed(lines):
        cleaned = clean_bullet_text(normalize_line(line))
        if cleaned:
            return cleaned
    return ""


def _join_wrapped_line(previous: str, continuation: str) -> str:
    if previous.endswith("-") and not previous.endswith(" -"):
        return f"{previous[:-1]}{continuation.lstrip()}"
    return f"{previous} {continuation}".strip()


def _block_has_bullet(lines: list[str]) -> bool:
    return any(looks_like_bullet(line) for line in lines if normalize_line(line))


def _block_has_date(lines: list[str], purpose: str) -> bool:
    for line in lines:
        _remainder, dates = take_dates(normalize_line(line), purpose)
        if dates:
            return True
    return False


def group_history_blocks(lines: list[str], kind: str) -> list[list[str]]:
    blocks: list[list[str]] = []
    current: list[str] = []

    def close() -> None:
        nonlocal current
        if any(normalize_line(line) for line in current):
            blocks.append(current)
        current = []

    for raw_line in lines:
        line = normalize_line(raw_line)
        if not line:
            if kind != "education" and (_block_has_bullet(current) or _block_has_date(current, kind)):
                close()
            continue

        if looks_like_bullet(line):
            current.append(line)
            continue

        if _block_has_bullet(current):
            if _is_bullet_continuation(line, _last_bullet_text(current), kind):
                current.append(line)
                continue
            close()
        elif kind == "education" and _is_school_line(line) and any(_is_school_line(item) for item in current):
            close()
        elif kind == "experience" and _is_role_line(line) and any(_is_role_line(item) for item in current):
            close()
        elif kind == "project" and _is_project_title(line) and any(_is_project_title(item) for item in current):
            close()

        current.append(line)

    close()
    return blocks


FIELD_STOP_PATTERN = re.compile(
    r"(?:\s*[,;|]\s*|\s+)(?:minor|concentration|specialization|track|emphasis|gpa|cgpa|"
    r"expected|anticipated|honors?|cum laude|magna|summa|dean'?s)\b.*$",
    re.IGNORECASE,
)
MAJOR_LABEL_PATTERN = re.compile(
    r"^(?:major|field of study|area of study|program)\s*[:\-–—]\s*(.+)$",
    re.IGNORECASE,
)
MAJOR_SUFFIX_PATTERN = re.compile(r"^(.+?)\s+major$", re.IGNORECASE)
EDUCATION_SEGMENT_SPLIT = re.compile(r"\s+[|•·]\s+|\s+[–—]\s+|\s+-\s+|\t+|\s{2,}")


def _clean_field(text: str) -> str:
    cleaned = FIELD_STOP_PATTERN.sub("", text or "")
    cleaned = re.sub(r"\(\s*\)", "", cleaned)
    return MULTISPACE_PATTERN.sub(" ", cleaned).strip(" ,.;:-–—|()")


def _parse_degree_line(line: str) -> tuple[str, str] | None:
    """Return (degree, field of study) from a degree line, or None.

    Handles "Bachelor of Science in Computer Science", "B.S. Computer Science",
    "Computer Science, B.S.", "Major: Computer Science", and "Computer Science Major".
    """
    label = MAJOR_LABEL_PATTERN.match(line)
    if label:
        field = _clean_field(label.group(1))
        return ("", field) if field else None

    suffix = MAJOR_SUFFIX_PATTERN.match(line)
    if suffix and not _is_school_line(line):
        field = _clean_field(suffix.group(1))
        return ("", field) if field else None

    degree_match = DEGREE_PATTERN.search(line)
    if not degree_match:
        # Legacy shape: "... in Computer Science" with no recognizable degree word.
        in_match = re.search(r"\bin\s+(.+)$", line, re.IGNORECASE)
        if in_match and not _is_school_line(line):
            field = _clean_field(in_match.group(1))
            return ("", field) if field else None
        return None

    degree = degree_match.group(0).strip(" ,-|")
    end = degree_match.end()
    if end < len(line) and line[end] == "." and not degree.endswith("."):
        degree += "."
        end += 1

    after = line[end:].strip(" ,:;-–—|")
    after = re.sub(r"^(?:degree\s+)?(?:in|of)\s+", "", after, flags=re.IGNORECASE)
    field = _clean_field(after)
    if not field:
        # "Computer Science, B.S." puts the major before the degree.
        field = _clean_field(line[: degree_match.start()])
    if DATE_PATTERN.search(field):
        field = ""
    if not degree and not field:
        return None
    return degree, field


def _education_segments(line: str) -> list[str]:
    """Split one education line into school / degree pieces.

    "University of North Texas, B.S. in Computer Science" and
    "University of Texas at Dallas | Bachelor of Science | May 2026"
    both hold the school and the degree on the same line.
    """
    segments: list[str] = []
    for piece in EDUCATION_SEGMENT_SPLIT.split(line):
        piece = piece.strip(" ,;|")
        if not piece:
            continue
        degree_match = DEGREE_PATTERN.search(piece)
        if _is_school_line(piece) and degree_match:
            comma_parts = [part.strip() for part in piece.split(",") if part.strip()]
            if len(comma_parts) > 1:
                segments.extend(comma_parts)
                continue
            school_index = min(
                (piece.lower().find(word) for word in ("university", "college", "institute", "academy", "school")
                 if word in piece.lower()),
                default=-1,
            )
            if 0 <= school_index < degree_match.start():
                segments.extend([piece[: degree_match.start()].strip(), piece[degree_match.start():].strip()])
                continue
        segments.append(piece)
    return segments


def _education_summary(school: str, degree: str, field: str, dates: dict) -> str:
    detail = f"{degree} in {field}".strip() if degree and field else degree or field
    parts = [part for part in (school, detail, _display_span(dates)) if part]
    return " — ".join(parts)


def parse_education_block(lines: list[str]) -> dict | None:
    dates = _empty_dates()
    kept: list[str] = []

    for raw_line in lines:
        line = clean_bullet_text(normalize_line(raw_line))
        if not line or EDUCATION_SKIP_PATTERN.match(line):
            continue
        remainder, found = take_dates(line, "education")
        if found:
            dates = _merge_dates(dates, found)
        if remainder:
            kept.append(remainder)

    school = ""
    degree = ""
    field = ""
    fallback_school = ""
    for line in kept:
        for segment in _education_segments(line):
            if _is_school_line(segment):
                if not school:
                    school = _strip_trailing_location(segment)
                continue
            parsed_degree = _parse_degree_line(segment)
            if parsed_degree:
                parsed_name, parsed_field = parsed_degree
                if parsed_name and not degree:
                    degree = parsed_name
                if parsed_field and not field:
                    field = parsed_field
                continue
            if not fallback_school and not _split_location(segment):
                fallback_school = _strip_trailing_location(segment)
    if not school:
        school = fallback_school

    if not school and not degree and not field:
        return None

    return {
        "school": school,
        "degree": degree,
        "fieldOfStudy": field,
        "startDate": dates["startDate"],
        "endDate": "" if dates["current"] else dates["endDate"],
        "current": dates["current"],
        "summary": _education_summary(school, degree, field, dates),
    }


def _split_role_and_company(text: str) -> tuple[str, str]:
    lowered = text.lower()
    for marker in (" at ", " @ "):
        index = lowered.rfind(marker)
        if index > 0:
            return text[index + len(marker):].strip(), text[:index].strip()
    return "", text


def _location_segment(segment: str) -> bool:
    text = segment.strip()
    if re.fullmatch(r"(?i)remote|hybrid|on-?site", text):
        return True
    return bool(re.search(r",\s*[A-Z]{2}\b", text)) and len(text.split()) <= 6


def parse_experience_block(lines: list[str]) -> dict | None:
    headers: list[str] = []
    bullets: list[str] = []
    dates = _empty_dates()

    for raw_line in lines:
        line = normalize_line(raw_line)
        if not line:
            continue
        if looks_like_bullet(line):
            cleaned = clean_bullet_text(line)
            if cleaned:
                bullets.append(cleaned)
            continue
        if bullets and not _starts_new_history_entry(line, "experience"):
            bullets[-1] = _join_wrapped_line(bullets[-1], clean_bullet_text(line))
            continue
        remainder, found = take_dates(line, "experience")
        if found:
            dates = _merge_dates(dates, found)
        if remainder:
            headers.append(remainder)

    segments: list[str] = []
    for header in headers:
        for part in header.split("|"):
            cleaned = normalize_line(part).strip(" -|,")
            if cleaned:
                segments.append(cleaned)

    company = ""
    job_title = ""
    location = ""
    other: list[str] = []
    role_segments: list[str] = []
    for segment in segments:
        if not location and _location_segment(segment):
            location = segment
        elif _is_role_line(segment):
            role_segments.append(segment)
        else:
            other.append(segment)

    if role_segments:
        job_title = role_segments[0]
        if other:
            company = other[0]
    elif other:
        job_title = other[0]
        if len(other) > 1:
            company = other[1]

    if job_title and not company:
        parsed_company, parsed_title = _split_role_and_company(job_title)
        if parsed_company:
            company = parsed_company
            job_title = parsed_title
    elif not job_title and company:
        parsed_company, parsed_title = _split_role_and_company(company)
        if parsed_company:
            company = parsed_company
            job_title = parsed_title

    bullets = dedupe_preserve_order(bullets)
    if not (job_title or company or bullets):
        return None

    label_parts = []
    if job_title and company:
        label_parts.append(f"{job_title} at {company}")
    elif job_title or company:
        label_parts.append(job_title or company)
    if location:
        label_parts.append(location)
    span = _display_span(dates)
    if span:
        label_parts.append(span)

    return {
        "title": " | ".join(label_parts),
        "bullets": bullets,
        "company": company,
        "job_title": job_title,
        "location": location,
        "startDate": dates["startDate"],
        "endDate": "" if dates["current"] else dates["endDate"],
        "current": dates["current"],
    }


def parse_project_block(lines: list[str]) -> dict | None:
    headers: list[str] = []
    bullets: list[str] = []
    for raw_line in lines:
        line = normalize_line(raw_line)
        if not line:
            continue
        cleaned = clean_bullet_text(line)
        if not cleaned:
            continue
        if looks_like_bullet(line):
            bullets.append(cleaned)
        elif bullets and not _starts_new_history_entry(line, "project"):
            bullets[-1] = _join_wrapped_line(bullets[-1], cleaned)
        elif headers and not bullets and not _starts_new_history_entry(line, "project"):
            headers[-1] = _join_wrapped_line(headers[-1], cleaned)
        else:
            headers.append(cleaned)

    title = headers[0] if headers else ""
    extra = headers[1:]
    if not title and bullets:
        title = bullets[0]
        bullets = bullets[1:]
    if not title:
        return None
    return {
        "title": title,
        "bullets": dedupe_preserve_order(extra + bullets),
    }


def split_skill_items(lines: list[str]) -> list[str]:
    items: list[str] = []
    for raw_line in lines:
        line = clean_bullet_text(normalize_line(raw_line))
        if not line or match_section(line):
            continue
        if ":" in line and len(line.split(":", 1)[0].split()) <= 3:
            line = line.split(":", 1)[1]
        for part in re.split(r"\s*(?:,|;|\||•|●|▪|·)\s*", line):
            skill = normalize_line(part).strip(" -")
            if not skill or match_section(skill) or len(skill.split()) > 8 or len(skill) > 60:
                continue
            items.append(skill)
    return dedupe_preserve_order(items)


def combine_skills(text: str, skill_lines: list[str]) -> list[str]:
    listed = split_skill_items(skill_lines)
    seen = {skill.lower() for skill in listed}
    combined = list(listed)
    for skill in extract_skills(text):
        if skill.lower() in seen:
            continue
        seen.add(skill.lower())
        combined.append(skill)
    return combined


def _parsed_entries(lines: list[str], kind: str) -> list[dict]:
    parser = {
        "education": parse_education_block,
        "experience": parse_experience_block,
        "project": parse_project_block,
    }[kind]
    entries = []
    for block in group_history_blocks(lines, kind if kind != "project" else "project"):
        parsed = parser(block)
        if parsed:
            entries.append(parsed)
    return entries


def flatten_structured_entries(entries: list[dict]) -> list[str]:
    flattened: list[str] = []

    for entry in entries:
        title = normalize_line(entry.get("title", ""))
        bullets = entry.get("bullets", [])

        if title:
            flattened.append(title)

        for bullet in bullets:
            cleaned = clean_bullet_text(bullet)
            if cleaned:
                flattened.append(cleaned)

    return dedupe_preserve_order(flattened)


def parse_resume_text(text: str, links: list[str] | None = None) -> dict:
    normalized_text = normalize_whitespace(text)
    name = extract_name(normalized_text)
    first_name, last_name = split_name(name)
    city, state = extract_location(normalized_text)
    profile_links = extract_profile_links(normalized_text, links)

    education_lines = extract_section(normalized_text, "education")
    experience_lines = extract_section(normalized_text, "experience")
    project_lines = extract_section(normalized_text, "projects")
    leadership_lines = extract_section(normalized_text, "leadership")
    skill_lines = extract_section(normalized_text, "skills")

    education_entries = _parsed_entries(education_lines, "education")
    structured_experience = _parsed_entries(experience_lines, "experience")
    structured_projects = _parsed_entries(project_lines, "project")
    structured_leadership = _parsed_entries(leadership_lines, "experience")

    return {
        "name": name,
        "first_name": first_name,
        "last_name": last_name,
        "city": city,
        "state": state,
        "linkedin": profile_links["linkedin"],
        "github": profile_links["github"],
        "email": extract_email(normalized_text),
        "phone": extract_phone(normalized_text),
        "skills": combine_skills(normalized_text, skill_lines),
        "education": [entry["summary"] for entry in education_entries if entry.get("summary")],
        "experience": flatten_structured_entries(structured_experience),
        "projects": flatten_structured_entries(structured_projects),
        "leadership": flatten_structured_entries(structured_leadership),
        "education_entries": education_entries,
        "experience_entries": structured_experience,
        "project_entries": structured_projects,
        "leadership_entries": structured_leadership,
        "raw_text": normalized_text,
    }


