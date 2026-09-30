"""Transitional imports for retired callers; removed with the resume domain."""
from ..documents.parser import (
    DocumentParseResult as ResumeParseResult,
    normalize_document_text as normalize_resume_text,
    parse_document as parse_resume,
    parse_document_result as parse_resume_result,
)
