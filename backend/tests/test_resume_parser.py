from __future__ import annotations

import unittest
from io import BytesIO

from docx import Document

from app.resume_parser import parse_resume


class ResumeParserTest(unittest.TestCase):
    def test_parses_utf8_text_resume(self) -> None:
        text = parse_resume("resume.txt", "张三\nPython 开发工程师\n五年后端开发经验".encode())
        self.assertIn("Python 开发工程师", text)

    def test_parses_docx_paragraphs_and_tables(self) -> None:
        document = Document()
        document.add_heading("个人简历", level=1)
        document.add_paragraph("负责 FastAPI 和 Agent 平台开发")
        table = document.add_table(rows=1, cols=2)
        table.cell(0, 0).text = "技能"
        table.cell(0, 1).text = "Python"
        stream = BytesIO()
        document.save(stream)

        text = parse_resume("resume.docx", stream.getvalue())

        self.assertIn("Agent 平台开发", text)
        self.assertIn("技能\tPython", text)

    def test_rejects_unsupported_or_empty_files(self) -> None:
        with self.assertRaises(ValueError):
            parse_resume("resume.pages", b"not supported")
        with self.assertRaises(ValueError):
            parse_resume("resume.txt", b"")


if __name__ == "__main__":
    unittest.main()
