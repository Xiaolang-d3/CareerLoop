import unittest

from app.profile_intelligence import analyze_gap, extract_skills


class ProfileIntelligenceTest(unittest.TestCase):
    def test_extract_skills_and_gap_with_evidence(self) -> None:
        resume = "技能：Python、FastAPI、Docker\n项目：使用 Python 开发 Agent 服务。"
        job = {
            "title": "AI Agent 工程师",
            "description": "要求 Python、FastAPI、Kubernetes 和 RAG 经验",
            "experience": "3年",
            "education": "本科",
        }
        profile = {"resume_text": resume, "skills": ["Python", "Docker"]}

        self.assertIn("FastAPI", extract_skills(resume))
        result = analyze_gap(job, profile)
        self.assertGreaterEqual(set(result["matched_skills"]), {"Python", "FastAPI", "Agent"})
        self.assertGreaterEqual(set(result["missing_skills"]), {"Kubernetes", "RAG"})
        self.assertTrue(result["evidence"])

    def test_gap_marks_incomplete_job_description(self) -> None:
        result = analyze_gap({"title": "后端工程师", "description": ""}, {"resume_text": "Python 开发", "skills": []})
        self.assertEqual(result["confidence"], "limited")
        self.assertTrue(result["limitations"])
