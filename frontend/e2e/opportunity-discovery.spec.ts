import { expect, test } from "@playwright/test";

test("opportunity hub keeps queue and job detail, without discovery run modes", async ({ page }) => {
  const jobs = [{
    id: 9, source_id: null, canonical_url: "https://example.com/job/9",
    company_name: "示例科技", job_title: "AI 产品经理", location: "上海",
    salary_text: "30-45K", description: "完整岗位说明只在下一级详情页面展示。",
    lifecycle_status: "discovered", posting_status: "active", processing_status: "evaluated",
    assessment: { id: 3, analysis_tier: "local", score: 78, recommendation: "strong", verdict: "pass", triage_dimensions: {}, coverage: 80, confidence: "medium", matched_skills: ["Python"], evidence_gaps: [], hard_conflicts: [], soft_risks: [], reasons: ["已有证据"], status: "current", created_at: "2026-08-01" },
    updated_at: "2026-08-01"
  }];

  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/system/database-status") return route.fulfill({ json: { status: "ready", schema_version: 5, required_schema_version: 5 } });
    if (path === "/opportunity-runs") return route.fulfill({ json: [] });
    if (path === "/discovered-jobs") return route.fulfill({ json: jobs });
    if (path === "/discovered-jobs/9") return route.fulfill({ json: jobs[0] });
    if (path === "/discovered-jobs/9/assessments") return route.fulfill({ json: [jobs[0].assessment] });
    if (path === "/opportunity-sources") return route.fulfill({ json: [] });
    if (path === "/career-profile") return route.fulfill({ json: { profile: { id: 1 }, active_strategy: { id: 2, name: "AI 产品" }, facts: [], sources: [] } });
    if (path === "/jobs" || path === "/conversations" || path === "/chat/messages") return route.fulfill({ json: [] });
    if (path === "/workflow/status") return route.fulfill({ json: { status: "in_progress", counts: { profiles: 1, jd_analyses: 0, resume_evidence_searches: 0, tailored_resume_generations: 0, interview_advice_generations: 0, company_researches: 0 }, stage_counts: { candidate_knowledge: 0, opportunity_discovery: 0, job_evaluation: 0, material_preparation: 0, interview_preparation: 0, outcome_tracking: 0 }, nodes: [{ id: "candidate_knowledge", title: "候选人画像与知识", status: "pending", detail: "" }, { id: "opportunity_discovery", title: "机会发现", status: "pending", detail: "" }, { id: "job_evaluation", title: "岗位评估与决策", status: "pending", detail: "" }, { id: "material_preparation", title: "求职材料准备", status: "pending", detail: "" }, { id: "interview_preparation", title: "面试准备", status: "pending", detail: "" }, { id: "outcome_tracking", title: "结果与复盘", status: "pending", detail: "" }] } });
    if (path === "/agent/settings") return route.fulfill({ json: { display_name: "CareerLoop", persona_role: "AI 求职伙伴", response_style: "concise", custom_instructions: "", profile_memory_enabled: true, conversation_memory_enabled: true, knowledge_memory_enabled: true, summary_enabled: true, context_message_limit: 12, model_name: "gpt", model_base_url: "", api_key: "", api_key_configured: false } });
    if (path === "/agent/capabilities") return route.fulfill({ json: { tools: [] } });
    if (path === "/attachments/config") return route.fulfill({ json: { storage: "local", vision_enabled: false, vision_ready: false, checks: [] } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/#/opportunities");
  await expect(page.getByRole("heading", { name: "值得优先查看" })).toBeVisible();
  await expect(page.getByText("完整岗位说明只在下一级详情页面展示。")).not.toBeVisible();
  await expect(page.getByRole("button", { name: /新建发现任务/ })).toHaveCount(0);
  await expect(page.getByText("近期融资公司")).toHaveCount(0);
  await expect(page.getByText("识别公司 ATS")).toHaveCount(0);

  await page.goto("/#/opportunities/new");
  await expect(page).toHaveURL(/#\/opportunities$/);
  await expect(page.getByRole("heading", { name: "选择发现方式" })).toHaveCount(0);

  await page.goto("/#/opportunities/pipeline");
  await expect(page.getByRole("heading", { name: "决定哪些岗位值得推进" })).toBeVisible();
  await expect(page.getByRole("button", { name: /分析全部/ })).toHaveCount(0);
  await page.getByRole("button", { name: "示例科技 · AI 产品经理" }).click();
  await expect(page).toHaveURL(/#\/opportunities\/jobs\/9$/);
  await expect(page.getByText("完整岗位说明只在下一级详情页面展示。")).toBeVisible();
});
