import unittest

from app.profile.intelligence import (
    analyze_gap,
    analyze_resume,
    apply_resume_rewrite,
    extract_skill_tags,
    extract_skills,
    suggest_profile_fields,
)


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
        self.assertEqual(unlabeled["skills"], ["Python"])

    def test_extract_skill_tags_splits_resume_sentences(self) -> None:
        tags = extract_skill_tags(
            "Python\nFastAPI\n"
            "熟练掌握 LangChain、RAG 检索增强、Prompt 工程、多模态 AI 开发\n"
            "具备 LLM 模型接入、微调优化、结构化输出约束能力。\n"
            "熟练使用 Python、FastAPI、Redis、Kafka、gRPC、WebSocket、Docker\n"
            "擅长实时语音链路、分布式服务架构、缓存优化与任务调度。\n"
            "Redis\nDocker"
        )
        for expected in (
            "Python", "FastAPI", "LangChain", "RAG", "Redis", "Docker",
            "Kafka", "Prompt 工程", "实时语音链路", "分布式服务架构",
        ):
            self.assertIn(expected, tags)
        self.assertFalse(any("熟练掌握" in tag or "具备" in tag or "。" in tag for tag in tags))
        self.assertTrue(all(len(tag) <= 16 for tag in tags))
        merged = extract_skill_tags("Python、Redis、FastAPI 擅长实时语音链路、分布式服务架构。")
        self.assertIn("实时语音链路", merged)
        self.assertIn("分布式服务架构", merged)
        self.assertFalse(any("擅长" in tag for tag in merged))

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
        resume = result["resume"]

        self.assertEqual(result["mode"], "resume_only")
        self.assertIn("Python", resume["skills"])
        self.assertTrue(resume["strengths"])
        self.assertIn("项目经历", resume["structure"]["found"])
        self.assertTrue(resume["projects"])
        self.assertEqual(resume["projects"][0]["title"], "AI 求职助手")
        self.assertIn("STAR", resume["projects"][0]["how_to_talk"])
        self.assertIn("FastAPI", resume["projects"][0]["how_to_talk"])
        self.assertIn("35%", resume["projects"][0]["how_to_talk"])
        self.assertTrue(resume["gaps"])
        self.assertIn("35%", resume["headline"]["verdict"])
        self.assertNotIn("技能：Python", resume["headline"]["evidence"])
        self.assertTrue(resume["headline"]["remember"])
        self.assertTrue(resume["headline"]["skip"])
        self.assertTrue(resume["next_actions"])
        self.assertTrue(any("教育经历" in item["title"] or "工作经历" in item["title"] for item in resume["next_actions"]))
        self.assertIsNone(result["skill_coverage"])

    def test_resume_analysis_groups_evidence_and_avoids_skill_dump_quotes(self) -> None:
        result = analyze_resume({
            "resume_text": (
                "专业技能\nPython、FastAPI、Redis、Docker\n"
                "项目经历\n求职助手\n"
                "- 使用 Python / FastAPI 开发岗位分析接口，将整理时间降低 35%。\n"
                "- 负责简历解析与匹配结果展示。\n"
                "- 接入 Redis 缓存热点查询。"
            ),
            "skills": [],
        })
        resume = result["resume"]
        proven = [item for item in resume["strengths"] if item["evidence"]]
        unproven_labels = {item["label"] for item in resume["strengths"] if not item["evidence"]}
        quotes = [item["evidence"] for item in proven]
        headline_quote = resume["headline"]["evidence"]

        self.assertNotRegex(headline_quote, r"Python、FastAPI、Redis")
        self.assertIn("35%", headline_quote)
        self.assertEqual(len(quotes), len(set(quotes)))
        self.assertTrue(any("FastAPI" in " ".join(item.get("skills") or [item["label"]]) for item in proven))
        self.assertIn("Docker", unproven_labels)
        self.assertIn("STAR", resume["projects"][0]["how_to_talk"])
        rewrite = resume["projects"][0]["rewrite"]
        self.assertIn("负责简历解析", rewrite["original"])
        self.assertIn("待补充", rewrite["suggested"])
        self.assertNotRegex(rewrite["suggested"], r"\d+%")
        self.assertTrue(resume["projects"][0]["holes"])
        self.assertTrue(any("Docker" in item["title"] or "技能" in item["title"] for item in resume["next_actions"]))

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

    def test_resume_analysis_exposes_applyable_rewrite_patch(self) -> None:
        result = analyze_resume({
            "resume_text": (
                "技能：Python、FastAPI\n"
                "项目经历\n求职助手\n"
                "- 使用 FastAPI 完成岗位分析接口，将整理时间降低 35%。\n"
                "- 负责简历解析与匹配结果展示。"
            ),
            "skills": [],
        })
        rewrite = result["resume"]["projects"][0]["rewrite"]
        action = next(
            item for item in result["resume"]["next_actions"]
            if item.get("kind") == "rewrite" and item.get("patch")
        )
        self.assertEqual(action["patch"]["original"], rewrite["original"])
        self.assertEqual(action["patch"]["suggested"], rewrite["suggested"])
        self.assertIn("负责简历解析", action["patch"]["original"])

    def test_apply_resume_rewrite_replaces_bullet_and_drops_that_action(self) -> None:
        resume = (
            "技能：Python、FastAPI\n"
            "项目经历\n求职助手\n"
            "- 使用 FastAPI 完成岗位分析接口，将整理时间降低 35%。\n"
            "- 负责简历解析与匹配结果展示。\n"
        )
        first = analyze_resume({"resume_text": resume, "skills": []})
        rewrite = first["resume"]["projects"][0]["rewrite"]
        updated = apply_resume_rewrite(resume, rewrite["original"], rewrite["suggested"])
        self.assertIn(rewrite["suggested"], updated)
        self.assertNotIn("- 负责简历解析与匹配结果展示。\n", updated)
        self.assertIn("- 使用 FastAPI 完成岗位分析接口，将整理时间降低 35%。\n", updated)

        second = analyze_resume({"resume_text": updated, "skills": []})
        self.assertFalse(any(
            item.get("patch") and item["patch"]["original"] == rewrite["original"]
            for item in second["resume"]["next_actions"]
        ))

    def test_apply_resume_rewrite_asks_to_replace_placeholders_when_still_weak(self) -> None:
        resume = "项目经历\n内部工具\n- 负责简历解析与匹配结果展示。\n"
        first = analyze_resume({"resume_text": resume, "skills": []})
        rewrite = first["resume"]["projects"][0]["rewrite"]
        updated = apply_resume_rewrite(resume, rewrite["original"], rewrite["suggested"])
        second = analyze_resume({"resume_text": updated, "skills": []})
        titles = [item["title"] for item in second["resume"]["next_actions"]]
        self.assertTrue(any("待补充" in title for title in titles))
        self.assertFalse(any(item.get("kind") == "rewrite" for item in second["resume"]["next_actions"]))

    def test_apply_resume_rewrite_matches_line_without_period(self) -> None:
        resume = "项目经历\n内部工具\n- 负责简历解析与匹配结果展示\n"
        updated = apply_resume_rewrite(
            resume,
            "负责简历解析与匹配结果展示。",
            "负责简历解析与匹配结果展示，【待补充：可核对的结果】。",
        )
        self.assertIn("【待补充：可核对的结果】", updated)
        self.assertTrue(updated.startswith("项目经历\n内部工具\n- "))

    def test_apply_resume_rewrite_rejects_missing_or_duplicate_original(self) -> None:
        with self.assertRaisesRegex(ValueError, "找不到这句原文"):
            apply_resume_rewrite("项目：使用 Python 开发服务。", "并不存在的原句。", "新的一句。")
        with self.assertRaisesRegex(ValueError, "出现了多次"):
            apply_resume_rewrite(
                "- 负责接口开发。\n- 负责接口开发。\n",
                "负责接口开发。",
                "负责接口开发，【待补充：可核对的结果】。",
            )

    def test_resume_analysis_requires_saved_resume_text(self) -> None:
        with self.assertRaisesRegex(ValueError, "上传并保存简历"):
            analyze_resume({"resume_text": "  ", "skills": []})

    def test_resume_analysis_is_structured_across_four_chapters(self) -> None:
        result = analyze_resume({
            "resume_text": (
                "张三\n求职意向：后端工程师\n"
                "专业技能\nPython、FastAPI、Redis、Docker\n"
                "项目经历\n求职助手\n"
                "- 使用 Python / FastAPI 开发岗位分析接口，将整理时间降低 35%。\n"
                "- 负责简历解析与匹配结果展示。\n"
                "- 接入 Redis 缓存热点查询。"
            ),
            "skills": [],
        })
        resume = result["resume"]
        scan = resume["scan"]
        self.assertEqual(scan["identity"], "张三")
        self.assertEqual(scan["target"], "后端工程师")
        self.assertIn("Python", scan["headline_skills"])
        self.assertTrue(scan["remember"])
        self.assertTrue(any("技能清单" in item for item in scan["skip"]))
        present = {item["key"]: item["present"] for item in scan["completeness"]["modules"]}
        self.assertEqual(list(present), ["教育", "工作", "项目", "技能", "成果"])
        self.assertTrue(present["项目"])
        self.assertTrue(present["技能"])
        self.assertTrue(present["成果"])
        self.assertFalse(present["教育"])
        self.assertEqual(scan["completeness"]["present"], 3)
        self.assertEqual(scan["completeness"]["total"], 5)
        self.assertEqual(scan["proof"]["label"], "有可核对数字")
        self.assertGreaterEqual(scan["proof"]["metric_lines"], 1)

        buckets = {group["bucket"]: group["rows"] for group in resume["evidence_matrix"]}
        self.assertIn("后端服务", buckets)
        fastapi = next(row for row in buckets["后端服务"] if row["skill"] == "FastAPI")
        self.assertEqual(fastapi["strength"], "proven")
        self.assertIn("FastAPI", fastapi["evidence"])
        self.assertNotRegex(fastapi["evidence"], r"Python、FastAPI、Redis")
        docker = next(row for row in buckets["工程与部署"] if row["skill"] == "Docker")
        self.assertEqual(docker["strength"], "mentioned")
        self.assertEqual(docker["evidence"], "")

        star = resume["projects"][0]["star"]
        self.assertEqual(resume["talking_source"], "project")
        self.assertEqual(star["situation"], "求职助手")
        self.assertTrue(star["action"])
        self.assertIn("35%", star["result"])
        action = resume["next_actions"][0]
        self.assertTrue(action["why"])
        self.assertTrue(action["where"])
        self.assertTrue(action["effect"])

    def test_resume_analysis_uses_work_bullets_when_no_project(self) -> None:
        result = analyze_resume({
            "resume_text": (
                "工作经历\n某公司 后端实习生\n"
                "- 使用 Python 开发内部对账接口，将核对时间缩短 20%。\n"
                "- 负责和财务对接需求。\n"
            ),
            "skills": [],
        })
        resume = result["resume"]
        self.assertEqual(resume["talking_source"], "work")
        self.assertEqual(resume["projects"][0]["title"], "某公司 后端实习生")
        self.assertEqual(resume["projects"][0]["source"], "work")
        self.assertIn("STAR", resume["projects"][0]["how_to_talk"])
        self.assertIn("工作经历", resume["projects"][0]["how_to_talk"])
        self.assertTrue(resume["projects"][0]["star"]["action"])
        self.assertIn("20%", resume["projects"][0]["star"]["result"])
        self.assertTrue(any("没有独立项目" in item for item in resume["scan"]["skip"]))

    def test_resume_analysis_walks_checklist_and_cites_stable_blocks(self) -> None:
        result = analyze_resume({
            "resume_text": (
                "张三\n求职意向：后端工程师\n"
                "专业技能\nPython、FastAPI、Docker\n"
                "项目经历\n求职助手\n"
                "- 使用 Python / FastAPI 开发岗位分析接口，将整理时间降低 35%。\n"
                "- 负责简历解析与匹配结果展示。\n"
            ),
            "skills": [],
        })
        resume = result["resume"]
        keys = [item["key"] for item in resume["checklist"]]
        self.assertEqual(keys, ["direction", "project_evidence", "quantified", "risks", "next_step"])
        by_key = {item["key"]: item for item in resume["checklist"]}
        self.assertEqual(by_key["direction"]["status"], "pass")
        self.assertIn("后端工程师", by_key["direction"]["summary"])
        self.assertEqual(by_key["project_evidence"]["status"], "pass")
        self.assertTrue(by_key["project_evidence"]["block_ids"])
        self.assertTrue(all(item.startswith("project-") for item in by_key["project_evidence"]["block_ids"]))
        self.assertEqual(by_key["quantified"]["status"], "pass")
        self.assertIn("35", by_key["quantified"]["summary"])
        self.assertIn(by_key["risks"]["status"], {"warn", "gap"})
        self.assertEqual(by_key["next_step"]["next_action"]["intent"], resume["next_actions"][0]["intent"])
        self.assertTrue(resume["projects"][0]["block_id"].startswith("project-"))
        project_ids = {item["id"] for item in resume["blocks"] if item["kind"] == "project"}
        self.assertIn(resume["projects"][0]["block_id"], project_ids)
        proven = next(item for item in resume["strengths"] if item["evidence"])
        self.assertTrue(str(proven.get("block_id") or "").startswith("project-"))
        fastapi = next(
            row
            for group in resume["evidence_matrix"]
            for row in group["rows"]
            if row["skill"] == "FastAPI"
        )
        self.assertEqual(fastapi["block_id"], resume["projects"][0]["block_id"])
        self.assertTrue(any(item.get("intent") for item in resume["next_actions"]))

    def test_resume_analysis_checklist_does_not_invent_job_or_metrics(self) -> None:
        result = analyze_resume({
            "resume_text": "专业技能\nPython、FastAPI\n项目经历\n内部工具\n- 负责接口联调。\n",
            "skills": [],
        })
        by_key = {item["key"]: item for item in result["resume"]["checklist"]}
        self.assertEqual(by_key["direction"]["status"], "gap")
        self.assertNotIn("后端", by_key["direction"]["summary"])
        self.assertEqual(by_key["quantified"]["status"], "warn")
        self.assertNotRegex(by_key["quantified"]["summary"], r"\d+%")
        self.assertEqual(by_key["quantified"]["next_action"]["intent"], "confirm_knowledge")
        self.assertIn("待补充", by_key["quantified"]["next_action"]["detail"])

    def test_analyze_resume_keeps_document_skills_and_omits_blocked(self) -> None:
        result = analyze_resume({
            "resume_text": "专业技能\nPython、Redis、Docker\n项目经历\n缓存服务\n- 使用 Redis 做热点查询。\n",
            "skills": ["实时语音链路"],
            "blocked_skills": ["Redis"],
        })
        skills = result["resume"]["skills"]
        self.assertIn("Python", skills)
        self.assertIn("实时语音链路", skills)
        self.assertNotIn("Redis", skills)
        gap = analyze_gap(
            {
                "title": "后端",
                "description": "需要 Python、Redis 和 Kubernetes 经验，岗位描述足够长以便进入匹配层。",
            },
            {
                "resume_text": "专业技能\nPython、Redis",
                "skills": ["实时语音链路"],
                "blocked_skills": ["Redis"],
            },
        )
        self.assertIn("Python", gap["matched_skills"])
        self.assertNotIn("Redis", gap["matched_skills"])
        self.assertIn("Redis", gap["missing_skills"])
