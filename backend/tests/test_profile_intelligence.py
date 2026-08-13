import unittest

from app.profile.intelligence import analyze_gap, analyze_resume, extract_skills, suggest_profile_fields


class ProfileIntelligenceTest(unittest.TestCase):
    def test_suggests_profile_fields_from_resume_without_guessing_unlabeled_preferences(self) -> None:
        result = suggest_profile_fields(
            "张三\n求职意向：AI Agent 工程师\n期望城市：上海、杭州\n技能：Python、FastAPI、Docker"
        )

        self.assertEqual(result["name"], "张三")
        self.assertEqual(result["target_roles"], ["AI Agent 工程师"])
        self.assertEqual(result["target_cities"], ["上海", "杭州"])
        self.assertEqual(result["skills"], ["Python", "FastAPI", "Docker", "Agent"])

        unlabeled = suggest_profile_fields("后端工程师\n常驻北京\n熟悉 Python")
        self.assertEqual(unlabeled["name"], "")
        self.assertEqual(unlabeled["target_roles"], [])
        self.assertEqual(unlabeled["target_cities"], [])

    def test_reads_table_style_profile_labels_without_colons(self) -> None:
        result = suggest_profile_fields("姓名 张三\n求职目标 产品经理\n期望工作地点 上海/苏州")

        self.assertEqual(result["name"], "张三")
        self.assertEqual(result["target_roles"], ["产品经理"])
        self.assertEqual(result["target_cities"], ["上海", "苏州"])

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

    def test_resume_only_analysis_covers_strengths_structure_and_project_talking_points(self) -> None:
        profile = {
            "resume_text": (
                "技能：Python、FastAPI、Docker\n"
                "项目经历\nAI 求职助手\n"
                "- 使用 FastAPI 完成岗位分析接口，将整理时间降低 35%。\n"
                "- 负责简历解析与匹配结果展示。"
            ),
            "skills": ["Python"],
        }
        result = analyze_resume(profile)

        self.assertEqual(result["mode"], "resume_only")
        self.assertIn("Python", result["resume"]["skills"])
        self.assertTrue(result["resume"]["strengths"])
        self.assertIn("项目经历", result["resume"]["structure"]["found"])
        self.assertTrue(result["resume"]["projects"])
        self.assertEqual(result["resume"]["projects"][0]["title"], "AI 求职助手")
        self.assertTrue(result["resume"]["projects"][0]["how_to_talk"])
        self.assertTrue(result["resume"]["gaps"])
        self.assertIn("Python", result["resume"]["headline"]["verdict"])
        self.assertTrue(result["resume"]["headline"]["evidence"])
        self.assertTrue(result["resume"]["next_actions"])
        self.assertTrue(any("教育经历" in item["title"] or "工作经历" in item["title"] for item in result["resume"]["next_actions"]))
        self.assertIsNone(result["skill_coverage"])

    def test_resume_analysis_adds_job_match_only_when_jd_is_substantial(self) -> None:
        profile = {"resume_text": "技能：Python、FastAPI\n项目：使用 Python 开发内部服务。", "skills": []}
        without_job = analyze_resume(profile)
        with_job = analyze_resume(
            profile,
            {"title": "后端工程师", "description": "要求 Python、Kubernetes 和 RAG 经验"},
        )

        self.assertEqual(without_job["mode"], "resume_only")
        self.assertEqual(with_job["mode"], "job_match")
        self.assertIn("Python", with_job["matched_skills"])
        self.assertIn("Kubernetes", with_job["missing_skills"])
        self.assertIn("Kubernetes", with_job["resume"]["headline"]["verdict"])
        self.assertTrue(any("Kubernetes" in item["title"] for item in with_job["resume"]["next_actions"]))

    def test_resume_analysis_requires_saved_resume_text(self) -> None:
        with self.assertRaisesRegex(ValueError, "上传并保存简历"):
            analyze_resume({"resume_text": "  ", "skills": []})
