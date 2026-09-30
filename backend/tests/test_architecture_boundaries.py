"""Production imports must not load retired tools through package exports."""
import subprocess
import sys
from pathlib import Path


def test_production_entry_does_not_load_retired_tool_implementations():
    subprocess.run(
        [sys.executable, "-c", """
import sys
from app.main import app
retired = {
    'app.tools.career_os', 'app.tools.profile_interview',
    'app.tools.analyze_resume_against_jd', 'app.tools.generate_interview_advice',
    'app.tools.generate_tailored_resume_content', 'app.tools.search_resume_evidence',
    'app.tools.research_company', 'app.jobs.evaluations',
}
assert not retired.intersection(sys.modules), retired.intersection(sys.modules)
assert not any(name.startswith(('app.profile', 'app.jobs', 'app.resume', 'app.interview', 'app.opportunities', 'app.projects', 'app.workflow')) for name in sys.modules)
"""],
        cwd=Path(__file__).resolve().parents[1],
        check=True,
        capture_output=True,
        text=True,
    )


def test_document_parser_does_not_import_career_domains():
    subprocess.run(
        [sys.executable, "-c", """
import sys
from app.documents.parser import parse_document
from app.documents.ocr import extract_image_text
assert '保持资料原文' in parse_document('notes.md', '阅读笔记：保持资料原文，解析不推断职业方向或技能。'.encode())
assert not any(name.startswith(('app.profile', 'app.jobs', 'app.resume', 'app.interview', 'app.opportunities', 'app.projects', 'app.workflow')) for name in sys.modules)
"""],
        cwd=Path(__file__).resolve().parents[1],
        check=True,
        capture_output=True,
        text=True,
    )
