"""Bounded, career-only context used for storage and provider requests."""
import re

_EMAIL = re.compile(r'\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', re.I)
_PHONE = re.compile(r'(?<!\w)(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]?\d{4}(?!\w)')
_ADDRESS = re.compile(r'\b\d{1,6}\s+(?:[\w.-]+\s+){1,5}(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|boulevard|blvd)\b[^\n|;]*', re.I)
_SENSITIVE_LINE = re.compile(r'^\s*(?:name|email|phone|address|zip(?: code)?|postal code|date of birth|gender|citizenship|work authorization|ssn|auth(?:orization)? token)\s*:', re.I)


def safe_text(value, limit=1000):
    text = str(value or '')
    text = '\n'.join(line for line in text.splitlines() if not _SENSITIVE_LINE.match(line))
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]', '', text)
    for pattern in (_EMAIL, _PHONE, _ADDRESS):
        text = pattern.sub('[redacted]', text)
    return ' '.join(text.split())[:limit]


def safe_resume_context(resume):
    result = {}
    for key, limit, count in (('skills', 100, 50), ('education', 500, 10)):
        result[key] = [text for item in resume.get(key, [])[:count] if (text := safe_text(item, limit))]
    for key in ('experience', 'projects', 'leadership'):
        # Projects has a singular key; experience and leadership do not.
        structured_key = 'project_entries' if key == 'projects' else f'{key}_entries'
        structured = resume.get(structured_key, [])
        result[structured_key] = [
            {'title': safe_text(entry.get('title'), 200),
             'bullets': [text for bullet in entry.get('bullets', [])[:8] if (text := safe_text(bullet))]}
            for entry in structured[:10] if isinstance(entry, dict) and safe_text(entry.get('title'), 200)
        ]
        # Avoid persisting redundant unstructured sections when structured evidence exists.
        result[key] = [] if result[structured_key] else [
            text for item in resume.get(key, [])[:10] if (text := safe_text(item))
        ]
    return result
