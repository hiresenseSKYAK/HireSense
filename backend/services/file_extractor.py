import io
import pdfplumber
from docx import Document

from services.resume_parser import replace_pdf_glyph_codes


def extract_text_from_pdf(file_bytes: bytes) -> str:
    text_parts = []

    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)

    # Fix "(cid:127)" bullets here too, so the AI parser sees the same text as the rules parser.
    return replace_pdf_glyph_codes("\n".join(text_parts)).strip()


def extract_text_from_docx(file_bytes: bytes) -> str:
    doc = Document(io.BytesIO(file_bytes))
    text_parts = [paragraph.text for paragraph in doc.paragraphs if paragraph.text.strip()]
    return "\n".join(text_parts).strip()


def extract_links_from_pdf(file_bytes: bytes) -> list[str]:
    """URLs behind clickable text (e.g. the word "LinkedIn") that extract_text cannot see."""
    links: list[str] = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            for link in page.hyperlinks or []:
                uri = link.get("uri")
                if isinstance(uri, str) and uri.strip():
                    links.append(uri.strip())
    return links


def extract_links_from_docx(file_bytes: bytes) -> list[str]:
    doc = Document(io.BytesIO(file_bytes))
    return [
        rel.target_ref
        for rel in doc.part.rels.values()
        if rel.reltype.endswith("/hyperlink") and rel.is_external and rel.target_ref
    ]


def extract_resume_links(filename: str, file_bytes: bytes) -> list[str]:
    """Best-effort hyperlink targets; never fails the upload."""
    lower_name = filename.lower()
    try:
        if lower_name.endswith(".pdf"):
            return extract_links_from_pdf(file_bytes)
        if lower_name.endswith(".docx"):
            return extract_links_from_docx(file_bytes)
    except Exception:
        return []
    return []


def extract_resume_text(filename: str, file_bytes: bytes) -> str:
    lower_name = filename.lower()

    if lower_name.endswith(".pdf"):
        return extract_text_from_pdf(file_bytes)

    if lower_name.endswith(".docx"):
        return extract_text_from_docx(file_bytes)

    raise ValueError("Unsupported file type. Only PDF and DOCX are allowed.")