import unittest
from unittest.mock import patch

from fastapi import HTTPException

from api.resume import upload_resume


class FakeUpload:
    filename = "resume.pdf"

    async def read(self):
        return b"not a readable PDF"


class ResumeApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_malformed_file_returns_safe_actionable_error(self):
        with patch("api.resume.extract_resume_text", side_effect=ValueError("internal parser details")):
            with self.assertRaises(HTTPException) as raised:
                await upload_resume(FakeUpload())

        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("Export it as a new PDF or DOCX", raised.exception.detail)
        self.assertNotIn("internal parser details", raised.exception.detail)


if __name__ == "__main__":
    unittest.main()
